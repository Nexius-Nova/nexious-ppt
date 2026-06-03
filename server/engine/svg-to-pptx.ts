import type { DesignSpec } from './spec.js';
import { Resvg } from '@resvg/resvg-js';
import { buildSpecLock, type SpecLock } from './spec.js';
import pptxgenModule from 'pptxgenjs';

const PptxGen = (pptxgenModule as any).default || pptxgenModule;

function escapeXmlText(value: unknown): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function inlineRemoteImages(svg: string): Promise<string> {
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/+$/, '');
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
      const fetchUrl = match.href.startsWith('/') ? `${publicBaseUrl}${match.href}` : match.href;
      const resp = await fetch(fetchUrl, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) continue;
      const contentType = resp.headers.get('content-type') || 'image/png';
      const buf = Buffer.from(await resp.arrayBuffer());
      const b64 = buf.toString('base64');
      const dataUrl = `data:${contentType};base64,${b64}`;
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

  const resvg = new Resvg(processedSvg, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles: [], defaultFontFamily: 'sans-serif' },
  });

  return Buffer.from(resvg.render().asPng());
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
  return Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
}

export { inlineRemoteImages, sanitizeSvgForResvg };
