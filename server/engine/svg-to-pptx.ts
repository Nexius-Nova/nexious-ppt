import type { DesignSpec } from './spec.js';
import { Resvg } from '@resvg/resvg-js';
import { buildSpecLock, type SpecLock } from './spec.js';
import pptxgenModule from 'pptxgenjs';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { generatedImagesRoot, publicBaseUrl } from '../utils/storage.js';

const PptxGen = (pptxgenModule as any).default || pptxgenModule;
const MAX_EXPORT_CACHE_ITEMS = 120;
const remoteImageCache = new Map<string, string>();
const pngRenderCache = new Map<string, Buffer>();

type SvgAttrs = Record<string, string>;
type SvgStyle = Record<string, string>;
type NativeContext = {
  pptx: any;
  slide: any;
  slideW: number;
  slideH: number;
  scaleX: number;
  scaleY: number;
  converted: number;
};
type SvgContext = {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  style: SvgStyle;
};

const MIN_PPT_SIZE = 0.001;

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function rememberCacheValue<T>(cache: Map<string, T>, key: string, value: T) {
  if (cache.size >= MAX_EXPORT_CACHE_ITEMS && !cache.has(key)) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, value);
}

function finiteNumber(value: number): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}

function safeSize(value: number): number | undefined {
  const finite = finiteNumber(value);
  if (finite === undefined) return undefined;
  return Math.max(MIN_PPT_SIZE, Math.abs(finite));
}

function safeBox(x: number, y: number, w: number, h: number) {
  const safeX = finiteNumber(x);
  const safeY = finiteNumber(y);
  const safeW = safeSize(w);
  const safeH = safeSize(h);
  if (safeX === undefined || safeY === undefined || safeW === undefined || safeH === undefined) return undefined;
  return { x: safeX, y: safeY, w: safeW, h: safeH };
}

function escapeXmlText(value: unknown): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function inlineRemoteImages(svg: string): Promise<string> {
  const publicBase = publicBaseUrl();
  const generatedImageRoot = generatedImagesRoot;
  const imgRegex = /<image\b([^>]*?)\/?\s*>/gi;
  const matches: Array<{ full: string; href: string }> = [];
  let m;

  while ((m = imgRegex.exec(svg)) !== null) {
    const hrefMatch = m[0].match(/\b(?:href|xlink:href)\s*=\s*(['"])(.*?)\1/i);
    const href = hrefMatch?.[2] || '';
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('/generated-images/')) {
      matches.push({ full: m[0], href });
    }
  }

  let result = svg;
  for (const match of matches) {
    try {
      const fetchUrl = match.href.startsWith('/') ? `${publicBase}${match.href}` : match.href;
      const cachedDataUrl = remoteImageCache.get(fetchUrl);
      if (cachedDataUrl) {
        result = result.split(match.href).join(cachedDataUrl);
        continue;
      }

      let contentType = 'image/png';
      let buf: Buffer;
      const localUrl = new URL(fetchUrl);
      const publicUrl = new URL(publicBase);

      if (localUrl.origin === publicUrl.origin && localUrl.pathname.startsWith('/generated-images/')) {
        const relativePath = decodeURIComponent(localUrl.pathname.replace(/^\/generated-images\/?/, ''));
        const safePath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
        const filePath = path.join(generatedImageRoot, safePath);
        const relativeToRoot = path.relative(generatedImageRoot, filePath);
        if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) continue;
        const ext = path.extname(filePath).toLowerCase();
        contentType = ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
          ? 'image/gif'
          : 'image/png';
        buf = await readFile(filePath);
      } else {
        const resp = await fetch(fetchUrl, { signal: AbortSignal.timeout(10000) });
        if (!resp.ok) continue;
        contentType = resp.headers.get('content-type') || 'image/png';
        buf = Buffer.from(await resp.arrayBuffer());
      }
      const b64 = buf.toString('base64');
      const dataUrl = `data:${contentType};base64,${b64}`;
      rememberCacheValue(remoteImageCache, fetchUrl, dataUrl);
      result = result.split(match.href).join(dataUrl);
    } catch {
      result = result.replace(match.full, '');
    }
  }

  return result;
}

function sanitizeSvgForResvg(svg: string): string {
  let result = extractSvgFragment(svg);
  result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  result = result.replace(/\bclass\s*=\s*"[^"]*"/gi, '');
  result = result.replace(/\s+[a-zA-Z_:][\w:.-]*\s*=\s*$/g, '');
  result = result.replace(/rgba\(\s*([^)]+)\)/gi, (_, inner) => {
    const parts = inner.split(',').map((s: string) => s.trim());
    if (parts.length === 4) {
      const r = parseInt(parts[0]).toString(16).padStart(2, '0');
      const g = parseInt(parts[1]).toString(16).padStart(2, '0');
      const b = parseInt(parts[2]).toString(16).padStart(2, '0');
      const a = Math.round(parseFloat(parts[3]) * 255).toString(16).padStart(2, '0');
      return `#${r}${g}${b}${a}`;
    }
    return '#ffffffff';
  });
  result = result.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
  result = result.replace(/<image\b(?=[^>]*$)[\s\S]*$/gi, '');
  result = result.replace(/<image\b[^>]*(?:href|xlink:href)\s*=\s*(['"])(?:data:image\/[^;]+;base64,)?[^'"]*$/gi, '');
  result = result.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/g, '&amp;');
  if (!/<\/svg>\s*$/i.test(result)) {
    const danglingTagIndex = result.lastIndexOf('<');
    const lastCloseIndex = result.lastIndexOf('>');
    if (danglingTagIndex > lastCloseIndex) {
      result = result.slice(0, danglingTagIndex);
    }
    result = `${result}</svg>`;
  }
  return result;
}

function extractSvgFragment(svg: string): string {
  const source = String(svg || '');
  const start = source.search(/<svg\b/i);
  if (start < 0) return '';

  let result = source.slice(start);
  const close = result.toLowerCase().lastIndexOf('</svg>');
  if (close >= 0) {
    result = result.slice(0, close + '</svg>'.length);
  }

  return result.trim();
}

function withCanvasAttributes(svg: string, spec: DesignSpec): string {
  if (!svg) return '';
  let result = svg;
  const svgOpen = result.match(/<svg\b[^>]*>/i)?.[0];
  if (!svgOpen) return result;

  let patchedOpen = svgOpen;
  if (!/\sxmlns\s*=/.test(patchedOpen)) {
    patchedOpen = patchedOpen.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/\sviewBox\s*=/.test(patchedOpen)) {
    patchedOpen = patchedOpen.replace('<svg', `<svg viewBox="0 0 ${spec.canvas.width} ${spec.canvas.height}"`);
  }
  if (!/\swidth\s*=/.test(patchedOpen)) {
    patchedOpen = patchedOpen.replace('<svg', `<svg width="${spec.canvas.width}"`);
  }
  if (!/\sheight\s*=/.test(patchedOpen)) {
    patchedOpen = patchedOpen.replace('<svg', `<svg height="${spec.canvas.height}"`);
  }
  return result.replace(svgOpen, patchedOpen);
}

function buildExportFallbackSvg(spec: DesignSpec, pageNumber: number, reason: string): string {
  const colors = spec.visualTheme.colors;
  const typography = spec.typography;
  const title = spec.outline[pageNumber - 1]?.title || `第 ${pageNumber} 页`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.canvas.width} ${spec.canvas.height}" width="${spec.canvas.width}" height="${spec.canvas.height}">
  <rect width="${spec.canvas.width}" height="${spec.canvas.height}" fill="${colors.background}"/>
  <rect x="72" y="72" width="${spec.canvas.width - 144}" height="${spec.canvas.height - 144}" rx="16" fill="${colors.surface}" stroke="${colors.border}" stroke-width="2"/>
  <text x="104" y="132" font-size="${typography.subtitleSize}" font-family="${typography.titleFamily}" font-weight="700" fill="${colors.text}">本页导出时已使用兜底画面</text>
  <text x="104" y="178" font-size="${typography.bodySize}" font-family="${typography.bodyFamily}" fill="${colors.muted}">${escapeXmlText(title)}</text>
  <text x="104" y="${spec.canvas.height - 104}" font-size="${typography.annotationSize}" font-family="${typography.bodyFamily}" fill="${colors.muted}">${escapeXmlText(reason).slice(0, 120)}</text>
</svg>`;
}

function parseAttributes(source: string): SvgAttrs {
  const attrs: SvgAttrs = {};
  const attrPattern = /([:\w.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(source)) !== null) {
    attrs[match[1]] = match[3] ?? match[4] ?? '';
  }
  return attrs;
}

function parseStyle(value = ''): SvgStyle {
  const style: SvgStyle = {};
  for (const pair of value.split(';')) {
    const [key, raw] = pair.split(':');
    if (!key || raw === undefined) continue;
    style[key.trim()] = raw.trim();
  }
  return style;
}

function mergeStyle(parent: SvgStyle, attrs: SvgAttrs): SvgStyle {
  const direct = parseStyle(attrs.style);
  const result = { ...parent, ...direct };
  for (const key of [
    'fill',
    'fill-opacity',
    'stroke',
    'stroke-width',
    'stroke-opacity',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'text-anchor',
    'opacity',
  ]) {
    if (attrs[key] !== undefined) result[key] = attrs[key];
  }
  return result;
}

function numberAttr(attrs: SvgAttrs, name: string, fallback = 0): number {
  const value = attrs[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseFloat(String(value).replace(/px$/i, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanColor(value?: string): string | undefined {
  if (!value || value === 'none' || value.startsWith('url(')) return undefined;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return trimmed.slice(1).split('').map((char) => `${char}${char}`).join('').toUpperCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.slice(1).toUpperCase();
  const rgb = trimmed.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (rgb) {
    return rgb.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return undefined;
}

function opacityToTransparency(value?: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.min(100, Math.round((1 - parsed) * 100)));
}

function buildFill(style: SvgStyle) {
  const color = cleanColor(style.fill);
  if (!color) return { color: 'FFFFFF', transparency: 100 };
  const transparency = opacityToTransparency(style['fill-opacity'] || style.opacity);
  return transparency === undefined ? { color } : { color, transparency };
}

function buildLine(style: SvgStyle, scale = 1) {
  const color = cleanColor(style.stroke);
  if (!color) return { color: 'FFFFFF', transparency: 100 };
  const width = Number.parseFloat(style['stroke-width'] || '1');
  const transparency = opacityToTransparency(style['stroke-opacity'] || style.opacity);
  return {
    color,
    width: Number.isFinite(width) ? Math.max(0.25, width * scale * 0.75) : 0.75,
    ...(transparency === undefined ? {} : { transparency }),
  };
}

function parseTransform(value = '') {
  let dx = 0;
  let dy = 0;
  let sx = 1;
  let sy = 1;
  const translate = value.match(/translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/i);
  if (translate) {
    dx += Number.parseFloat(translate[1]) || 0;
    dy += Number.parseFloat(translate[2] || '0') || 0;
  }
  const scale = value.match(/scale\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/i);
  if (scale) {
    sx *= Number.parseFloat(scale[1]) || 1;
    sy *= Number.parseFloat(scale[2] || scale[1]) || 1;
  }
  return { dx, dy, sx, sy };
}

function childContext(parent: SvgContext, attrs: SvgAttrs): SvgContext {
  const transform = parseTransform(attrs.transform);
  return {
    dx: parent.dx + transform.dx * parent.sx,
    dy: parent.dy + transform.dy * parent.sy,
    sx: parent.sx * transform.sx,
    sy: parent.sy * transform.sy,
    style: mergeStyle(parent.style, attrs),
  };
}

function pxX(ctx: NativeContext, scope: SvgContext, value: number) {
  return (scope.dx + value * scope.sx) * ctx.scaleX;
}

function pxY(ctx: NativeContext, scope: SvgContext, value: number) {
  return (scope.dy + value * scope.sy) * ctx.scaleY;
}

function pxW(ctx: NativeContext, scope: SvgContext, value: number) {
  return Math.abs(value * scope.sx * ctx.scaleX);
}

function pxH(ctx: NativeContext, scope: SvgContext, value: number) {
  return Math.abs(value * scope.sy * ctx.scaleY);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
}

function localTag(tag: string) {
  return tag.includes(':') ? tag.split(':').pop() || tag : tag;
}

function addNativeLine(ctx: NativeContext, style: SvgStyle, x1: number, y1: number, x2: number, y2: number) {
  if (![x1, y1, x2, y2].every(Number.isFinite)) return;
  const box = safeBox(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  if (!box) return;
  ctx.slide.addShape(ctx.pptx.ShapeType.line, {
    ...box,
    flipH: x1 > x2,
    flipV: y1 > y2,
    line: buildLine(style, Math.max(ctx.scaleX, ctx.scaleY)),
  });
  ctx.converted += 1;
}

function addRect(ctx: NativeContext, scope: SvgContext, attrs: SvgAttrs) {
  const x = numberAttr(attrs, 'x');
  const y = numberAttr(attrs, 'y');
  const w = numberAttr(attrs, 'width');
  const h = numberAttr(attrs, 'height');
  if (w <= 0 || h <= 0) return;
  const style = mergeStyle(scope.style, attrs);
  const rx = numberAttr(attrs, 'rx');
  const box = safeBox(pxX(ctx, scope, x), pxY(ctx, scope, y), pxW(ctx, scope, w), pxH(ctx, scope, h));
  if (!box) return;
  ctx.slide.addShape(rx > 0 ? ctx.pptx.ShapeType.roundRect : ctx.pptx.ShapeType.rect, {
    ...box,
    fill: buildFill(style),
    line: buildLine(style, Math.max(ctx.scaleX, ctx.scaleY)),
  });
  ctx.converted += 1;
}

function addEllipse(ctx: NativeContext, scope: SvgContext, attrs: SvgAttrs, isCircle: boolean) {
  const style = mergeStyle(scope.style, attrs);
  const cx = numberAttr(attrs, 'cx');
  const cy = numberAttr(attrs, 'cy');
  const rx = isCircle ? numberAttr(attrs, 'r') : numberAttr(attrs, 'rx');
  const ry = isCircle ? numberAttr(attrs, 'r') : numberAttr(attrs, 'ry');
  if (rx <= 0 || ry <= 0) return;
  const box = safeBox(pxX(ctx, scope, cx - rx), pxY(ctx, scope, cy - ry), pxW(ctx, scope, rx * 2), pxH(ctx, scope, ry * 2));
  if (!box) return;
  ctx.slide.addShape(ctx.pptx.ShapeType.ellipse, {
    ...box,
    fill: buildFill(style),
    line: buildLine(style, Math.max(ctx.scaleX, ctx.scaleY)),
  });
  ctx.converted += 1;
}

function addLine(ctx: NativeContext, scope: SvgContext, attrs: SvgAttrs) {
  const style = mergeStyle(scope.style, attrs);
  const x1 = pxX(ctx, scope, numberAttr(attrs, 'x1'));
  const y1 = pxY(ctx, scope, numberAttr(attrs, 'y1'));
  const x2 = pxX(ctx, scope, numberAttr(attrs, 'x2'));
  const y2 = pxY(ctx, scope, numberAttr(attrs, 'y2'));
  addNativeLine(ctx, style, x1, y1, x2, y2);
}

function textLinesFromContent(content: string, baseAttrs: SvgAttrs) {
  const tspanPattern = /<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/gi;
  const lines: Array<{ text: string; attrs: SvgAttrs }> = [];
  let match: RegExpExecArray | null;
  while ((match = tspanPattern.exec(content)) !== null) {
    const text = stripTags(match[2]);
    if (text) lines.push({ text, attrs: { ...baseAttrs, ...parseAttributes(match[1]) } });
  }
  if (lines.length) return lines;
  const text = stripTags(content);
  return text ? [{ text, attrs: baseAttrs }] : [];
}

function addText(ctx: NativeContext, scope: SvgContext, attrs: SvgAttrs, content: string) {
  const lines = textLinesFromContent(content, attrs);
  for (const line of lines) {
    const style = mergeStyle(scope.style, line.attrs);
    const x = numberAttr(line.attrs, 'x', numberAttr(attrs, 'x'));
    const y = numberAttr(line.attrs, 'y', numberAttr(attrs, 'y'));
    const fontSizePx = Number.parseFloat(style['font-size'] || attrs['font-size'] || '18') || 18;
    const fontSize = Math.max(4, fontSizePx * 0.75);
    const fill = cleanColor(style.fill) || cleanColor(style.stroke) || '111827';
    const fontFace = (style['font-family'] || 'Microsoft YaHei, Arial, sans-serif')
      .split(',')[0]
      .replace(/^['"]|['"]$/g, '')
      .trim();
    const anchor = style['text-anchor'];
    const textW = Math.max(0.2, Math.min(ctx.slideW - pxX(ctx, scope, x), line.text.length * fontSize * 0.08 + 0.25));
    const lineH = Math.max(0.18, fontSize * 0.018 + 0.08);
    const drawX = anchor === 'middle' ? pxX(ctx, scope, x) - textW / 2 : anchor === 'end' ? pxX(ctx, scope, x) - textW : pxX(ctx, scope, x);
    const box = safeBox(Math.max(0, drawX), Math.max(0, pxY(ctx, scope, y) - lineH * 0.8), Math.max(0.2, textW), lineH);
    if (!box) continue;
    ctx.slide.addText(line.text, {
      ...box,
      margin: 0,
      breakLine: false,
      fit: 'shrink',
      color: fill,
      fontFace: fontFace || 'Microsoft YaHei',
      fontSize,
      bold: /^(bold|[6-9]00)$/i.test(style['font-weight'] || ''),
      italic: /^italic$/i.test(style['font-style'] || ''),
      align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left',
      valign: 'mid',
    });
    ctx.converted += 1;
  }
}

function addImage(ctx: NativeContext, scope: SvgContext, attrs: SvgAttrs) {
  const href = attrs.href || attrs['xlink:href'];
  if (!href || !href.startsWith('data:image/')) return;
  const x = numberAttr(attrs, 'x');
  const y = numberAttr(attrs, 'y');
  const w = numberAttr(attrs, 'width');
  const h = numberAttr(attrs, 'height');
  if (w <= 0 || h <= 0) return;
  const box = safeBox(pxX(ctx, scope, x), pxY(ctx, scope, y), pxW(ctx, scope, w), pxH(ctx, scope, h));
  if (!box) return;
  ctx.slide.addImage({
    data: href,
    ...box,
  });
  ctx.converted += 1;
}

function tessellatePathToLines(d: string): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const commands = Array.from(d.matchAll(/([MLCQSAZmlcqsaZ])[\s,]*([-\d.e+-]*)/gi));

  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let prevCmd = '';

  for (const match of commands) {
    const cmd = match[1];
    const argsStr = match[2] || '';

    if (cmd === 'M' || cmd === 'm') {
      const nums = parsePathNumbers(argsStr);
      if (nums.length >= 2) {
        if (cmd === 'M') { cx = nums[0]; cy = nums[1]; }
        else { cx += nums[0]; cy += nums[1]; }
        sx = cx; sy = cy;
      }
      prevCmd = cmd;
      continue;
    }

    if (cmd === 'L' || cmd === 'l') {
      const nums = parsePathNumbers(argsStr);
      if (nums.length >= 2) {
        const nx = cmd === 'L' ? nums[0] : cx + nums[0];
        const ny = cmd === 'L' ? nums[1] : cy + nums[1];
        lines.push({ x1: cx, y1: cy, x2: nx, y2: ny });
        cx = nx; cy = ny;
      }
      prevCmd = cmd;
      continue;
    }

    if (cmd === 'H' || cmd === 'h') {
      const nums = parsePathNumbers(argsStr);
      if (nums.length >= 1) {
        const nx = cmd === 'H' ? nums[0] : cx + nums[0];
        lines.push({ x1: cx, y1: cy, x2: nx, y2: cy });
        cx = nx;
      }
      prevCmd = cmd;
      continue;
    }

    if (cmd === 'V' || cmd === 'v') {
      const nums = parsePathNumbers(argsStr);
      if (nums.length >= 1) {
        const ny = cmd === 'V' ? nums[0] : cy + nums[0];
        lines.push({ x1: cx, y1: cy, x2: cx, y2: ny });
        cy = ny;
      }
      prevCmd = cmd;
      continue;
    }

    if (cmd === 'C' || cmd === 'c') {
      const nums = parsePathNumbers(argsStr);
      if (nums.length >= 6) {
        const x1 = cmd === 'C' ? nums[0] : cx + nums[0];
        const y1 = cmd === 'C' ? nums[1] : cy + nums[1];
        const x2 = cmd === 'C' ? nums[2] : cx + nums[2];
        const y2 = cmd === 'C' ? nums[3] : cy + nums[3];
        const x3 = cmd === 'C' ? nums[4] : cx + nums[4];
        const y3 = cmd === 'C' ? nums[5] : cy + nums[5];
        const steps = 8;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const mt = 1 - t;
          const px = mt * mt * mt * cx + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3;
          const py = mt * mt * mt * cy + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3;
          const prevT = (i - 1) / steps;
          const pmt = 1 - prevT;
          const ppx = pmt * pmt * pmt * cx + 3 * pmt * pmt * prevT * x1 + 3 * pmt * prevT * prevT * x2 + prevT * prevT * prevT * x3;
          const ppy = pmt * pmt * pmt * cy + 3 * pmt * pmt * prevT * y1 + 3 * pmt * prevT * prevT * y2 + prevT * prevT * prevT * y3;
          lines.push({ x1: ppx, y1: ppy, x2: px, y2: py });
        }
        cx = x3; cy = y3;
      }
      prevCmd = cmd;
      continue;
    }

    if (cmd === 'Q' || cmd === 'q') {
      const nums = parsePathNumbers(argsStr);
      if (nums.length >= 4) {
        const x1 = cmd === 'Q' ? nums[0] : cx + nums[0];
        const y1 = cmd === 'Q' ? nums[1] : cy + nums[1];
        const x2 = cmd === 'Q' ? nums[2] : cx + nums[2];
        const y2 = cmd === 'Q' ? nums[3] : cy + nums[3];
        const steps = 6;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const mt = 1 - t;
          const px = mt * mt * cx + 2 * mt * t * x1 + t * t * x2;
          const py = mt * mt * cy + 2 * mt * t * y1 + t * t * y2;
          const prevT = (i - 1) / steps;
          const pmt = 1 - prevT;
          const ppx = pmt * pmt * cx + 2 * pmt * prevT * x1 + prevT * prevT * x2;
          const ppy = pmt * pmt * cy + 2 * pmt * prevT * y1 + prevT * prevT * y2;
          lines.push({ x1: ppx, y1: ppy, x2: px, y2: py });
        }
        cx = x2; cy = y2;
      }
      prevCmd = cmd;
      continue;
    }

    if (cmd === 'A' || cmd === 'a') {
      const nums = parsePathNumbers(argsStr);
      if (nums.length >= 7) {
        const rx = Math.abs(nums[0]);
        const ry = Math.abs(nums[1]);
        const xAxisRotation = nums[2];
        const largeArcFlag = nums[3];
        const sweepFlag = nums[4];
        const ex = cmd === 'A' ? nums[5] : cx + nums[5];
        const ey = cmd === 'A' ? nums[6] : cy + nums[6];
        const steps = 10;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const prevT = (i - 1) / steps;
          const p1 = arcPoint(cx, cy, rx, ry, xAxisRotation, largeArcFlag, sweepFlag, ex, ey, prevT);
          const p2 = arcPoint(cx, cy, rx, ry, xAxisRotation, largeArcFlag, sweepFlag, ex, ey, t);
          lines.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
        }
        cx = ex; cy = ey;
      }
      prevCmd = cmd;
      continue;
    }

    if (cmd === 'Z' || cmd === 'z') {
      lines.push({ x1: cx, y1: cy, x2: sx, y2: sy });
      cx = sx; cy = sy;
      prevCmd = cmd;
      continue;
    }

    if (cmd === 'S' || cmd === 's') {
      const nums = parsePathNumbers(argsStr);
      if (nums.length >= 4) {
        const x2 = cmd === 'S' ? nums[0] : cx + nums[0];
        const y2 = cmd === 'S' ? nums[1] : cy + nums[1];
        const x3 = cmd === 'S' ? nums[2] : cx + nums[2];
        const y3 = cmd === 'S' ? nums[3] : cy + nums[3];
        let x1 = x2;
        let y1 = y2;
        if (prevCmd === 'C' || prevCmd === 'c' || prevCmd === 'S' || prevCmd === 's') {
          x1 = 2 * cx - x2;
          y1 = 2 * cy - y2;
        }
        const steps = 8;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const mt = 1 - t;
          const px = mt * mt * mt * cx + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3;
          const py = mt * mt * mt * cy + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3;
          const prevT = (i - 1) / steps;
          const pmt = 1 - prevT;
          const ppx = pmt * pmt * pmt * cx + 3 * pmt * pmt * prevT * x1 + 3 * pmt * prevT * prevT * x2 + prevT * prevT * prevT * x3;
          const ppy = pmt * pmt * pmt * cy + 3 * pmt * pmt * prevT * y1 + 3 * pmt * prevT * prevT * y2 + prevT * prevT * prevT * y3;
          lines.push({ x1: ppx, y1: ppy, x2: px, y2: py });
        }
        cx = x3; cy = y3;
      }
      prevCmd = cmd;
      continue;
    }

    if (cmd === 'T' || cmd === 't') {
      const nums = parsePathNumbers(argsStr);
      if (nums.length >= 2) {
        const ex = cmd === 'T' ? nums[0] : cx + nums[0];
        const ey = cmd === 'T' ? nums[1] : cy + nums[1];
        let qx = ex;
        let qy = ey;
        if (prevCmd === 'Q' || prevCmd === 'q' || prevCmd === 'T' || prevCmd === 't') {
          qx = 2 * cx - ex;
          qy = 2 * cy - ey;
        }
        const steps = 6;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const mt = 1 - t;
          const px = mt * mt * cx + 2 * mt * t * qx + t * t * ex;
          const py = mt * mt * cy + 2 * mt * t * qy + t * t * ey;
          const prevT = (i - 1) / steps;
          const pmt = 1 - prevT;
          const ppx = pmt * pmt * cx + 2 * pmt * prevT * qx + prevT * prevT * ex;
          const ppy = pmt * pmt * cy + 2 * pmt * prevT * qy + prevT * prevT * ey;
          lines.push({ x1: ppx, y1: ppy, x2: px, y2: py });
        }
        cx = ex; cy = ey;
      }
      prevCmd = cmd;
      continue;
    }

    prevCmd = cmd;
  }

  return lines;
}

function parsePathNumbers(value: string): number[] {
  return Array.from(value.matchAll(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)).map(m => Number.parseFloat(m[0])).filter(Number.isFinite);
}

function arcPoint(cx: number, cy: number, rx: number, ry: number, rotation: number, largeArc: number, sweep: number, ex: number, ey: number, t: number): { x: number; y: number } {
  if (rx === 0 || ry === 0) return { x: cx + (ex - cx) * t, y: cy + (ey - cy) * t };
  const phi = rotation * Math.PI / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (cx - ex) / 2;
  const dy2 = (cy - ey) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;
  let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const sqrtLambda = Math.sqrt(lambda);
    rx *= sqrtLambda;
    ry *= sqrtLambda;
  }
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;
  let c = Math.sqrt(Math.max(0, (rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2) / (rx2 * y1p2 + ry2 * x1p2)));
  if (largeArc === sweep) c = -c;
  const cxp = c * rx * y1p / ry;
  const cyp = -c * ry * x1p / rx;
  const theta1 = vectorAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  const dTheta = vectorAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  let thetaEnd = theta1 + dTheta * t;
  if (!sweep && dTheta > 0) thetaEnd = theta1 - (2 * Math.PI - dTheta) * t;
  if (sweep && dTheta < 0) thetaEnd = theta1 + (2 * Math.PI + dTheta) * t;
  const cosT = Math.cos(thetaEnd);
  const sinT = Math.sin(thetaEnd);
  const px = cosPhi * rx * cosT - sinPhi * ry * sinT + (cx + ex) / 2;
  const py = sinPhi * rx * cosT + cosPhi * ry * sinT + (cy + ey) / 2;
  return { x: px, y: py };
}

function vectorAngle(ux: number, uy: number, vx: number, vy: number): number {
  const dot = ux * vx + uy * vy;
  const cross = ux * vy - uy * vx;
  return Math.atan2(cross, dot);
}

function addSimplePathLines(ctx: NativeContext, scope: SvgContext, attrs: SvgAttrs) {
  const d = attrs.d || '';
  if (!d) return;
  const style = mergeStyle(scope.style, attrs);
  const fill = cleanColor(style.fill);
  if (fill && fill !== 'FFFFFF') {
    addPathAsPolygon(ctx, scope, attrs, style);
    return;
  }
  const pathLines = tessellatePathToLines(d);
  if (!pathLines.length) return;
  for (const line of pathLines) {
    const x1 = pxX(ctx, scope, line.x1);
    const y1 = pxY(ctx, scope, line.y1);
    const x2 = pxX(ctx, scope, line.x2);
    const y2 = pxY(ctx, scope, line.y2);
    addNativeLine(ctx, style, x1, y1, x2, y2);
  }
}

function addPathAsPolygon(ctx: NativeContext, scope: SvgContext, attrs: SvgAttrs, style: SvgStyle) {
  const d = attrs.d || '';
  const pathLines = tessellatePathToLines(d);
  for (const line of pathLines) {
    const x1 = pxX(ctx, scope, line.x1);
    const y1 = pxY(ctx, scope, line.y1);
    const x2 = pxX(ctx, scope, line.x2);
    const y2 = pxY(ctx, scope, line.y2);
    addNativeLine(ctx, style, x1, y1, x2, y2);
  }
}

function addPolygonLines(ctx: NativeContext, scope: SvgContext, attrs: SvgAttrs, close: boolean) {
  const points = (attrs.points || '')
    .trim()
    .split(/\s+/)
    .map((point) => point.split(',').map(Number.parseFloat))
    .filter((point) => point.length === 2 && point.every(Number.isFinite));
  if (points.length < 2) return;
  const style = mergeStyle(scope.style, attrs);
  const total = close ? points.length : points.length - 1;
  for (let i = 0; i < total; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const x1 = pxX(ctx, scope, a[0]);
    const y1 = pxY(ctx, scope, a[1]);
    const x2 = pxX(ctx, scope, b[0]);
    const y2 = pxY(ctx, scope, b[1]);
    addNativeLine(ctx, style, x1, y1, x2, y2);
  }
}

function convertSvgToNativeSlide(ctx: NativeContext, svg: string) {
  const source = withCanvasAttributes(extractSvgFragment(svg), {
    projectInfo: { title: '', topic: '', audience: '', occasion: '' },
    canvas: { format: 'ppt169', width: ctx.slideW / ctx.scaleX, height: ctx.slideH / ctx.scaleY },
    visualTheme: { mode: 'versatile', style: '', colors: { primary: '', secondary: '', accent: '', background: '', surface: '', text: '', muted: '', border: '' } },
    typography: { fontFamily: '', titleFamily: '', bodyFamily: '', emphasisFamily: '', codeFamily: '', bodySize: 0, titleSize: 0, subtitleSize: 0, annotationSize: 0 },
    iconStyle: 'none',
    imageUsage: 'none',
    outline: [],
    skillExtensions: [],
  });
  const tokenPattern = /<text\b([^>]*)>([\s\S]*?)<\/text>|<([^!?/\s>]+)\b([^>]*)\/?>|<\/([^>\s]+)>/gi;
  const stack: SvgContext[] = [{ dx: 0, dy: 0, sx: 1, sy: 1, style: {} }];
  let match: RegExpExecArray | null;
  let skipDepth = 0;

  while ((match = tokenPattern.exec(source)) !== null) {
    const closingTag = match[5] ? localTag(match[5]).toLowerCase() : '';
    if (skipDepth > 0) {
      if (match[3]) {
        const skippedOpenTag = localTag(match[3]).toLowerCase();
        const skippedAttrs = match[4] || '';
        const isSelfClosing = /\/\s*$/.test(skippedAttrs) || /\/\s*>$/.test(match[0]);
        if (['defs', 'style', 'title', 'desc', 'metadata', 'clipPath', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'filter'].includes(skippedOpenTag) && !isSelfClosing) {
          skipDepth += 1;
        }
      } else if (closingTag) {
        skipDepth -= 1;
      }
      continue;
    }

    if (match[1] !== undefined) {
      try {
        addText(ctx, stack[stack.length - 1], parseAttributes(match[1]), match[2] || '');
      } catch {
        // Ignore one broken SVG text node; the rest of the slide can still export.
      }
      continue;
    }

    if (closingTag === 'g' || closingTag === 'svg') {
      if (stack.length > 1) stack.pop();
      continue;
    }

    const rawTag = match[3];
    if (!rawTag) continue;
    const tag = localTag(rawTag).toLowerCase();
    const attrs = parseAttributes(match[4] || '');
    const scope = stack[stack.length - 1];

    const isSelfClosing = /\/\s*$/.test(match[4] || '') || /\/\s*>$/.test(match[0]);
    if (tag === 'svg' || tag === 'g') {
      if (isSelfClosing) continue;
      stack.push(childContext(scope, attrs));
      continue;
    }

    if (['defs', 'style', 'title', 'desc', 'metadata', 'clipPath', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'filter'].includes(tag)) {
      if (!isSelfClosing) skipDepth = 1;
      continue;
    }

    try {
      if (tag === 'rect') addRect(ctx, scope, attrs);
      else if (tag === 'circle') addEllipse(ctx, scope, attrs, true);
      else if (tag === 'ellipse') addEllipse(ctx, scope, attrs, false);
      else if (tag === 'line') addLine(ctx, scope, attrs);
      else if (tag === 'image') addImage(ctx, scope, attrs);
      else if (tag === 'path') addSimplePathLines(ctx, scope, attrs);
      else if (tag === 'polyline') addPolygonLines(ctx, scope, attrs, false);
      else if (tag === 'polygon') addPolygonLines(ctx, scope, attrs, true);
    } catch {
      // Keep the PPTX package valid even when an individual SVG node is unsupported.
    }
  }
}

async function renderSvgToPngBufferWithRepair(svg: string, width: number, spec: DesignSpec, pageNumber: number): Promise<Buffer> {
  try {
    return await renderSvgToPngBuffer(svg, width, spec);
  } catch (firstError) {
    const repairedSvg = withCanvasAttributes(sanitizeSvgForResvg(svg), spec);
    try {
      return await renderSvgToPngBuffer(repairedSvg, width, spec);
    } catch (secondError) {
      const reason = secondError instanceof Error
        ? secondError.message
        : firstError instanceof Error
          ? firstError.message
          : 'SVG 解析失败';
      const fallbackSvg = buildExportFallbackSvg(spec, pageNumber, reason);
      return renderSvgToPngBuffer(fallbackSvg, width, spec);
    }
  }
}

export async function renderSvgToPngBuffer(svg: string, width: number, spec?: DesignSpec): Promise<Buffer> {
  let processedSvg = await inlineRemoteImages(svg);
  processedSvg = sanitizeSvgForResvg(processedSvg);
  if (spec) {
    processedSvg = withCanvasAttributes(processedSvg, spec);
  }
  if (!processedSvg) {
    throw new Error('SVG 内容为空');
  }

  const renderCacheKey = `${width}:${spec?.canvas.width || 0}x${spec?.canvas.height || 0}:${hashText(processedSvg)}`;
  const cachedPng = pngRenderCache.get(renderCacheKey);
  if (cachedPng) {
    return Buffer.from(cachedPng);
  }

  const resvg = new Resvg(processedSvg, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles: [], defaultFontFamily: 'sans-serif' },
  });

  const pngBuffer = Buffer.from(resvg.render().asPng());
  rememberCacheValue(pngRenderCache, renderCacheKey, pngBuffer);
  return Buffer.from(pngBuffer);
}

export async function convertSvgPagesToPptx(
  svgPages: Array<{ svg: string; speakerNotes: string }>,
  spec: DesignSpec,
  _lock: SpecLock = buildSpecLock(spec),
): Promise<Buffer> {
  const pptx = new PptxGen();
  const slideH = 7.5;
  const slideW = Number(((spec.canvas.width / spec.canvas.height) * slideH).toFixed(3));
  const layoutName = `SVG_${spec.canvas.width}x${spec.canvas.height}`;

  pptx.defineLayout({ name: layoutName, width: slideW, height: slideH });
  pptx.layout = layoutName;
  pptx.author = 'Nexious PPT Agent';
  pptx.subject = spec.projectInfo.topic || spec.projectInfo.title || 'Nexious PPT';
  pptx.title = spec.projectInfo.title || 'Nexious PPT';
  pptx.company = 'Nexious';
  pptx.theme = {
    headFontFace: 'Microsoft YaHei',
    bodyFontFace: 'Microsoft YaHei',
  };

  for (const [index, page] of svgPages.entries()) {
    const slide = pptx.addSlide();
    const pngBuffer = await renderSvgToPngBufferWithRepair(page.svg, spec.canvas.width * 2, spec, index + 1);
    slide.addImage({
      data: `data:image/png;base64,${pngBuffer.toString('base64')}`,
      x: 0,
      y: 0,
      w: slideW,
      h: slideH,
    });

    if (page.speakerNotes) {
      slide.addNotes(page.speakerNotes);
    }
  }

  const output = await pptx.write({ outputType: 'nodebuffer' });
  const buffer = Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
  return repairPptxPackage(buffer);
}

export async function repairPptxPackage(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const contentTypes = zip.file('[Content_Types].xml');
  if (!contentTypes) return buffer;

  const originalXml = await contentTypes.async('string');
  const repairedXml = originalXml.replace(
    /<Override\s+PartName="([^"]+)"\s+ContentType="[^"]+"\s*\/>/g,
    (entry, partName: string) => {
      const zipPath = partName.replace(/^\/+/, '');
      return zip.file(zipPath) ? entry : '';
    },
  );

  if (repairedXml === originalXml) return buffer;

  zip.file('[Content_Types].xml', repairedXml);
  const repaired = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  return Buffer.from(repaired);
}

export { inlineRemoteImages, sanitizeSvgForResvg };
