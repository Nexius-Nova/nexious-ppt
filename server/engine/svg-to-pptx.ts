import type { DesignSpec } from './spec.js';
import { Resvg } from '@resvg/resvg-js';
import { buildSpecLock, type SpecLock } from './spec.js';
import { exportWithPptMaster } from './ppt-master-adapter.js';

async function inlineRemoteImages(svg: string): Promise<string> {
  const imgRegex = /<image\s([^>]*?)\/?\s*>/g;
  const matches: Array<{ full: string; href: string }> = [];
  let m;

  while ((m = imgRegex.exec(svg)) !== null) {
    const hrefMatch = m[0].match(/href\s*=\s*"([^"]*)"/) || m[0].match(/xlink:href\s*=\s*"([^"]*)"/);
    if (hrefMatch && hrefMatch[1] && hrefMatch[1].startsWith('http')) {
      matches.push({ full: m[0], href: hrefMatch[1] });
    }
  }

  let result = svg;
  for (const match of matches) {
    try {
      const resp = await fetch(match.href, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) continue;
      const contentType = resp.headers.get('content-type') || 'image/png';
      const buf = Buffer.from(await resp.arrayBuffer());
      const b64 = buf.toString('base64');
      const dataUrl = `data:${contentType};base64,${b64}`;
      result = result.replace(match.href, dataUrl);
    } catch {
      result = result.replace(match.full, '');
    }
  }

  return result;
}

function sanitizeSvgForResvg(svg: string): string {
  let result = svg;
  result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  result = result.replace(/\bclass\s*=\s*"[^"]*"/gi, '');
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
  return result;
}

export async function renderSvgToPngBuffer(svg: string, width: number): Promise<Buffer> {
  let processedSvg = await inlineRemoteImages(svg);
  processedSvg = sanitizeSvgForResvg(processedSvg);

  const resvg = new Resvg(processedSvg, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles: [], defaultFontFamily: 'sans-serif' },
  });

  return Buffer.from(resvg.render().asPng());
}

export async function convertSvgPagesToPptx(
  svgPages: Array<{ svg: string; speakerNotes: string }>,
  spec: DesignSpec,
  lock: SpecLock = buildSpecLock(spec),
): Promise<Buffer> {
  const result = await exportWithPptMaster(
    svgPages.map((page, index) => ({
      pageNumber: index + 1,
      svg: page.svg,
      speakerNotes: page.speakerNotes,
    })),
    spec,
    lock,
  );
  return result.buffer;
}

export { inlineRemoteImages, sanitizeSvgForResvg };
