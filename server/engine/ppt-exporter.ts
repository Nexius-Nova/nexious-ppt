import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DesignSpec, SpecLock } from './spec.js';
import { convertSvgPagesToPptx, inlineRemoteImages } from './svg-to-pptx.js';
import { exportNativeEditablePptx } from './native-svg-pptx.js';

export interface PptExportPage {
  pageNumber?: number;
  svg: string;
  speakerNotes?: string;
}

export interface PptExportResult {
  buffer: Buffer;
  fileName: string;
  projectPath: string;
  logs: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const GENERATED_ROOT = path.join(ROOT_DIR, '.generated', 'nexious-ppt');

export function renderSpecLockMarkdown(lock: SpecLock): string {
  const c = lock.colors;
  const t = lock.typography;
  const lines: string[] = [
    '# Execution Lock',
    '',
    '## canvas',
    `- viewBox: 0 0 ${lock.canvas.width} ${lock.canvas.height}`,
    `- format: ${lock.canvas.format === 'ppt43' ? 'PPT 4:3' : 'PPT 16:9'}`,
    '',
    '## colors',
    `- bg: ${c.background}`,
    `- background: ${c.background}`,
    `- surface: ${c.surface}`,
    `- primary: ${c.primary}`,
    `- accent: ${c.accent}`,
    `- secondary_accent: ${c.secondary}`,
    `- secondary: ${c.secondary}`,
    `- text: ${c.text}`,
    `- text_secondary: ${c.muted}`,
    `- muted: ${c.muted}`,
    `- border: ${c.border}`,
    '',
    '## typography',
    `- font_family: ${t.fontFamily}`,
    `- title_family: ${t.titleFamily}`,
    `- body_family: ${t.bodyFamily}`,
    `- emphasis_family: ${t.emphasisFamily}`,
    `- code_family: ${t.codeFamily}`,
    `- body: ${t.bodySize}`,
    `- title: ${t.titleSize}`,
    `- subtitle: ${t.subtitleSize}`,
    `- annotation: ${t.annotationSize}`,
    '',
    '## icons',
    `- library: ${lock.iconStyle === 'none' ? 'tabler-outline' : lock.iconStyle}`,
    '- stroke_width: 2',
    '- inventory: chart-bar, layout-dashboard, list-check, bulb, target, users, arrow-right, check, presentation',
    '',
    '## page_rhythm',
    ...Object.entries(lock.pageRhythm).map(([key, value]) => `- ${key}: ${value}`),
  ];

  if (Object.keys(lock.pageLayouts).length > 0) {
    lines.push('', '## page_layouts', ...Object.entries(lock.pageLayouts).map(([key, value]) => `- ${key}: ${value}`));
  }

  if (Object.keys(lock.pageCharts).length > 0) {
    lines.push('', '## page_charts', ...Object.entries(lock.pageCharts).map(([key, value]) => `- ${key}: ${value}`));
  }

  lines.push('', '## forbidden', ...lock.forbidden.map((item) => `- ${item}`), '');
  return lines.join('\n');
}

export function renderDesignSpecMarkdown(spec: DesignSpec, lock: SpecLock): string {
  const c = spec.visualTheme.colors;
  return `# ${spec.projectInfo.title} - Design Spec

## I. Project Information

| Item | Value |
| ---- | ----- |
| Project Name | ${spec.projectInfo.title} |
| Topic | ${spec.projectInfo.topic} |
| Canvas Format | ${spec.canvas.format} (${spec.canvas.width}x${spec.canvas.height}) |
| Page Count | ${spec.outline.length} |
| Design Style | ${spec.visualTheme.style} |
| Target Audience | ${spec.projectInfo.audience} |
| Use Case | ${spec.projectInfo.occasion} |

## II. Canvas Specification

| Property | Value |
| -------- | ----- |
| Format | ${spec.canvas.format} |
| Dimensions | ${spec.canvas.width}x${spec.canvas.height} |
| viewBox | \`0 0 ${spec.canvas.width} ${spec.canvas.height}\` |
| Margins | 48-64px |

## III. Visual Theme

- Style: ${spec.visualTheme.style}
- Mode: ${spec.visualTheme.mode}
- Note: No gradients. All SVG pages must use solid HEX colors from spec_lock.

| Role | HEX |
| ---- | --- |
| Background | \`${c.background}\` |
| Surface | \`${c.surface}\` |
| Primary | \`${c.primary}\` |
| Secondary | \`${c.secondary}\` |
| Accent | \`${c.accent}\` |
| Body text | \`${c.text}\` |
| Secondary text | \`${c.muted}\` |
| Border/divider | \`${c.border}\` |

## IV. Typography System

- Font family: ${spec.typography.fontFamily}
- Title: ${spec.typography.titleFamily}, ${spec.typography.titleSize}px
- Body: ${spec.typography.bodyFamily}, ${spec.typography.bodySize}px
- Subtitle: ${spec.typography.subtitleSize}px
- Annotation: ${spec.typography.annotationSize}px

## V. Layout Principles

- Pages follow the \`page_rhythm\` values from \`spec_lock.md\`.
- Anchor pages prioritize hierarchy and whitespace.
- Dense pages may use tables, columns, charts, and structured lists.
- Breathing pages focus on one statement and avoid multi-card grids.

## VI. Icon Usage Specification

- Library: ${lock.iconStyle}
- Inventory: chart-bar, layout-dashboard, list-check, bulb, target, users, arrow-right, check, presentation

## VII. Visualization Reference List

${spec.outline.filter((slide) => slide.chartHint).map((slide) => `- P${String(slide.pageNumber).padStart(2, '0')}: ${slide.chartHint}`).join('\n') || '- No chart pages.'}

## VIII. Image Resource List

${spec.outline.filter((slide) => slide.visualPrompt).map((slide) => `- P${String(slide.pageNumber).padStart(2, '0')}: ${slide.visualPrompt}`).join('\n') || '- No image resources.'}

## IX. Content Outline

${spec.outline.map((slide) => {
  const key = `P${String(slide.pageNumber).padStart(2, '0')}`;
  return `### ${key} ${slide.title}

- Layout: ${slide.layout}
- Rhythm: ${slide.rhythm}
- Bullets:
${slide.bullets.map((bullet) => `  - ${bullet}`).join('\n') || '  - None'}
- Speaker notes: ${slide.speakerNotes || 'None'}`;
}).join('\n\n')}
`;
}

export async function exportWithNexiousPpt(
  pages: PptExportPage[],
  spec: DesignSpec,
  lock: SpecLock,
): Promise<PptExportResult> {
  if (!pages.length) {
    throw new Error('没有可导出的 SVG 页面');
  }

  const logs: string[] = [];
  const preparedPages = await Promise.all(
    pages.map(async (page, index) => {
      const pageNumber = page.pageNumber || index + 1;
      const inlinedSvg = await inlineRemoteImages(page.svg);
      const svg = normalizeSvgForExport(inlinedSvg, spec, pageNumber);
      return {
        pageNumber,
        svg,
        speakerNotes: page.speakerNotes || spec.outline[index]?.speakerNotes || '',
      };
    })
  );

  const fileName = `${sanitizeName(spec.projectInfo.title || 'nexious-deck')}_${Date.now()}.pptx`;
  const projectPath = await prepareExportDirectory(spec, lock, preparedPages, logs);
  const exportPath = path.join(projectPath, 'exports', fileName);
  await mkdir(path.dirname(exportPath), { recursive: true });

  let buffer: Buffer;
  try {
    const nativeResult = await exportNativeEditablePptx(projectPath, exportPath, spec);
    buffer = nativeResult.buffer;
    await writeFile(exportPath, buffer);
    logs.push(...nativeResult.logs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logs.push(`可编辑导出未完成，已自动改用整页快照导出：${message}`);
    buffer = await convertSvgPagesToPptx(preparedPages, spec, lock);
    await writeFile(exportPath, buffer);
  }

  logs.push('内置导出器已完成 PPTX 生成。');
  return { buffer, fileName, projectPath, logs };
}

async function prepareExportDirectory(
  spec: DesignSpec,
  lock: SpecLock,
  pages: Array<{ pageNumber: number; svg: string; speakerNotes: string }>,
  logs: string[],
) {
  const safeTitle = sanitizeName(spec.projectInfo.title || 'nexious_deck');
  const projectPath = path.join(GENERATED_ROOT, `${safeTitle}_${Date.now()}`);

  await mkdir(projectPath, { recursive: true });
  await mkdir(path.join(projectPath, 'sources'), { recursive: true });
  await mkdir(path.join(projectPath, 'notes'), { recursive: true });
  await mkdir(path.join(projectPath, 'svg_output'), { recursive: true });

  await writeFile(path.join(projectPath, 'design_spec.md'), renderDesignSpecMarkdown(spec, lock), 'utf-8');
  await writeFile(path.join(projectPath, 'spec_lock.md'), renderSpecLockMarkdown(lock), 'utf-8');
  await writeFile(path.join(projectPath, 'sources', 'input.md'), renderSourceMarkdown(spec), 'utf-8');
  await writeFile(path.join(projectPath, 'notes', 'total.md'), renderTotalNotes(pages, spec), 'utf-8');

  const notesByStem: Record<string, string> = {};
  for (let i = 0; i < pages.length; i += 1) {
    const pageNumber = pages[i].pageNumber || i + 1;
    const fileName = `${String(pageNumber).padStart(2, '0')}_${sanitizeName(spec.outline[i]?.title || `slide_${pageNumber}`)}.svg`;
    notesByStem[path.parse(fileName).name] = pages[i].speakerNotes || spec.outline[i]?.speakerNotes || '';
    await writeFile(path.join(projectPath, 'svg_output', fileName), pages[i].svg, 'utf-8');
  }
  await writeFile(path.join(projectPath, 'notes', 'export-notes.json'), JSON.stringify(notesByStem, null, 2), 'utf-8');

  logs.push(`导出快照已保存：${projectPath}`);
  return projectPath;
}

export function normalizeSvgForExport(rawSvg: string, spec: DesignSpec, pageNumber: number): string {
  let svg = extractSvg(rawSvg);
  svg = repairCommonSvgBreakage(svg, spec);
  if (isWellFormedXml(svg)) {
    return svg;
  }

  return buildSafeFallbackSvg(spec, pageNumber);
}

function extractSvg(rawSvg: string): string {
  let svg = String(rawSvg || '').trim();
  if (svg.startsWith('```')) {
    svg = svg.replace(/^```(?:svg|xml)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  const start = svg.search(/<svg\b/i);
  const end = svg.toLowerCase().lastIndexOf('</svg>');
  if (start >= 0 && end >= start) {
    svg = svg.slice(start, end + 6);
  }
  return svg;
}

function repairCommonSvgBreakage(rawSvg: string, spec: DesignSpec): string {
  const safeBodyFamily = escapeAttrValue(spec.typography.bodyFamily);
  let svg = rawSvg;

  svg = flattenNestedSvgRoots(svg);
  svg = svg.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  svg = svg.replace(/\sclass\s*=\s*(['"])[\s\S]*?\1/gi, '');
  svg = svg.replace(/\sfont-family=""[^"]+",\s*"[^"]+",\s*([^"]+)"/g, ` font-family="${safeBodyFamily}"`);
  svg = svg.replace(/\sfont-family="'([^"]*?)"/g, (_match, inner) => ` font-family="${escapeAttrValue(String(inner).replace(/'/g, ''))}"`);
  svg = svg.replace(/\sfont-family='([^']*)'/g, (_match, inner) => ` font-family="${escapeAttrValue(String(inner).replace(/"/g, ''))}"`);
  svg = svg.replace(/\sfont-family="([^"]*)"/g, (_match, inner) => ` font-family="${escapeAttrValue(String(inner).replace(/"/g, ''))}"`);
  svg = svg.replace(/rgba\(\s*([^)]+)\)/gi, '#000000');
  svg = removeDuplicateAttributes(svg);
  svg = escapeTextNodes(svg);

  const svgOpen = svg.match(/<svg\b[^>]*>/i)?.[0] || '';
  if (!svgOpen) {
    return svg;
  }

  let patchedOpen = svgOpen;
  if (!/\sxmlns=/.test(patchedOpen)) {
    patchedOpen = patchedOpen.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/\sviewBox=/.test(patchedOpen)) {
    patchedOpen = patchedOpen.replace('<svg', `<svg viewBox="0 0 ${spec.canvas.width} ${spec.canvas.height}"`);
  }
  if (!/\swidth=/.test(patchedOpen)) {
    patchedOpen = patchedOpen.replace('<svg', `<svg width="${spec.canvas.width}"`);
  }
  if (!/\sheight=/.test(patchedOpen)) {
    patchedOpen = patchedOpen.replace('<svg', `<svg height="${spec.canvas.height}"`);
  }

  return svg.replace(svgOpen, patchedOpen);
}

function flattenNestedSvgRoots(rawSvg: string): string {
  const svg = rawSvg.trim();
  const rootOpen = svg.match(/<svg\b[^>]*>/i);
  const rootCloseIndex = svg.toLowerCase().lastIndexOf('</svg>');
  if (!rootOpen || rootCloseIndex < 0) return svg;

  const before = svg.slice(0, rootOpen.index! + rootOpen[0].length);
  let inner = svg.slice(rootOpen.index! + rootOpen[0].length, rootCloseIndex);
  const after = svg.slice(rootCloseIndex);
  let nestedIndex = 0;

  inner = inner.replace(/<svg\b([^>]*)>/gi, (_full, attrs: string) => {
    nestedIndex += 1;
    const x = readNumericAttr(attrs, 'x');
    const y = readNumericAttr(attrs, 'y');
    const transform = x || y ? ` transform="translate(${x || 0} ${y || 0})"` : '';
    const id = readStringAttr(attrs, 'id') || `nested-svg-${nestedIndex}`;
    return `<g id="${escapeAttrValue(id)}"${transform}>`;
  });
  inner = inner.replace(/<\/svg>/gi, '</g>');

  return `${before}${inner}${after}`;
}

function readNumericAttr(attrs: string, name: string): number {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(['"])(.*?)\\1`, 'i'));
  if (!match) return 0;
  const value = Number.parseFloat(match[2]);
  return Number.isFinite(value) ? value : 0;
}

function readStringAttr(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(['"])(.*?)\\1`, 'i'));
  return match?.[2] || '';
}

function removeDuplicateAttributes(svg: string): string {
  return svg.replace(/<([A-Za-z][\w:.-]*)([^<>]*?)>/g, (full, tagName: string, attrs: string) => {
    if (full.startsWith('</')) return full;
    const attrPattern = /([:\w.-]+)\s*=\s*(".*?"|'.*?')/g;
    const seen = new Set<string>();
    const kept: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = attrPattern.exec(attrs)) !== null) {
      const name = match[1];
      if (seen.has(name)) continue;
      seen.add(name);
      kept.push(`${name}=${match[2]}`);
    }
    const selfClosing = /\/\s*$/.test(attrs);
    return `<${tagName}${kept.length ? ` ${kept.join(' ')}` : ''}${selfClosing ? ' /' : ''}>`;
  });
}

function escapeTextNodes(svg: string): string {
  return svg.replace(/>([^<>]+)</g, (_match, text: string) => `>${escapeTextContent(text)}<`);
}

function escapeTextContent(text: string): string {
  return text
    .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#[0-9]+;|#x[0-9a-fA-F]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttrValue(value: string): string {
  return value
    .replace(/"/g, '')
    .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#[0-9]+;|#x[0-9a-fA-F]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function isWellFormedXml(svg: string): boolean {
  if (!svg.startsWith('<svg') || !svg.endsWith('</svg>')) return false;
  if (/<[A-Za-z][^>]*$/m.test(svg) || /<\/\s*$/m.test(svg)) return false;
  if (/font-family="[^"]*"[^=\s>]+/.test(svg)) return false;

  const normalized = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');

  const stack: string[] = [];
  const tagPattern = /<\/?([A-Za-z][\w:.-]*)([^<>]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(normalized)) !== null) {
    const full = match[0];
    const tagName = match[1];
    if (full.startsWith('</')) {
      if (stack.pop() !== tagName) return false;
      continue;
    }
    if (!full.endsWith('/>')) {
      stack.push(tagName);
    }
  }

  const stripped = normalized.replace(tagPattern, '');
  return stack.length === 0 && !/[<>]/.test(stripped);
}

function buildSafeFallbackSvg(spec: DesignSpec, pageNumber: number): string {
  const slide = spec.outline.find((item) => item.pageNumber === pageNumber) || spec.outline[pageNumber - 1];
  const colors = spec.visualTheme.colors;
  const typography = spec.typography;
  const title = escapeTextContent(slide?.title || `第 ${pageNumber} 页`);
  const bullets = (slide?.bullets || []).slice(0, 6);
  const bulletLines = bullets
    .map((bullet, index) => {
      const y = 190 + index * 52;
      return `<g id="bullet-${index + 1}"><circle cx="92" cy="${y - 7}" r="5" fill="${colors.accent}"/><text x="112" y="${y}" font-family="${escapeAttrValue(typography.bodyFamily)}" font-size="${typography.bodySize}" fill="${colors.text}">${escapeTextContent(bullet)}</text></g>`;
    })
    .join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.canvas.width}" height="${spec.canvas.height}" viewBox="0 0 ${spec.canvas.width} ${spec.canvas.height}">
  <rect width="${spec.canvas.width}" height="${spec.canvas.height}" fill="${colors.background}"/>
  <rect x="54" y="54" width="${spec.canvas.width - 108}" height="${spec.canvas.height - 108}" fill="${colors.surface}" stroke="${colors.border}" stroke-width="1"/>
  <g id="title-block">
    <text x="80" y="120" font-family="${escapeAttrValue(typography.titleFamily)}" font-size="${typography.titleSize}" font-weight="700" fill="${colors.text}">${title}</text>
    <rect x="80" y="145" width="96" height="4" fill="${colors.accent}"/>
  </g>
  <g id="content-list">
  ${bulletLines || `<text x="80" y="210" font-family="${escapeAttrValue(typography.bodyFamily)}" font-size="${typography.bodySize}" fill="${colors.muted}">本页 SVG 已自动修复为安全兜底页面。</text>`}
  </g>
</svg>`;
}

function renderSourceMarkdown(spec: DesignSpec): string {
  return `# ${spec.projectInfo.title}

${spec.projectInfo.topic}

${spec.outline.map((slide) => `## ${slide.title}\n${slide.bullets.map((bullet) => `- ${bullet}`).join('\n')}`).join('\n\n')}
`;
}

function renderTotalNotes(pages: Array<{ pageNumber: number; speakerNotes: string }>, spec: DesignSpec): string {
  return pages.map((page, index) => {
    const pageNumber = page.pageNumber || index + 1;
    const title = spec.outline[index]?.title || `Slide ${pageNumber}`;
    return `# ${String(pageNumber).padStart(2, '0')}_${sanitizeName(title)}

${page.speakerNotes || spec.outline[index]?.speakerNotes || ''}
`;
  }).join('\n---\n\n');
}

function sanitizeName(value: string): string {
  const safe = value
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (safe || 'slide').slice(0, 80);
}

export async function clearGeneratedProjects() {
  await rm(GENERATED_ROOT, { recursive: true, force: true });
}

export async function listGeneratedExports() {
  try {
    return await readdir(GENERATED_ROOT, { recursive: true });
  } catch {
    return [];
  }
}
