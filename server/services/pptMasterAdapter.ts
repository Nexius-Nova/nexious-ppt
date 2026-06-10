import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DesignSpec } from '../engine/spec.js';
import type { NativeSvgPptxAnimationOptions } from '../engine/native-svg-pptx.js';

export interface AdapterRunResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface InputEnhancementSummary {
  originalContent: string;
  fileSummaries: Array<{
    name: string;
    kind: string;
    status: string;
    summary: string;
    warnings: string[];
  }>;
  imageSummaries: Array<{
    name: string;
    summary: string;
  }>;
  formulaCandidates: string[];
  sourceMap: Array<{
    type: 'user' | 'file' | 'image' | 'skill' | 'web';
    name: string;
    chars: number;
  }>;
}

const PROJECT_ROOT = process.cwd();
const VENDOR_ROOT = path.join(PROJECT_ROOT, 'server', 'vendor');
const PYTHON_BIN = process.env.PYTHON || process.env.PYTHON_BIN || 'python';
const TOOL_TIMEOUT_MS = Number(process.env.PPT_MASTER_TOOL_TIMEOUT_MS || 90_000);
const FORMULA_PATTERN = /(?:\$\$([\s\S]{2,300}?)\$\$|\$([^\n$]{2,180}?)\$|\\\(([\s\S]{2,180}?)\\\)|\\\[([\s\S]{2,300}?)\\\])/g;

export async function runVendorPython(
  scriptPath: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<AdapterRunResult> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON_BIN, [scriptPath, ...args], {
      cwd: options.cwd || VENDOR_ROOT,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        PYTHONPATH: [VENDOR_ROOT, process.env.PYTHONPATH || ''].filter(Boolean).join(path.delimiter),
        ...(options.env || {}),
      },
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
        stderr: clipOutput(`工具执行超时\n${Buffer.concat(stderr).toString('utf-8')}`),
      });
    }, options.timeoutMs || TOOL_TIMEOUT_MS);

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
      const exitCode = code ?? 1;
      resolve({
        ok: exitCode === 0,
        exitCode,
        stdout: clipOutput(Buffer.concat(stdout).toString('utf-8')),
        stderr: clipOutput(Buffer.concat(stderr).toString('utf-8')),
      });
    });
  });
}

export async function finalizeSvgProject(projectPath: string) {
  const scriptPath = path.join(VENDOR_ROOT, 'finalize_svg.py');
  if (!existsSync(scriptPath)) {
    throw new Error('SVG 后处理脚本不存在：finalize_svg.py');
  }
  const result = await runVendorPython(scriptPath, [projectPath, '--quiet'], {
    cwd: VENDOR_ROOT,
    timeoutMs: Number(process.env.SVG_FINALIZE_TIMEOUT_MS || TOOL_TIMEOUT_MS),
  });
  if (!result.ok) {
    throw new Error(`SVG 后处理失败：${clipOutput(result.stderr || result.stdout, 1200)}`);
  }
  return result;
}

export async function writeAnimationConfig(
  projectPath: string,
  pages: Array<{ pageNumber: number; svg: string }>,
  spec: DesignSpec,
  options?: NativeSvgPptxAnimationOptions,
) {
  const enabled = Boolean(options?.enabled);
  const configPath = path.join(projectPath, 'animations.json');
  if (!enabled) {
    await writeFile(
      configPath,
      JSON.stringify({ version: 1, defaults: { transition: { effect: 'none' }, animation: { effect: 'none' } }, slides: {} }, null, 2),
      'utf-8',
    );
    return configPath;
  }

  const effect = normalizeAnimationEffect(options?.effect, spec);
  const transitionEffect = normalizeTransitionEffect(options?.transitionEffect);
  const duration = clampNumber(options?.duration, 0.1, 3, 0.62);
  const stagger = clampNumber(options?.stagger, 0, 3, 0.24);
  const transitionDuration = clampNumber(options?.transitionDuration, 0.1, 3, 0.55);
  const trigger = options?.trigger === 'on-click' || options?.trigger === 'with-previous' ? options.trigger : 'after-previous';
  const slides: Record<string, any> = {};

  for (const page of pages) {
    const slide = spec.outline.find((item) => item.pageNumber === page.pageNumber) || spec.outline[page.pageNumber - 1];
    const stem = `${String(page.pageNumber).padStart(2, '0')}_${sanitizeName(slide?.title || `slide_${page.pageNumber}`)}`;
    const pageTransitionEffect = chooseSlideTransitionEffect(slide, transitionEffect, page.pageNumber);
    const groups = extractTopLevelGroups(page.svg)
      .filter((id) => !isStaticGroup(id))
      .slice(0, 12)
      .reduce<Record<string, any>>((acc, id, index) => {
        acc[id] = {
          order: index + 1,
          effect: chooseGroupEffect(id, effect, index),
          duration,
          stagger,
        };
        return acc;
      }, {});
    slides[stem] = {
      transition: { effect: pageTransitionEffect, duration: transitionDuration },
      animation: { effect, duration, stagger, trigger },
      groups,
    };
  }

  await writeFile(
    configPath,
    JSON.stringify({
      version: 1,
      defaults: {
        transition: { effect: transitionEffect, duration: transitionDuration },
        animation: { effect, duration, stagger, trigger },
      },
      slides,
    }, null, 2),
    'utf-8',
  );
  return configPath;
}

export function buildInputEnhancementSummary(input: {
  content?: string;
  files?: Array<{
    name?: string;
    text?: string;
    kind?: string;
    status?: string;
    summary?: string;
    warnings?: string[];
  }>;
  skillChunks?: string[];
}): InputEnhancementSummary {
  const originalContent = normalizeText(input.content || '');
  const files = Array.isArray(input.files) ? input.files : [];
  const skillChunks = Array.isArray(input.skillChunks) ? input.skillChunks.filter(Boolean) : [];
  const fileSummaries = files.map((file) => ({
    name: String(file.name || '未命名文件'),
    kind: String(file.kind || 'file'),
    status: String(file.status || 'partial'),
    summary: clipOutput(String(file.summary || firstMeaningfulLine(file.text || '') || '未提取到摘要'), 260),
    warnings: Array.isArray(file.warnings) ? file.warnings.map(String).filter(Boolean).slice(0, 5) : [],
  }));
  const imageSummaries = files
    .filter((file) => String(file.kind || '').toLowerCase() === 'image')
    .map((file) => ({
      name: String(file.name || '图片'),
      summary: clipOutput(String(file.text || file.summary || ''), 420),
    }))
    .filter((item) => item.summary);
  const formulaCandidates = extractFormulaCandidates([originalContent, ...files.map((file) => file.text || ''), ...skillChunks].join('\n\n'));
  const sourceMap = [
    originalContent ? { type: 'user' as const, name: '用户输入', chars: originalContent.length } : null,
    ...files.map((file) => ({
      type: String(file.kind || '') === 'image' ? 'image' as const : 'file' as const,
      name: String(file.name || '上传文件'),
      chars: String(file.text || '').length,
    })),
    ...skillChunks.map((chunk, index) => ({
      type: /web|搜索|资料收集/i.test(chunk) ? 'web' as const : 'skill' as const,
      name: `Skill 结果 ${index + 1}`,
      chars: chunk.length,
    })),
  ].filter(Boolean) as InputEnhancementSummary['sourceMap'];

  return { originalContent, fileSummaries, imageSummaries, formulaCandidates, sourceMap };
}

export function renderInputEnhancementMarkdown(summary: InputEnhancementSummary) {
  return [
    '## 输入资料处理摘要',
    '',
    summary.originalContent ? `### 用户原始输入\n${summary.originalContent}` : '',
    summary.fileSummaries.length
      ? `### 上传文件\n${summary.fileSummaries.map((file) => `- ${file.name}：${file.summary}${file.warnings.length ? `（提示：${file.warnings.join('；')}）` : ''}`).join('\n')}`
      : '',
    summary.imageSummaries.length
      ? `### 图片识别结果\n${summary.imageSummaries.map((image) => `- ${image.name}：${image.summary}`).join('\n')}`
      : '',
    summary.formulaCandidates.length
      ? `### 识别到的公式\n${summary.formulaCandidates.map((formula) => `- ${formula}`).join('\n')}`
      : '',
    summary.sourceMap.length
      ? `### 来源清单\n${summary.sourceMap.map((item) => `- ${item.type} / ${item.name} / ${item.chars} 字符`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n');
}

export async function writeFormulaManifest(projectPath: string, formulas: string[]) {
  const unique = Array.from(new Set(formulas.map((formula) => formula.trim()).filter(Boolean))).slice(0, 80);
  if (!unique.length) return null;
  const imagesDir = path.join(projectPath, 'images');
  await mkdir(imagesDir, { recursive: true });
  const manifestPath = path.join(imagesDir, 'formula_manifest.json');
  const manifest = {
    version: 1,
    providers: ['codecogs', 'quicklatex', 'mathpad', 'wikimedia'],
    items: unique.map((latex, index) => ({
      id: `formula_${String(index + 1).padStart(2, '0')}`,
      latex,
      filename: `formula_${String(index + 1).padStart(2, '0')}.png`,
      display: latex.length > 28 ? 'block' : 'inline',
      dpi: 300,
      color: '#111827',
      transparent: true,
    })),
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  return manifestPath;
}

export async function loadTextFile(filePath: string) {
  return readFile(filePath, 'utf-8').catch(() => '');
}

function extractTopLevelGroups(svg: string) {
  const body = String(svg || '').replace(/<defs\b[\s\S]*?<\/defs>/gi, '');
  const open = body.match(/<svg\b[^>]*>/i);
  const start = open ? (open.index || 0) + open[0].length : 0;
  const end = body.toLowerCase().lastIndexOf('</svg>');
  const rootContent = body.slice(start, end > start ? end : undefined);
  const ids: string[] = [];
  const tokenPattern = /<\/?g\b[^>]*>/gi;
  let depth = 0;
  let token: RegExpExecArray | null;

  while ((token = tokenPattern.exec(rootContent)) !== null) {
    if (token[0].startsWith('</')) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) {
      const id = token[0].match(/\bid\s*=\s*(['"])(.*?)\1/i)?.[2];
      if (id) ids.push(id);
    }
    if (!token[0].endsWith('/>')) depth += 1;
  }

  if (ids.length) return Array.from(new Set(ids));
  const groupPattern = /<g\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = groupPattern.exec(rootContent)) !== null) {
    const id = match[1].match(/\bid\s*=\s*(['"])(.*?)\1/i)?.[2];
    if (id) ids.push(id);
  }
  return Array.from(new Set(ids));
}

function isStaticGroup(id: string) {
  return /background|bg|decor|chrome|header|footer|watermark|page-number|pagenum/i.test(id);
}

function chooseGroupEffect(groupId: string, fallback: string, index: number) {
  if (/title|heading|headline/i.test(groupId)) return fallback === 'random' ? 'fade' : fallback;
  if (/chart|bar|timeline|matrix|table|process|flow/i.test(groupId)) return fallback === 'auto' || fallback === 'mixed' ? 'wipe' : fallback;
  if (/image|visual|hero/i.test(groupId)) return fallback === 'auto' || fallback === 'mixed' ? 'zoom' : fallback;
  if (fallback === 'auto' || fallback === 'mixed') return ['fade', 'wipe', 'fly', 'zoom'][index % 4];
  return fallback;
}

function chooseSlideTransitionEffect(slide: DesignSpec['outline'][number] | undefined, fallback: string, pageNumber: number) {
  if (fallback === 'random') return 'random';
  if (fallback !== 'auto') return fallback;
  const layout = String(slide?.layout || '').toLowerCase();
  const rhythm = String(slide?.rhythm || '').toLowerCase();
  if (layout === 'cover' || layout === 'chapter') return 'fade';
  if (layout === 'content-chart' || /chart|table|matrix|timeline|process|flow/i.test(String(slide?.chartHint || ''))) return 'wipe';
  if (layout === 'visual-focus' || layout === 'media-grid' || layout === 'mixed-media') return 'push';
  if (layout === 'ending') return 'fade';
  if (rhythm === 'dense') return pageNumber % 2 === 0 ? 'wipe' : 'split';
  return pageNumber % 3 === 0 ? 'cover' : 'fade';
}

function normalizeAnimationEffect(value: unknown, spec: DesignSpec) {
  const effect = String(value || '').trim();
  const allowed = new Set(['appear', 'fade', 'fly', 'cut', 'zoom', 'wipe', 'split', 'blinds', 'checkerboard', 'dissolve', 'random_bars', 'peek', 'wheel', 'box', 'circle', 'diamond', 'plus', 'strips', 'wedge', 'stretch', 'expand', 'swivel', 'auto', 'mixed', 'random']);
  if (allowed.has(effect)) return effect;
  const densePages = spec.outline.filter((slide) => slide.rhythm === 'dense').length;
  return densePages >= Math.max(2, spec.outline.length / 2) ? 'mixed' : 'fade';
}

function normalizeTransitionEffect(value: unknown) {
  const effect = String(value || '').trim();
  return ['fade', 'push', 'wipe', 'split', 'strips', 'cover', 'auto', 'random'].includes(effect) ? effect : 'auto';
}

function extractFormulaCandidates(text: string) {
  const formulas: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = FORMULA_PATTERN.exec(text)) !== null) {
    const formula = (match[1] || match[2] || match[3] || match[4] || '').trim();
    if (formula && /[=\\^_{}]/.test(formula)) formulas.push(formula);
  }
  return Array.from(new Set(formulas)).slice(0, 80);
}

function normalizeText(value: string) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

function firstMeaningfulLine(value: string) {
  return normalizeText(value).split('\n').map((line) => line.trim()).find(Boolean) || '';
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function sanitizeName(value: string): string {
  const safe = String(value || '')
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (safe || 'slide').slice(0, 80);
}

function clipOutput(value: string, maxLength = 6000) {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
