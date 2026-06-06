import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';

type RelationshipMap = Map<string, { target: string; type: string }>;
type ThemeColors = Record<string, string>;

export interface PptxSvgSlide {
  pageNumber: number;
  title: string;
  bullets: string[];
  description: string;
  layout: string;
  svg: string;
  visualSummary?: string;
}

export interface PptxSvgConversionResult {
  slideCount: number;
  width: number;
  height: number;
  slides: PptxSvgSlide[];
  allText: string;
}

export interface PptxSvgConversionOptions {
  mediaOutputDir?: string;
  mediaUrlPrefix?: string;
}

interface Transform {
  x: number;
  y: number;
  cx: number;
  cy: number;
  rot: number;
}

type DrawingKind = 'sp' | 'pic' | 'cxnSp' | 'grpSp' | 'graphicFrame';

interface DrawingBlock {
  kind: DrawingKind;
  xml: string;
}

interface PictureRenderResult {
  element: string;
  visualHint: string;
}

interface MediaAssetWriter {
  write(mediaPath: string, data: Buffer): Promise<string>;
}

const EMU_PER_INCH = 914400;
const DEFAULT_WIDTH_EMU = 12192000;
const DEFAULT_HEIGHT_EMU = 6858000;
const OUTPUT_WIDTH = 1120;

function stripDataUrl(value: string) {
  const commaIndex = value.indexOf(',');
  return value.startsWith('data:') && commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
}

function escapeXml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function clampText(value: unknown, maxLength: number) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(1, maxLength - 1))}...` : text;
}

function safeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'asset';
}

function normalizeUrlPath(value: string) {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function mimeFromExtension(extension: string) {
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'svg') return 'image/svg+xml';
  return 'image/png';
}

function createMediaAssetWriter(options: PptxSvgConversionOptions): MediaAssetWriter | null {
  if (!options.mediaOutputDir || !options.mediaUrlPrefix) return null;

  const mediaOutputDir = options.mediaOutputDir;
  const mediaUrlPrefix = normalizeUrlPath(options.mediaUrlPrefix).replace(/\/$/, '');
  const written = new Map<string, string>();

  return {
    async write(mediaPath: string, data: Buffer) {
      const cached = written.get(mediaPath);
      if (cached) return cached;

      const extension = safeFilePart(mediaPath.split('.').pop()?.toLowerCase() || 'png');
      const basename = safeFilePart(path.posix.basename(mediaPath, path.posix.extname(mediaPath)));
      const hash = crypto.createHash('sha1').update(mediaPath).update(data).digest('hex').slice(0, 16);
      const filename = `${basename}-${hash}.${extension}`;
      await fs.mkdir(mediaOutputDir, { recursive: true });
      await fs.writeFile(path.join(mediaOutputDir, filename), data);
      const url = `${mediaUrlPrefix}/${filename}`;
      written.set(mediaPath, url);
      return url;
    },
  };
}

function attr(source: string, name: string) {
  const match = source.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function numAttr(source: string, name: string, fallback = 0) {
  const value = Number(attr(source, name));
  return Number.isFinite(value) ? value : fallback;
}

function extractTag(source: string, tagName: string) {
  const match = source.match(new RegExp(`<${tagName}\\b[\\s\\S]*?</${tagName}>`, 'i'));
  return match?.[0] || '';
}

function extractSelfOrPairedTag(source: string, tagName: string) {
  const paired = extractTag(source, tagName);
  if (paired) return paired;
  const single = source.match(new RegExp(`<${tagName}\\b[^>]*/>`, 'i'));
  return single?.[0] || '';
}

function extractTransform(block: string): Transform {
  const xfrm = extractTag(block, 'a:xfrm') || extractSelfOrPairedTag(block, 'a:xfrm');
  const off = extractSelfOrPairedTag(xfrm, 'a:off');
  const ext = extractSelfOrPairedTag(xfrm, 'a:ext');
  return {
    x: numAttr(off, 'x'),
    y: numAttr(off, 'y'),
    cx: numAttr(ext, 'cx'),
    cy: numAttr(ext, 'cy'),
    rot: numAttr(xfrm, 'rot') / 60000,
  };
}

function extractGroupTransform(block: string, scaleX: number, scaleY: number) {
  const xfrm = extractTag(block, 'a:xfrm') || extractSelfOrPairedTag(block, 'a:xfrm');
  const off = extractSelfOrPairedTag(xfrm, 'a:off');
  const ext = extractSelfOrPairedTag(xfrm, 'a:ext');
  const chOff = extractSelfOrPairedTag(xfrm, 'a:chOff');
  const chExt = extractSelfOrPairedTag(xfrm, 'a:chExt');
  const ox = numAttr(off, 'x');
  const oy = numAttr(off, 'y');
  const ocx = numAttr(ext, 'cx', 1);
  const ocy = numAttr(ext, 'cy', 1);
  const cx = numAttr(chOff, 'x');
  const cy = numAttr(chOff, 'y');
  const ccx = numAttr(chExt, 'cx', ocx || 1);
  const ccy = numAttr(chExt, 'cy', ocy || 1);
  const sx = ccx ? ocx / ccx : 1;
  const sy = ccy ? ocy / ccy : 1;
  const tx = emuToPx(ox - cx * sx, scaleX);
  const ty = emuToPx(oy - cy * sy, scaleY);
  return { tx, ty, sx, sy };
}

function readSlideSize(presentationXml: string) {
  const sldSz = presentationXml.match(/<p:sldSz\b[^>]*>/i)?.[0] || '';
  return {
    cx: numAttr(sldSz, 'cx', DEFAULT_WIDTH_EMU),
    cy: numAttr(sldSz, 'cy', DEFAULT_HEIGHT_EMU),
  };
}

function emuToPx(value: number, scale: number) {
  return Math.round(value * scale * 100) / 100;
}

function ptToPx(pt: number) {
  return Math.round((pt * 96 / 72) * 100) / 100;
}

function splitTextIntoLines(text: string, maxChars: number) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const safeMax = Math.max(4, maxChars);
  if (/[\u4e00-\u9fff]/.test(normalized)) {
    const chars = Array.from(normalized);
    const lines: string[] = [];
    for (let index = 0; index < chars.length; index += safeMax) {
      lines.push(chars.slice(index, index + safeMax).join(''));
    }
    return lines;
  }

  const words = normalized.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if ((current.length + word.length + 1) <= safeMax) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.flatMap((line) => {
    if (line.length <= safeMax) return [line];
    const chunks: string[] = [];
    for (let index = 0; index < line.length; index += safeMax) {
      chunks.push(line.slice(index, index + safeMax));
    }
    return chunks;
  });
}

function parseRelationships(xml: string): RelationshipMap {
  const map: RelationshipMap = new Map();
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    const id = attr(tag, 'Id');
    const target = attr(tag, 'Target');
    const type = attr(tag, 'Type');
    if (id && target) map.set(id, { target, type });
  }
  return map;
}

function normalizeTarget(baseDir: string, target: string) {
  if (/^[a-z]+:/i.test(target)) return target;
  const normalized = path.posix.normalize(path.posix.join(baseDir, target)).replace(/^\/+/, '');
  return normalized.startsWith('ppt/') ? normalized : `ppt/${normalized}`;
}

function slidePathsFromPresentation(zip: JSZip, presentationXml: string, rels: RelationshipMap) {
  const paths: string[] = [];
  for (const match of presentationXml.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)) {
    const rel = rels.get(match[1]);
    if (rel) paths.push(normalizeTarget('ppt', rel.target));
  }
  if (paths.length) return paths;
  return Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0) - Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0));
}

function parseThemeColors(themeXml: string): ThemeColors {
  const colorScheme = extractTag(themeXml, 'a:clrScheme');
  const colors: ThemeColors = {};
  for (const key of ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']) {
    const block = extractTag(colorScheme, `a:${key}`);
    const srgb = block.match(/<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/i)?.[1];
    const sys = block.match(/<a:sysClr\b[^>]*\blastClr="([0-9A-Fa-f]{6})"/i)?.[1];
    if (srgb || sys) colors[key] = `#${srgb || sys}`;
  }
  colors.bg1 ||= colors.lt1 || '#FFFFFF';
  colors.tx1 ||= colors.dk1 || '#111827';
  colors.bg2 ||= colors.lt2 || '#F8FAFC';
  colors.tx2 ||= colors.dk2 || '#334155';
  return colors;
}

async function readRels(zip: JSZip, sourcePath: string) {
  const relsPath = `${path.posix.dirname(sourcePath)}/_rels/${path.posix.basename(sourcePath)}.rels`;
  const xml = await zip.file(relsPath)?.async('string').catch(() => '') || '';
  return parseRelationships(xml);
}

async function readRelatedXml(zip: JSZip, sourcePath: string, rels: RelationshipMap, relationPattern: RegExp) {
  for (const rel of rels.values()) {
    if (!relationPattern.test(rel.type)) continue;
    const targetPath = normalizeTarget(path.posix.dirname(sourcePath), rel.target);
    return {
      path: targetPath,
      xml: await zip.file(targetPath)?.async('string').catch(() => '') || '',
    };
  }
  return { path: '', xml: '' };
}

async function loadSlideInheritance(zip: JSZip, slidePath: string) {
  const slideRels = await readRels(zip, slidePath);
  const layout = await readRelatedXml(zip, slidePath, slideRels, /slideLayout$/);
  const layoutRels = layout.path ? await readRels(zip, layout.path) : new Map();
  const master = layout.path ? await readRelatedXml(zip, layout.path, layoutRels, /slideMaster$/) : { path: '', xml: '' };
  const masterRels = master.path ? await readRels(zip, master.path) : new Map();
  const theme = master.path ? await readRelatedXml(zip, master.path, masterRels, /theme$/) : { path: '', xml: '' };
  return {
    slideRels,
    layout,
    layoutRels,
    master,
    masterRels,
    themeColors: theme.xml ? parseThemeColors(theme.xml) : {},
  };
}

function colorFromFill(block: string, fallback = '#FFFFFF', theme: ThemeColors = {}) {
  const solidFill = extractTag(block, 'a:solidFill');
  const srgb = solidFill.match(/<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/i)?.[1];
  if (srgb) return `#${srgb}`;

  const scheme = solidFill.match(/<a:schemeClr\b[^>]*\bval="([^"]+)"/i)?.[1];
  const schemeMap: Record<string, string> = {
    accent1: '#4472C4',
    accent2: '#ED7D31',
    accent3: '#A5A5A5',
    accent4: '#FFC000',
    accent5: '#5B9BD5',
    accent6: '#70AD47',
    bg1: '#FFFFFF',
    tx1: '#111827',
    bg2: '#F8FAFC',
    tx2: '#334155',
    dk1: '#111827',
    lt1: '#FFFFFF',
  };
  return scheme ? theme[scheme] || schemeMap[scheme] || fallback : fallback;
}

function lineColor(block: string, fallback = '#334155', theme: ThemeColors = {}) {
  const ln = extractTag(block, 'a:ln');
  return ln ? colorFromFill(ln, fallback, theme) : fallback;
}

function isNoFill(block: string) {
  return /<a:noFill\s*\/?>/i.test(block);
}

function textColor(runBlock: string, shapeBlock: string, theme: ThemeColors = {}) {
  const runColor = colorFromFill(runBlock, '', theme);
  if (runColor) return runColor;
  const bodyPrColor = colorFromFill(shapeBlock, '', theme);
  return bodyPrColor || theme.tx1 || '#172026';
}

function shapePlaceholderKey(shapeBlock: string) {
  const ph = shapeBlock.match(/<p:ph\b[^>]*\/?>/i)?.[0] || '';
  if (!ph) return '';
  return [attr(ph, 'type') || 'body', attr(ph, 'idx') || ''].join(':');
}

function collectPlaceholderTransforms(xml: string) {
  const map = new Map<string, Transform>();
  for (const match of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/gi)) {
    const block = match[0];
    const key = shapePlaceholderKey(block);
    if (key) map.set(key, extractTransform(block));
  }
  return map;
}

function applyInheritedTransform(shapeBlock: string, inherited?: Transform) {
  const current = extractTransform(shapeBlock);
  if (!inherited || (current.cx > 0 && current.cy > 0)) return shapeBlock;

  const xfrm = `<a:xfrm><a:off x="${inherited.x}" y="${inherited.y}"/><a:ext cx="${inherited.cx}" cy="${inherited.cy}"/></a:xfrm>`;
  if (/<p:spPr\b[^>]*>/i.test(shapeBlock)) {
    return shapeBlock.replace(/<p:spPr\b[^>]*>/i, (tag) => `${tag}${xfrm}`);
  }
  return shapeBlock;
}

function extractTextRuns(shapeBlock: string, theme: ThemeColors = {}) {
  const paragraphs = Array.from(shapeBlock.matchAll(/<a:p\b[\s\S]*?<\/a:p>/gi)).map((match) => match[0]);
  return paragraphs.map((paragraph) => {
    const pPr = paragraph.match(/<a:pPr\b[^>]*>/i)?.[0] || '';
    const defaultSize = Math.max(8, numAttr(pPr, 'fontSz', 1800) / 100);
    const runs = Array.from(paragraph.matchAll(/<a:r\b[\s\S]*?<\/a:r>/gi)).map((runMatch) => {
      const run = runMatch[0];
      const text = Array.from(run.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gi)).map((textMatch) => decodeXml(textMatch[1])).join('');
      const rPr = run.match(/<a:rPr\b[^>]*>/i)?.[0] || '';
      const size = Math.max(8, numAttr(rPr, 'sz', defaultSize * 100) / 100);
      return {
        text,
        size,
        bold: /\sb="1"/i.test(rPr),
        italic: /\si="1"/i.test(rPr),
        color: textColor(run, shapeBlock, theme),
      };
    }).filter((run) => run.text.trim());
    const fallbackText = Array.from(paragraph.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gi)).map((textMatch) => decodeXml(textMatch[1])).join('');
    return runs.length ? runs : fallbackText.trim() ? [{ text: fallbackText, size: defaultSize, bold: false, italic: false, color: theme.tx1 || '#172026' }] : [];
  }).filter((line) => line.length);
}

function allTextsFromShape(shapeBlock: string) {
  return Array.from(shapeBlock.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gi))
    .map((match) => decodeXml(match[1]).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function extractDrawingBlocks(xml: string): DrawingBlock[] {
  const spTree = extractTag(xml, 'p:spTree');
  const trimmedXml = xml.trim();
  const source = spTree || (/^<p:grpSp\b/i.test(trimmedXml)
    ? trimmedXml.replace(/^<p:grpSp\b[^>]*>/i, '').replace(/<\/p:grpSp>\s*$/i, '')
    : xml);
  const blocks: DrawingBlock[] = [];
  const openTagRegex = /<p:(sp|pic|cxnSp|grpSp|graphicFrame)\b/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = openTagRegex.exec(source)) !== null) {
    const start = match.index;
    if (start < cursor) continue;

    const kind = match[1] as DrawingKind;
    const openEnd = source.indexOf('>', start);
    if (openEnd < 0) break;
    if (source.slice(start, openEnd + 1).endsWith('/>')) {
      blocks.push({ kind, xml: source.slice(start, openEnd + 1) });
      cursor = openEnd + 1;
      continue;
    }

    const closeTag = `</p:${kind}>`;
    let depth = 1;
    let searchFrom = openEnd + 1;
    let end = -1;
    const nestedOpenRegex = new RegExp(`<p:${kind}\\b`, 'gi');

    while (depth > 0) {
      nestedOpenRegex.lastIndex = searchFrom;
      const nestedOpen = nestedOpenRegex.exec(source);
      const closeIndex = source.indexOf(closeTag, searchFrom);
      if (closeIndex < 0) break;
      if (nestedOpen && nestedOpen.index < closeIndex) {
        depth += 1;
        searchFrom = nestedOpen.index + nestedOpen[0].length;
        continue;
      }
      depth -= 1;
      end = closeIndex + closeTag.length;
      searchFrom = end;
    }

    if (end < 0) continue;
    blocks.push({ kind, xml: source.slice(start, end) });
    cursor = end;
    openTagRegex.lastIndex = end;
  }

  return blocks;
}

function renderTextShape(shapeBlock: string, scaleX: number, scaleY: number, theme: ThemeColors = {}) {
  const transform = extractTransform(shapeBlock);
  const x = emuToPx(transform.x, scaleX);
  const y = emuToPx(transform.y, scaleY);
  const width = Math.max(1, emuToPx(transform.cx, scaleX));
  const height = Math.max(1, emuToPx(transform.cy, scaleY));
  const lines = extractTextRuns(shapeBlock, theme);
  if (!lines.length) return '';

  const bodyPr = shapeBlock.match(/<a:bodyPr\b[^>]*>/i)?.[0] || '';
  const anchor = attr(bodyPr, 'anchor');
  const firstSize = lines[0]?.[0]?.size || 18;
  const textAnchor = /<a:pPr\b[^>]*\balgn="ctr"/i.test(shapeBlock) ? 'middle' : 'start';
  const textX = textAnchor === 'middle' ? x + width / 2 : x + 6;
  const renderedLines = lines.flatMap((line) => {
    const run = line[0];
    const size = ptToPx(run.size || firstSize);
    const maxChars = Math.max(6, Math.floor((width - 12) / Math.max(size * 0.52, 8)));
    return splitTextIntoLines(line.map((item) => item.text).join(''), maxChars).map((text) => ({
      text,
      size,
      bold: run.bold,
      italic: run.italic,
      color: run.color,
    }));
  });
  if (!renderedLines.length) return '';

  const avgLineHeight = Math.max(12, ptToPx(firstSize) * 1.22);
  const maxLines = Math.max(1, Math.floor(height / avgLineHeight));
  const visibleLines = renderedLines.slice(0, maxLines);
  if (renderedLines.length > maxLines) {
    const last = visibleLines[visibleLines.length - 1];
    last.text = clampText(last.text, Math.max(4, last.text.length - 1));
  }
  const totalTextHeight = visibleLines.reduce((sum, line) => sum + line.size * 1.22, 0);
  const startY = anchor === 'ctr'
    ? y + Math.max(visibleLines[0].size, (height - totalTextHeight) / 2 + visibleLines[0].size)
    : y + Math.max(visibleLines[0].size, ptToPx(firstSize));

  let currentY = startY;
  const tspans = visibleLines.map((line) => {
    const element = `<text x="${textX}" y="${currentY}" font-size="${line.size}" font-weight="${line.bold ? 700 : 500}" font-style="${line.italic ? 'italic' : 'normal'}" fill="${line.color}" text-anchor="${textAnchor}">${escapeXml(line.text)}</text>`;
    currentY += line.size * 1.22;
    return element;
  }).join('');

  return `<g>${tspans}</g>`;
}

function renderGeometry(shapeBlock: string, scaleX: number, scaleY: number, theme: ThemeColors = {}) {
  if (/<p:txBody\b/i.test(shapeBlock) && !/<a:solidFill\b/i.test(shapeBlock) && !/<a:ln\b/i.test(shapeBlock)) return '';
  const transform = extractTransform(shapeBlock);
  const x = emuToPx(transform.x, scaleX);
  const y = emuToPx(transform.y, scaleY);
  const width = Math.max(1, emuToPx(transform.cx, scaleX));
  const height = Math.max(1, emuToPx(transform.cy, scaleY));
  const geometry = attr(shapeBlock.match(/<a:prstGeom\b[^>]*>/i)?.[0] || '', 'prst') || 'rect';
  const fill = isNoFill(shapeBlock) ? 'none' : colorFromFill(shapeBlock, 'none', theme);
  const stroke = lineColor(shapeBlock, 'none', theme);
  const strokeWidth = /<a:ln\b/i.test(shapeBlock) ? Math.max(1, numAttr(extractTag(shapeBlock, 'a:ln'), 'w') / EMU_PER_INCH * 96) : 0;

  if (fill === 'none' && stroke === 'none' && !strokeWidth) return '';
  if (/<p:cxnSp\b/i.test(shapeBlock)) {
    return `<line x1="${x}" y1="${y}" x2="${x + width}" y2="${y + height}" stroke="${stroke || fill || '#334155'}" stroke-width="${Math.max(1, strokeWidth)}" />`;
  }
  if (geometry === 'ellipse') {
    return `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
  }
  if (geometry === 'triangle') {
    return `<path d="M ${x + width / 2} ${y} L ${x + width} ${y + height} L ${x} ${y + height} Z" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
  }
  if (geometry === 'line') {
    return `<line x1="${x}" y1="${y}" x2="${x + width}" y2="${y + height}" stroke="${stroke || fill || '#334155'}" stroke-width="${Math.max(1, strokeWidth)}" />`;
  }
  const rx = geometry === 'roundRect' ? Math.min(width, height) * 0.08 : 0;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
}

function picturePreserveAspectRatio(picBlock: string, transform: Transform, slideSizePx: { width: number; height: number }) {
  const isFullSlide = Math.abs(transform.x) < 1000 &&
    Math.abs(transform.y) < 1000 &&
    Math.abs(transform.cx - slideSizePx.width) < slideSizePx.width * 0.02 &&
    Math.abs(transform.cy - slideSizePx.height) < slideSizePx.height * 0.02;
  if (/<a:stretch\b[\s\S]*?<a:fillRect\s*\/?>/i.test(picBlock) || isFullSlide) return 'none';
  if (/<a:srcRect\b/i.test(picBlock)) return 'xMidYMid slice';
  return 'xMidYMid meet';
}

async function renderPicture(
  zip: JSZip,
  slidePath: string,
  picBlock: string,
  rels: RelationshipMap,
  scaleX: number,
  scaleY: number,
  writer: MediaAssetWriter | null,
  slideSizePx: { width: number; height: number },
) {
  const embedId = attr(picBlock.match(/<a:blip\b[^>]*>/i)?.[0] || '', 'r:embed');
  const rel = embedId ? rels.get(embedId) : null;
  if (!rel) return '';

  const slideDir = path.posix.dirname(slidePath);
  const mediaPath = normalizeTarget(slideDir, rel.target);
  const file = zip.file(mediaPath);
  if (!file) return '';

  const transform = extractTransform(picBlock);
  const x = emuToPx(transform.x, scaleX);
  const y = emuToPx(transform.y, scaleY);
  const width = Math.max(1, emuToPx(transform.cx, scaleX));
  const height = Math.max(1, emuToPx(transform.cy, scaleY));
  const extension = mediaPath.split('.').pop()?.toLowerCase() || 'png';
  const buffer = await file.async('nodebuffer');
  const href = writer
    ? await writer.write(mediaPath, buffer)
    : `data:${mimeFromExtension(extension)};base64,${buffer.toString('base64')}`;
  const preserveAspectRatio = picturePreserveAspectRatio(picBlock, transform, {
    width: slideSizePx.width / scaleX,
    height: slideSizePx.height / scaleY,
  });

  return `<image x="${x}" y="${y}" width="${width}" height="${height}" href="${escapeXml(href)}" xlink:href="${escapeXml(href)}" preserveAspectRatio="${preserveAspectRatio}" />`;
}

function renderGraphicFrame(block: string, scaleX: number, scaleY: number, theme: ThemeColors = {}) {
  const transform = extractTransform(block);
  const x = emuToPx(transform.x, scaleX);
  const y = emuToPx(transform.y, scaleY);
  const width = Math.max(1, emuToPx(transform.cx, scaleX));
  const height = Math.max(1, emuToPx(transform.cy, scaleY));

  if (/<c:chart\b/i.test(block)) {
    return {
      element: `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1.5" /><path d="M ${x + 42} ${y + height - 48} L ${x + width - 42} ${y + 42}" stroke="${theme.accent1 || '#4472C4'}" stroke-width="6" fill="none" stroke-linecap="round" /><rect x="${x + width * 0.18}" y="${y + height * 0.52}" width="${width * 0.08}" height="${height * 0.28}" fill="${theme.accent1 || '#4472C4'}" /><rect x="${x + width * 0.34}" y="${y + height * 0.42}" width="${width * 0.08}" height="${height * 0.38}" fill="${theme.accent2 || '#ED7D31'}" /><rect x="${x + width * 0.5}" y="${y + height * 0.32}" width="${width * 0.08}" height="${height * 0.48}" fill="${theme.accent3 || '#A5A5A5'}" /></g>`,
      texts: [],
    };
  }

  const table = extractTag(block, 'a:tbl');
  if (!table) return { element: '', texts: [] };

  const rows = Array.from(table.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/gi)).map((rowMatch) => rowMatch[0]);
  const rowCount = Math.max(1, rows.length);
  const maxCols = Math.max(1, ...rows.map((row) => Array.from(row.matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/gi)).length));
  const rowHeight = height / rowCount;
  const colWidth = width / maxCols;
  const texts: string[] = [];
  const cells: string[] = [];

  rows.forEach((row, rowIndex) => {
    const columns = Array.from(row.matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/gi)).map((cellMatch) => cellMatch[0]);
    columns.forEach((cell, colIndex) => {
      const cellText = allTextsFromShape(cell).join(' ');
      if (cellText) texts.push(cellText);
      const cx = x + colIndex * colWidth;
      const cy = y + rowIndex * rowHeight;
      const fill = rowIndex === 0 ? (theme.accent1 || '#334155') : '#FFFFFF';
      const color = rowIndex === 0 ? '#FFFFFF' : (theme.tx1 || '#172026');
      cells.push(`<rect x="${cx}" y="${cy}" width="${colWidth}" height="${rowHeight}" fill="${fill}" stroke="#CBD5E1" stroke-width="1" />`);
      if (cellText) {
        cells.push(`<text x="${cx + 8}" y="${cy + Math.max(18, rowHeight / 2 + 6)}" font-size="${Math.min(16, Math.max(10, rowHeight * 0.36))}" fill="${color}">${escapeXml(clampText(cellText, Math.max(8, Math.floor(colWidth / 8))))}</text>`);
      }
    });
  });

  return { element: `<g>${cells.join('')}</g>`, texts };
}

function backgroundColorFromXml(xml: string, theme: ThemeColors) {
  const bg = extractTag(xml, 'p:bg');
  const bgPr = extractTag(bg, 'p:bgPr');
  const bgRef = extractTag(bg, 'p:bgRef') || extractSelfOrPairedTag(bg, 'p:bgRef');
  if (bgPr) return colorFromFill(bgPr, '', theme);
  if (bgRef) return colorFromFill(bgRef, '', theme);
  return '';
}

async function renderDrawingBlocks(
  zip: JSZip,
  sourcePath: string,
  xml: string,
  rels: RelationshipMap,
  scaleX: number,
  scaleY: number,
  theme: ThemeColors,
  writer: MediaAssetWriter | null,
  slideSizePx: { width: number; height: number },
  options: {
    inheritedTransforms?: Map<string, Transform>;
    skipPlaceholders?: boolean;
    collectText?: boolean;
  } = {},
) {
  const elements: string[] = [];
  const texts: string[] = [];

  for (const drawing of extractDrawingBlocks(xml)) {
    const kind = drawing.kind;
    let block = drawing.xml;
    const placeholderKey = shapePlaceholderKey(block);
    if (placeholderKey && options.skipPlaceholders) continue;

    if (placeholderKey && options.inheritedTransforms?.has(placeholderKey)) {
      block = applyInheritedTransform(block, options.inheritedTransforms.get(placeholderKey));
    }

    if (kind === 'pic') {
      const image = await renderPicture(zip, sourcePath, block, rels, scaleX, scaleY, writer, slideSizePx);
      if (image) elements.push(image);
      continue;
    }

    if (kind === 'grpSp') {
      const groupDrawing = await renderDrawingBlocks(zip, sourcePath, block, rels, scaleX, scaleY, theme, writer, slideSizePx, options);
      texts.push(...groupDrawing.texts);
      const transform = extractGroupTransform(block, scaleX, scaleY);
      if (groupDrawing.elements.length) {
        elements.push(`<g transform="translate(${transform.tx} ${transform.ty}) scale(${transform.sx} ${transform.sy})">${groupDrawing.elements.join('')}</g>`);
      }
      continue;
    }

    if (kind === 'graphicFrame') {
      const frame = renderGraphicFrame(block, scaleX, scaleY, theme);
      if (options.collectText) texts.push(...frame.texts);
      if (frame.element) elements.push(frame.element);
      continue;
    }

    if (kind === 'cxnSp') {
      const line = renderGeometry(block, scaleX, scaleY, theme);
      if (line) elements.push(line);
      continue;
    }

    const shapeTexts = allTextsFromShape(block);
    if (options.collectText) texts.push(...shapeTexts);
    const geometry = renderGeometry(block, scaleX, scaleY, theme);
    if (geometry) elements.push(geometry);
    const text = renderTextShape(block, scaleX, scaleY, theme);
    if (text) elements.push(text);
  }

  return { elements, texts };
}

function inferLayout(index: number, total: number, texts: string[]) {
  if (index === 0) return 'cover';
  if (/目录|contents?|agenda/i.test(texts[0] || '')) return 'toc';
  if (index === total - 1 && total > 1) return 'ending';
  if (texts.some((text) => /[%％]|同比|环比|增长|下降|数据|指标|表格|图表|趋势|矩阵/.test(text))) return 'content-chart';
  return 'content-image';
}

function countSvgTag(svg: string, tag: string) {
  return (svg.match(new RegExp(`<${tag}\\b`, 'gi')) || []).length;
}

function summarizeSlideVisual(input: {
  pageNumber: number;
  layout: string;
  svg: string;
  texts: string[];
  backgroundColor: string;
  width: number;
  height: number;
}) {
  const { svg, texts, backgroundColor, width, height } = input;
  const imageCount = countSvgTag(svg, 'image');
  const textCount = countSvgTag(svg, 'text');
  const rectCount = countSvgTag(svg, 'rect');
  const pathCount = countSvgTag(svg, 'path');
  const lineCount = countSvgTag(svg, 'line');
  const groupCount = countSvgTag(svg, 'g');
  const colors = Array.from(new Set(svg.match(/#[0-9a-fA-F]{6,8}\b/g) || [])).slice(0, 8);
  const fontSizes = Array.from(new Set(Array.from(svg.matchAll(/font-size="([\d.]+)"/gi)).map((match) => match[1]))).slice(0, 6);
  const fullSlideImage = new RegExp(`<image\\b[^>]*x="0"[^>]*y="0"[^>]*width="${width}"[^>]*height="${height}"[^>]*preserveAspectRatio="none"`, 'i').test(svg);
  const denseText = textCount >= 8 || texts.join('').length > 180;
  const hasChartHint = /content-chart|chart|matrix|table/i.test(input.layout) || svg.includes('<c:chart') || rectCount >= 12;
  const notes = [
    `第 ${input.pageNumber} 页，${input.layout} 版式`,
    `画布 ${width}x${height}，背景 ${backgroundColor}`,
    fullSlideImage ? '整页图片快照铺满画布，预览可高保真参考原 PPT；生成新内容时只学习构图、留白、色彩和装饰，不复用图片内业务文字' : '',
    imageCount ? `图片 ${imageCount} 个${fullSlideImage ? '，主视觉为整页图片' : ''}` : '无图片或图片较少',
    `文本元素 ${textCount} 个${denseText ? '，信息密度偏高' : '，信息密度适中'}`,
    `形状元素 rect:${rectCount}, path:${pathCount}, line:${lineCount}, group:${groupCount}`,
    colors.length ? `主要颜色 ${colors.join(', ')}` : '',
    fontSizes.length ? `字号线索 ${fontSizes.join(', ')}` : '',
    hasChartHint ? '包含数据/矩阵/图表型布局线索' : '',
  ].filter(Boolean);
  return notes.join('；');
}

async function renderSlide(
  zip: JSZip,
  slidePath: string,
  pageNumber: number,
  total: number,
  slideSize: { cx: number; cy: number },
  writer: MediaAssetWriter | null,
) {
  const xml = await zip.file(slidePath)?.async('string');
  if (!xml) throw new Error(`Missing slide file: ${slidePath}`);

  const inheritance = await loadSlideInheritance(zip, slidePath);
  const outputHeight = Math.round(OUTPUT_WIDTH * slideSize.cy / slideSize.cx);
  const scaleX = OUTPUT_WIDTH / slideSize.cx;
  const scaleY = outputHeight / slideSize.cy;
  const theme = inheritance.themeColors;
  const slideSizePx = { width: OUTPUT_WIDTH, height: outputHeight };
  const backgroundColor =
    backgroundColorFromXml(xml, theme) ||
    backgroundColorFromXml(inheritance.layout.xml, theme) ||
    backgroundColorFromXml(inheritance.master.xml, theme) ||
    theme.bg1 ||
    '#FFFFFF';

  const layoutPlaceholders = collectPlaceholderTransforms(inheritance.layout.xml);
  const masterPlaceholders = collectPlaceholderTransforms(inheritance.master.xml);
  const inheritedTransforms = new Map([...masterPlaceholders, ...layoutPlaceholders]);
  const masterDrawing = inheritance.master.path
    ? await renderDrawingBlocks(zip, inheritance.master.path, inheritance.master.xml, inheritance.masterRels, scaleX, scaleY, theme, writer, slideSizePx, { skipPlaceholders: true })
    : { elements: [], texts: [] };
  const layoutDrawing = inheritance.layout.path
    ? await renderDrawingBlocks(zip, inheritance.layout.path, inheritance.layout.xml, inheritance.layoutRels, scaleX, scaleY, theme, writer, slideSizePx, { skipPlaceholders: true })
    : { elements: [], texts: [] };
  const slideDrawing = await renderDrawingBlocks(zip, slidePath, xml, inheritance.slideRels, scaleX, scaleY, theme, writer, slideSizePx, {
    inheritedTransforms,
    collectText: true,
  });
  const elements = [...masterDrawing.elements, ...layoutDrawing.elements, ...slideDrawing.elements];
  const texts = slideDrawing.texts;

  const title = texts[0] || `Page ${pageNumber}`;
  const bullets = texts.slice(1, 6);
  const layout = inferLayout(pageNumber - 1, total, texts);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${OUTPUT_WIDTH} ${outputHeight}" width="${OUTPUT_WIDTH}" height="${outputHeight}" role="img" aria-label="${escapeXml(title)}">`,
    `<rect width="${OUTPUT_WIDTH}" height="${outputHeight}" fill="${escapeXml(backgroundColor)}" />`,
    ...elements.filter(Boolean),
    '</svg>',
  ].join('\n');

  return {
    pageNumber,
    title,
    bullets,
    description: bullets.slice(0, 3).join(' / ') || 'Converted from PPTX slide.',
    layout,
    svg,
    visualSummary: summarizeSlideVisual({
      pageNumber,
      layout,
      svg,
      texts,
      backgroundColor,
      width: OUTPUT_WIDTH,
      height: outputHeight,
    }),
    texts,
  };
}

export async function convertPptxToSvg(
  filename: string,
  dataBase64: string,
  options: PptxSvgConversionOptions = {},
): Promise<PptxSvgConversionResult> {
  if (!filename.toLowerCase().endsWith('.pptx')) {
    throw new Error('Only .pptx files are supported by the lightweight converter.');
  }

  const buffer = Buffer.from(stripDataUrl(dataBase64), 'base64');
  if (!buffer.length) throw new Error('PPTX file is empty.');

  const zip = await JSZip.loadAsync(buffer);
  const presentationXml = await zip.file('ppt/presentation.xml')?.async('string');
  if (!presentationXml) throw new Error('Invalid PPTX: ppt/presentation.xml is missing.');

  const presentationRelsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string').catch(() => '') || '';
  const presentationRels = parseRelationships(presentationRelsXml);
  const slideSize = readSlideSize(presentationXml);
  const slidePaths = slidePathsFromPresentation(zip, presentationXml, presentationRels);
  if (!slidePaths.length) throw new Error('No convertible slides were found.');

  const writer = createMediaAssetWriter(options);
  const slides: PptxSvgSlide[] = [];
  const allText: string[] = [];
  for (const [index, slidePath] of slidePaths.entries()) {
    const slide = await renderSlide(zip, slidePath, index + 1, slidePaths.length, slideSize, writer);
    allText.push(...slide.texts);
    slides.push({
      pageNumber: slide.pageNumber,
      title: slide.title,
      bullets: slide.bullets,
      description: slide.description,
      layout: slide.layout,
      svg: slide.svg,
      visualSummary: slide.visualSummary,
    });
  }

  return {
    slideCount: slidePaths.length,
    width: OUTPUT_WIDTH,
    height: Math.round(OUTPUT_WIDTH * slideSize.cy / slideSize.cx),
    slides,
    allText: allText.join('\n'),
  };
}
