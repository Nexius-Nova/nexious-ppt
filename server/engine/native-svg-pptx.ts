import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import type { DesignSpec } from './spec.js';
import { repairPptxPackage } from './svg-to-pptx.js';

export interface NativeSvgPptxResult {
  buffer: Buffer;
  outputPath: string;
  tracePath: string;
  logs: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.join(__dirname, 'native-svg-to-pptx-cli.py');
const PYTHON_BIN = process.env.PYTHON || process.env.PYTHON_BIN || 'python';

export async function exportNativeEditablePptx(
  projectPath: string,
  outputPath: string,
  spec: DesignSpec,
): Promise<NativeSvgPptxResult> {
  const tracePath = `${outputPath}.trace.json`;
  const notesPath = path.join(projectPath, 'notes', 'export-notes.json');
  const args = [
    CLI_PATH,
    '--project', projectPath,
    '--output', outputPath,
    '--format', spec.canvas.format,
    '--width', String(spec.canvas.width),
    '--height', String(spec.canvas.height),
    '--notes-json', notesPath,
    '--trace-json', tracePath,
  ];

  const run = await runPython(args);
  const cliPayload = parseCliPayload(run.stdout);
  const cliError = cliPayload?.error || run.stderr || run.stdout || `python exited with ${run.exitCode}`;
  if (run.exitCode !== 0 || !cliPayload?.ok) {
    throw new Error(`可编辑 PPTX 导出失败：${clipLog(cliError)}`);
  }

  const raw = await readFile(outputPath);
  const repaired = await repairPptxPackage(raw);
  await assertEditablePptx(repaired);

  return {
    buffer: repaired,
    outputPath,
    tracePath,
    logs: [
      '已生成可编辑 PPTX：SVG 元素转换为 PowerPoint 原生形状、文本框和图片。',
      `可编辑导出诊断：${tracePath}`,
    ],
  };
}

async function runPython(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON_BIN, args, {
      cwd: path.resolve(__dirname, '..', '..'),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', (error) => {
      resolve({ exitCode: 1, stdout: '', stderr: error.message });
    });
    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf-8'),
        stderr: Buffer.concat(stderr).toString('utf-8'),
      });
    });
  });
}

function parseCliPayload(stdout: string): Record<string, any> | null {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      continue;
    }
  }
  return null;
}

async function assertEditablePptx(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(sortSlides);

  if (!slideFiles.length) {
    throw new Error('PPTX 中没有幻灯片。');
  }

  let editableSlides = 0;
  for (const slideFile of slideFiles) {
    const xml = await zip.file(slideFile)?.async('string');
    if (!xml) continue;
    if (/<p:(?:sp|grpSp|cxnSp)\b/.test(xml)) {
      editableSlides += 1;
    }
  }

  if (editableSlides !== slideFiles.length) {
    throw new Error(`可编辑形状检查失败：${editableSlides}/${slideFiles.length} 页包含原生形状。`);
  }

  const missingTargets = await findMissingRelationshipTargets(zip);
  if (missingTargets.length) {
    throw new Error(`PPTX 关系目标缺失：${missingTargets.slice(0, 3).join('; ')}`);
  }
}

async function findMissingRelationshipTargets(zip: JSZip): Promise<string[]> {
  const missing: string[] = [];
  const relFiles = Object.keys(zip.files).filter((name) => name.endsWith('.rels'));
  for (const relFile of relFiles) {
    const xml = await zip.file(relFile)?.async('string');
    if (!xml) continue;
    const baseDir = relationshipBaseDir(relFile);
    const matches = xml.matchAll(/<Relationship\b[^>]*Target="([^"]+)"[^>]*>/g);
    for (const match of matches) {
      const target = match[1];
      if (!target || target.includes('://') || target.startsWith('#')) continue;
      const cleanTarget = target.split('#')[0].split('?')[0];
      const resolved = path.posix.normalize(path.posix.join(baseDir, cleanTarget)).replace(/^\/+/, '');
      if (!zip.file(resolved)) {
        missing.push(`${relFile} -> ${target}`);
      }
    }
  }
  return missing;
}

function relationshipBaseDir(relFile: string) {
  if (relFile === '_rels/.rels') return '';
  const marker = '/_rels/';
  const markerIndex = relFile.lastIndexOf(marker);
  if (markerIndex < 0) return path.posix.dirname(relFile);
  return relFile.slice(0, markerIndex + 1);
}

function sortSlides(a: string, b: string) {
  return slideNumber(a) - slideNumber(b);
}

function slideNumber(value: string) {
  return Number(value.match(/slide(\d+)\.xml$/)?.[1] || 0);
}

function clipLog(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
}
