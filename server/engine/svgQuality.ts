import type { DesignSpec, SpecSlide } from './spec.js';

export type SvgQualityIssueType =
  | 'invalid-svg'
  | 'text-overflow'
  | 'image-out-of-canvas'
  | 'required-image-missing'
  | 'image-overlap-content'
  | 'element-overlap'
  | 'low-contrast'
  | 'large-blank-image-area';

export type SvgQualitySeverity = 'warning' | 'error';

export interface SvgQualityIssue {
  type: SvgQualityIssueType;
  severity: SvgQualitySeverity;
  message: string;
  element?: string;
  bbox?: Box;
}

export interface SvgQualityResult {
  svg: string;
  issues: SvgQualityIssue[];
  blockingIssues: SvgQualityIssue[];
  repaired: boolean;
}

type Box = { x: number; y: number; width: number; height: number };
type SvgElementBox = Box & { tag: string; attrs: Record<string, string>; text?: string; source: string; index: number };
export interface SvgQualityImageAsset {
  id?: string;
  url: string;
  title?: string;
  prompt?: string;
  purpose?: string;
  style?: string;
  metadata?: {
    width?: number;
    height?: number;
    contentType?: string;
    bytes?: number;
    ok?: boolean;
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const TEXT_MARGIN = 28;
const FLOAT_TOLERANCE = 3;
const CONTAINER_TEXT_PADDING_X = 24;
const CONTAINER_TEXT_PADDING_Y = 16;

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  source.replace(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_match, key: string, doubleValue: string, singleValue: string) => {
    attrs[key] = doubleValue ?? singleValue ?? '';
    return '';
  });
  return attrs;
}

function numberAttr(attrs: Record<string, string>, key: string, fallback = 0) {
  const value = attrs[key];
  if (value === undefined || value === null) return fallback;
  const parsed = Number.parseFloat(String(value).replace(/[^\d.+-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function styleValue(attrs: Record<string, string>, key: string) {
  const style = attrs.style || '';
  const match = style.match(new RegExp(`${key}\\s*:\\s*([^;]+)`, 'i'));
  return match?.[1]?.trim();
}

function attrOrStyle(attrs: Record<string, string>, attr: string, fallback = '') {
  return attrs[attr] || styleValue(attrs, attr) || fallback;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripTags(value: string) {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeHexColor(value: string | undefined): string | undefined {
  const color = String(value || '').trim();
  if (!color || color === 'none' || color === 'transparent') return undefined;
  const short = color.match(/^#([0-9a-f]{3})$/i)?.[1];
  if (short) return `#${short.split('').map((char) => char + char).join('')}`.toUpperCase();
  const long = color.match(/^#([0-9a-f]{6})$/i)?.[1];
  return long ? `#${long.toUpperCase()}` : undefined;
}

function luminance(hex: string) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return 1;
  const rgb = [1, 3, 5].map((start) => Number.parseInt(normalized.slice(start, start + 2), 16) / 255);
  const linear = rgb.map((channel) => (channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string) {
  const fg = luminance(foreground);
  const bg = luminance(background);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

function rectsOverlap(a: Box, b: Box, padding = 0) {
  return a.x < b.x + b.width - padding &&
    a.x + a.width > b.x + padding &&
    a.y < b.y + b.height - padding &&
    a.y + a.height > b.y + padding;
}

function intersectionArea(a: Box, b: Box) {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

function outsideCanvas(box: Box, canvas: DesignSpec['canvas']) {
  return box.x < -FLOAT_TOLERANCE ||
    box.y < -FLOAT_TOLERANCE ||
    box.x + box.width > canvas.width + FLOAT_TOLERANCE ||
    box.y + box.height > canvas.height + FLOAT_TOLERANCE;
}

function estimateTextWidth(text: string, fontSize: number) {
  let units = 0;
  for (const char of String(text || '')) {
    if (/\s/.test(char)) units += 0.34;
    else if (/[\u3000-\u9fff\uff00-\uffef]/.test(char)) units += 0.98;
    else if (/[A-Z0-9]/.test(char)) units += 0.62;
    else if (/[.,;:!?'"`|/\\()[\]{}·•\-–—_+*=]/.test(char)) units += 0.42;
    else units += 0.54;
  }
  return Math.max(fontSize, units * fontSize);
}

function textLineBox(input: {
  attrs: Record<string, string>;
  parentAttrs: Record<string, string>;
  text: string;
  index: number;
  fallbackX: number;
  fallbackY: number;
  fallbackFontSize: number;
}) {
  const mergedAttrs = { ...input.parentAttrs, ...input.attrs };
  const fontSize = numberAttr(mergedAttrs, 'font-size', Number.parseFloat(styleValue(mergedAttrs, 'font-size') || '') || input.fallbackFontSize);
  const lineHeight = fontSize * 1.24;
  let x = numberAttr(input.attrs, 'x', input.fallbackX);
  let y = numberAttr(input.attrs, 'y', input.fallbackY + input.index * lineHeight);
  x += numberAttr(input.attrs, 'dx', 0);
  y += numberAttr(input.attrs, 'dy', 0);
  const width = estimateTextWidth(input.text, fontSize);
  const anchor = String(mergedAttrs['text-anchor'] || styleValue(mergedAttrs, 'text-anchor') || 'start').toLowerCase();
  if (anchor === 'middle') x -= width / 2;
  if (anchor === 'end') x -= width;
  return {
    x,
    y: y - fontSize,
    width,
    height: Math.max(fontSize * 1.16, lineHeight),
  };
}

function extractElementBoxes(svg: string, tag: 'image' | 'rect' | 'text' | 'line' | 'path'): SvgElementBox[] {
  const boxes: SvgElementBox[] = [];
  const regex = tag === 'text'
    ? /<text\b[\s\S]*?<\/text>/gi
    : new RegExp(`<${tag}\\b[^>]*(?:/>|>[\\s\\S]*?<\\/${tag}>)`, 'gi');

  for (const match of svg.matchAll(regex)) {
    const source = match[0];
    const attrs = parseAttributes(source);
    const index = match.index || 0;

    if (tag === 'image' || tag === 'rect') {
      const box = {
        x: numberAttr(attrs, 'x'),
        y: numberAttr(attrs, 'y'),
        width: numberAttr(attrs, 'width'),
        height: numberAttr(attrs, 'height'),
      };
      if (box.width > 0 && box.height > 0) boxes.push({ tag, attrs, source, index, ...box });
      continue;
    }

    if (tag === 'line') {
      const x1 = numberAttr(attrs, 'x1');
      const y1 = numberAttr(attrs, 'y1');
      const x2 = numberAttr(attrs, 'x2');
      const y2 = numberAttr(attrs, 'y2');
      boxes.push({ tag, attrs, source, index, x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.max(1, Math.abs(x2 - x1)), height: Math.max(1, Math.abs(y2 - y1)) });
      continue;
    }

    if (tag === 'path') {
      const numbers = Array.from(String(attrs.d || '').matchAll(/-?\d+(?:\.\d+)?/g)).map((item) => Number.parseFloat(item[0]));
      if (numbers.length >= 4) {
        const xs = numbers.filter((_value, idx) => idx % 2 === 0);
        const ys = numbers.filter((_value, idx) => idx % 2 === 1);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        if (Number.isFinite(minX) && Number.isFinite(maxX) && Number.isFinite(minY) && Number.isFinite(maxY)) {
          boxes.push({ tag, attrs, source, index, x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) });
        }
      }
      continue;
    }

    const fontSize = numberAttr(attrs, 'font-size', Number.parseFloat(styleValue(attrs, 'font-size') || '') || 20);
    const tspans = Array.from(source.matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/gi));
    const lines = tspans.length ? tspans.map((item) => stripTags(item[2])) : stripTags(source).split(/\n+/);
    const text = lines.join(' ').trim();
    const fallbackX = numberAttr(attrs, 'x', TEXT_MARGIN);
    const fallbackY = numberAttr(attrs, 'y', fontSize + TEXT_MARGIN);
    const lineBoxes = tspans.length
      ? tspans.map((item, lineIndex) => textLineBox({
          attrs: parseAttributes(item[1] || ''),
          parentAttrs: attrs,
          text: stripTags(item[2]),
          index: lineIndex,
          fallbackX,
          fallbackY,
          fallbackFontSize: fontSize,
        }))
      : lines.map((line, lineIndex) => textLineBox({
          attrs: {},
          parentAttrs: attrs,
          text: line,
          index: lineIndex,
          fallbackX,
          fallbackY,
          fallbackFontSize: fontSize,
        }));
    const minX = Math.min(...lineBoxes.map((box) => box.x));
    const minY = Math.min(...lineBoxes.map((box) => box.y));
    const maxX = Math.max(...lineBoxes.map((box) => box.x + box.width));
    const maxY = Math.max(...lineBoxes.map((box) => box.y + box.height));
    const x = Number.isFinite(minX) ? minX : fallbackX;
    const y = Number.isFinite(minY) ? minY : fallbackY - fontSize;
    const width = Number.isFinite(maxX) ? Math.max(fontSize, maxX - x) : estimateTextWidth(text, fontSize);
    const height = Number.isFinite(maxY) ? Math.max(fontSize * 1.2, maxY - y) : Math.max(fontSize * 1.2, lines.length * fontSize * 1.24);
    boxes.push({ tag, attrs, source, index, x, y, width, height, text });
  }

  return boxes;
}

function setAttribute(openTag: string, key: string, value: string | number) {
  const escaped = escapeAttribute(String(value));
  if (new RegExp(`\\s${escapeRegExp(key)}\\s*=`, 'i').test(openTag)) {
    return openTag.replace(new RegExp(`(\\s${escapeRegExp(key)}\\s*=\\s*)(?:"[^"]*"|'[^']*')`, 'i'), `$1"${escaped}"`);
  }
  if (openTag.endsWith('/>')) return openTag.replace(/\/>$/, ` ${key}="${escaped}"/>`);
  return openTag.replace(/>$/, ` ${key}="${escaped}">`);
}

function setTextOpenAttribute(source: string, key: string, value: string | number) {
  const open = source.match(/^<text\b[^>]*>/i)?.[0];
  if (!open) return source;
  return source.replace(open, setAttribute(open, key, value));
}

function addOrReplaceSvgAttributes(svg: string, spec: DesignSpec) {
  const open = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!open) return svg;
  let patched = open;
  if (!/\sxmlns\s*=/i.test(patched)) patched = patched.replace('<svg', `<svg xmlns="${SVG_NS}"`);
  if (!/\sxmlns:xlink\s*=/i.test(patched)) patched = patched.replace('<svg', `<svg xmlns:xlink="${XLINK_NS}"`);
  patched = setAttribute(patched, 'viewBox', `0 0 ${spec.canvas.width} ${spec.canvas.height}`);
  patched = setAttribute(patched, 'width', spec.canvas.width);
  patched = setAttribute(patched, 'height', spec.canvas.height);
  return svg.replace(open, patched);
}

function removeStyleAndClassAttributes(svg: string) {
  return svg
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/\sclass\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
}

function removeUnsupportedClipPathTargets(svg: string) {
  return svg.replace(/<([a-z][\w:-]*)\b([^<>]*?)>/gi, (tag, tagName: string, attrs: string) => {
    const normalized = tagName.toLowerCase();
    if (normalized === 'image' || normalized === 'clippath' || /\sdata-pptx-crop\s*=/i.test(attrs)) return tag;
    if (!/\sclip-path\s*=/i.test(attrs)) return tag;
    return `<${tagName}${attrs.replace(/\sclip-path\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')}>`;
  });
}

function removeDuplicateAttributes(svg: string) {
  return svg.replace(/<([a-z][\w:-]*)(\s[^<>]*?)?(\/?)>/gi, (tag, tagName: string, attrSource = '', selfClosing = '') => {
    const attrs = Array.from(attrSource.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/g));
    if (attrs.length < 2) return tag;
    const seen = new Map<string, { name: string; quote: string; value: string }>();
    for (const attr of attrs) {
      seen.set(String(attr[1]).toLowerCase(), { name: attr[1], quote: attr[2], value: attr[3] });
    }
    if (seen.size === attrs.length) return tag;
    const serialized = Array.from(seen.values())
      .map((attr) => ` ${attr.name}=${attr.quote}${attr.value}${attr.quote}`)
      .join('');
    return `<${tagName}${serialized}${selfClosing || ''}>`;
  });
}

function isFullCanvasBox(box: Box, spec: DesignSpec) {
  return box.x <= FLOAT_TOLERANCE &&
    box.y <= FLOAT_TOLERANCE &&
    box.width >= spec.canvas.width - FLOAT_TOLERANCE &&
    box.height >= spec.canvas.height - FLOAT_TOLERANCE;
}

function isDecorativeBackgroundBox(box: SvgElementBox, spec: DesignSpec) {
  if (isFullCanvasBox(box, spec)) return true;
  const area = box.width * box.height;
  const canvasArea = spec.canvas.width * spec.canvas.height;
  if (area >= canvasArea * 0.68) return true;
  const id = String(box.attrs.id || '').toLowerCase();
  if (/(background|bg|chrome|backdrop|canvas|page-bg)/.test(id) && area >= canvasArea * 0.25) return true;
  return false;
}

function findTextContainer(text: SvgElementBox, rects: SvgElementBox[], spec: DesignSpec) {
  return rects
    .filter((rect) => rect.index < text.index)
    .filter((rect) => rect.width > 40 && rect.height > 20)
    .filter((rect) => !isDecorativeBackgroundBox(rect, spec))
    .filter((rect) => rectsOverlap(rect, text))
    .sort((a, b) => {
      const areaA = a.width * a.height;
      const areaB = b.width * b.height;
      return areaA - areaB;
    })[0];
}

function textViolatesContainerPadding(text: SvgElementBox, container: SvgElementBox) {
  const safeLeft = container.x + CONTAINER_TEXT_PADDING_X;
  const safeRight = container.x + container.width - CONTAINER_TEXT_PADDING_X;
  const safeTop = container.y + CONTAINER_TEXT_PADDING_Y;
  const safeBottom = container.y + container.height - CONTAINER_TEXT_PADDING_Y;
  return text.x < safeLeft - FLOAT_TOLERANCE ||
    text.y < safeTop - FLOAT_TOLERANCE ||
    text.x + text.width > safeRight + FLOAT_TOLERANCE ||
    text.y + text.height > safeBottom + FLOAT_TOLERANCE;
}

function isBlockingTextOverlap(a: SvgElementBox, b: SvgElementBox, overlap: number) {
  const minArea = Math.min(a.width * a.height, b.width * b.height);
  if (minArea <= 0) return false;
  const ratio = overlap / minArea;
  return ratio > 0.26 || overlap > 420;
}

function isLikelyTextCoveringElement(element: SvgElementBox, text: SvgElementBox, spec: DesignSpec) {
  if (element.index <= text.index) return false;
  if (element.width <= 1.5 && element.height <= 1.5) return false;
  if (isDecorativeBackgroundBox(element, spec)) return false;
  const fill = String(attrOrStyle(element.attrs, 'fill', '')).trim().toLowerCase();
  const stroke = String(attrOrStyle(element.attrs, 'stroke', '')).trim().toLowerCase();
  const hasVisiblePaint = fill && fill !== 'none' && fill !== 'transparent' || stroke && stroke !== 'none' && stroke !== 'transparent';
  if (!hasVisiblePaint && element.tag !== 'line') return false;
  const overlap = intersectionArea(element, text);
  if (overlap <= 0) return false;
  const textArea = Math.max(1, text.width * text.height);
  if (element.tag === 'line') return overlap > Math.min(160, textArea * 0.08);
  if (element.width * element.height > spec.canvas.width * spec.canvas.height * 0.45) return false;
  return overlap / textArea > 0.12 || overlap > 360;
}

function repairTextCanvasOverflow(svg: string, spec: DesignSpec) {
  let result = svg;
  const texts = extractElementBoxes(svg, 'text').sort((a, b) => b.index - a.index);

  for (const text of texts) {
    if (!outsideCanvas(text, spec.canvas)) continue;

    let replacement = text.source;
    let fontSize = numberAttr(text.attrs, 'font-size', Number.parseFloat(styleValue(text.attrs, 'font-size') || '') || spec.typography.bodySize || 20);
    let x = numberAttr(text.attrs, 'x', text.x);
    let y = numberAttr(text.attrs, 'y', text.y + fontSize);
    const textEnd = text.x + text.width;
    const canvasEnd = spec.canvas.width - TEXT_MARGIN;
    const canvasBottom = spec.canvas.height - TEXT_MARGIN;

    if (text.x < TEXT_MARGIN) x += TEXT_MARGIN - text.x;
    if (textEnd > canvasEnd) {
      const available = Math.max(80, canvasEnd - Math.max(TEXT_MARGIN, text.x));
      if (text.width > available) fontSize = Math.max(10, Math.floor(fontSize * (available / text.width)));
      else x -= textEnd - canvasEnd;
    }
    if (text.y < TEXT_MARGIN) y += TEXT_MARGIN - text.y;
    if (text.y + text.height > canvasBottom) y -= text.y + text.height - canvasBottom;

    replacement = setTextOpenAttribute(replacement, 'x', Math.round(x));
    replacement = setTextOpenAttribute(replacement, 'y', Math.round(y));
    replacement = setTextOpenAttribute(replacement, 'font-size', Math.round(fontSize));
    result = result.slice(0, text.index) + replacement + result.slice(text.index + text.source.length);
  }

  return result;
}

function deterministicRepair(svg: string, spec: DesignSpec) {
  let result = removeStyleAndClassAttributes(svg);
  result = removeDuplicateAttributes(result);
  result = removeUnsupportedClipPathTargets(result);
  result = addOrReplaceSvgAttributes(result, spec);
  result = repairTextCanvasOverflow(result, spec);
  return result;
}

function issue(type: SvgQualityIssueType, severity: SvgQualitySeverity, message: string, element?: string, bbox?: Box): SvgQualityIssue {
  return { type, severity, message, element, bbox };
}

function normalizeQualityImageAssets(input?: string | SvgQualityImageAsset[]): SvgQualityImageAsset[] {
  if (!input) return [];
  if (typeof input === 'string') {
    const url = input.trim();
    return url ? [{ id: 'img-1', url }] : [];
  }
  return input
    .filter((asset) => asset?.url && typeof asset.url === 'string')
    .slice(0, 8)
    .map((asset, index) => ({
      id: String(asset.id || `img-${index + 1}`),
      url: String(asset.url),
      title: asset.title ? String(asset.title).slice(0, 120) : undefined,
      prompt: asset.prompt ? String(asset.prompt).slice(0, 360) : undefined,
      purpose: asset.purpose ? String(asset.purpose).slice(0, 80) : undefined,
      style: asset.style ? String(asset.style).slice(0, 80) : undefined,
    }));
}

function imageHrefOf(img: SvgElementBox) {
  return String(img.attrs.href || img.attrs['xlink:href'] || '');
}

function inspectSvg(svg: string, spec: DesignSpec, slide: SpecSlide, imageInput?: string | SvgQualityImageAsset[]): SvgQualityIssue[] {
  const issues: SvgQualityIssue[] = [];
  const open = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!open || !/<\/svg>\s*$/i.test(svg.trim())) {
    return [issue('invalid-svg', 'error', 'SVG is incomplete or missing root node.')];
  }

  const canvas = spec.canvas;
  const images = extractElementBoxes(svg, 'image');
  const texts = extractElementBoxes(svg, 'text');
  const rects = extractElementBoxes(svg, 'rect');
  const lines = extractElementBoxes(svg, 'line');
  const paths = extractElementBoxes(svg, 'path');
  const layout = String(slide.layout || '').toLowerCase();
  const imageAssets = normalizeQualityImageAssets(imageInput);
  const generatedImages = imageAssets.length
    ? images.filter((img) => imageAssets.some((asset) => imageHrefOf(img).includes(asset.url)))
    : [];

  for (const text of texts) {
    if (outsideCanvas(text, canvas)) {
      issues.push(issue('text-overflow', 'error', `Text may overflow canvas: ${(text.text || '').slice(0, 36)}`, 'text', text));
    }
    const container = findTextContainer(text, rects, spec);
    if (container && !isFullCanvasBox(container, spec)) {
      const allowedWidth = Math.max(0, container.width - CONTAINER_TEXT_PADDING_X * 2);
      const allowedHeight = Math.max(0, container.height - CONTAINER_TEXT_PADDING_Y * 2);
      if (text.width > allowedWidth || text.height > allowedHeight || textViolatesContainerPadding(text, container)) {
        issues.push(issue('text-overflow', 'error', `Text may overflow or touch its container edge: ${(text.text || '').slice(0, 36)}`, text.source, text));
      }
    }
  }

  for (const img of images) {
    if (outsideCanvas(img, canvas)) {
      issues.push(issue('image-out-of-canvas', 'error', 'Image is outside the canvas.', 'image', img));
    }
  }

  if (imageAssets.length) {
    for (const asset of imageAssets) {
      const found = images.some((img) => imageHrefOf(img).includes(asset.url));
      if (!found) {
        issues.push(issue('required-image-missing', 'error', `Required generated image was not found on this page: ${asset.id || asset.title || asset.url.slice(0, 32)}`));
      }
    }
    for (const img of generatedImages) {
      for (const text of texts) {
        const overlap = intersectionArea(img, text);
        const threshold = layout.includes('cover') || layout.includes('full') ? 0.18 : 0.08;
        if (overlap > Math.min(text.width * text.height, img.width * img.height) * threshold) {
          issues.push(issue('image-overlap-content', 'error', `Image may cover text: ${(text.text || '').slice(0, 24)}`, 'image/text', img));
          break;
        }
      }
      const chartLikeElements = [...rects, ...lines, ...paths].filter((item) => {
        if (item.width >= canvas.width * 0.92 && item.height >= canvas.height * 0.85) return false;
        if (item.width <= 2 && item.height <= 2) return false;
        return rectsOverlap(img, item, 3);
      });
      if (/chart|matrix|table/i.test(layout) && chartLikeElements.length >= 3) {
        issues.push(issue('image-overlap-content', 'error', 'Image may cover chart or structured components.', 'image/chart', img));
      }
      if (img.width * img.height > canvas.width * canvas.height * 0.42 && !layout.includes('cover') && !layout.includes('full')) {
        issues.push(issue('large-blank-image-area', 'warning', 'Image placeholder is too large and may create excessive blank area.', 'image', img));
      }
    }
  }

  const significantTexts = texts.filter((text) => (text.text || '').length >= 2);
  for (let i = 0; i < significantTexts.length; i += 1) {
    for (let j = i + 1; j < significantTexts.length; j += 1) {
      const a = significantTexts[i];
      const b = significantTexts[j];
      const overlap = intersectionArea(a, b);
      const minArea = Math.min(a.width * a.height, b.width * b.height);
      if (isBlockingTextOverlap(a, b, overlap)) {
        issues.push(issue('element-overlap', 'error', `Text elements overlap: ${(a.text || '').slice(0, 18)} / ${(b.text || '').slice(0, 18)}`, a.source, a));
      } else if (minArea > 0 && overlap / minArea > 0.16) {
        issues.push(issue('element-overlap', 'warning', `Text elements may be too close: ${(a.text || '').slice(0, 18)} / ${(b.text || '').slice(0, 18)}`, a.source, a));
      }
    }
  }

  const coveringElements = [...rects, ...lines, ...paths];
  for (const text of significantTexts) {
    const cover = coveringElements.find((element) => isLikelyTextCoveringElement(element, text, spec));
    if (cover) {
      issues.push(issue('element-overlap', 'error', `A later ${cover.tag} element may cover text: ${(text.text || '').slice(0, 24)}`, cover.source, text));
    }
  }

  const background = spec.visualTheme.colors.background || '#FFFFFF';
  const surface = spec.visualTheme.colors.surface || background;
  for (const text of texts) {
    const fill = normalizeHexColor(attrOrStyle(text.attrs, 'fill', spec.visualTheme.colors.text));
    if (!fill) continue;
    const bg = rects
      .filter((rect) => rectsOverlap(rect, text) && rect.index < text.index)
      .sort((a, b) => b.index - a.index)[0];
    const bgFill = normalizeHexColor(attrOrStyle(bg?.attrs || {}, 'fill')) || surface || background;
    if (contrastRatio(fill, bgFill) < 3) {
      issues.push(issue('low-contrast', 'error', `Text contrast is low: ${(text.text || '').slice(0, 24)}`, 'text', text));
    }
  }

  return issues;
}

export function finalizeSvgQuality(svg: string, spec: DesignSpec, slide: SpecSlide, _imageSlot?: unknown, imageInput?: string | SvgQualityImageAsset[]): SvgQualityResult {
  const repairedSvg = deterministicRepair(String(svg || ''), spec);
  const issues = inspectSvg(repairedSvg, spec, slide, imageInput);
  const blockingIssues = issues.filter((item) => item.severity === 'error');
  return { svg: repairedSvg, issues, blockingIssues, repaired: repairedSvg !== svg };
}

export function summarizeSvgQualityIssues(issues: SvgQualityIssue[], limit = 8) {
  return issues
    .slice(0, limit)
    .map((item, index) => `${index + 1}. [${item.severity}] ${item.message}`)
    .join('\n');
}

export function buildSvgQualityRepairPrompt(
  svg: string,
  spec: DesignSpec,
  slide: SpecSlide,
  _imageSlot: unknown,
  issues: SvgQualityIssue[],
  imageInput?: string | SvgQualityImageAsset[]
) {
  const issueSummary = summarizeSvgQualityIssues(issues, 10) || 'Quality check failed.';
  const imageAssets = normalizeQualityImageAssets(imageInput);
  const imageInstruction = imageAssets.length
    ? `Use only these generated image assets, and keep every listed asset that is required by the slide plan:\n${imageAssets.map((asset, index) => `- ${asset.id || `img-${index + 1}`}: ${asset.url}${asset.purpose ? `, purpose: ${asset.purpose}` : ''}${asset.prompt ? `, prompt: ${asset.prompt}` : ''}`).join('\n')}\nYou may decide each image's position, size, crop, rotation and layering. Use preserveAspectRatio="xMidYMid slice|meet|none", clipPath with rect/circle/ellipse/path/polygon for regular or irregular cropping, and transform for rotate/scale/translate. Images must stay within the canvas and must not cover titles, body text, charts, or key components.`
    : 'Do not add any <image> element when no image URL is provided.';

  return `Repair this SVG slide. Output a complete SVG only. Do not explain.

Page:
- pageNumber: ${slide.pageNumber}
- title: ${slide.title}
- layout: ${slide.layout}
- canvas: ${spec.canvas.width}x${spec.canvas.height}

Quality issues:
${issueSummary}

Rules:
1. Text must not overflow the canvas, touch container edges, overlap other text, or be covered by images, charts, labels, icons, lines or decorative shapes.
2. Keep text inside cards/tables/timelines/chart labels with at least 24px horizontal and 16px vertical padding.
3. To fix dense content, first shorten wording, split text with <tspan>, reduce font size, increase row/card size, or move nearby components. Do not simply stack elements closer together.
4. Images must not leave the canvas, cover titles/body/chart elements, or leave their required containers.
5. ${imageInstruction}
6. Text must have readable contrast against its background.
7. Do not use <style>, class, foreignObject, mask, script, animate, textPath, rgba(), or gradients.
8. The root must be <svg viewBox="0 0 ${spec.canvas.width} ${spec.canvas.height}" width="${spec.canvas.width}" height="${spec.canvas.height}">.

SVG to repair:
${svg}`;
}

function extractIssueSnippets(svg: string, issues: SvgQualityIssue[], maxChars = 5200) {
  const directSnippets = issues
    .map((item) => item.element)
    .filter(Boolean)
    .map((element) => String(element))
    .filter((element) => element.startsWith('<'));
  const elementSnippets = Array.from(svg.matchAll(/<(?:text|image|rect|path|line|g)\b[\s\S]*?(?:\/>|<\/(?:text|image|rect|path|line|g)>)/gi))
    .map((match) => match[0])
    .filter((source) => {
      const lower = source.toLowerCase();
      return issues.some((item) => {
        const text = String(item.message || '').toLowerCase();
        return text.includes('image') && lower.includes('<image') ||
          text.includes('text') && lower.includes('<text') ||
          text.includes('contrast') && lower.includes('<text') ||
          text.includes('overlap') && /<(text|image|rect|path|line)\b/i.test(source);
      });
    });
  const snippets = [...directSnippets, ...elementSnippets]
    .map((source) => source.trim())
    .filter(Boolean);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const snippet of snippets) {
    const key = snippet.slice(0, 180);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(snippet);
    if (unique.join('\n').length >= maxChars) break;
  }
  return unique.join('\n').slice(0, maxChars) || svg.slice(0, maxChars);
}

export function buildSvgQualityPatchPrompt(
  svg: string,
  spec: DesignSpec,
  slide: SpecSlide,
  _imageSlot: unknown,
  issues: SvgQualityIssue[],
  imageInput?: string | SvgQualityImageAsset[]
) {
  const issueSummary = summarizeSvgQualityIssues(issues, 10) || 'Quality check failed.';
  const snippets = extractIssueSnippets(svg, issues);
  const imageAssets = normalizeQualityImageAssets(imageInput);
  const imageInstruction = imageAssets.length
    ? imageAssets.map((asset, index) => `- ${asset.id || `img-${index + 1}`}: ${asset.url}${asset.purpose ? `, purpose: ${asset.purpose}` : ''}`).join('\n')
    : 'No generated image asset is required for this page.';

  return `Repair only the broken parts of this SVG slide. Output a complete SVG only. Do not explain.

Page:
- pageNumber: ${slide.pageNumber}
- title: ${slide.title}
- layout: ${slide.layout}
- canvas: ${spec.canvas.width}x${spec.canvas.height}

Quality issues:
${issueSummary}

Relevant SVG snippets:
${snippets}

Image assets:
${imageInstruction}

Rules:
1. Keep all unrelated layout, wording, colors and visual hierarchy unchanged.
2. Only move, resize, recolor, wrap, shorten, crop or reorder elements needed to fix the listed issues.
3. Preserve at least 24px horizontal and 16px vertical padding for text inside visible containers.
4. Fix overlaps by separating text, images, chart shapes, labels and connectors; do not hide the issue by drawing another shape above it.
5. The final answer must still be a complete valid SVG.
6. Do not use <style>, class, foreignObject, mask, script, animate, textPath, rgba(), or gradients.
7. The root must be <svg viewBox="0 0 ${spec.canvas.width} ${spec.canvas.height}" width="${spec.canvas.width}" height="${spec.canvas.height}">.`;
}
