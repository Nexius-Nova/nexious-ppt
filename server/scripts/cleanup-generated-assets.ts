import path from 'path';
import { promises as fs } from 'fs';
import { query, closePool } from '../db/connection.js';
import {
  collectGeneratedAssetUrls,
  deleteGeneratedPath,
  generatedPathFromUrl,
  sanitizeGeneratedProjectName,
} from '../utils/generatedAssets.js';
import {
  generatedAvatarsRoot,
  generatedImagesRoot,
  generatedProjectsRoot,
  storageRoot,
} from '../utils/storage.js';

const generatedRoot = storageRoot;
const apply = process.argv.includes('--apply');

type CleanupPlan = {
  staleAssetFiles: string[];
  staleProjectDirs: string[];
};

function isInside(parent: string, target: string) {
  const relative = path.relative(parent, target);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function normalizePath(value: string) {
  return path.resolve(value);
}

async function tableExists(tableName: string) {
  const rows = await query(`SHOW TABLES LIKE ?`, [tableName]).catch(() => []);
  return rows.length > 0;
}

async function readTableRows(tableName: string, columns: string[]) {
  if (!(await tableExists(tableName))) return [];
  return query(`SELECT ${columns.map((column) => `\`${column}\``).join(', ')} FROM \`${tableName}\``).catch(() => []);
}

function parseJsonValue(value: unknown) {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function collectUsedGeneratedAssetPaths() {
  const urls = new Set<string>();
  const addUrls = (value: unknown) => {
    collectGeneratedAssetUrls(value).forEach((url) => urls.add(url));
  };

  const users = await readTableRows('users', ['avatar']);
  users.forEach((row: any) => addUrls(row.avatar));

  const prompts = await readTableRows('prompts', ['preview_url']);
  prompts.forEach((row: any) => addUrls(row.preview_url));

  const templates = await readTableRows('templates', ['preview_url', 'settings']);
  templates.forEach((row: any) => {
    addUrls(row.preview_url);
    addUrls(parseJsonValue(row.settings));
  });

  const projects = await readTableRows('projects', ['title', 'topic', 'content', 'state']);
  projects.forEach((row: any) => addUrls({
    title: row.title,
    topic: row.topic,
    content: row.content,
    state: parseJsonValue(row.state),
  }));

  const versions = await readTableRows('version_snapshots', ['state']);
  versions.forEach((row: any) => addUrls(parseJsonValue(row.state)));

  const workflowSnapshots = await readTableRows('workflow_snapshots', ['snapshot_data']);
  workflowSnapshots.forEach((row: any) => addUrls(parseJsonValue(row.snapshot_data)));

  const generationJobs = await readTableRows('generation_jobs', ['metadata']);
  generationJobs.forEach((row: any) => addUrls(parseJsonValue(row.metadata)));

  const paths = new Set<string>();
  urls.forEach((url) => {
    const generatedPath = generatedPathFromUrl(url);
    if (generatedPath) paths.add(normalizePath(generatedPath));
  });
  return paths;
}

async function collectAllFiles(root: string) {
  const files: string[] = [];
  async function walk(dir: string) {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true }) as any;
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(normalizePath(fullPath));
      }
    }
  }
  await walk(root);
  return files;
}

async function collectActiveProjectDirPrefixes() {
  const rows = await readTableRows('projects', ['title']);
  return new Set(rows
    .map((row: any) => `${sanitizeGeneratedProjectName(row.title)}_`)
    .filter(Boolean));
}

async function collectStaleProjectDirs() {
  const keepPrefixes = await collectActiveProjectDirPrefixes();
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(generatedProjectsRoot, { withFileTypes: true }) as any;
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(generatedProjectsRoot, entry.name))
    .filter((dir) => {
      const name = path.basename(dir);
      return !Array.from(keepPrefixes).some((prefix) => name.startsWith(prefix));
    })
    .map(normalizePath);
}

async function buildCleanupPlan(): Promise<CleanupPlan> {
  const usedAssetPaths = await collectUsedGeneratedAssetPaths();
  const assetFiles = [
    ...(await collectAllFiles(generatedImagesRoot)),
    ...(await collectAllFiles(generatedAvatarsRoot)),
  ];

  return {
    staleAssetFiles: assetFiles.filter((file) => !usedAssetPaths.has(file)),
    staleProjectDirs: await collectStaleProjectDirs(),
  };
}

async function main() {
  const plan = await buildCleanupPlan();
  const totalFiles = plan.staleAssetFiles.length;
  const totalDirs = plan.staleProjectDirs.length;

  console.log(apply ? '将清理以下 .generated 残留资源：' : 'Dry run：以下 .generated 资源可清理：');
  console.log(`- 未被数据库引用的图片/头像文件：${totalFiles} 个`);
  console.log(`- 没有对应项目标题的导出目录：${totalDirs} 个`);

  [...plan.staleAssetFiles, ...plan.staleProjectDirs].slice(0, 120).forEach((item) => {
    console.log(`  ${item}`);
  });
  if (totalFiles + totalDirs > 120) {
    console.log(`  ... 还有 ${totalFiles + totalDirs - 120} 项未展示`);
  }

  if (!apply) {
    console.log('未执行删除。确认无误后运行：pnpm cleanup-generated -- --apply');
    return;
  }

  for (const file of plan.staleAssetFiles) {
    if (isInside(generatedImagesRoot, file) || isInside(generatedAvatarsRoot, file)) {
      await deleteGeneratedPath(file);
    }
  }
  for (const dir of plan.staleProjectDirs) {
    if (isInside(generatedProjectsRoot, dir)) {
      await deleteGeneratedPath(dir);
    }
  }
  console.log('清理完成。');
}

main()
  .catch((error) => {
    console.error('清理 .generated 残留资源失败:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => undefined);
  });
