import { spawn } from 'node:child_process';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DesignSpec, SpecLock } from './spec.js';
import { inlineRemoteImages } from './svg-to-pptx.js';
import { exportNativeEditablePptx, type NativeSvgPptxAnimationOptions } from './native-svg-pptx.js';
import { generatedProjectsRoot } from '../utils/storage.js';
import { sanitizeGeneratedSvg } from './executor.js';
import {
  finalizeSvgProject,
  writeAnimationConfig,
  writeFormulaManifest,
} from '../services/pptMasterAdapter.js';
import { renderLatexManifest } from '../services/pptTools.js';

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

export interface PptExportOptions {
  animation?: NativeSvgPptxAnimationOptions;
}

const GENERATED_ROOT = generatedProjectsRoot;
const PROJECT_ROOT = process.cwd();
const SVG_QUALITY_CHECKER = path.join(PROJECT_ROOT, 'server', 'vendor', 'svg_quality', 'svg_quality_checker.py');
const SVG_QUALITY_ROOT = path.dirname(SVG_QUALITY_CHECKER);
const PYTHON_BIN = process.env.PYTHON || process.env.PYTHON_BIN || 'python';
const SVG_QUALITY_TIMEOUT_MS = Number(process.env.SVG_QUALITY_TIMEOUT_MS || 60_000);

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
  options: PptExportOptions = {},
): Promise<PptExportResult> {
  if (!pages.length) {
    throw new Error('没有可导出的 SVG 页面');
  }

  assertCompleteExportPages(pages, spec);

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
  const formulaManifestPath = await writeFormulaManifest(projectPath, extractFormulaCandidatesFromExport(preparedPages, spec));
  if (formulaManifestPath) {
    logs.push(`公式清单已写入：${formulaManifestPath}`);
    await renderLatexManifest(projectPath).then((result) => {
      const output = clipToolOutput([result.stdout, result.stderr].filter(Boolean).join('\n'), 2000);
      if (result.ok) {
        logs.push('公式图片已渲染到导出快照 images 目录。');
      } else {
        logs.push(`公式图片渲染未完成，已保留公式清单并继续导出：${output || `exitCode=${result.exitCode}`}`);
      }
    }).catch((error) => {
      logs.push(`公式图片渲染跳过：${error instanceof Error ? error.message : String(error)}`);
    });
  }
  await writeAnimationConfig(projectPath, preparedPages, spec, options.animation).then((configPath) => {
    if (options.animation?.enabled) logs.push(`动画配置已写入：${configPath}`);
  });
  await runPptMasterSvgQualityCheck(projectPath, spec.canvas.format, logs);
  await finalizeSvgProject(projectPath).then((result) => {
    logs.push(`SVG 后处理完成：exitCode=${result.exitCode}`);
    const output = clipToolOutput([result.stdout, result.stderr].filter(Boolean).join('\n'), 2000);
    if (output) logs.push(output);
  });
  await runPptMasterSvgQualityCheck(path.join(projectPath, 'svg_final'), spec.canvas.format, logs);
  const exportPath = path.join(projectPath, 'exports', fileName);
  await mkdir(path.dirname(exportPath), { recursive: true });

  let buffer: Buffer;
  try {
    const nativeResult = await exportNativeEditablePptx(projectPath, exportPath, spec, options.animation);
    buffer = nativeResult.buffer;
    await writeFile(exportPath, buffer);
    logs.push(...nativeResult.logs);
    if (options.animation?.enabled) {
      logs.push('元素入场动画已在 PPTX 导出阶段添加，生成内容与 SVG 页面保持不变。');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logs.push(`可编辑 PPTX 导出失败：${message}`);
    await rm(exportPath, { force: true });
    throw new Error(`可编辑 PPTX 导出失败，已阻止生成整页图片版 PPT：${message}`);
  }

  logs.push('内置导出器已完成 PPTX 生成。');
  return { buffer, fileName, projectPath, logs };
}

function isFallbackSvgPage(svg?: string) {
  const value = String(svg || '');
  return value.includes('本页待重试') || value.includes('待重试') || value.includes('page failed');
}

function assertCompleteExportPages(pages: PptExportPage[], spec: DesignSpec) {
  const expected = Array.isArray(spec?.outline) ? spec.outline.length : 0;
  if (expected <= 0) {
    throw new Error('缺少完整大纲，无法导出 PPTX');
  }
  const pagesByNumber = new Map<number, PptExportPage>();
  pages.forEach((page, index) => {
    const pageNumber = Number(page.pageNumber || index + 1);
    if (Number.isInteger(pageNumber) && pageNumber > 0) pagesByNumber.set(pageNumber, page);
  });
  const missing: number[] = [];
  for (let pageNumber = 1; pageNumber <= expected; pageNumber += 1) {
    const page = pagesByNumber.get(pageNumber);
    if (!page?.svg || isFallbackSvgPage(page.svg)) missing.push(pageNumber);
  }
  if (missing.length) {
    throw new Error(`页面尚未全部生成完成，缺少或待重试页面：${missing.slice(0, 12).join('、')}`);
  }
}

async function runPptMasterSvgQualityCheck(projectPath: string, format: string, logs: string[]) {
  const result = await runPythonTool(
    [SVG_QUALITY_CHECKER, projectPath, '--format', format],
    SVG_QUALITY_ROOT,
    SVG_QUALITY_TIMEOUT_MS,
    {
      PYTHONPATH: [
        SVG_QUALITY_ROOT,
        path.join(PROJECT_ROOT, 'server', 'vendor'),
        process.env.PYTHONPATH || '',
      ].filter(Boolean).join(path.delimiter),
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    }
  );
  const output = clipToolOutput([result.stdout, result.stderr].filter(Boolean).join('\n'), 5000);
  logs.push(`PPT Master SVG 质量检查完成：exitCode=${result.exitCode}`);
  if (output) logs.push(output);
  if (result.exitCode !== 0) {
    throw new Error(`PPT Master SVG 质量检查未通过：${output || '请检查 SVG 页面规范'}`);
  }
}

async function runPythonTool(
  args: string[],
  cwd: string,
  timeoutMs: number,
  env: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON_BIN, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({
        exitCode: 124,
        stdout: Buffer.concat(stdout).toString('utf-8'),
        stderr: `SVG 质量检查超时\n${Buffer.concat(stderr).toString('utf-8')}`,
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout: '', stderr: error.message });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf-8'),
        stderr: Buffer.concat(stderr).toString('utf-8'),
      });
    });
  });
}

function clipToolOutput(value: string, maxLength: number) {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
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
  let svg = sanitizeGeneratedSvg(rawSvg);

  svg = flattenNestedSvgRoots(svg);
  svg = svg.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  svg = svg.replace(/\sclass\s*=\s*(['"])[\s\S]*?\1/gi, '');
  svg = svg.replace(/\sfont-family=""[^"]+",\s*"[^"]+",\s*([^"]+)"/g, ` font-family="${safeBodyFamily}"`);
  svg = svg.replace(/\sfont-family="'([^"]*?)"/g, (_match, inner) => ` font-family="${escapeAttrValue(String(inner).replace(/'/g, ''))}"`);
  svg = svg.replace(/\sfont-family='([^']*)'/g, (_match, inner) => ` font-family="${escapeAttrValue(String(inner).replace(/"/g, ''))}"`);
  svg = svg.replace(/\sfont-family="([^"]*)"/g, (_match, inner) => ` font-family="${escapeAttrValue(String(inner).replace(/"/g, ''))}"`);
  svg = svg.replace(/rgba\(\s*([^)]+)\)/gi, '#000000');
  svg = removeUnsupportedClipPathTargets(svg);
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

function removeUnsupportedClipPathTargets(svg: string): string {
  return svg.replace(/<([A-Za-z][\w:.-]*)([^<>]*\bclip-path\s*=\s*(["'])[^"']*\3[^<>]*)>/gi, (full, tagName: string, attrs: string) => {
    const normalizedTag = tagName.includes(':') ? tagName.split(':').pop()?.toLowerCase() : tagName.toLowerCase();
    const isPptxCropWrapper = normalizedTag === 'svg' && /\bdata-pptx-crop\s*=\s*(["'])1\1/i.test(attrs);
    if (normalizedTag === 'image' || isPptxCropWrapper) return full;
    const cleanedAttrs = attrs.replace(/\s+clip-path\s*=\s*(["'])[^"']*\1/gi, '');
    return `<${tagName}${cleanedAttrs}>`;
  });
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

function extractFormulaCandidatesFromExport(
  pages: Array<{ svg: string; speakerNotes: string }>,
  spec: DesignSpec
) {
  const text = [
    spec.projectInfo.title,
    spec.projectInfo.topic,
    ...spec.outline.flatMap((slide) => [
      slide.title,
      ...(slide.bullets || []),
      slide.speakerNotes,
      slide.visualPrompt,
      slide.chartHint || '',
    ]),
    ...pages.flatMap((page) => [page.speakerNotes, page.svg.replace(/<[^>]+>/g, ' ')]),
  ].join('\n');
  const formulas: string[] = [];
  const pattern = /(?:\$\$([\s\S]{2,300}?)\$\$|\$([^\n$]{2,180}?)\$|\\\(([\s\S]{2,180}?)\\\)|\\\[([\s\S]{2,300}?)\\\])/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const formula = (match[1] || match[2] || match[3] || match[4] || '').trim();
    if (formula && /[=\\^_{}]/.test(formula)) formulas.push(formula);
  }
  return Array.from(new Set(formulas)).slice(0, 80);
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
