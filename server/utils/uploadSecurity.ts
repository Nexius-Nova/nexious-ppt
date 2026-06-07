import path from 'path';

export type SafeUploadKind = 'image' | 'pptx' | 'zip';

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/svg+xml';

export const IMAGE_MIME_EXT: Record<ImageMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

const PNG_MAGIC = '89504e470d0a1a0a';
const ZIP_MAGIC = '504b0304';

export function stripDataUrl(value: string) {
  const commaIndex = value.indexOf(',');
  return commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
}

export function decodeBase64Upload(value: string, label = '上传文件') {
  const raw = stripDataUrl(String(value || '').trim());
  if (!raw || !/^[A-Za-z0-9+/=\r\n]+$/.test(raw)) {
    throw new Error(`${label}内容不是有效的 base64 数据`);
  }
  return Buffer.from(raw.replace(/\s+/g, ''), 'base64');
}

export function normalizeUploadExtension(filename: string) {
  return path.extname(String(filename || '').trim()).toLowerCase().replace(/^\./, '');
}

export function normalizeContentType(value: unknown) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

export function detectImageMime(buffer: Buffer): ImageMime | null {
  if (buffer.byteLength >= 8 && buffer.subarray(0, 8).toString('hex') === PNG_MAGIC) return 'image/png';
  if (
    buffer.byteLength >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) return 'image/jpeg';
  if (
    buffer.byteLength >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp';
  if (
    buffer.byteLength >= 6 &&
    (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a')
  ) return 'image/gif';

  const head = buffer.subarray(0, Math.min(buffer.byteLength, 512)).toString('utf8').trimStart().toLowerCase();
  if (/^<svg[\s>]/.test(head) || /^<\?xml[\s\S]{0,240}<svg[\s>]/.test(head)) return 'image/svg+xml';
  return null;
}

export function assertUploadSize(buffer: Buffer, maxBytes: number, label: string) {
  if (!buffer.length) throw new Error(`${label}为空`);
  if (buffer.byteLength > maxBytes) throw new Error(`${label}大小超过限制`);
}

export function assertImageUploadSafe(
  buffer: Buffer,
  options: {
    label?: string;
    maxBytes: number;
    declaredMime?: string;
    filename?: string;
    allowSvg?: boolean;
  }
): { mimeType: ImageMime; extension: string } {
  const label = options.label || '图片';
  assertUploadSize(buffer, options.maxBytes, label);

  const detectedMime = detectImageMime(buffer);
  if (!detectedMime) throw new Error(`${label}内容不是受支持的图片格式`);
  if (detectedMime === 'image/svg+xml' && !options.allowSvg) {
    throw new Error(`${label}不支持 SVG 格式`);
  }

  const declaredMime = normalizeContentType(options.declaredMime);
  if (declaredMime && declaredMime !== detectedMime) {
    const jpegAlias = declaredMime === 'image/jpg' && detectedMime === 'image/jpeg';
    if (!jpegAlias) throw new Error(`${label}声明类型与实际内容不一致`);
  }

  const extension = normalizeUploadExtension(options.filename || '');
  if (extension) {
    const allowed = detectedMime === 'image/jpeg'
      ? ['jpg', 'jpeg']
      : [IMAGE_MIME_EXT[detectedMime]];
    if (!allowed.includes(extension)) throw new Error(`${label}扩展名与实际内容不一致`);
  }

  return { mimeType: detectedMime, extension: IMAGE_MIME_EXT[detectedMime] };
}

export function isZipLike(buffer: Buffer) {
  return buffer.byteLength >= 4 && buffer.subarray(0, 4).toString('hex') === ZIP_MAGIC;
}

export function assertZipUploadSafe(
  buffer: Buffer,
  options: { label?: string; maxBytes: number; filename?: string; extensions: string[] }
) {
  const label = options.label || '压缩包';
  assertUploadSize(buffer, options.maxBytes, label);

  const extension = normalizeUploadExtension(options.filename || '');
  if (extension && !options.extensions.includes(extension)) {
    throw new Error(`${label}扩展名不受支持`);
  }
  if (!isZipLike(buffer)) throw new Error(`${label}内容不是有效的 zip 格式`);
}
