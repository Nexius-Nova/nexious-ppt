import path from 'path';
import { promises as fs } from 'fs';
import {
  generatedAvatarsRoot,
  generatedImagesRoot,
  generatedProjectsRoot,
  storageRoot,
} from './storage.js';

const GENERATED_ROOT = storageRoot;
const GENERATED_IMAGES_ROOT = generatedImagesRoot;
const GENERATED_AVATARS_ROOT = generatedAvatarsRoot;
const GENERATED_PROJECTS_ROOT = generatedProjectsRoot;

function isInside(parent: string, target: string) {
  const relative = path.relative(parent, target);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function removeEmptyParents(startDir: string, stopDir: string) {
  let current = path.resolve(startDir);
  const stop = path.resolve(stopDir);
  while (isInside(stop, current)) {
    try {
      await fs.rmdir(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

export async function deleteGeneratedPath(targetPath: string) {
  const resolved = path.resolve(targetPath);
  if (!isInside(GENERATED_ROOT, resolved)) return false;

  await fs.rm(resolved, { recursive: true, force: true });
  const cleanupStop = resolved.startsWith(GENERATED_AVATARS_ROOT)
    ? GENERATED_AVATARS_ROOT
    : resolved.startsWith(GENERATED_PROJECTS_ROOT)
      ? GENERATED_PROJECTS_ROOT
      : GENERATED_IMAGES_ROOT;
  await removeEmptyParents(path.dirname(resolved), cleanupStop).catch(() => undefined);
  return true;
}

function pathnameFromAssetUrl(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/generated-images/') || raw.startsWith('/avatars/')) return raw;
  try {
    const url = new URL(raw);
    if (url.pathname.startsWith('/generated-images/') || url.pathname.startsWith('/avatars/')) {
      return decodeURIComponent(url.pathname);
    }
  } catch {
    return '';
  }
  return '';
}

export function generatedPathFromUrl(value: string) {
  const pathname = pathnameFromAssetUrl(value);
  if (pathname.startsWith('/generated-images/')) {
    const relative = pathname.replace(/^\/generated-images\/?/, '');
    const target = path.resolve(GENERATED_IMAGES_ROOT, relative);
    return isInside(GENERATED_IMAGES_ROOT, target) ? target : '';
  }
  if (pathname.startsWith('/avatars/')) {
    const relative = pathname.replace(/^\/avatars\/?/, '');
    const target = path.resolve(GENERATED_AVATARS_ROOT, relative);
    return isInside(GENERATED_AVATARS_ROOT, target) ? target : '';
  }
  return '';
}

export async function deleteGeneratedAssetUrl(value: unknown) {
  if (typeof value !== 'string') return false;
  const target = generatedPathFromUrl(value);
  if (!target) return false;
  return deleteGeneratedPath(target);
}

export async function deleteGeneratedAssetUrls(values: Iterable<unknown>) {
  const targets = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const target = generatedPathFromUrl(value);
    if (target) targets.add(target);
  }
  await Promise.all(Array.from(targets).map((target) => deleteGeneratedPath(target)));
}

export function collectGeneratedAssetUrls(value: unknown): string[] {
  const urls = new Set<string>();
  const visit = (item: unknown) => {
    if (!item) return;
    if (typeof item === 'string') {
      for (const match of item.matchAll(/(?:https?:\/\/[^"' <>)]+)?\/(?:generated-images|avatars)\/[^"' <>)]+/g)) {
        urls.add(match[0]);
      }
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (typeof item === 'object') {
      Object.values(item as Record<string, unknown>).forEach(visit);
    }
  };
  visit(value);
  return Array.from(urls);
}

export async function deletePptxPreviewImport(userId: number | string, importId: string) {
  const safeImportId = String(importId || '').trim();
  if (!/^\d+-[0-9a-f-]{36}$/i.test(safeImportId)) return false;
  const target = path.resolve(GENERATED_IMAGES_ROOT, 'pptx-previews', String(userId), safeImportId);
  if (!isInside(path.join(GENERATED_IMAGES_ROOT, 'pptx-previews'), target)) return false;
  return deleteGeneratedPath(target);
}

export function sanitizeGeneratedProjectName(value: string): string {
  const safe = String(value || '')
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (safe || 'slide').slice(0, 80);
}

export async function deleteGeneratedProjectDirsByTitle(title: string) {
  const safeTitle = sanitizeGeneratedProjectName(title);
  if (!safeTitle) return;
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(GENERATED_PROJECTS_ROOT, { withFileTypes: true }) as any;
  } catch {
    return;
  }
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${safeTitle}_`))
    .map((entry) => deleteGeneratedPath(path.join(GENERATED_PROJECTS_ROOT, entry.name))));
}
