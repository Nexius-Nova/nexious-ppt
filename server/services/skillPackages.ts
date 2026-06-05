import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { query } from '../db/connection.js';

export type SkillRuntime = 'prompt-only' | 'python' | 'node';
export type SkillInstallStatus = 'not_required' | 'pending' | 'installing' | 'ready' | 'failed';

interface SkillManifest {
  name?: string;
  description?: string;
  icon?: string;
  category?: string;
  runtime?: SkillRuntime;
  entry?: string;
  parameters?: Record<string, unknown>;
}

interface PackageAnalysis {
  name: string;
  description: string;
  icon: string;
  category: string;
  parameters: Record<string, unknown>;
  runtime: SkillRuntime;
  entry: string | null;
  dependencyFile: string | null;
  inferredDependencies: string[];
  manifest: SkillManifest & {
    skillMdPath?: string;
    skillJsonPath?: string;
    files?: string[];
    inferredDependencies?: string[];
  };
  files: Array<{ relativePath: string; data: Buffer }>;
}

export interface SkillPackagePreviewFile {
  path: string;
  size: number;
  role: 'skill-md' | 'manifest' | 'dependency' | 'entry' | 'source' | 'asset';
}

export interface SkillPackagePreview {
  name: string;
  description: string;
  icon: string;
  category: string;
  runtime: SkillRuntime;
  entry: string | null;
  dependencyFile: string | null;
  inferredDependencies: string[];
  skillMdPath: string;
  skillJsonPath: string | null;
  fileCount: number;
  totalSize: number;
  instructionPreview: string;
  files: SkillPackagePreviewFile[];
}

const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const RUN_TIMEOUT_MS = 2 * 60 * 1000;
const storageRoot = path.join(process.cwd(), '.generated', 'skills');

function stripDataUrl(value: string) {
  const commaIndex = value.indexOf(',');
  return value.startsWith('data:') && commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
}

function safeRelativePath(input: string) {
  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '');
  const resolved = path.posix.normalize(normalized);
  if (!resolved || resolved === '.' || resolved.startsWith('../') || resolved.includes('/../')) {
    throw new Error(`Invalid package path: ${input}`);
  }
  return resolved;
}

function parseFrontMatter(content: string): SkillManifest {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};
  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (endIndex <= 0) return {};

  const manifest: SkillManifest = {};
  for (const rawLine of lines.slice(1, endIndex)) {
    const match = rawLine.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (!match) continue;
    const key = match[1].trim();
    const rawValue = match[2].trim().replace(/^['"]|['"]$/g, '');
    if (key === 'name') manifest.name = rawValue;
    if (key === 'description') manifest.description = rawValue;
    if (key === 'icon') manifest.icon = rawValue;
    if (key === 'category') manifest.category = rawValue;
    if (key === 'runtime' && ['prompt-only', 'python', 'node'].includes(rawValue)) {
      manifest.runtime = rawValue as SkillRuntime;
    }
    if (key === 'entry') manifest.entry = rawValue;
  }

  return manifest;
}

function parseSkillInstruction(content: string) {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return content.trim();
  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  return endIndex > 0 ? lines.slice(endIndex + 1).join('\n').trim() : content.trim();
}

function parseJsonManifest(content: string): SkillManifest {
  try {
    const data = JSON.parse(content);
    return {
      name: typeof data.name === 'string' ? data.name : undefined,
      description: typeof data.description === 'string' ? data.description : undefined,
      icon: typeof data.icon === 'string' ? data.icon : undefined,
      category: typeof data.category === 'string' ? data.category : undefined,
      runtime: ['prompt-only', 'python', 'node'].includes(data.runtime) ? data.runtime : undefined,
      entry: typeof data.entry === 'string' ? data.entry : undefined,
      parameters: data.parameters && typeof data.parameters === 'object' ? data.parameters : undefined,
    };
  } catch {
    return {};
  }
}

function pickFile(files: Map<string, Buffer>, candidates: string[]) {
  const normalizedCandidates = candidates.map((item) => item.toLowerCase());
  for (const [filePath] of files) {
    const lower = filePath.toLowerCase();
    if (normalizedCandidates.includes(lower) || normalizedCandidates.some((candidate) => lower.endsWith(`/${candidate}`))) {
      return filePath;
    }
  }
  return null;
}

function inferEntry(files: Map<string, Buffer>, manifest: SkillManifest) {
  if (manifest.entry) return safeRelativePath(manifest.entry);
  const conventionalEntry = pickFile(files, ['run.py', 'main.py', 'index.py', 'run.js', 'main.js', 'index.js']);
  if (conventionalEntry) return conventionalEntry;

  const scriptEntries = Array.from(files.keys())
    .filter((filePath) => /^scripts\/[^/]+\.(py|js|mjs|cjs)$/i.test(filePath))
    .sort((a, b) => {
      const score = (value: string) => (/search|parse|run|main|index/i.test(value) ? 0 : 1);
      return score(a) - score(b) || a.localeCompare(b);
    });
  return scriptEntries[0] || null;
}

function inferRuntime(files: Map<string, Buffer>, manifest: SkillManifest, entry: string | null): SkillRuntime {
  if (manifest.runtime) return manifest.runtime;
  if (pickFile(files, ['requirements.txt']) || entry?.endsWith('.py')) return 'python';
  if (pickFile(files, ['package.json']) || entry?.endsWith('.js') || entry?.endsWith('.mjs') || entry?.endsWith('.cjs')) return 'node';
  return 'prompt-only';
}

const PYTHON_IMPORT_DEPENDENCIES: Record<string, string> = {
  duckduckgo_search: 'duckduckgo-search',
  bs4: 'beautifulsoup4',
  PIL: 'Pillow',
  pptx: 'python-pptx',
  docx: 'python-docx',
  yaml: 'PyYAML',
  cv2: 'opencv-python',
};

const PYTHON_STDLIB_MODULES = new Set([
  'argparse', 'asyncio', 'base64', 'collections', 'csv', 'datetime', 'functools', 'hashlib',
  'html', 'io', 'itertools', 'json', 'logging', 'math', 'os', 'pathlib', 'random', 're',
  'shutil', 'statistics', 'string', 'subprocess', 'sys', 'tempfile', 'textwrap', 'time',
  'typing', 'uuid', 'urllib', 'xml', 'zipfile',
]);

function inferPythonDependencies(files: Map<string, Buffer>) {
  const dependencies = new Set<string>();

  for (const [filePath, data] of files) {
    if (!filePath.endsWith('.py')) continue;
    const source = data.toString('utf8');

    for (const match of source.matchAll(/pip\s+install\s+([A-Za-z0-9_.-]+)/gi)) {
      dependencies.add(match[1]);
    }

    for (const match of source.matchAll(/^\s*(?:from|import)\s+([A-Za-z_][\w.]*)/gm)) {
      const moduleName = match[1].split('.')[0];
      if (!moduleName || PYTHON_STDLIB_MODULES.has(moduleName)) continue;
      dependencies.add(PYTHON_IMPORT_DEPENDENCIES[moduleName] || moduleName.replace(/_/g, '-'));
    }
  }

  return Array.from(dependencies).sort((a, b) => a.localeCompare(b));
}

function normalizePackage(files: Map<string, Buffer>, fallbackName: string): PackageAnalysis {
  const skillMdPath = pickFile(files, ['SKILL.md', 'skill.md']);
  if (!skillMdPath) throw new Error('SKILL.md is required in the skill package.');

  const skillMd = files.get(skillMdPath)!.toString('utf8');
  const frontMatter = parseFrontMatter(skillMd);
  const skillJsonPath = pickFile(files, ['skill.json']);
  const jsonManifest = skillJsonPath ? parseJsonManifest(files.get(skillJsonPath)!.toString('utf8')) : {};
  const manifest: SkillManifest = { ...frontMatter, ...jsonManifest };
  const entry = inferEntry(files, manifest);
  const runtime = inferRuntime(files, manifest, entry);
  const dependencyFile =
    runtime === 'python'
      ? pickFile(files, ['requirements.txt'])
      : runtime === 'node'
        ? pickFile(files, ['package.json'])
        : null;
  const inferredDependencies = runtime === 'python' && !dependencyFile
    ? inferPythonDependencies(files)
    : [];
  const instruction = parseSkillInstruction(skillMd);

  return {
    name: manifest.name || path.parse(fallbackName).name || 'Untitled Skill',
    description: manifest.description || 'Uploaded skill package',
    icon: manifest.icon || 'Zap',
    category: manifest.category || '资料收集',
    parameters: {
      ...(manifest.parameters || {}),
      instruction,
      packageFileCount: files.size,
      inferredDependencies,
    },
    runtime,
    entry: runtime === 'prompt-only' ? null : entry,
    dependencyFile,
    inferredDependencies,
    manifest: {
      ...manifest,
      skillMdPath,
      skillJsonPath: skillJsonPath || undefined,
      files: Array.from(files.keys()),
      inferredDependencies,
    },
    files: Array.from(files.entries()).map(([relativePath, data]) => ({ relativePath, data })),
  };
}

async function analyzePackage(filename: string, dataBase64: string): Promise<PackageAnalysis> {
  const buffer = Buffer.from(stripDataUrl(dataBase64), 'base64');
  if (!buffer.length) throw new Error('Skill package is empty.');
  if (buffer.byteLength > MAX_PACKAGE_BYTES) throw new Error('Skill package must be smaller than 20MB.');

  const lowerName = filename.toLowerCase();
  const files = new Map<string, Buffer>();

  if (lowerName.endsWith('.md')) {
    files.set('SKILL.md', buffer);
    return normalizePackage(files, filename);
  }

  const zip = await JSZip.loadAsync(buffer);
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const relativePath = safeRelativePath(entry.name);
    const data = await entry.async('nodebuffer');
    if (data.byteLength > MAX_FILE_BYTES) {
      throw new Error(`File too large in package: ${relativePath}`);
    }
    files.set(relativePath, data);
  }

  if (!files.size) throw new Error('Skill package contains no usable files.');
  return normalizePackage(files, filename);
}

async function analyzePackageDirectory(packagePath: string): Promise<PackageAnalysis> {
  const files = new Map<string, Buffer>();

  async function walk(currentDir: string) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.venv' || entry.name === '__pycache__') continue;
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = safeRelativePath(path.relative(packagePath, absolutePath));
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        const data = await fs.readFile(absolutePath);
        files.set(relativePath, data);
      }
    }
  }

  await walk(packagePath);
  if (!files.size) throw new Error('Skill package contains no usable files.');
  return normalizePackage(files, path.basename(packagePath));
}

function classifyPackageFile(analysis: PackageAnalysis, relativePath: string): SkillPackagePreviewFile['role'] {
  if (relativePath === analysis.manifest.skillMdPath) return 'skill-md';
  if (relativePath === analysis.manifest.skillJsonPath) return 'manifest';
  if (relativePath === analysis.dependencyFile) return 'dependency';
  if (relativePath === analysis.entry) return 'entry';
  if (/\.(py|js|mjs|cjs|ts|tsx)$/i.test(relativePath)) return 'source';
  return 'asset';
}

function packageAnalysisToPreview(analysis: PackageAnalysis): SkillPackagePreview {
  const instruction = String(analysis.parameters.instruction || '');
  return {
    name: analysis.name,
    description: analysis.description,
    icon: analysis.icon,
    category: analysis.category,
    runtime: analysis.runtime,
    entry: analysis.entry,
    dependencyFile: analysis.dependencyFile,
    inferredDependencies: analysis.inferredDependencies,
    skillMdPath: analysis.manifest.skillMdPath || 'SKILL.md',
    skillJsonPath: analysis.manifest.skillJsonPath || null,
    fileCount: analysis.files.length,
    totalSize: analysis.files.reduce((sum, file) => sum + file.data.byteLength, 0),
    instructionPreview: instruction.length > 360 ? `${instruction.slice(0, 360)}...` : instruction,
    files: analysis.files
      .map((file) => ({
        path: file.relativePath,
        size: file.data.byteLength,
        role: classifyPackageFile(analysis, file.relativePath),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export async function previewSkillPackage(filename: string, dataBase64: string): Promise<SkillPackagePreview> {
  return packageAnalysisToPreview(await analyzePackage(filename, dataBase64));
}

async function writePackageFiles(baseDir: string, files: PackageAnalysis['files']) {
  await fs.rm(baseDir, { recursive: true, force: true });
  await fs.mkdir(baseDir, { recursive: true });

  for (const file of files) {
    const target = path.join(baseDir, file.relativePath);
    const resolvedTarget = path.resolve(target);
    const resolvedBase = path.resolve(baseDir);
    if (!resolvedTarget.startsWith(resolvedBase + path.sep) && resolvedTarget !== resolvedBase) {
      throw new Error(`Invalid package path: ${file.relativePath}`);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.data);
  }
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; input?: string }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`Process timeout: ${command} ${args.join(' ')}`));
    }, options.timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error((stderr || stdout || `Process exited with code ${code}`).trim()));
      }
    });
    child.stdin.end(options.input || '');
  });
}

function pythonExecutable(packagePath: string) {
  return process.platform === 'win32'
    ? path.join(packagePath, '.venv', 'Scripts', 'python.exe')
    : path.join(packagePath, '.venv', 'bin', 'python');
}

function pipExecutable(packagePath: string) {
  return process.platform === 'win32'
    ? path.join(packagePath, '.venv', 'Scripts', 'pip.exe')
    : path.join(packagePath, '.venv', 'bin', 'pip');
}

function compactRunText(value: string, maxLength = 900) {
  const normalized = value.trim().replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function hasSkillRuntimeError(stderrText: string) {
  if (!stderrText.trim()) return false;
  return [
    /Traceback \(most recent call last\)/i,
    /\bException\b/i,
    /\bError\b/i,
    /Error performing/i,
    /Missing required dependency/i,
    /ModuleNotFoundError/i,
    /ImportError/i,
    /Process timeout/i,
  ].some((pattern) => pattern.test(stderrText));
}

function isSearchLikeSkill(skill: any, payload: { phase?: string; input?: unknown }) {
  const inputRecord = extractInputRecord(payload.input);
  const text = [
    skill?.name,
    skill?.description,
    skill?.category,
    skill?.entry,
    inputRecord.purpose,
  ].filter(Boolean).join(' ').toLowerCase();
  return /search|web|collect|bing|google|duckduckgo|资料收集|搜索|联网/.test(text);
}

function isEmptySkillOutput(outputText: string, stderrText: string, searchLike: boolean) {
  const normalized = outputText.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!normalized) return true;
  if (/^no results found\.?$/.test(normalized)) return true;
  if (/^none$|^null$|^\[\]$|^\{\}$/.test(normalized)) return true;
  if (searchLike && /found\s+0\s+result/i.test(`${outputText}\n${stderrText}`)) return true;
  return false;
}

function validateSkillRunOutput(
  skill: any,
  payload: { phase?: string; input?: unknown },
  outputText: string,
  stderrText: string
) {
  if (hasSkillRuntimeError(stderrText)) {
    return {
      ok: false,
      message: `Skill 执行异常：${compactRunText(stderrText, 800)}`,
    };
  }

  if (isEmptySkillOutput(outputText, stderrText, isSearchLikeSkill(skill, payload))) {
    return {
      ok: false,
      message: outputText.trim()
        ? `Skill 未返回有效内容：${compactRunText(outputText, 300)}`
        : 'Skill 未返回有效内容。',
    };
  }

  return { ok: true, message: '' };
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function updateSkillInstallStatus(skillId: number, status: SkillInstallStatus, log: string, installed = false) {
  await query(
    `UPDATE skills
     SET install_status = ?, install_log = ?, last_installed_at = ${installed ? 'CURRENT_TIMESTAMP' : 'last_installed_at'}
     WHERE id = ?`,
    [status, log.slice(-12000), skillId]
  );
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function initializeSkillEnvironment(skillId: number) {
  const rows = await query<any>(
    'SELECT id, runtime, package_path, dependency_file, parameters FROM skills WHERE id = ?',
    [skillId]
  );
  const skill = rows[0];
  if (!skill) return;

  const packagePath = String(skill.package_path || '');
  let runtime = skill.runtime as SkillRuntime;
  let dependencyFile = skill.dependency_file ? String(skill.dependency_file) : null;
  let inferredDependencies: string[] = [];

  if (packagePath) {
    try {
      const analysis = await analyzePackageDirectory(packagePath);
      runtime = analysis.runtime;
      dependencyFile = analysis.dependencyFile;
      inferredDependencies = analysis.inferredDependencies;
      const nextParameters = {
        ...parseJsonRecord(skill.parameters),
        packageFileCount: analysis.files.length,
        inferredDependencies: analysis.inferredDependencies,
      };
      await query(
        `UPDATE skills
         SET runtime = ?, entry = ?, dependency_file = ?, manifest = ?, parameters = ?
         WHERE id = ?`,
        [
          analysis.runtime,
          analysis.entry,
          analysis.dependencyFile,
          JSON.stringify(analysis.manifest),
          JSON.stringify(nextParameters),
          skillId,
        ]
      );
    } catch (error) {
      await updateSkillInstallStatus(skillId, 'failed', error instanceof Error ? error.message : 'Skill package scan failed.');
      return;
    }
  }

  if (runtime === 'prompt-only') {
    await updateSkillInstallStatus(skillId, 'not_required', 'No dependency initialization is required.', true);
    return;
  }

  await updateSkillInstallStatus(skillId, 'installing', 'Initializing runtime environment...');

  try {
    let log = '';
    if (runtime === 'python') {
      const pythonBin = process.env.PYTHON_BIN || 'python';
      const venvPython = pythonExecutable(packagePath);
      if (!(await fileExists(venvPython))) {
        const result = await runProcess(pythonBin, ['-m', 'venv', '.venv'], {
          cwd: packagePath,
          timeoutMs: INSTALL_TIMEOUT_MS,
        });
        log += result.stdout + result.stderr;
      }
      if (dependencyFile) {
        const result = await runProcess(pipExecutable(packagePath), ['install', '-r', path.join(packagePath, dependencyFile)], {
          cwd: packagePath,
          timeoutMs: INSTALL_TIMEOUT_MS,
        });
        log += result.stdout + result.stderr;
      } else if (inferredDependencies.length) {
        const result = await runProcess(pipExecutable(packagePath), ['install', ...inferredDependencies], {
          cwd: packagePath,
          timeoutMs: INSTALL_TIMEOUT_MS,
        });
        log += [
          `自动识别 Python 依赖：${inferredDependencies.join(', ')}`,
          result.stdout,
          result.stderr,
        ].filter(Boolean).join('\n');
      }
    }

    if (runtime === 'node') {
      const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
      const dependencyDir = dependencyFile ? path.dirname(path.join(packagePath, dependencyFile)) : packagePath;
      const result = await runProcess(pnpmBin, ['install', '--prod'], {
        cwd: dependencyDir,
        timeoutMs: INSTALL_TIMEOUT_MS,
      });
      log += result.stdout + result.stderr;
    }

    await updateSkillInstallStatus(skillId, 'ready', log.trim() || 'Runtime environment is ready.', true);
  } catch (error) {
    await updateSkillInstallStatus(skillId, 'failed', error instanceof Error ? error.message : 'Runtime initialization failed.');
  }
}

export async function createSkillFromPackage(userId: number, filename: string, dataBase64: string) {
  const analysis = await analyzePackage(filename, dataBase64);
  const initialStatus: SkillInstallStatus = analysis.runtime === 'prompt-only' ? 'not_required' : 'pending';
  const result = await query<any>(
    `INSERT INTO skills
      (user_id, name, description, icon, category, parameters, is_enabled, type, runtime, entry, manifest, dependency_file, install_status, install_log)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      analysis.name,
      analysis.description,
      analysis.icon,
      analysis.category,
      JSON.stringify(analysis.parameters),
      analysis.runtime === 'prompt-only' ? 'prompt-only' : 'package',
      analysis.runtime,
      analysis.entry,
      JSON.stringify(analysis.manifest),
      analysis.dependencyFile,
      initialStatus,
      analysis.runtime === 'prompt-only' ? 'No dependency initialization is required.' : 'Package saved. Runtime initialization is pending.',
    ]
  );

  const skillId = Number((result as any).insertId);
  const packagePath = path.join(storageRoot, String(userId), String(skillId));
  await writePackageFiles(packagePath, analysis.files);
  await query('UPDATE skills SET package_path = ? WHERE id = ?', [packagePath, skillId]);

  void initializeSkillEnvironment(skillId).catch((error) => {
    console.error('Skill runtime initialization failed', error);
  });

  return skillId;
}

export async function runSkillPackage(
  userId: number,
  skillId: number,
  payload: { projectId?: string; phase?: string; input?: unknown }
) {
  let rows = await query<any>('SELECT * FROM skills WHERE id = ? AND user_id = ?', [skillId, userId]);
  let skill = rows[0];
  if (!skill) throw new Error('Skill not found.');

  if (skill.package_path && (skill.runtime === 'prompt-only' || !skill.entry || skill.install_status === 'pending')) {
    await initializeSkillEnvironment(skillId);
    rows = await query<any>('SELECT * FROM skills WHERE id = ? AND user_id = ?', [skillId, userId]);
    skill = rows[0] || skill;
  }

  const runResult = await query<any>(
    `INSERT INTO skill_runs
      (user_id, skill_id, project_id, phase, status, progress, input, logs, started_at)
     VALUES (?, ?, ?, ?, 'running', 10, ?, ?, CURRENT_TIMESTAMP)`,
    [
      userId,
      skillId,
      payload.projectId || null,
      payload.phase || 'input',
      JSON.stringify(payload.input || {}),
      'Skill run started.',
    ]
  );
  const runId = Number((runResult as any).insertId);

  try {
    const runtime = skill.runtime as SkillRuntime;
    const skillParameters = typeof skill.parameters === 'string' ? JSON.parse(skill.parameters || '{}') : skill.parameters || {};
    const inputJson = JSON.stringify({
      skill: {
        id: String(skill.id),
        name: skill.name,
        parameters: skillParameters,
      },
      input: payload.input || {},
    });

    if (runtime === 'prompt-only' || !skill.entry) {
      const instruction = String(skillParameters.instruction || '').trim();
      if (!instruction) {
        const message = 'Skill 未返回有效内容：提示词 Skill 内容为空。';
        await query(
          `UPDATE skill_runs
           SET status = 'failed', progress = 100, output = ?, error_message = ?, logs = ?, completed_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            JSON.stringify({
              mode: 'prompt-only',
              text: '',
              instruction: '',
              ok: false,
              summary: message,
            }),
            message,
            message,
            runId,
          ]
        );
        return runId;
      }
      await query(
        `UPDATE skill_runs
         SET status = 'completed', progress = 100, output = ?, logs = ?, completed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          JSON.stringify({
            mode: 'prompt-only',
            text: instruction,
            instruction,
            summary: instruction ? `已读取提示词 Skill：${instruction.slice(0, 160)}` : '已读取提示词 Skill',
          }),
          instruction ? '已读取提示词 Skill 内容。' : '提示词 Skill 未填写内容。',
          runId,
        ]
      );
      return runId;
    }

    if (skill.install_status !== 'ready') {
      throw new Error(skill.install_status === 'failed' ? 'Skill runtime initialization failed.' : 'Skill runtime is still initializing.');
    }

    const packagePath = String(skill.package_path || '');
    const entry = safeRelativePath(String(skill.entry || ''));
    const entryPath = path.join(packagePath, entry);
    const command = runtime === 'python' ? pythonExecutable(packagePath) : 'node';
    const args = runtime === 'python'
      ? [entryPath, ...buildPythonSkillArgs(payload.input)]
      : [entryPath];
    const readableArgs = args.slice(1).map((item) => item.includes(' ') ? `"${item}"` : item).join(' ');
    const result = await runProcess(command, args, {
      cwd: packagePath,
      timeoutMs: RUN_TIMEOUT_MS,
      input: inputJson,
    });
    const outputText = result.stdout.trim();
    const stderrText = result.stderr.trim();
    const validation = validateSkillRunOutput(skill, payload, outputText, stderrText);

    if (!validation.ok) {
      await query(
        `UPDATE skill_runs
         SET status = 'failed', progress = 100, output = ?, error_message = ?, logs = ?, completed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          JSON.stringify({
            mode: runtime,
            entry,
            args: args.slice(1),
            text: outputText,
            stderr: stderrText,
            ok: false,
            summary: validation.message,
          }),
          validation.message,
          [
            `执行入口：${entry}${readableArgs ? ` ${readableArgs}` : ''}`,
            stderrText,
            outputText ? `stdout：${compactRunText(outputText, 1200)}` : '未返回 stdout 内容。',
          ].filter(Boolean).join('\n'),
          runId,
        ]
      );
      return runId;
    }

    await query(
      `UPDATE skill_runs
       SET status = 'completed', progress = 100, output = ?, logs = ?, completed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        JSON.stringify({
          mode: runtime,
          entry,
          args: args.slice(1),
          text: outputText,
          stderr: stderrText,
          ok: true,
          summary: outputText ? outputText.slice(0, 500) : 'Skill 执行完成，但没有返回正文。',
        }),
        [
          `执行入口：${entry}${readableArgs ? ` ${readableArgs}` : ''}`,
          stderrText,
          outputText ? `输出 ${outputText.length} 个字符。` : '未返回 stdout 内容。',
        ].filter(Boolean).join('\n'),
        runId,
      ]
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Skill run failed.';
    await query(
      `UPDATE skill_runs
       SET status = 'failed', progress = 100, error_message = ?, logs = ?, completed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [message, message, runId]
    );
  }

  return runId;
}

function extractInputRecord(input: unknown): Record<string, any> {
  return input && typeof input === 'object' ? input as Record<string, any> : {};
}

function inferSkillQuery(input: unknown) {
  const record = extractInputRecord(input);
  const rawContent = String(record.content || record.topic || record.query || '').trim();
  const explicitTopic = rawContent.match(/(?:主题|题目|标题)\s*[：:]\s*([^\n。；;]+)/)?.[1]?.trim();
  const query = String(record.query || explicitTopic || rawContent).replace(/\s+/g, ' ').trim();
  return query.length > 120 ? query.slice(0, 120) : query;
}

function buildPythonSkillArgs(input: unknown) {
  const record = extractInputRecord(input);
  const purpose = String(record.purpose || '');
  const query = inferSkillQuery(input);
  if (!query) return [];

  if (/search|collect|web|资料收集/i.test(purpose)) {
    return [query, '--max-results', '5', '--format', 'markdown'];
  }
  return [];
}

export async function removeSkillPackage(userId: number, skillId: number) {
  const target = path.join(storageRoot, String(userId), String(skillId));
  await fs.rm(target, { recursive: true, force: true });
}
