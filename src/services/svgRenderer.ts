const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function fetchImageAsDataUrl(imageUrl: string): Promise<string | null> {
  try {
    const proxyUrl = `${API_BASE_URL}/api/ai/proxy-image?url=${encodeURIComponent(imageUrl)}`;
    const resp = await fetch(proxyUrl);
    if (!resp.ok) {
      console.warn(`[svgRenderer] proxy-image failed for ${imageUrl}: ${resp.status}`);
      return null;
    }
    const blob = await resp.blob();
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => {
        console.warn(`[svgRenderer] FileReader error for ${imageUrl}`);
        resolve('');
      };
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn(`[svgRenderer] fetchImageAsDataUrl error for ${imageUrl}:`, err);
    return null;
  }
}

async function inlineRemoteImages(svg: string): Promise<string> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, 'image/svg+xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    console.warn('[svgRenderer] SVG parse error, falling back to regex');
    return inlineRemoteImagesRegex(svg);
  }

  const images = doc.querySelectorAll('image');
  if (images.length === 0) return svg;

  const hrefsToFetch: Map<string, string> = new Map();

  images.forEach((img) => {
    const href =
      img.getAttribute('href') ||
      img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
      '';
    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      if (!hrefsToFetch.has(href)) {
        hrefsToFetch.set(href, '');
      }
    }
  });

  if (hrefsToFetch.size === 0) return svg;

  console.log(`[svgRenderer] Found ${hrefsToFetch.size} remote image(s) to inline`);

  await Promise.all(
    Array.from(hrefsToFetch.keys()).map(async (href) => {
      const dataUrl = await fetchImageAsDataUrl(href);
      if (dataUrl) {
        hrefsToFetch.set(href, dataUrl);
      }
    })
  );

  images.forEach((img) => {
    const href =
      img.getAttribute('href') ||
      img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
      '';
    if (href && hrefsToFetch.has(href)) {
      const dataUrl = hrefsToFetch.get(href);
      if (dataUrl) {
        if (img.hasAttribute('href')) {
          img.setAttribute('href', dataUrl);
        }
        const xlinkHref = img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (xlinkHref) {
          img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', dataUrl);
        }
      }
    }
  });

  const serializer = new XMLSerializer();
  let result = serializer.serializeToString(doc);

  if (!result.includes('xmlns=') && !result.includes('xmlns ="')) {
    result = result.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!result.includes('xmlns:xlink')) {
    result = result.replace('<svg', '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }

  return result;
}

async function inlineRemoteImagesRegex(svg: string): Promise<string> {
  const imgRegex = /<image\s+[^>]*?(?:href|xlink:href)\s*=\s*"([^"]*)"[^>]*?\/?>/gi;
  const httpUrls: string[] = [];
  let m;

  while ((m = imgRegex.exec(svg)) !== null) {
    const href = m[1];
    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      httpUrls.push(href);
    }
  }

  if (httpUrls.length === 0) return svg;

  const uniqueUrls = [...new Set(httpUrls)];
  console.log(`[svgRenderer] Regex fallback: found ${uniqueUrls.length} remote image(s)`);

  const urlToDataUrl = new Map<string, string>();

  await Promise.all(
    uniqueUrls.map(async (url) => {
      const dataUrl = await fetchImageAsDataUrl(url);
      if (dataUrl) {
        urlToDataUrl.set(url, dataUrl);
      }
    })
  );

  let result = svg;
  for (const [original, dataUrl] of urlToDataUrl) {
    result = result.split(original).join(dataUrl);
  }

  return result;
}

function svgToDataUrl(svgString: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
}

export async function renderSvgToPng(svgString: string, width: number, height: number): Promise<Blob> {
  const inlined = await inlineRemoteImages(svgString);

  const dataUrl = svgToDataUrl(inlined);

  const img = new Image();

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('SVG 加载失败'));
    img.src = dataUrl;
  });

  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 不可用');
  }

  ctx.scale(dpr, dpr);
  ctx.drawImage(img, 0, 0, width, height);

  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('PNG 导出失败'));
        },
        'image/png',
        1.0
      );
    });
    return blob;
  } catch (e) {
    console.warn('[svgRenderer] Canvas toBlob with data URL failed, trying Blob URL fallback');
    return renderSvgToPngViaBlobUrl(inlined, width, height);
  }
}

async function renderSvgToPngViaBlobUrl(svgString: string, width: number, height: number): Promise<Blob> {
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const img = new Image();

  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG 加载失败'));
      img.src = url;
    });

    const dpr = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 不可用');
    }

    ctx.scale(dpr, dpr);
    ctx.drawImage(img, 0, 0, width, height);

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('PNG 导出失败'));
        },
        'image/png',
        1.0
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function renderSvgToDataUrl(svgString: string, width: number, height: number): Promise<string> {
  const blob = await renderSvgToPng(svgString, width, height);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Data URL 转换失败'));
    reader.readAsDataURL(blob);
  });
}

export async function exportSvgPagesToPptx(
  pages: Array<{ svg: string; speakerNotes: string }>,
  canvasWidth: number,
  canvasHeight: number,
  title: string
): Promise<string> {
  void pages;
  void canvasWidth;
  void canvasHeight;
  void title;
  throw new Error('已禁用 SVG 整页图片版 PPTX 导出：请使用后端可编辑 PPTX 导出接口。');
}

async function exportSvgPagesToPptxLegacy(
  pages: Array<{ svg: string; speakerNotes: string }>,
  canvasWidth: number,
  canvasHeight: number,
  title: string
): Promise<string> {
  const { default: pptxgen } = await import('pptxgenjs');
  const pptx = new pptxgen();

  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Nexious PPT Agent';
  pptx.subject = title;
  pptx.title = title;
  pptx.company = 'Nexious';
  pptx.theme = {
    headFontFace: 'Microsoft YaHei',
    bodyFontFace: 'Microsoft YaHei',
  };

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const slide = pptx.addSlide();

    try {
      const dataUrl = await renderSvgToDataUrl(page.svg, canvasWidth, canvasHeight);
      slide.addImage({
        data: dataUrl,
        x: 0,
        y: 0,
        w: 13.333,
        h: 7.5,
        sizing: { type: 'cover', w: 13.333, h: 7.5 },
      });
    } catch {
      slide.background = { color: '0A0E14' };
      slide.addText(page.speakerNotes || `Page ${i + 1}`, {
        x: 1,
        y: 3,
        w: 11.333,
        h: 1.5,
        color: 'FFFFFF',
        fontSize: 24,
        align: 'center',
        fontFace: 'Microsoft YaHei',
      });
    }

    if (page.speakerNotes) {
      slide.addNotes(page.speakerNotes);
    }
  }

  const fileName = `nexious-deck-${Date.now()}.pptx`;
  await pptx.writeFile({ fileName });
  return fileName;
}
