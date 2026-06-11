import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { query } from '../db/connection.js';
import { generatedSkillsRoot } from '../utils/storage.js';

export type SkillRuntime = 'prompt-only' | 'python' | 'node';
export type SkillInstallStatus = 'not_required' | 'pending' | 'installing' | 'ready' | 'failed';
export type SkillTestStatus = 'not_tested' | 'testing' | 'passed' | 'failed' | 'skipped';
export type SkillCapability =
  | 'web-search'
  | 'file-parse'
  | 'content-refine'
  | 'image-tool'
  | 'topic-extract'
  | 'generation-constraint'
  | 'chart-design'
  | 'svg-layout'
  | 'page-generation';

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
  autoFixes?: SkillPackageAutoFix[];
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

interface SkillPackageAutoFix {
  file: string;
  reason: string;
}

interface CommandSkillAdapter {
  runtime: SkillRuntime;
  entry: string;
  dependencyFile: string | null;
  inferredDependencies?: string[];
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

function repairSkillSecurityFalsePositiveText(content: string, relativePath: string) {
  let next = content;
  const fixes: string[] = [];
  const lowerPath = relativePath.toLowerCase();
  const isMarkdownLike = /\.(md|txt|rst)$/i.test(lowerPath);
  const isPython = /\.py$/i.test(lowerPath);

  if (isMarkdownLike || isPython) {
    const before = next;
    next = next.replace(/\bsudo\s+(apt|apt-get|dnf|yum|apk|brew)\s+/gi, '$1 ');
    if (next !== before) {
      fixes.push(isPython ? '移除提示文本中的 sudo 前缀' : '移除文档示例中的 sudo 前缀');
    }
  }

  if (isMarkdownLike) {
    const before = next;
    next = next
      .replace(/(['"`])\.\.\/scripts\1/g, '$1scripts$1')
      .replace(/(['"`])\.\.\\scripts\1/g, '$1scripts$1')
      .replace(/\.\.\/scripts/g, 'scripts')
      .replace(/\.\.\\scripts/g, 'scripts');
    if (next !== before) {
      fixes.push('改写文档示例中的父目录脚本路径');
    }
  }

  return { content: next, fixes };
}

function annotateSkillPackageAutoFixes(analysis: PackageAnalysis, fixes: SkillPackageAutoFix[]): PackageAnalysis {
  if (!fixes.length) return analysis;
  return {
    ...analysis,
    parameters: {
      ...analysis.parameters,
      autoFixes: fixes,
    },
    manifest: {
      ...analysis.manifest,
      autoFixes: fixes,
    },
  };
}

function autoRepairSkillPackageAnalysis(analysis: PackageAnalysis): PackageAnalysis {
  const repairedFiles = new Map<string, Buffer>();
  const fixes: SkillPackageAutoFix[] = [];
  let changed = false;

  for (const file of analysis.files) {
    repairedFiles.set(file.relativePath, file.data);
    const relativePath = file.relativePath.replace(/\\/g, '/');
    if (!isTextScannablePath(relativePath)) continue;
    if (file.data.byteLength > TEXT_SCAN_BYTES) continue;
    const content = readTextForSecurityScan(file.data);
    if (!content) continue;
    const repair = repairSkillSecurityFalsePositiveText(content, relativePath);
    if (!repair.fixes.length || repair.content === content) continue;
    repairedFiles.set(file.relativePath, Buffer.from(repair.content, 'utf8'));
    changed = true;
    for (const reason of repair.fixes) {
      fixes.push({ file: relativePath, reason });
    }
  }

  if (!changed) return analysis;
  const repairedAnalysis = normalizePackage(repairedFiles, analysis.name);
  return annotateSkillPackageAutoFixes(repairedAnalysis, fixes);
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
  if (['chart-design', 'chart', 'charts', 'data-chart', 'data-visualization', 'dataviz'].includes(raw)) return 'chart-design';
  if (['svg-layout', 'svg', 'layout', 'page-layout', 'visual-layout'].includes(raw)) return 'svg-layout';
  if (['page-generation', 'page', 'slide-generation', 'executor', 'svg-generation'].includes(raw)) return 'page-generation';
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
  if (/chart|table|dataviz|data[-\s]?visuali[sz]ation|图表|表格|数据可视化/.test(text)) capabilities.add('chart-design');
  if (/svg|layout|composition|grid|页面布局|版式|布局|构图/.test(text)) capabilities.add('svg-layout');
  if (/page[-\s]?generation|slide[-\s]?generation|executor|svg[-\s]?generation|页面生成|幻灯片生成|单页生成|svg生成/.test(text)) capabilities.add('page-generation');
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
    category: manifest.category || 'Web 搜索',
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
    return autoRepairSkillPackageAnalysis(normalizePackage(files, filename));
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
  return autoRepairSkillPackageAnalysis(normalizePackage(files, filename));
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
      inferredDependencies: ['markitdown'],
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
import sys

try:
    from markitdown import MarkItDown
except ImportError as e:
    print(f"Error: Missing required dependency: {e}", file=sys.stderr)
    print("Install with: pip install markitdown", file=sys.stderr)
    sys.exit(1)


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
    converter = MarkItDown()
    result = converter.convert(path)
    text = getattr(result, "text_content", None) or str(result)
    return text.strip()


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
  const autoFixes = Array.isArray(analysis.parameters.autoFixes)
    ? analysis.parameters.autoFixes as SkillPackageAutoFix[]
    : [];

  if (autoFixes.length) {
    const files = Array.from(new Set(autoFixes.map((fix) => fix.file))).slice(0, 4);
    plan.push(`已自动修复 ${autoFixes.length} 处包内安全检查误报：${files.join('、')}${autoFixes.length > files.length ? ' 等' : ''}`);
  }

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

  if (commandAdapter?.inferredDependencies?.length) {
    plan.push(`自动补充适配器依赖：${commandAdapter.inferredDependencies.join('、')}`);
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
  const adapterDependencies = commandAdapter?.inferredDependencies || [];
  if (adapterDependencies.length) {
    const inferredDependencies = Array.from(new Set([
      ...nextAnalysis.inferredDependencies,
      ...adapterDependencies,
    ])).sort((a, b) => a.localeCompare(b));
    return {
      analysis: {
        ...nextAnalysis,
        inferredDependencies,
        parameters: {
          ...nextAnalysis.parameters,
          inferredDependencies,
        },
        manifest: {
          ...nextAnalysis.manifest,
          inferredDependencies,
        },
      },
      logs,
    };
  }

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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeLogPaths(value: string, packagePath?: string) {
  if (!value) return '';
  let next = value.replace(/\r\n/g, '\n');
  const normalizedPackagePath = packagePath ? path.resolve(packagePath) : '';

  if (normalizedPackagePath) {
    const variants = Array.from(new Set([
      normalizedPackagePath,
      normalizedPackagePath.replace(/\\/g, '/'),
      normalizedPackagePath.replace(/\//g, '\\'),
    ])).filter(Boolean);

    for (const variant of variants) {
      next = next.replace(new RegExp(`${escapeRegExp(variant)}(?:[\\/])?`, 'gi'), '<skill-package>/');
    }
  }

  return next
    .replace(/(["'`])([A-Za-z]:[\\/][^"'`\n\r<>|]+)\1/g, '$1<local-path>$1')
    .replace(/\b[A-Za-z]:[\\/][^\s"'`<>|]+/g, '<local-path>')
    .replace(/(["'`])((?:\/home\/|\/Users\/|\/root\/|\/var\/|\/tmp\/|\/opt\/|\/srv\/)[^"'`\n\r]+)\1/g, '$1<local-path>$1')
    .replace(/(?:\/home\/|\/Users\/|\/root\/|\/var\/|\/tmp\/|\/opt\/|\/srv\/)[^\s"'`<>]+/g, '<local-path>')
    .replace(/<skill-package>[\\/]/g, '<skill-package>/');
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
  const safeLog = sanitizeLogPaths(log).slice(-12000);
  await query(
    `UPDATE skills
     SET install_status = ?, install_log = ?, last_installed_at = ${installed ? 'CURRENT_TIMESTAMP' : 'last_installed_at'}
     WHERE id = ?`,
    [status, safeLog, skillId]
  );
}

async function updateSkillTestStatus(skillId: number, status: SkillTestStatus, log: string) {
  const safeLog = sanitizeLogPaths(log).slice(-12000);
  await query(
    `UPDATE skills
     SET test_status = ?, test_log = ?, last_tested_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [status, safeLog, skillId]
  );
}

async function readSkillMarkdownSampleFile(skill: any) {
  const packagePath = String(skill?.package_path || '');
  if (!packagePath) return null;
  const manifest = parseJsonRecord(skill?.manifest);
  const skillMdPath = safeRelativePath(String(manifest.skillMdPath || manifest.skill_md_path || 'SKILL.md'));
  const candidates = Array.from(new Set([skillMdPath, 'SKILL.md', 'skill.md'].filter(Boolean)));

  for (const relativePath of candidates) {
    const absolutePath = path.join(packagePath, relativePath);
    if (!isPathInside(absolutePath, packagePath)) continue;
    if (!(await fileExists(absolutePath))) continue;
    const text = await fs.readFile(absolutePath, 'utf8');
    return {
      name: path.basename(relativePath) || 'skill.md',
      text,
      content: text,
      markdown: text,
      mimeType: 'text/markdown',
      extension: 'md',
      kind: 'document',
      status: 'parsed',
      summary: '使用 Skill 包内 skill.md 作为健康测试文件。',
    };
  }

  return null;
}

async function buildImageHealthSampleFile() {
  let dataBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  try {
    const { Resvg } = await import('@resvg/resvg-js');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300">
  <rect width="480" height="300" fill="#F8FAFC"/>
  <rect x="44" y="42" width="392" height="216" rx="24" fill="#FFFFFF" stroke="#2563EB" stroke-width="8"/>
  <text x="240" y="132" text-anchor="middle" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#0F172A">Nexious PPT</text>
  <text x="240" y="190" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" fill="#2563EB">Skill Test Image</text>
</svg>`;
    dataBase64 = Buffer.from(new Resvg(svg).render().asPng()).toString('base64');
  } catch {
    // Keep the health check independent from optional native rendering failures.
  }

  return {
    name: 'skill-image-test.png',
    dataBase64,
    mimeType: 'image/png',
    extension: 'png',
    kind: 'image',
    status: 'parsed',
    text: '图片识别 Skill 健康测试图片：画面包含 Nexious PPT 和 Skill Test Image 文本。',
    content: '请识别这张健康测试图片的画面内容和可见文字。',
    summary: '系统内置图片健康测试样本。',
  };
}

function textIncludesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function getSchemaProperties(schema: Record<string, unknown>) {
  return parseJsonRecord(schema.properties);
}

function getSchemaRequiredKeys(schema: Record<string, unknown>) {
  return Array.isArray(schema.required) ? schema.required.map((item) => String(item)) : [];
}

function collectContractKeys(schema: Record<string, unknown>, prefix = '', depth = 0): string[] {
  if (depth > 4 || !schema || typeof schema !== 'object') return [];
  const keys = new Set<string>();
  for (const key of getSchemaRequiredKeys(schema)) keys.add(prefix ? `${prefix}.${key}` : key);
  for (const [key, value] of Object.entries(getSchemaProperties(schema))) {
    const pathKey = prefix ? `${prefix}.${key}` : key;
    keys.add(pathKey);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const nested of collectContractKeys(value as Record<string, unknown>, pathKey, depth + 1)) {
        keys.add(nested);
      }
    }
  }
  return Array.from(keys);
}

function inferSchemaType(schema: Record<string, unknown>) {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  return typeof type === 'string' ? type : '';
}

function getContractSchemaForKey(contract: Record<string, unknown>, key: string) {
  const properties = getSchemaProperties(contract);
  const schema = properties[key];
  return schema && typeof schema === 'object' && !Array.isArray(schema)
    ? schema as Record<string, unknown>
    : {};
}

async function readSkillPackageText(skill: any) {
  const packagePath = String(skill?.package_path || '');
  const manifest = parseJsonRecord(skill?.manifest);
  const parameters = parseJsonRecord(skill?.parameters);
  const texts: string[] = [
    skill?.name,
    skill?.description,
    skill?.category,
    skill?.entry,
    compactMetadataValue(manifest),
    compactMetadataValue(parameters),
    parseStoredCapabilities(skill?.capabilities).join(' '),
  ].filter(Boolean).map(String);

  if (packagePath) {
    const skillMdPath = safeRelativePath(String(manifest.skillMdPath || manifest.skill_md_path || 'SKILL.md'));
    const candidates = Array.from(new Set([skillMdPath, 'SKILL.md', 'skill.md'].filter(Boolean)));
    for (const relativePath of candidates) {
      const absolutePath = path.join(packagePath, relativePath);
      if (!isPathInside(absolutePath, packagePath) || !(await fileExists(absolutePath))) continue;
      texts.push((await fs.readFile(absolutePath, 'utf8')).slice(0, TEXT_SCAN_BYTES));
      break;
    }

    const entry = String(skill?.entry || '');
    if (entry) {
      const entryPath = path.join(packagePath, safeRelativePath(entry));
      if (isPathInside(entryPath, packagePath) && await fileExists(entryPath)) {
        texts.push((await fs.readFile(entryPath, 'utf8')).slice(0, TEXT_SCAN_BYTES));
      }
    }
  }

  return texts.join('\n').toLowerCase();
}

function inferSkillHealthProfile(skill: any, text: string, contract: Record<string, unknown>) {
  const contractKeys = collectContractKeys(contract).join(' ').toLowerCase();
  const combined = `${text}\n${contractKeys}`;
  const wantsFile = textIncludesAny(combined, [
    /\b(file|files|filepath|file_path|path|paths|document|documents|attachment|attachments)\b/i,
    /\b(pdf|docx|pptx|xlsx|markdown|markitdown|convert|parse)\b/i,
    /文件|附件|文档|解析|转换|读取/i,
  ]);
  const wantsImageFile = textIncludesAny(combined, [
    /\b(image|images|picture|photo|vision|ocr)\b/i,
    /图片|图像|视觉|识别|OCR/i,
  ]) && !textIncludesAny(combined, [
    /\b(image\s*search|search\s*image|generate\s*image|image\s*generation|text-to-image)\b/i,
    /图片搜索|素材搜索|生成图片|图片生成|配图/i,
  ]);
  const wantsImageSearch = textIncludesAny(combined, [
    /\b(image\s*search|search\s*image|stock\s*photo|asset\s*search)\b/i,
    /图片搜索|素材搜索|图库/i,
  ]);
  const wantsImageGeneration = textIncludesAny(combined, [
    /\b(generate\s*image|image\s*generation|text-to-image|draw|paint)\b/i,
    /生成图片|图片生成|绘制|配图/i,
  ]);
  const wantsSearch = textIncludesAny(combined, [
    /\b(query|search|web|bing|google|duckduckgo|ddgs|url|urls)\b/i,
    /联网|搜索|网页|资料收集|检索/i,
  ]);

  const intent =
    wantsImageSearch ? 'image-search'
      : wantsImageGeneration ? 'image-generation'
        : wantsImageFile ? 'image-file'
          : wantsFile ? 'file-parse'
            : wantsSearch ? 'web-search'
              : 'content-refine';

  return {
    intent,
    wantsFile: wantsFile || wantsImageFile,
    wantsImageFile,
    wantsSearch,
    wantsImageSearch,
    wantsImageGeneration,
    query: '手机发展历程',
    topic: '手机发展历程',
  };
}

function applyInputContractDefaults(input: Record<string, any>, contract: Record<string, unknown>, profile: ReturnType<typeof inferSkillHealthProfile>, sampleFile: any | null) {
  const properties = getSchemaProperties(contract);
  const requiredKeys = getSchemaRequiredKeys(contract);
  const keys = Array.from(new Set([...Object.keys(properties), ...requiredKeys]));

  for (const key of keys) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== '') continue;
    const schema = getContractSchemaForKey(contract, key);
    const lowerKey = key.toLowerCase();
    const type = inferSchemaType(schema);
    const enumValues = Array.isArray(schema.enum) ? schema.enum : [];
    if (enumValues.length) {
      input[key] = enumValues[0];
    } else if (/query|keyword|search|url/.test(lowerKey)) {
      input[key] = profile.query;
    } else if (/topic|title|subject/.test(lowerKey)) {
      input[key] = profile.topic;
    } else if (/prompt|instruction|content|text|markdown/.test(lowerKey)) {
      input[key] = profile.wantsImageGeneration
        ? '生成一张适合 16:9 PPT 使用的清晰配图，主体明确，构图自然。'
        : '请把手机发展历程整理为可用于 PPT 的资料要点。';
    } else if (/max.*result|limit|count|num|size/.test(lowerKey)) {
      input[key] = 5;
    } else if (/format/.test(lowerKey)) {
      input[key] = 'markdown';
    } else if (/type|mode/.test(lowerKey)) {
      input[key] = profile.intent;
    } else if (/file|files|image|images|path|paths/.test(lowerKey)) {
      input[key] = type === 'array'
        ? (sampleFile ? [sampleFile] : [])
        : sampleFile;
    } else if (type === 'array') {
      input[key] = [];
    } else if (type === 'number' || type === 'integer') {
      input[key] = 1;
    } else if (type === 'boolean') {
      input[key] = true;
    } else if (type === 'object') {
      input[key] = {};
    } else {
      input[key] = 'Nexious PPT Skill health check';
    }
  }

  return input;
}

async function buildAdaptiveSkillHealthInput(skill: any) {
  const testSample = parseJsonRecord(skill?.test_sample);
  const inputContract = parseJsonRecord(skill?.input_contract);
  const packageText = await readSkillPackageText(skill);
  const profile = inferSkillHealthProfile(skill, packageText, inputContract);
  const sampleFile = profile.wantsImageFile
    ? await buildImageHealthSampleFile()
    : profile.wantsFile
      ? await readSkillMarkdownSampleFile(skill)
      : null;
  const sampleFiles = Array.isArray(testSample.fileContents)
    ? testSample.fileContents
    : Array.isArray(testSample.files)
      ? testSample.files
      : sampleFile
        ? [sampleFile]
        : [];
  const input: Record<string, any> = {
    ...testSample,
    purpose: String(testSample.purpose || profile.intent),
    topic: String(testSample.topic || profile.topic),
    query: String(testSample.query || testSample.keyword || profile.query),
    content: String(testSample.content || testSample.text || '请把手机发展历程整理为可用于 PPT 的资料要点。'),
  };

  if (profile.wantsImageGeneration) {
    input.prompt = String(testSample.prompt || '生成一张适合 16:9 PPT 使用的清晰配图，主体明确，构图自然。');
  }
  if (sampleFiles.length) {
    input.fileContents = sampleFiles;
    input.files = sampleFiles;
    if (profile.wantsImageFile) input.images = sampleFiles;
  }
  if (profile.wantsSearch || profile.wantsImageSearch) {
    input.maxResults = Number(testSample.maxResults || testSample.max_results || 5);
    input.format = String(testSample.format || 'markdown');
  }

  return applyInputContractDefaults(input, inputContract, profile, sampleFiles[0] || null);
}

async function buildSkillHealthInput(skill: any) {
  return buildAdaptiveSkillHealthInput(skill);

  const testSample = parseJsonRecord(skill?.test_sample);
  const capabilities = parseStoredCapabilities(skill?.capabilities);
  const categoryText = String(skill?.category || '').toLowerCase();
  const nameText = String(skill?.name || '').toLowerCase();
  const entryText = String(skill?.entry || '').toLowerCase();
  const packageText = `${categoryText} ${nameText} ${entryText}`;
  const isSearch = capabilities.includes('web-search') || /search|web|collect|web 搜索|资料收集|搜索|联网/.test(packageText);
  const isFileParse = capabilities.includes('file-parse') || /file|parse|文件|解析|markitdown|markdown[_-]?adapter/.test(packageText);
  const imageText = packageText;
  const isImageTool = capabilities.includes('image-tool') || /image|vision|picture|ocr|图片|图像|视觉|识别/.test(imageText);
  const isImageSearch = /image\s*search|图片搜索|素材搜索/.test(imageText);
  const isImageGeneration = /image\s*(gen|generation)|生成图片|图片生成|配图/.test(imageText);
  const needsImageFile = isImageTool && !isImageSearch && !isImageGeneration;

  if (
    Object.keys(testSample).length > 0
    && !isSearch
    && !isFileParse
    && !isImageSearch
    && !isImageGeneration
    && !needsImageFile
  ) {
    return testSample;
  }

  if (isImageSearch) {
    return {
      ...testSample,
      purpose: 'image-search',
      query: String(testSample.query || testSample.topic || '现代办公协作场景配图'),
      topic: String(testSample.topic || '现代办公协作场景配图'),
      content: String(testSample.content || '请搜索适合 PPT 使用的现代办公协作场景图片素材，返回标题、来源和可用链接。'),
    };
  }

  if (isImageGeneration) {
    return {
      ...testSample,
      purpose: 'image-generation',
      topic: String(testSample.topic || 'Nexious PPT 健康测试配图'),
      prompt: String(testSample.prompt || '生成一张简洁、清晰的 PPT 配图：现代办公桌面、蓝色点缀、适合 16:9 幻灯片。'),
      content: String(testSample.content || '请根据提示词生成或返回一张适合 PPT 使用的测试图片结果。'),
    };
  }

  if (isFileParse) {
    const sampleFile = await readSkillMarkdownSampleFile(skill) || {
      name: 'skill.md',
      text: '文件解析 Skill 健康测试：请读取这段 Markdown 内容，并提取可用于生成 PPT 的主题和关键要点。',
      content: '文件解析 Skill 健康测试：请读取这段 Markdown 内容，并提取可用于生成 PPT 的主题和关键要点。',
      markdown: '文件解析 Skill 健康测试：请读取这段 Markdown 内容，并提取可用于生成 PPT 的主题和关键要点。',
      mimeType: 'text/markdown',
      extension: 'md',
      kind: 'document',
      status: 'parsed',
      summary: '健康测试 Markdown 文件。',
    };
    const sampleFiles = Array.isArray(testSample.fileContents)
      ? testSample.fileContents
      : Array.isArray(testSample.files)
        ? testSample.files
        : [];
    return {
      ...testSample,
      purpose: '文件解析',
      topic: 'Skill 健康测试',
      content: '请解析随本次健康测试传入的 skill.md 文件，并返回可用于 PPT 输入阶段的 Markdown 文本摘要。',
      fileContents: sampleFiles.length ? sampleFiles : [sampleFile],
      files: sampleFiles.length ? sampleFiles : [sampleFile],
    };
  }

  if (needsImageFile) {
    const sampleFile = await buildImageHealthSampleFile();
    const sampleFiles = Array.isArray(testSample.fileContents)
      ? testSample.fileContents
      : Array.isArray(testSample.files)
        ? testSample.files
        : [];
    return {
      ...testSample,
      purpose: '图片识别',
      topic: String(testSample.topic || 'Skill 图片健康测试'),
      content: String(testSample.content || '请识别随本次健康测试传入的图片，返回画面内容、可见文字和可用于 PPT 的要点。'),
      fileContents: sampleFiles.length ? sampleFiles : [sampleFile],
      files: sampleFiles.length ? sampleFiles : [sampleFile],
      images: sampleFiles.length ? sampleFiles : [sampleFile],
    };
  }

  if (isSearch) {
    const query = String(testSample.query || testSample.topic || '手机发展历程');
    return {
      ...testSample,
      purpose: String(testSample.purpose || '资料收集'),
      query,
      topic: String(testSample.topic || query),
      content: String(testSample.content || '请联网搜索手机发展历程，并返回可用于 PPT 的简要资料。'),
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
          sanitizeLogPaths([
            '正在自动适配 Skill 包到输入阶段工作流...',
            ...adaptationLogs,
            adaptationLogs.length ? '自动适配完成，准备初始化依赖。' : '未发现需要生成的新执行入口，准备初始化依赖。',
          ].join('\n'), packagePath),
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
      }
      if (inferredDependencies.length) {
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
  const autoFixes = Array.isArray(analysis.parameters.autoFixes)
    ? analysis.parameters.autoFixes as SkillPackageAutoFix[]
    : [];
  const autoFixLog = autoFixes.length
    ? `已自动修复包内安全检查误报：\n${autoFixes.map((fix) => `- ${fix.file}：${fix.reason}`).join('\n')}\n\n`
    : '';
  const baseInitialLog = initialStatus === 'not_required'
    ? '未识别到可执行入口，将作为提示词型 Skill 使用；无需依赖初始化。'
    : 'Skill 包已保存，等待自动适配、初始化依赖并执行健康测试。';
  const initialLog = autoFixLog + baseInitialLog;
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
    const cliArgs = await buildSkillCliArgsForRun(payload.input, skill, {
      entryPath,
      savedFiles: inputFiles.savedFiles,
    });
    const args = [entryPath, ...cliArgs];
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
    const safeStderrText = sanitizeLogPaths(stderrText, packagePath);
    const safeValidationMessage = sanitizeLogPaths(validation.message, packagePath);
    const safeReadableArgs = sanitizeLogPaths(readableArgs, packagePath);
    const safeArgs = args.slice(1).map((item) => sanitizeLogPaths(item, packagePath));

    if (!validation.ok) {
      await query(
        `UPDATE skill_runs
         SET status = 'failed', progress = 100, output = ?, error_message = ?, logs = ?, completed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          JSON.stringify({
            mode: runtime,
            entry,
            args: safeArgs,
            text: outputText,
            stderr: safeStderrText,
            ok: false,
            summary: safeValidationMessage,
          }),
          safeValidationMessage,
          [
            `执行入口：${entry}${safeReadableArgs ? ` ${safeReadableArgs}` : ''}`,
            safeStderrText,
            outputText ? `stdout：${compactRunText(outputText, 1200)}` : '未返回 stdout 内容。',
          ].filter(Boolean).map((item) => sanitizeLogPaths(item, packagePath)).join('\n'),
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
            args: safeArgs,
            text: outputText,
            stderr: safeStderrText,
            ok: false,
            summary: sanitizeLogPaths(message, packagePath),
          }),
          sanitizeLogPaths(message, packagePath),
          [
            `执行入口：${entry}${safeReadableArgs ? ` ${safeReadableArgs}` : ''}`,
            safeStderrText,
            outputText ? `stdout：${compactRunText(outputText, 1200)}` : '未返回 stdout 内容。',
          ].filter(Boolean).map((item) => sanitizeLogPaths(item, packagePath)).join('\n'),
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
          args: safeArgs,
          text: outputText,
          stderr: safeStderrText,
          ok: true,
          summary: outputText ? outputText.slice(0, 500) : 'Skill 执行完成，但没有返回正文。',
        }),
        [
          `执行入口：${entry}${safeReadableArgs ? ` ${safeReadableArgs}` : ''}`,
          safeStderrText,
          outputText ? `输出 ${outputText.length} 个字符。` : '未返回 stdout 内容。',
        ].filter(Boolean).map((item) => sanitizeLogPaths(item, packagePath)).join('\n'),
        runId,
      ]
    );
  } catch (error) {
    const message = sanitizeLogPaths(error instanceof Error ? error.message : 'Skill run failed.', packagePath);
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

  const runHealthCheck = async () => runSkillPackage(userId, skillId, {
    projectId: HEALTH_TEST_PROJECT_ID,
    phase: 'health-check',
    input: await buildSkillHealthInput(currentSkill),
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

function compactMetadataValue(value: unknown) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildSkillMetadataText(skill: any, input: unknown, entrySource = '') {
  const inputRecord = extractInputRecord(input);
  const manifest = parseJsonRecord(skill?.manifest);
  const parameters = parseJsonRecord(skill?.parameters);
  const capabilities = parseStoredCapabilities(skill?.capabilities);
  return [
    skill?.name,
    skill?.description,
    skill?.category,
    skill?.entry,
    inputRecord.purpose,
    inputRecord.type,
    inputRecord.mode,
    ...capabilities,
    compactMetadataValue(manifest),
    compactMetadataValue(parameters),
    entrySource,
  ].filter(Boolean).join(' ').toLowerCase();
}

function sourceHasFlag(source: string, flag: string) {
  return source.includes(`'${flag}'`)
    || source.includes(`"${flag}"`)
    || source.includes(flag);
}

function sourceExpectsFileArgument(source: string) {
  if (!source.trim()) return false;
  return /add_argument\(\s*['"](?:input|file|path|document|image|source|filename)/i.test(source)
    || /\bsys\.argv\[\s*1\s*\]/.test(source);
}

function sourceAcceptsMultipleFiles(source: string) {
  return /nargs\s*=\s*['"](?:\+|\*)['"]/.test(source)
    || /add_argument\(\s*['"](?:files|paths|documents|images)/i.test(source);
}

function extractCliPositionals(source: string) {
  const positionals: string[] = [];
  for (const match of source.matchAll(/add_argument\(\s*['"]([^'"-][^'"]*)['"]/g)) {
    const name = String(match[1] || '').trim();
    if (name && !name.startsWith('-')) positionals.push(name);
  }
  return Array.from(new Set(positionals));
}

function buildValueForCliPositional(name: string, input: Record<string, any>, query: string, savedFiles: Array<{ name: string; path: string }>) {
  const lower = name.toLowerCase();
  if (/file|path|document|doc|pdf|ppt|excel|image|photo|picture|input|source/.test(lower)) {
    return savedFiles[0]?.path || '';
  }
  if (/query|keyword|search|url|link/.test(lower)) {
    return String(input.query || input.keyword || input.url || query || '').trim();
  }
  if (/prompt|instruction|text|content|markdown/.test(lower)) {
    return String(input.prompt || input.content || input.text || query || '').trim();
  }
  if (/topic|title|subject/.test(lower)) {
    return String(input.topic || input.title || query || '').trim();
  }
  return String(input[name] || query || input.content || '').trim();
}

function appendKnownCliOptions(args: string[], source: string, record: Record<string, any>) {
  if (sourceHasFlag(source, '--max-results')) {
    args.push('--max-results', String(record.maxResults || record.max_results || 5));
  } else if (sourceHasFlag(source, '--limit')) {
    args.push('--limit', String(record.maxResults || record.max_results || 5));
  }
  if (sourceHasFlag(source, '--format')) {
    args.push('--format', String(record.format || 'markdown'));
  }
  if (sourceHasFlag(source, '--type')) {
    args.push('--type', String(record.searchType || record.type || 'web'));
  }
}

async function readEntrySource(entryPath?: string) {
  if (!entryPath) return '';
  try {
    return await fs.readFile(entryPath, 'utf8');
  } catch {
    return '';
  }
}

async function buildSkillCliArgsForRun(
  input: unknown,
  skill?: any,
  options: { entryPath?: string; savedFiles?: Array<{ name: string; path: string }> } = {}
) {
  const record = extractInputRecord(input);
  const purpose = String(record.purpose || '');
  const query = inferSkillQuery(input);
  const entrySource = await readEntrySource(options.entryPath);
  const metadataText = buildSkillMetadataText(skill, input, entrySource);
  const entryText = String(skill?.entry || options.entryPath || '').toLowerCase();
  const sourceExpectsQuery = /add_argument\(\s*['"]query['"]/i.test(entrySource)
    || /\bquery\b[\s\S]{0,120}\bsys\.argv\[\s*1\s*\]/i.test(entrySource);
  const searchLike = sourceExpectsQuery
    || /search|collect|web|bing|google|duckduckgo|ddgs|联网|搜索|资料收集|图片搜索|素材搜索/i.test(`${purpose} ${entryText} ${metadataText}`);
  const fileLike = /file|parse|document|pdf|docx|pptx|xlsx|markdown|markitdown|ocr|文件|解析|读取|图片识别|图像识别/i.test(`${purpose} ${entryText} ${metadataText}`);
  const args: string[] = [];
  const savedFiles = options.savedFiles || [];
  const positionals = extractCliPositionals(entrySource);

  if (positionals.length) {
    for (const positional of positionals) {
      const value = buildValueForCliPositional(positional, record, query, savedFiles);
      if (value) args.push(value);
    }
    appendKnownCliOptions(args, entrySource, record);
    if (args.length) return args;
  }

  if (query && searchLike) {
    args.push(query);
    appendKnownCliOptions(args, entrySource, record);
    return args;
  }

  if (fileLike && savedFiles.length && sourceExpectsFileArgument(entrySource)) {
    const files = sourceAcceptsMultipleFiles(entrySource) ? savedFiles : savedFiles.slice(0, 1);
    args.push(...files.map((file) => file.path));
  }
  return args;
}

function buildPythonSkillArgs(input: unknown) {
  const record = extractInputRecord(input);
  const purpose = String(record.purpose || '');
  const query = inferSkillQuery(input);
  if (!query) return [];

  if (/search|collect|web|web 搜索|资料收集|图片搜索|素材搜索/i.test(purpose)) {
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
