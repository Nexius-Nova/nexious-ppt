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

export interface NativeSvgPptxAnimationOptions {
  enabled?: boolean;
  effect?: NativeSvgPptxAnimationEffect;
  duration?: number;
  stagger?: number;
  trigger?: 'after-previous' | 'with-previous' | 'on-click';
  transitionEffect?: NativeSvgPptxTransitionEffect;
  transitionDuration?: number;
}

export type NativeSvgPptxAnimationEffect =
  | 'none'
  | 'appear'
  | 'fade'
  | 'fly'
  | 'cut'
  | 'zoom'
  | 'wipe'
  | 'split'
  | 'blinds'
  | 'checkerboard'
  | 'dissolve'
  | 'random_bars'
  | 'peek'
  | 'wheel'
  | 'box'
  | 'circle'
  | 'diamond'
  | 'plus'
  | 'strips'
  | 'wedge'
  | 'stretch'
  | 'expand'
  | 'swivel'
  | 'auto'
  | 'mixed'
  | 'random';

export type NativeSvgPptxTransitionEffect =
  | 'none'
  | 'fade'
  | 'push'
  | 'wipe'
  | 'split'
  | 'strips'
  | 'cover'
  | 'random';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.join(__dirname, 'native-svg-to-pptx-cli.py');
const PYTHON_BIN = process.env.PYTHON || process.env.PYTHON_BIN || 'python';

export async function exportNativeEditablePptx(
  projectPath: string,
  outputPath: string,
  spec: DesignSpec,
  animation?: NativeSvgPptxAnimationOptions,
): Promise<NativeSvgPptxResult> {
  const tracePath = `${outputPath}.trace.json`;
  const notesPath = path.join(projectPath, 'notes', 'export-notes.json');
  const animationConfigPath = path.join(projectPath, 'animations.json');
  const args = [
    CLI_PATH,
    '--project', projectPath,
    '--output', outputPath,
    '--format', spec.canvas.format,
    '--width', String(spec.canvas.width),
    '--height', String(spec.canvas.height),
    '--notes-json', notesPath,
    '--trace-json', tracePath,
    '--animation-config', animationConfigPath,
  ];

  const animationOptions = normalizeAnimationOptions(animation);
  if (animationOptions.enabled) {
    args.push(
      '--animation-effect', animationOptions.effect,
      '--animation-duration', String(animationOptions.duration),
      '--animation-stagger', String(animationOptions.stagger),
      '--animation-trigger', animationOptions.trigger,
      '--transition-effect', animationOptions.transitionEffect,
      '--transition-duration', String(animationOptions.transitionDuration),
    );
  }

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

function normalizeAnimationOptions(animation?: NativeSvgPptxAnimationOptions): Required<NativeSvgPptxAnimationOptions> {
  const enabled = Boolean(animation?.enabled);
  const effect = isAnimationEffect(animation?.effect)
    ? animation!.effect!
    : 'fade';
  const duration = clampNumber(animation?.duration, 0.1, 3, 0.45);
  const stagger = clampNumber(animation?.stagger, 0, 3, 0.18);
  const trigger = animation?.trigger === 'with-previous' || animation?.trigger === 'on-click'
    ? animation.trigger
    : 'after-previous';
  const transitionEffect = isTransitionEffect(animation?.transitionEffect)
    ? animation!.transitionEffect!
    : 'fade';
  const transitionDuration = clampNumber(animation?.transitionDuration, 0.1, 3, 0.45);
  return { enabled, effect, duration, stagger, trigger, transitionEffect, transitionDuration };
}

function isAnimationEffect(value: unknown): value is NativeSvgPptxAnimationEffect {
  return [
    'none',
    'appear',
    'fade',
    'fly',
    'cut',
    'zoom',
    'wipe',
    'split',
    'blinds',
    'checkerboard',
    'dissolve',
    'random_bars',
    'peek',
    'wheel',
    'box',
    'circle',
    'diamond',
    'plus',
    'strips',
    'wedge',
    'stretch',
    'expand',
    'swivel',
    'auto',
    'mixed',
    'random',
  ].includes(String(value));
}

function isTransitionEffect(value: unknown): value is NativeSvgPptxTransitionEffect {
  return ['none', 'fade', 'push', 'wipe', 'split', 'strips', 'cover', 'random'].includes(String(value));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
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
  const rasterOnlySlides: string[] = [];
  for (const slideFile of slideFiles) {
    const xml = await zip.file(slideFile)?.async('string');
    if (!xml) continue;
    const stats = inspectSlideEditability(xml);
    if (stats.editablePrimitiveCount > 0) {
      editableSlides += 1;
    }
    if (stats.isRasterOnlySnapshot) {
      rasterOnlySlides.push(slideFile);
    }
  }

  if (editableSlides !== slideFiles.length) {
    throw new Error(`可编辑形状检查失败：${editableSlides}/${slideFiles.length} 页包含原生形状。`);
  }

  if (rasterOnlySlides.length) {
    throw new Error(`检测到整页图片快照幻灯片，已拒绝导出不可编辑 PPT：${rasterOnlySlides.slice(0, 5).join(', ')}`);
  }

  const missingTargets = await findMissingRelationshipTargets(zip);
  if (missingTargets.length) {
    throw new Error(`PPTX 关系目标缺失：${missingTargets.slice(0, 3).join('; ')}`);
  }
}

function inspectSlideEditability(xml: string) {
  const shapeCount = countMatches(xml, /<p:sp\b/g);
  const groupCount = countMatches(xml, /<p:grpSp\b/g);
  const connectorCount = countMatches(xml, /<p:cxnSp\b/g);
  const textFrameCount = countMatches(xml, /<p:txBody\b/g);
  const picBlocks = xml.match(/<p:pic\b[\s\S]*?<\/p:pic>/g) || [];
  const hasFullSlidePicture = picBlocks.some((block) => isFullSlidePicture(block));
  const editablePrimitiveCount = shapeCount + groupCount + connectorCount;

  return {
    editablePrimitiveCount,
    isRasterOnlySnapshot:
      picBlocks.length > 0
      && hasFullSlidePicture
      && textFrameCount === 0
      && editablePrimitiveCount <= 1,
  };
}

function countMatches(value: string, pattern: RegExp) {
  return (value.match(pattern) || []).length;
}

function isFullSlidePicture(picXml: string) {
  const off = picXml.match(/<a:off\b[^>]*\bx="(-?\d+)"[^>]*\by="(-?\d+)"/);
  const ext = picXml.match(/<a:ext\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  if (!off || !ext) return false;

  const x = Number(off[1]);
  const y = Number(off[2]);
  const cx = Number(ext[1]);
  const cy = Number(ext[2]);
  const wide16x9 = { cx: 12192000, cy: 6858000 };
  const standard4x3 = { cx: 9144000, cy: 6858000 };

  return Math.abs(x) <= 5000
    && Math.abs(y) <= 5000
    && (isNearSize(cx, cy, wide16x9) || isNearSize(cx, cy, standard4x3));
}

function isNearSize(cx: number, cy: number, size: { cx: number; cy: number }) {
  const tolerance = 50000;
  return Math.abs(cx - size.cx) <= tolerance && Math.abs(cy - size.cy) <= tolerance;
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
