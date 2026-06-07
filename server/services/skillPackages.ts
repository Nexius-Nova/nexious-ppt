import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { query } from '../db/connection.js';
import { generatedSkillsRoot } from '../utils/storage.js';

export type SkillRuntime = 'prompt-only' | 'python' | 'node';
export type SkillInstallStatus = 'not_required' | 'pending' | 'installing' | 'ready' | 'failed';
export type SkillTestStatus = 'not_tested' | 'testing' | 'passed' | 'failed' | 'skipped';
export type SkillCapability = 'web-search' | 'file-parse' | 'content-refine' | 'image-tool' | 'topic-extract' | 'generation-constraint';

interface SkillManifest {
  name?: string;
  description?: string;
  icon?: string;
  category?: string;
  runtime?: SkillRuntime;
  entry?: string;
  capabilities?: SkillCapability[];
  inputContract?: Record<string, unknown>;
  outputContract?: Record<string, unknown>;
  testSample?: Record<string, unknown>;
  sandbox?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
}

interface PackageAnalysis {
  name: string;
  description: string;
  icon: string;
  category: string;
  capabilities: SkillCapability[];
  inputContract: Record<string, unknown> | null;
  outputContract: Record<string, unknown> | null;
  testSample: Record<string, unknown> | null;
  sandboxPolicy: Record<string, unknown>;
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

interface CommandSkillAdapter {
  runtime: SkillRuntime;
  entry: string;
  dependencyFile: string | null;
  title: string;
  description: string;
  plan: string[];
  script: string;
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
  capabilities: SkillCapability[];
  inputContract: Record<string, unknown> | null;
  outputContract: Record<string, unknown> | null;
  hasTestSample: boolean;
  adaptationPlan: string[];
  files: SkillPackagePreviewFile[];
}

export interface SkillPackageView {
  skillMdPath: string;
  skillMdContent: string;
  skillMdTruncated: boolean;
  fileCount: number;
  totalSize: number;
  runtime: SkillRuntime;
  entry: string | null;
  dependencyFile: string | null;
  files: SkillPackagePreviewFile[];
}

const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const RUN_TIMEOUT_MS = Math.max(5000, Number(process.env.SKILL_RUN_TIMEOUT_MS || 2 * 60 * 1000));
const SKILL_RUN_OUTPUT_BYTES = Math.max(16 * 1024, Number(process.env.SKILL_RUN_OUTPUT_BYTES || 1024 * 1024));
const SKILL_RUN_CONCURRENCY = Math.max(1, Number(process.env.SKILL_RUN_CONCURRENCY || 2));
const HEALTH_TEST_PROJECT_ID = '__skill_health_check__';
const storageRoot = generatedSkillsRoot;
const TEXT_SCAN_BYTES = 512 * 1024;
const SKILL_MD_VIEW_BYTES = 512 * 1024;
const SECURITY_FAILURE_MESSAGE = 'Skill 包未通过安全验证。';
let activeSkillRuns = 0;
const skillRunWaiters: Array<() => void> = [];

interface SkillPackageSecurityIssue {
  code: string;
  path: string;
}

class SkillPackageSecurityError extends Error {
  readonly issues: SkillPackageSecurityIssue[];

  constructor(issues: SkillPackageSecurityIssue[]) {
    super(SECURITY_FAILURE_MESSAGE);
    this.name = 'SkillPackageSecurityError';
    this.issues = issues;
  }
}

function isPathInside(childPath: string, parentPath: string) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

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

function collectSecurityIssue(
  issues: SkillPackageSecurityIssue[],
  code: string,
  filePath: string,
  limit = 80
) {
  if (issues.length >= limit) return;
  issues.push({ code, path: filePath });
}

function logSkillSecurityFailure(context: string, issues: SkillPackageSecurityIssue[]) {
  console.warn(`Skill package security validation failed during ${context}`, {
    issues: issues.map((issue) => ({ code: issue.code, path: issue.path })),
  });
}

function throwIfSecurityIssues(context: string, issues: SkillPackageSecurityIssue[]) {
  if (!issues.length) return;
  logSkillSecurityFailure(context, issues);
  throw new SkillPackageSecurityError(issues);
}

function assertSkillPackageDirectoryScope(packagePath: string, userId: number | null, skillId: number) {
  if (!packagePath) return;
  const expectedBase = userId
    ? path.join(storageRoot, String(userId), String(skillId))
    : storageRoot;
  const resolvedPackage = path.resolve(packagePath);
  const resolvedBase = path.resolve(expectedBase);
  if (resolvedPackage !== resolvedBase && !isPathInside(resolvedPackage, resolvedBase)) {
    logSkillSecurityFailure('package-directory-scope', [{ code: 'path:package-directory-out-of-scope', path: packagePath }]);
    throw new SkillPackageSecurityError([{ code: 'path:package-directory-out-of-scope', path: packagePath }]);
  }
}

function isTextScannablePath(filePath: string) {
  return /\.(md|txt|json|ya?ml|toml|ini|cfg|conf|py|js|mjs|cjs|ts|tsx|css|html|xml|csv|requirements)$/i.test(filePath)
    || /(^|\/)(requirements\.txt|package\.json|skill\.json|skill\.md)$/i.test(filePath);
}

function readTextForSecurityScan(data: Buffer) {
  if (!data.byteLength) return '';
  const sample = data.subarray(0, Math.min(data.byteLength, TEXT_SCAN_BYTES));
  if (sample.includes(0)) return '';
  return sample.toString('utf8');
}

function hasSuspiciousPackageJsonDependency(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).some((dependency) => {
    const spec = String(dependency || '').trim().toLowerCase();
    return /^(file:|link:|workspace:|git\+|https?:\/\/|ssh:)/i.test(spec);
  });
}

function scanPackageJsonSecurity(
  content: string,
  filePath: string,
  issues: SkillPackageSecurityIssue[]
) {
  try {
    const data = JSON.parse(content);
    const scripts = data?.scripts && typeof data.scripts === 'object' && !Array.isArray(data.scripts)
      ? data.scripts as Record<string, unknown>
      : {};
    for (const scriptName of ['preinstall', 'install', 'postinstall', 'prepare']) {
      if (typeof scripts[scriptName] === 'string' && String(scripts[scriptName]).trim()) {
        collectSecurityIssue(issues, `dependency-script:${scriptName}`, filePath);
      }
    }
    if (
      hasSuspiciousPackageJsonDependency(data?.dependencies)
      || hasSuspiciousPackageJsonDependency(data?.optionalDependencies)
      || hasSuspiciousPackageJsonDependency(data?.devDependencies)
      || hasSuspiciousPackageJsonDependency(data?.peerDependencies)
    ) {
      collectSecurityIssue(issues, 'dependency-source:external-or-local', filePath);
    }
  } catch {
    collectSecurityIssue(issues, 'manifest:invalid-package-json', filePath);
  }
}

function scanRequirementsSecurity(
  content: string,
  filePath: string,
  issues: SkillPackageSecurityIssue[]
) {
  const blockedLine = /(^|\s)(-e|--editable|--index-url|--extra-index-url|--find-links|--trusted-host)\b|(?:git\+|https?:\/\/|file:|\.{1,2}[\\/])/i;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (blockedLine.test(line)) {
      collectSecurityIssue(issues, 'dependency-source:requirements', filePath);
      return;
    }
  }
}

function scanTextSecurity(
  content: string,
  filePath: string,
  issues: SkillPackageSecurityIssue[]
) {
  const normalized = content.replace(/\r\n/g, '\n');
  const suspiciousPatterns: Array<{ code: string; pattern: RegExp }> = [
    { code: 'path:parent-directory-reference', pattern: /(^|[^.])\.\.[\\/]/ },
    { code: 'path:system-or-home-reference', pattern: /(?:\/etc\/(?:passwd|shadow)|~[\\/]?\.ssh|[A-Za-z]:\\|\/Users\/|\/root\/|\/home\/[^/\s]+\/\.ssh)/i },
    { code: 'path:sensitive-file-reference', pattern: /(?:\.env\b|id_rsa\b|id_dsa\b|authorized_keys\b|known_hosts\b|\.npmrc\b|\.pypirc\b)/i },
    { code: 'secret:private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { code: 'secret:token-pattern', pattern: /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-[A-Za-z0-9_-]{32,})\b/ },
    { code: 'secret:assignment-pattern', pattern: /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key|password|passwd|pwd)\s*[:=]\s*['"]?[^'"\s]{12,}/i },
    { code: 'code:node-child-process', pattern: /\b(?:child_process|spawnSync|execSync|execFileSync)\b|require\(\s*['"]child_process['"]\s*\)/i },
    { code: 'code:node-destructive-fs', pattern: /\bfs\.(?:rm|rmdir|unlink)\b/i },
    { code: 'code:node-sensitive-env', pattern: /\b(?:JSON\.stringify|Object\.(?:keys|values|entries))\(\s*process\.env\s*\)|\bprocess\.env(?:\.|\[['"])(?!(?:SKILL_|PATH\b|Path\b|TEMP\b|TMP\b|HOME\b|USERPROFILE\b|SystemRoot\b|WINDIR\b))[A-Za-z0-9_ -]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|DATABASE|DB_|JWT|OPENAI|AWS_)/i },
    { code: 'code:python-dangerous-runtime', pattern: /\b(?:os\.system|eval|exec|compile|__import__)\b|\bsubprocess\.(?:Popen|call|check_call|check_output|run)\s*\([\s\S]{0,240}\bshell\s*=\s*True/i },
    { code: 'code:python-destructive-fs', pattern: /\b(?:shutil\.rmtree|os\.remove|os\.unlink|os\.rmdir|Path\([^)]*\)\.unlink)\b/i },
    { code: 'shell:destructive-or-privileged', pattern: /\b(?:rm\s+-rf|sudo\s+|chmod\s+(?:\+x|777)|powershell(?:\.exe)?|cmd\.exe)\b/i },
    { code: 'network:shell-pipe-download', pattern: /\b(?:curl|wget)\b[\s\S]{0,120}\|\s*(?:sh|bash|powershell|python|node)\b/i },
    { code: 'intent:exfiltration-or-malware', pattern: /\b(?:exfiltrate|keylogger|ransomware|credential\s*(?:dump|steal)|token\s*(?:dump|steal)|phishing)\b|(?:窃取|外传|盗取|键盘记录|勒索|钓鱼|删除系统文件|读取环境变量)/i },
  ];

  for (const rule of suspiciousPatterns) {
    if (rule.pattern.test(normalized)) {
      collectSecurityIssue(issues, rule.code, filePath);
    }
  }
}

function assertSkillPackageSafe(analysis: PackageAnalysis, context = 'package') {
  const issues: SkillPackageSecurityIssue[] = [];
  const blockedDirNames = new Set([
    '.git',
    '.ssh',
    '.gnupg',
    '.aws',
    '.azure',
    '.config',
    'node_modules',
    '.venv',
    'venv',
    '__pycache__',
  ]);
  const blockedFileNames = [
    /^\.env(?:\.|$)/i,
    /^\.npmrc$/i,
    /^\.pypirc$/i,
    /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
    /(?:private[_-]?key|secret|credential|token|password).*\.(?:txt|json|ya?ml|env)$/i,
    /\.(?:pem|key|p12|pfx|crt|cer)$/i,
  ];
  const blockedExtensions = new Set([
    '.exe',
    '.dll',
    '.so',
    '.dylib',
    '.msi',
    '.scr',
    '.bat',
    '.cmd',
    '.ps1',
    '.vbs',
    '.jar',
    '.com',
  ]);
  const filePaths = new Set(analysis.files.map((file) => file.relativePath));

  for (const file of analysis.files) {
    let relativePath = '';
    try {
      relativePath = safeRelativePath(file.relativePath);
    } catch {
      collectSecurityIssue(issues, 'path:invalid', file.relativePath);
      continue;
    }

    const normalizedPath = relativePath.replace(/\\/g, '/');
    const lowerPath = normalizedPath.toLowerCase();
    const segments = lowerPath.split('/');
    const fileName = segments[segments.length - 1] || lowerPath;
    const extension = path.posix.extname(lowerPath);

    if (segments.some((segment) => blockedDirNames.has(segment))) {
      collectSecurityIssue(issues, 'path:blocked-directory', normalizedPath);
    }
    if (blockedFileNames.some((pattern) => pattern.test(fileName))) {
      collectSecurityIssue(issues, 'file:sensitive-name', normalizedPath);
    }
    if (blockedExtensions.has(extension)) {
      collectSecurityIssue(issues, 'file:executable-or-binary', normalizedPath);
    }

    if (!isTextScannablePath(normalizedPath)) continue;
    const content = readTextForSecurityScan(file.data);
    if (!content) continue;
    if (fileName === 'package.json') {
      scanPackageJsonSecurity(content, normalizedPath, issues);
    } else if (fileName === 'requirements.txt') {
      scanRequirementsSecurity(content, normalizedPath, issues);
    }
    scanTextSecurity(content, normalizedPath, issues);
  }

  for (const candidate of [analysis.entry, analysis.dependencyFile, analysis.manifest.skillMdPath, analysis.manifest.skillJsonPath]) {
    if (!candidate) continue;
    let relativePath = '';
    try {
      relativePath = safeRelativePath(candidate);
    } catch {
      collectSecurityIssue(issues, 'manifest:path-invalid', String(candidate));
      continue;
    }
    if (!filePaths.has(relativePath)) {
      collectSecurityIssue(issues, 'manifest:path-missing', relativePath);
    }
  }

  throwIfSecurityIssues(context, issues);
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
    if (key === 'capabilities') manifest.capabilities = parseCapabilityList(rawValue);
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
      capabilities: parseCapabilityList(data.capabilities),
      inputContract: normalizeRecord(data.inputContract || data.input_contract),
      outputContract: normalizeRecord(data.outputContract || data.output_contract),
      testSample: normalizeRecord(data.testSample || data.test_sample),
      sandbox: normalizeRecord(data.sandbox || data.sandboxPolicy || data.sandbox_policy),
      parameters: data.parameters && typeof data.parameters === 'object' ? data.parameters : undefined,
    };
  } catch {
    return {};
  }
}

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeSkillCapability(value: unknown): SkillCapability | null {
  const raw = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (['web-search', 'search', 'web'].includes(raw)) return 'web-search';
  if (['file-parse', 'file-parser', 'parse-file', 'document-parse'].includes(raw)) return 'file-parse';
  if (['content-refine', 'content', 'refine', 'rewrite'].includes(raw)) return 'content-refine';
  if (['image-tool', 'image', 'vision'].includes(raw)) return 'image-tool';
  if (['topic-extract', 'topic', 'title'].includes(raw)) return 'topic-extract';
  if (['generation-constraint', 'constraint', 'config', 'prompt'].includes(raw)) return 'generation-constraint';
  return null;
}

function parseCapabilityList(value: unknown): SkillCapability[] | undefined {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\s]+/)
      : [];
  const capabilities = Array.from(new Set(values.map(normalizeSkillCapability).filter(Boolean))) as SkillCapability[];
  return capabilities.length ? capabilities : undefined;
}

function inferSkillCapabilities(manifest: SkillManifest, instruction: string, files: Map<string, Buffer>, entry: string | null): SkillCapability[] {
  const explicit = parseCapabilityList(manifest.capabilities);
  if (explicit?.length) return explicit;

  const text = [
    manifest.name,
    manifest.description,
    manifest.category,
    manifest.entry,
    entry,
    instruction,
    ...Array.from(files.keys()),
  ].filter(Boolean).join(' ').toLowerCase();
  const capabilities = new Set<SkillCapability>();
  if (/web|search|google|bing|duckduckgo|联网|搜索|资料收集|抓取/.test(text)) capabilities.add('web-search');
  if (/file|parse|docx|pdf|pptx|xlsx|markdown|文件|解析|读取/.test(text)) capabilities.add('file-parse');
  if (/topic|title|summary|summar|主题|标题|提炼|摘要/.test(text)) capabilities.add('topic-extract');
  if (/constraint|config|prompt|template|rule|约束|配置|提示词|模板/.test(text)) capabilities.add('generation-constraint');
  if (/image|vision|picture|图片|图像|视觉/.test(text)) capabilities.add('image-tool');
  if (/refine|rewrite|polish|content|润色|改写|优化/.test(text)) capabilities.add('content-refine');
  return Array.from(capabilities);
}

function buildSandboxPolicy(manifest: SkillManifest): Record<string, unknown> {
  const sandbox = manifest.sandbox || {};
  return {
    network: sandbox.network === true,
    timeoutMs: Math.min(RUN_TIMEOUT_MS, Math.max(5000, Number(sandbox.timeoutMs || sandbox.timeout_ms || RUN_TIMEOUT_MS))),
    maxOutputBytes: Math.min(SKILL_RUN_OUTPUT_BYTES, Math.max(16 * 1024, Number(sandbox.maxOutputBytes || sandbox.max_output_bytes || SKILL_RUN_OUTPUT_BYTES))),
    maxInputFiles: Math.min(20, Math.max(0, Number(sandbox.maxInputFiles || sandbox.max_input_files || 8))),
  };
}

function parseSandboxPolicy(value: unknown): {
  network: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
  maxInputFiles: number;
} {
  const record = parseJsonRecord(value);
  return {
    network: record.network === true,
    timeoutMs: Math.min(RUN_TIMEOUT_MS, Math.max(5000, Number(record.timeoutMs || record.timeout_ms || RUN_TIMEOUT_MS))),
    maxOutputBytes: Math.min(SKILL_RUN_OUTPUT_BYTES, Math.max(16 * 1024, Number(record.maxOutputBytes || record.max_output_bytes || SKILL_RUN_OUTPUT_BYTES))),
    maxInputFiles: Math.min(20, Math.max(0, Number(record.maxInputFiles || record.max_input_files || 8))),
  };
}

async function acquireSkillRunSlot() {
  if (activeSkillRuns < SKILL_RUN_CONCURRENCY) {
    activeSkillRuns += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    skillRunWaiters.push(resolve);
  });
  activeSkillRuns += 1;
}

function releaseSkillRunSlot() {
  activeSkillRuns = Math.max(0, activeSkillRuns - 1);
  const next = skillRunWaiters.shift();
  if (next) next();
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

  if (dependencies.has('duckduckgo-search')) {
    dependencies.add('ddgs');
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
  const capabilities = inferSkillCapabilities(manifest, instruction, files, entry);
  const sandboxPolicy = buildSandboxPolicy(manifest);

  return {
    name: manifest.name || path.parse(fallbackName).name || 'Untitled Skill',
    description: manifest.description || 'Uploaded skill package',
    icon: manifest.icon || 'Zap',
    category: manifest.category || '资料收集',
    capabilities,
    inputContract: manifest.inputContract || null,
    outputContract: manifest.outputContract || null,
    testSample: manifest.testSample || null,
    sandboxPolicy,
    parameters: {
      ...(manifest.parameters || {}),
      instruction,
      packageFileCount: files.size,
      inferredDependencies,
      capabilities,
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
      capabilities,
      inputContract: manifest.inputContract,
      outputContract: manifest.outputContract,
      testSample: manifest.testSample,
      sandbox: sandboxPolicy,
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
    const markdown = readTextForSecurityScan(buffer);
    if (!markdown.trim() || !/(^|\n)#|\bname\s*:|skill/i.test(markdown.slice(0, 4096))) {
      throw new Error('SKILL.md 内容无效，请上传文本格式的 Skill 说明文件。');
    }
    files.set('SKILL.md', buffer);
    return normalizePackage(files, filename);
  }

  if (!lowerName.endsWith('.zip') && !lowerName.endsWith('.skill')) {
    throw new Error('Skill package must be a .zip, .skill or SKILL.md file.');
  }
  if (buffer.subarray(0, 4).toString('hex') !== '504b0304') {
    throw new Error('Skill package content is not a valid zip archive.');
  }

  const zip = await JSZip.loadAsync(buffer);
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const unixPermissions = typeof entry.unixPermissions === 'number' ? entry.unixPermissions : 0;
    if ((unixPermissions & 0o170000) === 0o120000) {
      throw new Error(SECURITY_FAILURE_MESSAGE);
    }
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
      if (entry.name === 'node_modules' || entry.name === '.venv' || entry.name === '__pycache__' || entry.name === '.runs') continue;
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
    capabilities: analysis.capabilities,
    inputContract: analysis.inputContract,
    outputContract: analysis.outputContract,
    hasTestSample: Boolean(analysis.testSample),
    adaptationPlan: detectPackageAdaptationPlan(analysis),
    files: analysis.files
      .map((file) => ({
        path: file.relativePath,
        size: file.data.byteLength,
        role: classifyPackageFile(analysis, file.relativePath),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

function packageAnalysisToFiles(analysis: PackageAnalysis): SkillPackagePreviewFile[] {
  return analysis.files
    .map((file) => ({
      path: file.relativePath,
      size: file.data.byteLength,
      role: classifyPackageFile(analysis, file.relativePath),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function previewSkillPackage(filename: string, dataBase64: string): Promise<SkillPackagePreview> {
  const analysis = await analyzePackage(filename, dataBase64);
  assertSkillPackageSafe(analysis, 'preview');
  return packageAnalysisToPreview(analysis);
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

function detectSkillCommandAdapter(instruction: string): CommandSkillAdapter | null {
  const lower = instruction.toLowerCase();
  if (/\buvx\s+markitdown\b/.test(lower) || /\bmarkitdown\b/.test(lower)) {
    return {
      runtime: 'python' as SkillRuntime,
      entry: 'scripts/markitdown_adapter.py',
      dependencyFile: null,
      title: 'MarkItDown 文件解析适配器',
      description: '将上传文件转换为 Markdown，供 PPT 输入阶段继续处理。',
      plan: [
        '识别到 SKILL.md 中的 markitdown/uvx markitdown 命令',
        '自动创建 Python 执行入口，读取输入阶段上传文件',
        '执行 uvx markitdown 并把转换结果合并为 Markdown 输出',
      ],
      script: `#!/usr/bin/env python3
import json
import os
import subprocess
import sys


def read_payload():
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}


def collect_files(payload):
    input_data = payload.get("input", {}) if isinstance(payload, dict) else {}
    package_dir = os.path.abspath(os.environ.get("SKILL_PACKAGE_DIR") or os.getcwd())
    paths = []
    env_files = os.environ.get("SKILL_INPUT_FILES", "")
    if env_files:
        paths.extend([item for item in env_files.split(os.pathsep) if item])
    paths.extend(input_data.get("filePaths") or [])
    safe_paths = []
    for raw_path in paths:
        absolute_path = os.path.abspath(raw_path)
        if not absolute_path.startswith(package_dir + os.sep):
            raise RuntimeError(f"禁止读取 Skill 包外文件：{raw_path}")
        if os.path.isfile(absolute_path):
            safe_paths.append(absolute_path)
    seen = set()
    return [path for path in safe_paths if path and not (path in seen or seen.add(path))]


def convert(path):
    result = subprocess.run(
        ["uvx", "markitdown", path],
        text=True,
        capture_output=True,
        encoding="utf-8",
        timeout=240,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr or f"markitdown failed: {path}")
    return result.stdout.strip()


def main():
    files = collect_files(read_payload())
    if not files:
        raise RuntimeError("未收到可转换的上传文件。")
    parts = []
    for path in files:
        name = os.path.basename(path)
        markdown = convert(path)
        parts.append(f"# 文件：{name}\\n\\n{markdown}")
    print("\\n\\n---\\n\\n".join(parts))


if __name__ == "__main__":
    main()
`,
    };
  }
  return null;
}

function buildSkillMdWorkflowNote(adapter: CommandSkillAdapter) {
  return [
    '',
    '## Nexious PPT 工作流适配',
    '',
    '> 本节由系统在导入 Skill 包时自动补充，用于让 Skill 可以在 PPT 输入阶段稳定执行；原始核心说明保留不变。',
    '',
    `- 适配类型：${adapter.title}`,
    `- 执行入口：\`${adapter.entry}\``,
    '- 输入来源：系统会把用户上传文件写入临时目录，并通过 `SKILL_INPUT_DIR`、`SKILL_INPUT_FILES` 和 stdin JSON 传给执行入口。',
    '- 输出要求：执行入口需要将可用于生成 PPT 的文本内容输出到 stdout。',
    '',
  ].join('\n');
}

async function appendSkillWorkflowNote(packagePath: string, skillMdPath: string, adapter: CommandSkillAdapter) {
  const absolutePath = path.join(packagePath, skillMdPath);
  const source = await fs.readFile(absolutePath, 'utf8');
  if (source.includes('## Nexious PPT 工作流适配')) return false;
  await fs.writeFile(absolutePath, `${source.trimEnd()}\n${buildSkillMdWorkflowNote(adapter)}`, 'utf8');
  return true;
}

function detectPackageAdaptationPlan(analysis: PackageAnalysis) {
  const instruction = String(analysis.parameters.instruction || '');
  const commandAdapter = !analysis.entry ? detectSkillCommandAdapter(instruction) : null;
  const plan: string[] = [];

  if (commandAdapter) {
    plan.push(...commandAdapter.plan);
  } else if (analysis.entry) {
    plan.push('已识别执行入口，测试前会初始化依赖并应用兼容补丁。');
  } else {
    plan.push('未识别执行入口，将作为提示词型 Skill 使用。');
  }

  if (analysis.inferredDependencies.length) {
    plan.push(`自动识别 Python 依赖：${analysis.inferredDependencies.join('、')}`);
  }

  return plan;
}

async function adaptSkillPackageForWorkflow(packagePath: string) {
  const analysis = await analyzePackageDirectory(packagePath);
  assertSkillPackageSafe(analysis, 'workflow-adaptation:before');
  const logs: string[] = [];
  const instruction = parseSkillInstruction(
    await fs.readFile(path.join(packagePath, analysis.manifest.skillMdPath || 'SKILL.md'), 'utf8')
  );
  const commandAdapter = !analysis.entry ? detectSkillCommandAdapter(instruction) : null;

  if (commandAdapter) {
    const entryPath = path.join(packagePath, commandAdapter.entry);
    await fs.mkdir(path.dirname(entryPath), { recursive: true });
    await fs.writeFile(entryPath, commandAdapter.script, 'utf8');
    logs.push(`自动适配：检测到命令行型 Skill，已生成执行入口 ${commandAdapter.entry}`);
    if (await appendSkillWorkflowNote(packagePath, analysis.manifest.skillMdPath || 'SKILL.md', commandAdapter)) {
      logs.push('自动适配：已在 SKILL.md 追加 Nexious PPT 工作流适配说明，原核心内容保持不变');
    }
  }

  const nextAnalysis = await analyzePackageDirectory(packagePath);
  assertSkillPackageSafe(nextAnalysis, 'workflow-adaptation:after');
  return {
    analysis: nextAnalysis,
    logs,
  };
}

async function patchSkillPackageCompatibility(packagePath: string) {
  const patchedFiles: string[] = [];
  const ddgsFallbackImport = `try:
    from ddgs import DDGS
except ImportError:
    try:
        from duckduckgo_search import DDGS
    except ImportError as e:
        print(f"Error: Missing required dependency: {e}", file=sys.stderr)
        print("Install with: pip install ddgs", file=sys.stderr)
        sys.exit(1)`;

  async function walk(currentDir: string) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.venv' || entry.name === '__pycache__') continue;
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.py')) continue;

      const source = await fs.readFile(absolutePath, 'utf8');
      let nextSource = source;
      if (source.includes('from duckduckgo_search import DDGS') && !source.includes('from ddgs import DDGS')) {
        nextSource = source.replace(
          /^try:\s*\r?\n[ \t]+from duckduckgo_search import DDGS\s*\r?\nexcept ImportError as e:\s*\r?\n[ \t]+print\(f["']Error: Missing required dependency: \{e\}["'], file=sys\.stderr\)\s*\r?\n[ \t]+print\(["']Install with: pip install duckduckgo-search["'], file=sys\.stderr\)\s*\r?\n[ \t]+sys\.exit\(1\)/m,
          ddgsFallbackImport
        );
        nextSource = nextSource.replace(
          /^from duckduckgo_search import DDGS$/m,
          ddgsFallbackImport
        );
      }
      if (nextSource.includes('from ddgs import DDGS')) {
        nextSource = nextSource.replace(/\.text\(\s*\r?\n\s*keywords=/g, '.text(\n                    query=');
        nextSource = nextSource.replace(/\.news\(\s*\r?\n\s*keywords=/g, '.news(\n                    query=');
        nextSource = nextSource.replace(/\.images\(\s*\r?\n\s*keywords=/g, '.images(\n                    query=');
        nextSource = nextSource.replace(/\.videos\(\s*\r?\n\s*keywords=/g, '.videos(\n                    query=');
      }

      if (nextSource !== source) {
        await fs.writeFile(absolutePath, nextSource, 'utf8');
        patchedFiles.push(path.relative(packagePath, absolutePath));
      }
    }
  }

  await walk(packagePath);
  return patchedFiles;
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; input?: string; env?: Record<string, string>; maxOutputBytes?: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      env: buildSafeProcessEnv(options.env || {}),
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    const maxOutputBytes = Math.max(16 * 1024, Number(options.maxOutputBytes || SKILL_RUN_OUTPUT_BYTES));
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`Process timeout: ${command} ${args.join(' ')}`));
    }, options.timeoutMs);

    child.stdout.on('data', (chunk) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > maxOutputBytes && !settled) {
        settled = true;
        clearTimeout(timer);
        child.kill('SIGTERM');
        reject(new Error(`Process output exceeded ${maxOutputBytes} bytes`));
        return;
      }
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > maxOutputBytes && !settled) {
        settled = true;
        clearTimeout(timer);
        child.kill('SIGTERM');
        reject(new Error(`Process output exceeded ${maxOutputBytes} bytes`));
        return;
      }
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

function schemaTypeOf(value: unknown) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function contractTypeMatches(actual: string, expected: string) {
  if (expected === 'integer') return actual === 'number';
  return actual === expected;
}

function validateContractValue(
  value: unknown,
  schema: Record<string, unknown>,
  pathLabel: string,
  errors: string[],
  depth = 0
) {
  if (depth > 8 || !schema || typeof schema !== 'object') return;

  const expectedTypes = Array.isArray(schema.type)
    ? schema.type.map((item) => String(item))
    : schema.type
      ? [String(schema.type)]
      : [];
  const actualType = schemaTypeOf(value);
  if (expectedTypes.length && !expectedTypes.some((type) => contractTypeMatches(actualType, type))) {
    errors.push(`${pathLabel} 类型应为 ${expectedTypes.join(' 或 ')}，实际为 ${actualType}`);
    return;
  }

  if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${pathLabel} 不在允许取值范围内`);
  }

  if (actualType === 'object') {
    const record = value as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? schema.required.map((item) => String(item)) : [];
    for (const key of required) {
      if (!(key in record) || record[key] === undefined || record[key] === null || record[key] === '') {
        errors.push(`${pathLabel}.${key} 为必填项`);
      }
    }

    const properties = parseJsonRecord(schema.properties);
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in record && propertySchema && typeof propertySchema === 'object' && !Array.isArray(propertySchema)) {
        validateContractValue(record[key], propertySchema as Record<string, unknown>, `${pathLabel}.${key}`, errors, depth + 1);
      }
    }
  }

  if (actualType === 'array') {
    const items = schema.items;
    const list = value as unknown[];
    const minItems = Number(schema.minItems);
    const maxItems = Number(schema.maxItems);
    if (Number.isFinite(minItems) && list.length < minItems) errors.push(`${pathLabel} 至少需要 ${minItems} 项`);
    if (Number.isFinite(maxItems) && list.length > maxItems) errors.push(`${pathLabel} 最多允许 ${maxItems} 项`);
    if (items && typeof items === 'object' && !Array.isArray(items)) {
      list.slice(0, 20).forEach((item, index) => {
        validateContractValue(item, items as Record<string, unknown>, `${pathLabel}[${index}]`, errors, depth + 1);
      });
    }
  }

  if (actualType === 'string') {
    const text = String(value);
    const minLength = Number(schema.minLength);
    const maxLength = Number(schema.maxLength);
    if (Number.isFinite(minLength) && text.length < minLength) errors.push(`${pathLabel} 长度不能少于 ${minLength}`);
    if (Number.isFinite(maxLength) && text.length > maxLength) errors.push(`${pathLabel} 长度不能超过 ${maxLength}`);
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern).test(text)) errors.push(`${pathLabel} 格式不符合要求`);
      } catch {
        // 忽略 Skill 包声明中的非法正则，避免影响旧包运行。
      }
    }
  }

  if (actualType === 'number') {
    const numberValue = Number(value);
    const minimum = Number(schema.minimum);
    const maximum = Number(schema.maximum);
    if (Number.isFinite(minimum) && numberValue < minimum) errors.push(`${pathLabel} 不能小于 ${minimum}`);
    if (Number.isFinite(maximum) && numberValue > maximum) errors.push(`${pathLabel} 不能大于 ${maximum}`);
    if (expectedTypes.includes('integer') && !Number.isInteger(numberValue)) errors.push(`${pathLabel} 必须是整数`);
  }
}

function validateSkillContract(contract: unknown, value: unknown, label: string) {
  const schema = parseJsonRecord(contract);
  if (!Object.keys(schema).length) return '';
  const errors: string[] = [];
  validateContractValue(value, schema, label, errors);
  return errors.length ? errors.slice(0, 6).join('；') : '';
}

function parseSkillOutputForContract(outputText: string) {
  const text = outputText.trim();
  if (!text) return text;
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    if (fenced) {
      try {
        return JSON.parse(fenced);
      } catch {
        return text;
      }
    }
    return text;
  }
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

function buildSafeProcessEnv(extraEnv: Record<string, string> = {}) {
  const safeEnv: Record<string, string> = {
    PATH: process.env.PATH || '',
    Path: process.env.Path || process.env.PATH || '',
    PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
    SystemRoot: process.env.SystemRoot || 'C:\\Windows',
    WINDIR: process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows',
    TEMP: process.env.TEMP || process.env.TMP || '',
    TMP: process.env.TMP || process.env.TEMP || '',
    HOME: process.env.HOME || '',
    USERPROFILE: process.env.USERPROFILE || '',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHONNOUSERSITE: '1',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    PIP_NO_INPUT: '1',
    npm_config_ignore_scripts: 'true',
    PNPM_HOME: process.env.PNPM_HOME || '',
    LC_ALL: process.env.LC_ALL || 'C.UTF-8',
  };

  for (const [key, value] of Object.entries(extraEnv)) {
    safeEnv[key] = value;
  }

  return safeEnv;
}

function getSkillSecurityMessage(error: unknown) {
  return error instanceof SkillPackageSecurityError
    ? SECURITY_FAILURE_MESSAGE
    : error instanceof Error
      ? error.message
      : 'Skill package scan failed.';
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

async function updateSkillTestStatus(skillId: number, status: SkillTestStatus, log: string) {
  await query(
    `UPDATE skills
     SET test_status = ?, test_log = ?, last_tested_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [status, log.slice(-12000), skillId]
  );
}

function buildSkillHealthInput(skill: any) {
  const testSample = parseJsonRecord(skill?.test_sample);
  if (Object.keys(testSample).length > 0) return testSample;

  const capabilities = parseStoredCapabilities(skill?.capabilities);
  const categoryText = String(skill?.category || '').toLowerCase();
  const nameText = String(skill?.name || '').toLowerCase();
  const isSearch = capabilities.includes('web-search') || /search|web|collect|资料收集|搜索|联网/.test(`${categoryText} ${nameText}`);
  const isFileParse = capabilities.includes('file-parse') || /file|parse|文件|解析/.test(`${categoryText} ${nameText}`);

  if (isSearch) {
    return {
      purpose: '资料收集',
      query: '手机发展历程',
      topic: '手机发展历程',
      content: '请联网搜索手机发展历程，并返回可用于 PPT 的简要资料。',
    };
  }

  if (isFileParse) {
    const sampleFile = { name: 'sample.txt', text: '手机发展历程：从功能机到智能手机，再到 AI 终端。' };
    return {
      purpose: '文件解析',
      topic: 'Skill 健康测试',
      content: '这是一个用于测试文件解析 Skill 的短文本资料，请提取主题和关键要点。',
      fileContents: [sampleFile],
      files: [sampleFile],
    };
  }

  return {
    purpose: 'Skill 健康测试',
    topic: '手机发展历程',
    content: '请把“手机发展历程”整理为 3 条可用于 PPT 的资料要点。',
  };
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

function parseStoredCapabilities(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
    } catch {
      return value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

export async function initializeSkillEnvironment(skillId: number, userId?: number) {
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
  let adaptationLogs: string[] = [];

  if (packagePath) {
    try {
      await updateSkillInstallStatus(skillId, 'installing', '正在自动适配 Skill 包到输入阶段工作流...');
      assertSkillPackageDirectoryScope(packagePath, userId ?? null, skillId);
      const adaptation = await adaptSkillPackageForWorkflow(packagePath);
      adaptationLogs = adaptation.logs;
      const analysis = adaptation.analysis;
      runtime = analysis.runtime;
      dependencyFile = analysis.dependencyFile;
      inferredDependencies = analysis.inferredDependencies;
      const nextParameters = {
        ...parseJsonRecord(skill.parameters),
        packageFileCount: analysis.files.length,
        inferredDependencies: analysis.inferredDependencies,
        capabilities: analysis.capabilities,
      };
      await query(
        `UPDATE skills
         SET runtime = ?, entry = ?, dependency_file = ?, manifest = ?, capabilities = ?, input_contract = ?, output_contract = ?, test_sample = ?, sandbox_policy = ?, parameters = ?, install_log = ?
         WHERE id = ?`,
        [
          analysis.runtime,
          analysis.entry,
          analysis.dependencyFile,
          JSON.stringify(analysis.manifest),
          JSON.stringify(analysis.capabilities),
          analysis.inputContract ? JSON.stringify(analysis.inputContract) : null,
          analysis.outputContract ? JSON.stringify(analysis.outputContract) : null,
          analysis.testSample ? JSON.stringify(analysis.testSample) : null,
          JSON.stringify(analysis.sandboxPolicy),
          JSON.stringify(nextParameters),
          [
            '正在自动适配 Skill 包到输入阶段工作流...',
            ...adaptationLogs,
            adaptationLogs.length ? '自动适配完成，准备初始化依赖。' : '未发现需要生成的新执行入口，准备初始化依赖。',
          ].join('\n'),
          skillId,
        ]
      );
    } catch (error) {
      await updateSkillInstallStatus(skillId, 'failed', getSkillSecurityMessage(error));
      return;
    }
  }

  if (runtime === 'prompt-only') {
    await updateSkillInstallStatus(
      skillId,
      'not_required',
      [
        ...adaptationLogs,
        '未识别到可执行入口，将作为提示词型 Skill 使用；无需依赖初始化。',
      ].filter(Boolean).join('\n'),
      true
    );
    return;
  }

  await updateSkillInstallStatus(
    skillId,
    'installing',
    [
      ...adaptationLogs,
      '正在初始化运行环境...',
    ].filter(Boolean).join('\n')
  );

  try {
    let log = adaptationLogs.length ? `${adaptationLogs.join('\n')}\n` : '';
    if (packagePath) {
      const patchedFiles = await patchSkillPackageCompatibility(packagePath);
      if (patchedFiles.length) {
        log += `已应用 Skill 兼容补丁：${patchedFiles.join(', ')}\n`;
      }
    }
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
      const result = await runProcess(pnpmBin, ['install', '--prod', '--ignore-scripts'], {
        cwd: dependencyDir,
        timeoutMs: INSTALL_TIMEOUT_MS,
      });
      log += result.stdout + result.stderr;
    }

    await updateSkillInstallStatus(skillId, 'ready', log.trim() || '运行环境已就绪。', true);
  } catch (error) {
    await updateSkillInstallStatus(skillId, 'failed', error instanceof Error ? error.message : 'Runtime initialization failed.');
  }
}

export async function createSkillFromPackage(userId: number, filename: string, dataBase64: string, overrides: { category?: string } = {}) {
  const analysis = await analyzePackage(filename, dataBase64);
  assertSkillPackageSafe(analysis, 'upload');
  const category = String(overrides.category || analysis.category || '').trim() || analysis.category;
  const commandAdaptable = analysis.runtime === 'prompt-only'
    ? Boolean(detectSkillCommandAdapter(String(analysis.parameters.instruction || '')))
    : false;
  const initialStatus: SkillInstallStatus = analysis.runtime === 'prompt-only' && !commandAdaptable ? 'not_required' : 'pending';
  const initialType = initialStatus === 'not_required' ? 'prompt-only' : 'package';
  const initialLog = initialStatus === 'not_required'
    ? '未识别到可执行入口，将作为提示词型 Skill 使用；无需依赖初始化。'
    : 'Skill 包已保存，等待自动适配、初始化依赖并执行健康测试。';
  const result = await query<any>(
    `INSERT INTO skills
      (user_id, name, description, icon, category, parameters, is_enabled, type, runtime, entry, manifest, capabilities, input_contract, output_contract, test_sample, sandbox_policy, dependency_file, install_status, install_log, test_status, test_log)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      analysis.name,
      analysis.description,
      analysis.icon,
      category,
      JSON.stringify(analysis.parameters),
      initialType,
      analysis.runtime,
      analysis.entry,
      JSON.stringify(analysis.manifest),
      JSON.stringify(analysis.capabilities),
      analysis.inputContract ? JSON.stringify(analysis.inputContract) : null,
      analysis.outputContract ? JSON.stringify(analysis.outputContract) : null,
      analysis.testSample ? JSON.stringify(analysis.testSample) : null,
      JSON.stringify(analysis.sandboxPolicy),
      analysis.dependencyFile,
      initialStatus,
      initialLog,
      'not_tested',
      '等待自动测试。',
    ]
  );

  const skillId = Number((result as any).insertId);
  const packagePath = path.join(storageRoot, String(userId), String(skillId));
  await writePackageFiles(packagePath, analysis.files);
  await query('UPDATE skills SET package_path = ? WHERE id = ?', [packagePath, skillId]);

  void initializeAndTestSkill(userId, skillId).catch((error) => {
    console.error('Skill runtime initialization or health test failed', error);
  });

  return skillId;
}

export async function getSkillPackageView(userId: number, skillId: number): Promise<SkillPackageView> {
  const rows = await query<any>(
    'SELECT id, package_path FROM skills WHERE id = ? AND user_id = ?',
    [skillId, userId]
  );
  const skill = rows[0];
  if (!skill) throw new Error('Skill not found.');

  const packagePath = String(skill.package_path || '');
  if (!packagePath) throw new Error('Skill package not found.');

  assertSkillPackageDirectoryScope(packagePath, userId, skillId);
  const analysis = await analyzePackageDirectory(packagePath);
  assertSkillPackageSafe(analysis, 'package-view');

  const skillMdPath = analysis.manifest.skillMdPath || 'SKILL.md';
  const skillMdFile = analysis.files.find((file) => file.relativePath === skillMdPath);
  const skillMdBuffer = skillMdFile?.data || Buffer.from('');
  const skillMdTruncated = skillMdBuffer.byteLength > SKILL_MD_VIEW_BYTES;
  const skillMdContent = skillMdBuffer
    .subarray(0, Math.min(skillMdBuffer.byteLength, SKILL_MD_VIEW_BYTES))
    .toString('utf8');

  return {
    skillMdPath,
    skillMdContent,
    skillMdTruncated,
    fileCount: analysis.files.length,
    totalSize: analysis.files.reduce((sum, file) => sum + file.data.byteLength, 0),
    runtime: analysis.runtime,
    entry: analysis.entry,
    dependencyFile: analysis.dependencyFile,
    files: packageAnalysisToFiles(analysis),
  };
}

export async function initializeAndTestSkill(userId: number, skillId: number) {
  await initializeSkillEnvironment(skillId, userId);
  await testSkillPackage(userId, skillId);
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
    await initializeSkillEnvironment(skillId, userId);
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
  const packagePath = String(skill.package_path || '');
  let inputFiles: { inputDir: string; savedFiles: Array<{ name: string; path: string }>; runDir: string; workDir: string } | null = null;
  let slotAcquired = false;

  try {
    const runtime = skill.runtime as SkillRuntime;
    const sandboxPolicy = parseSandboxPolicy(skill.sandbox_policy);
    const inputContractError = validateSkillContract(skill.input_contract, payload.input || {}, 'Skill 输入');
    if (inputContractError) {
      throw new Error(`Skill 输入不符合契约：${inputContractError}`);
    }

    if (packagePath) {
      assertSkillPackageDirectoryScope(packagePath, userId, skillId);
      assertSkillPackageSafe(await analyzePackageDirectory(packagePath), 'run');
    }
    const skillParameters = typeof skill.parameters === 'string' ? JSON.parse(skill.parameters || '{}') : skill.parameters || {};
    inputFiles = await prepareSkillInputFiles(packagePath, runId, payload.input, sandboxPolicy.maxInputFiles);
    const inputJson = JSON.stringify({
      skill: {
        id: String(skill.id),
        name: skill.name,
        parameters: skillParameters,
      },
      input: {
        ...(extractInputRecord(payload.input)),
        fileDirectory: inputFiles.inputDir,
        filePaths: inputFiles.savedFiles.map((file) => file.path),
      },
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
      const outputContractError = validateSkillContract(skill.output_contract, instruction, 'Skill 输出');
      if (outputContractError) {
        const message = `Skill 输出不符合契约：${outputContractError}`;
        await query(
          `UPDATE skill_runs
           SET status = 'failed', progress = 100, output = ?, error_message = ?, logs = ?, completed_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            JSON.stringify({
              mode: 'prompt-only',
              text: instruction,
              instruction,
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

    const entry = safeRelativePath(String(skill.entry || ''));
    const entryPath = path.join(packagePath, entry);
    if (!isPathInside(entryPath, packagePath)) {
      throw new Error('Skill entry must be inside package directory.');
    }
    const command = runtime === 'python' ? pythonExecutable(packagePath) : 'node';
    const args = runtime === 'python'
      ? [entryPath, ...buildPythonSkillArgs(payload.input)]
      : [entryPath];
    const readableArgs = args.slice(1).map((item) => item.includes(' ') ? `"${item}"` : item).join(' ');
    await acquireSkillRunSlot();
    slotAcquired = true;
    const result = await runProcess(command, args, {
      cwd: inputFiles.workDir || packagePath,
      timeoutMs: sandboxPolicy.timeoutMs,
      maxOutputBytes: sandboxPolicy.maxOutputBytes,
      input: inputJson,
      env: {
        SKILL_PACKAGE_DIR: packagePath,
        SKILL_RUN_DIR: inputFiles.runDir,
        SKILL_WORK_DIR: inputFiles.workDir,
        SKILL_INPUT_DIR: inputFiles.inputDir,
        SKILL_INPUT_FILES: inputFiles.savedFiles.map((file) => file.path).join(path.delimiter),
        SKILL_PROJECT_ID: payload.projectId || '',
        SKILL_RUN_ID: String(runId),
      },
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

    const outputContractError = validateSkillContract(
      skill.output_contract,
      parseSkillOutputForContract(outputText),
      'Skill 输出'
    );
    if (outputContractError) {
      const message = `Skill 输出不符合契约：${outputContractError}`;
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
            summary: message,
          }),
          message,
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
  } finally {
    if (slotAcquired) releaseSkillRunSlot();
    if (inputFiles?.runDir) {
      await cleanupSkillRunDirectory(packagePath, inputFiles.runDir);
    }
  }

  return runId;
}

export async function testSkillPackage(userId: number, skillId: number) {
  const rows = await query<any>('SELECT * FROM skills WHERE id = ? AND user_id = ?', [skillId, userId]);
  const skill = rows[0];
  if (!skill) throw new Error('Skill not found.');

  if (skill.runtime !== 'prompt-only') {
    await updateSkillTestStatus(skillId, 'testing', '正在等待依赖初始化完成。');
    await initializeSkillEnvironment(skillId, userId);
  }

  const nextRows = await query<any>('SELECT * FROM skills WHERE id = ? AND user_id = ?', [skillId, userId]);
  const currentSkill = nextRows[0] || skill;
  if (currentSkill.install_status === 'failed') {
    const log = String(currentSkill.install_log || 'Skill 依赖初始化失败。');
    await updateSkillTestStatus(skillId, 'failed', log);
    return { ok: false, runId: null, log };
  }

  const runHealthCheck = () => runSkillPackage(userId, skillId, {
    projectId: HEALTH_TEST_PROJECT_ID,
    phase: 'health-check',
    input: buildSkillHealthInput(currentSkill),
  });

  await updateSkillTestStatus(skillId, 'testing', '正在使用示例输入测试 Skill 是否可用。');
  let runId = await runHealthCheck();

  let runs = await query<any>('SELECT * FROM skill_runs WHERE id = ? AND user_id = ?', [runId, userId]);
  let run = runs[0];
  let failed = run?.status === 'failed';
  const output = run?.output ? (typeof run.output === 'string' ? run.output : JSON.stringify(run.output)) : '';
  const log = [
    failed ? `测试失败：${run?.error_message || 'Skill 未通过健康测试。'}` : '测试通过：Skill 可以使用示例输入正常返回内容。',
    failed ? '测试阶段不会修改 Skill 包文件；请根据日志调整包后重新初始化。' : '',
    run?.logs,
    output ? `输出摘要：${compactRunText(output, 500)}` : '',
  ].filter(Boolean).join('\n');

  await updateSkillTestStatus(skillId, failed ? 'failed' : 'passed', log);
  return { ok: !failed, runId, log };
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

async function prepareSkillInputFiles(packagePath: string, runId: number, input: unknown, maxInputFiles = 8) {
  if (!packagePath) return { inputDir: '', savedFiles: [], runDir: '', workDir: '' };
  const record = extractInputRecord(input);
  const files = Array.isArray(record.fileContents)
    ? record.fileContents
    : Array.isArray(record.files)
      ? record.files
      : [];
  const runDir = path.join(packagePath, '.runs', String(runId));
  const inputDir = path.join(runDir, 'files');
  const workDir = path.join(runDir, 'work');
  const savedFiles: Array<{ name: string; path: string }> = [];

  await fs.mkdir(inputDir, { recursive: true });
  await fs.mkdir(workDir, { recursive: true });

  for (const [index, file] of files.slice(0, maxInputFiles).entries()) {
    const name = safeRelativePath(String(file?.name || `file-${index + 1}.txt`)).split('/').pop() || `file-${index + 1}.txt`;
    const target = path.join(inputDir, name);
    if (typeof file?.dataBase64 === 'string' && file.dataBase64.trim()) {
      const raw = file.dataBase64.includes(',') ? file.dataBase64.split(',').pop() || '' : file.dataBase64;
      await fs.writeFile(target, Buffer.from(raw, 'base64'));
    } else {
      const text = String(file?.text ?? file?.content ?? file?.markdown ?? '');
      await fs.writeFile(target, text, 'utf8');
    }
    savedFiles.push({ name, path: target });
  }

  return { inputDir, savedFiles, runDir, workDir };
}

async function cleanupSkillRunDirectory(packagePath: string, runDir: string) {
  if (!packagePath || !runDir) return;
  if (!isPathInside(runDir, packagePath)) return;
  await fs.rm(runDir, { recursive: true, force: true });
}

export async function removeSkillPackage(userId: number, skillId: number) {
  const target = path.join(storageRoot, String(userId), String(skillId));
  await fs.rm(target, { recursive: true, force: true });
}
