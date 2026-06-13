import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();
const ASSETS_ROOT = path.join(PROJECT_ROOT, 'server', 'vendor', 'ppt_assets');
const CHARTS_ROOT = path.join(ASSETS_ROOT, 'charts');
const ICONS_ROOT = path.join(ASSETS_ROOT, 'icons');

const MAX_CHART_CATALOG_ITEMS = Math.max(12, Number(process.env.PPT_CHART_CATALOG_ITEMS || 71));
const MAX_CHART_SVG_SNIPPET_CHARS = Math.max(800, Number(process.env.PPT_CHART_SVG_SNIPPET_CHARS || 2600));
const MAX_ICON_EXAMPLES = Math.max(20, Number(process.env.PPT_ICON_EXAMPLE_ITEMS || 80));

let chartCatalogCache: string | null = null;
let chartKeysCache: Set<string> | null = null;
const chartSvgCache = new Map<string, string>();
const iconGuideCache = new Map<string, string>();

export function pptAssetsRoot() {
  return ASSETS_ROOT;
}

export function pptIconsRoot() {
  return ICONS_ROOT;
}

export async function getChartCatalog() {
  if (chartCatalogCache !== null) return chartCatalogCache;
  const indexPath = path.join(CHARTS_ROOT, 'charts_index.json');
  const raw = await readFile(indexPath, 'utf-8').catch(() => '');
  if (!raw) {
    chartCatalogCache = '';
    return chartCatalogCache;
  }

  try {
    const data = JSON.parse(raw);
    const charts = data?.charts && typeof data.charts === 'object' ? data.charts : {};
    chartCatalogCache = Object.entries(charts)
      .slice(0, MAX_CHART_CATALOG_ITEMS)
      .map(([key, value]: [string, any]) => `- ${key}: ${String(value?.summary || value?.description || '').trim()}`)
      .join('\n');
    return chartCatalogCache;
  } catch {
    chartCatalogCache = '';
    return chartCatalogCache;
  }
}

async function getChartKeys() {
  if (chartKeysCache) return chartKeysCache;
  const indexPath = path.join(CHARTS_ROOT, 'charts_index.json');
  const raw = await readFile(indexPath, 'utf-8').catch(() => '');
  if (!raw) {
    chartKeysCache = new Set();
    return chartKeysCache;
  }

  try {
    const data = JSON.parse(raw);
    const charts = data?.charts && typeof data.charts === 'object' ? data.charts : {};
    chartKeysCache = new Set(Object.keys(charts));
    return chartKeysCache;
  } catch {
    chartKeysCache = new Set();
    return chartKeysCache;
  }
}

export async function resolveChartKey(chartHint?: string) {
  const raw = String(chartHint || '').trim();
  if (!raw) return '';
  const chartKeys = await getChartKeys();
  if (chartKeys.has(raw)) return raw;

  const leadingCandidate = raw.split(/[|:：,，\s]+/)[0]?.trim() || '';
  if (chartKeys.has(leadingCandidate)) return leadingCandidate;

  const candidates = Array.from(raw.matchAll(/[a-z0-9]+(?:[_-][a-z0-9]+)*/gi), (match) => match[0]);
  for (const candidate of candidates) {
    if (chartKeys.has(candidate)) return candidate;
  }
  return '';
}

export async function getChartSvg(chartKey?: string) {
  const key = await resolveChartKey(chartKey);
  if (!key) return '';
  if (chartSvgCache.has(key)) return chartSvgCache.get(key) || '';

  const svgPath = path.join(CHARTS_ROOT, `${key}.svg`);
  const svg = await readFile(svgPath, 'utf-8').catch(() => '');
  const snippet = svg ? stripGradientsFromSvg(svg).slice(0, MAX_CHART_SVG_SNIPPET_CHARS) : '';
  chartSvgCache.set(key, snippet);
  return snippet;
}

function stripGradientsFromSvg(svg: string) {
  return String(svg || '')
    .replace(/<linearGradient\b[\s\S]*?<\/linearGradient>/gi, '')
    .replace(/<radialGradient\b[\s\S]*?<\/radialGradient>/gi, '')
    .replace(/\s(?:fill|stroke)\s*=\s*(['"])url\(#(?:[^'")]*grad[^'")]*)\)\1/gi, ' fill="#64748B"')
    .replace(/url\(#(?:[^'")]*grad[^'")]*)\)/gi, '#64748B');
}

export async function getIconGuide(iconStyle?: string) {
  if (String(iconStyle || '').trim() === 'none') return '';
  const style = normalizeIconStyle(iconStyle);
  if (iconGuideCache.has(style)) return iconGuideCache.get(style) || '';

  const iconsDir = path.join(ICONS_ROOT, style);
  const examples = await readdir(iconsDir)
    .then((files) => files.filter((file) => file.endsWith('.svg')).slice(0, MAX_ICON_EXAMPLES).map((file) => file.replace(/\.svg$/i, '')))
    .catch(() => []);

  const guide = [
    `图标库：${style}`,
    '可用语法：使用 <use data-icon="库名/图标名" x="..." y="..." width="..." height="..." fill="#HEX"/>；导出 PPTX 时会自动展开为可编辑 SVG 图形。不要使用 <g data-icon="...">，它不是图标占位语法。',
    examples.length ? `常见可用图标：${examples.join(', ')}` : '',
    '同一份 PPT 尽量使用一个通用图标库；图标只服务视觉表达，不改变用户输入内容。',
  ].filter(Boolean).join('\n');
  iconGuideCache.set(style, guide);
  return guide;
}

function normalizeIconStyle(value?: string) {
  const candidate = String(value || '').trim();
  return ['chunk-filled', 'tabler-filled', 'tabler-outline', 'phosphor-duotone'].includes(candidate)
    ? candidate
    : 'tabler-outline';
}
