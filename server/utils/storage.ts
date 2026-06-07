import './env.js';
import path from 'node:path';

function resolveFromCwd(value: string) {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

export const storageRoot = resolveFromCwd(
  process.env.STORAGE_ROOT || process.env.NEXIOUS_STORAGE_ROOT || '.generated'
);

export const generatedImagesRoot = path.join(storageRoot, 'images');
export const generatedAvatarsRoot = path.join(storageRoot, 'avatars');
export const generatedProjectsRoot = path.join(storageRoot, 'nexious-ppt');
export const generatedSkillsRoot = path.join(storageRoot, 'skills');
export const generatedExportsRoot = path.join(storageRoot, 'exports');

export function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/+$/, '');
}
