import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { storageRoot } from '../utils/storage.js';
import { runPythonScript, type ScriptRunResult } from './sourceToMarkdown.js';

export interface PptToolResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  metadata: Record<string, unknown>;
}

const PROJECT_ROOT = process.cwd();
const PPT_TOOLS_ROOT = path.join(PROJECT_ROOT, 'server', 'vendor', 'ppt_tools');
const TOOL_TIMEOUT_MS = Number(process.env.PPT_TOOLS_TIMEOUT_MS || 90_000);
const STORAGE_ROOT = path.resolve(storageRoot);

export async function analyzeImagesDirectory(imagesDir: string, canvas = 'ppt169'): Promise<PptToolResult> {
  const safeImagesDir = resolveStoragePath(imagesDir, '图片目录');
  const safeCanvas = normalizeCanvas(canvas);
  const scriptPath = path.join(PPT_TOOLS_ROOT, 'analyze_images.py');
  if (!existsSync(scriptPath)) {
    throw new Error('图片分析脚本不存在：analyze_images.py');
  }
  if (!existsSync(safeImagesDir)) {
    throw new Error('图片目录不存在');
  }

  const result = await runPythonScript(scriptPath, [safeImagesDir, '--canvas', safeCanvas], {
    cwd: PPT_TOOLS_ROOT,
    timeoutMs: TOOL_TIMEOUT_MS,
  });
  const csvPath = path.join(path.dirname(safeImagesDir), 'image_analysis.csv');
  const csv = await readFile(csvPath, 'utf-8').catch(() => '');

  return buildToolResult(result, {
    tool: 'analyze_images.py',
    imagesDir: safeImagesDir,
    canvas: safeCanvas,
    csvPath: csv || existsSync(csvPath) ? csvPath : null,
    csv,
  });
}

export async function renderLatexManifest(
  projectPath: string,
  options: {
    manifest?: string;
    dpi?: number;
    providers?: string;
    dryRun?: boolean;
  } = {},
): Promise<PptToolResult> {
  const safeProjectPath = resolveStoragePath(projectPath, '项目目录');
  const scriptPath = path.join(PPT_TOOLS_ROOT, 'latex_render.py');
  if (!existsSync(scriptPath)) {
    throw new Error('公式渲染脚本不存在：latex_render.py');
  }
  if (!existsSync(safeProjectPath)) {
    throw new Error('项目目录不存在');
  }

  const args = [safeProjectPath];
  const manifest = normalizeManifestPath(options.manifest);
  if (manifest) args.push('--manifest', manifest);
  args.push('--dpi', String(normalizeDpi(options.dpi)));
  const providers = normalizeProviders(options.providers);
  if (providers) args.push('--providers', providers);
  if (options.dryRun) args.push('--dry-run');

  const result = await runPythonScript(scriptPath, args, {
    cwd: PPT_TOOLS_ROOT,
    timeoutMs: Number(process.env.LATEX_RENDER_TIMEOUT_MS || TOOL_TIMEOUT_MS),
  });
  const manifestPath = path.join(safeProjectPath, manifest || 'images/formula_manifest.json');
  const manifestText = await readFile(manifestPath, 'utf-8').catch(() => '');

  return buildToolResult(result, {
    tool: 'latex_render.py',
    projectPath: safeProjectPath,
    manifest: manifest || 'images/formula_manifest.json',
    manifestPath,
    manifestText,
    dryRun: Boolean(options.dryRun),
  });
}

function buildToolResult(result: ScriptRunResult, metadata: Record<string, unknown>): PptToolResult {
  return {
    ok: result.ok,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    metadata,
  };
}

function resolveStoragePath(value: string, label: string) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error(`缺少${label}`);
  const resolved = path.resolve(raw);
  if (!isPathInside(resolved, STORAGE_ROOT)) {
    throw new Error(`${label}必须位于项目生成目录内`);
  }
  return resolved;
}

function isPathInside(target: string, root: string) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeCanvas(value: string) {
  const canvas = String(value || 'ppt169').trim();
  return /^[a-z0-9_-]{2,32}$/i.test(canvas) ? canvas : 'ppt169';
}

function normalizeDpi(value: unknown) {
  const dpi = Number(value);
  if (!Number.isFinite(dpi)) return 300;
  return Math.max(96, Math.min(600, Math.round(dpi)));
}

function normalizeProviders(value: unknown) {
  const providers = String(value || '').trim();
  if (!providers) return '';
  return providers
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter((provider) => /^[a-z0-9_-]{2,40}$/i.test(provider))
    .join(',');
}

function normalizeManifestPath(value: unknown) {
  const manifest = String(value || '').trim().replace(/\\/g, '/');
  if (!manifest) return '';
  if (manifest.startsWith('/') || manifest.includes('..')) {
    throw new Error('公式清单路径必须是项目目录内的相对路径');
  }
  if (!/^[a-z0-9_./-]+\.json$/i.test(manifest)) {
    throw new Error('公式清单路径格式不正确');
  }
  return manifest;
}
