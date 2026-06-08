import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { storageRoot } from '../utils/storage.js';

export interface SourceToMarkdownResult {
  ok: boolean;
  text: string;
  warnings: string[];
  metadata: Record<string, unknown>;
}

export interface ScriptRunResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

const PROJECT_ROOT = process.cwd();
const SOURCE_TO_MD_ROOT = path.join(PROJECT_ROOT, 'server', 'vendor', 'source_to_md');
const PYTHON_BIN = process.env.PYTHON || process.env.PYTHON_BIN || 'python';
const TMP_ROOT = path.join(storageRoot, 'tmp', 'source-to-md');
const SCRIPT_TIMEOUT_MS = Number(process.env.SOURCE_TO_MD_TIMEOUT_MS || 60_000);
const MAX_SCRIPT_OUTPUT_CHARS = Number(process.env.SOURCE_TO_MD_OUTPUT_MAX_CHARS || 120_000);

const SCRIPT_BY_EXTENSION: Record<string, string> = {
  pdf: 'pdf_to_md.py',
  doc: 'doc_to_md.py',
  docx: 'doc_to_md.py',
  html: 'doc_to_md.py',
  htm: 'doc_to_md.py',
  epub: 'doc_to_md.py',
  ipynb: 'doc_to_md.py',
  xlsx: 'excel_to_md.py',
  xlsm: 'excel_to_md.py',
  pptx: 'ppt_to_md.py',
  pptm: 'ppt_to_md.py',
  ppsx: 'ppt_to_md.py',
  ppsm: 'ppt_to_md.py',
  potx: 'ppt_to_md.py',
  potm: 'ppt_to_md.py',
};

export function supportsSourceToMarkdown(extension: string) {
  return Boolean(SCRIPT_BY_EXTENSION[extension.toLowerCase()]);
}

export async function convertInputFileWithSourceToMarkdown(
  filename: string,
  buffer: Buffer,
  extension: string
): Promise<SourceToMarkdownResult | null> {
  const normalizedExtension = extension.toLowerCase();
  const scriptName = SCRIPT_BY_EXTENSION[normalizedExtension];
  if (!scriptName) return null;

  const scriptPath = path.join(SOURCE_TO_MD_ROOT, scriptName);
  if (!existsSync(scriptPath)) {
    return {
      ok: false,
      text: '',
      warnings: [`文件解析脚本不存在，已回退到内置解析：${scriptName}`],
      metadata: { sourceToMd: { script: scriptName, ok: false, reason: 'missing-script' } },
    };
  }

  const workDir = path.join(TMP_ROOT, `parse-${Date.now()}-${randomUUID()}`);
  const safeName = sanitizeLocalFileName(filename) || `input.${normalizedExtension}`;
  const inputPath = path.join(workDir, safeName);
  const outputPath = path.join(workDir, 'output.md');
  await mkdir(workDir, { recursive: true });

  try {
    await writeFile(inputPath, buffer);
    const result = await runPythonScript(scriptPath, [inputPath, '-o', outputPath], {
      cwd: SOURCE_TO_MD_ROOT,
      timeoutMs: SCRIPT_TIMEOUT_MS,
    });

    if (!result.ok) {
      return {
        ok: false,
        text: '',
        warnings: [`Python 文件解析未完成，已回退到内置解析：${clipOutput(result.stderr || result.stdout, 700)}`],
        metadata: { sourceToMd: { script: scriptName, ok: false, exitCode: result.exitCode } },
      };
    }

    const text = await readFile(outputPath, 'utf-8').catch(async () => result.stdout);
    const normalizedText = normalizeMarkdown(text);
    return {
      ok: Boolean(normalizedText),
      text: normalizedText,
      warnings: result.stderr.trim()
        ? [`Python 文件解析提示：${clipOutput(result.stderr, 700)}`]
        : [],
      metadata: { sourceToMd: { script: scriptName, ok: Boolean(normalizedText), exitCode: result.exitCode } },
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function convertWebUrlToMarkdown(url: string): Promise<SourceToMarkdownResult> {
  const safeUrl = normalizeHttpUrl(url);
  const scriptPath = path.join(SOURCE_TO_MD_ROOT, 'web_to_md.py');
  if (!existsSync(scriptPath)) {
    return {
      ok: false,
      text: '',
      warnings: ['网页解析脚本不存在：web_to_md.py'],
      metadata: { sourceToMd: { script: 'web_to_md.py', ok: false, reason: 'missing-script' } },
    };
  }

  const workDir = path.join(TMP_ROOT, `web-${Date.now()}-${randomUUID()}`);
  const outputPath = path.join(workDir, 'output.md');
  await mkdir(workDir, { recursive: true });

  try {
    const result = await runPythonScript(scriptPath, [safeUrl, '-o', outputPath], {
      cwd: SOURCE_TO_MD_ROOT,
      timeoutMs: Number(process.env.WEB_TO_MD_TIMEOUT_MS || SCRIPT_TIMEOUT_MS),
    });
    if (!result.ok) {
      return {
        ok: false,
        text: '',
        warnings: [`网页解析失败：${clipOutput(result.stderr || result.stdout, 900)}`],
        metadata: { sourceToMd: { script: 'web_to_md.py', ok: false, exitCode: result.exitCode, url: safeUrl } },
      };
    }
    const text = await readFile(outputPath, 'utf-8').catch(async () => result.stdout);
    const normalizedText = normalizeMarkdown(text);
    return {
      ok: Boolean(normalizedText),
      text: normalizedText,
      warnings: result.stderr.trim() ? [`网页解析提示：${clipOutput(result.stderr, 700)}`] : [],
      metadata: { sourceToMd: { script: 'web_to_md.py', ok: Boolean(normalizedText), exitCode: result.exitCode, url: safeUrl } },
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function runPythonScript(
  scriptPath: string,
  args: string[],
  options: { cwd: string; timeoutMs: number }
): Promise<ScriptRunResult> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON_BIN, [scriptPath, ...args], {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({
        ok: false,
        exitCode: 124,
        stdout: clipOutput(Buffer.concat(stdout).toString('utf-8')),
        stderr: clipOutput(`脚本执行超时\n${Buffer.concat(stderr).toString('utf-8')}`),
      });
    }, options.timeoutMs);

    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, exitCode: 1, stdout: '', stderr: error.message });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: (code ?? 1) === 0,
        exitCode: code ?? 1,
        stdout: clipOutput(Buffer.concat(stdout).toString('utf-8')),
        stderr: clipOutput(Buffer.concat(stderr).toString('utf-8')),
      });
    });
  });
}

function normalizeHttpUrl(value: string) {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('仅支持 http/https 网页地址');
  }
  return url.toString();
}

function normalizeMarkdown(value: string) {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function sanitizeLocalFileName(value: string) {
  const ext = path.extname(value);
  const stem = path.basename(value, ext)
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return `${stem || 'input'}${ext}`;
}

function clipOutput(value: string, maxLength = MAX_SCRIPT_OUTPUT_CHARS) {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
