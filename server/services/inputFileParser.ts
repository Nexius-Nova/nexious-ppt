import JSZip from 'jszip';
import { PDFParse } from 'pdf-parse';
import { resolveGenerationApiKey } from './modelSelection.js';
import { convertInputFileWithSourceToMarkdown } from './sourceToMarkdown.js';
import { decrypt } from '../utils/crypto.js';
import { buildOpenAIEndpoint, normalizeOpenAIBaseUrl } from '../utils/openaiUrl.js';
import {
  assertImageUploadSafe,
  assertUploadSize,
  decodeBase64Upload,
  isZipLike,
  normalizeContentType,
  normalizeUploadExtension,
} from '../utils/uploadSecurity.js';

export type InputFileKind = 'text' | 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'image' | 'unsupported';
export type InputFileParseStatus = 'parsed' | 'partial' | 'failed';

export interface ParsedInputFile {
  name: string;
  kind: InputFileKind;
  status: InputFileParseStatus;
  text: string;
  summary: string;
  mimeType: string;
  extension: string;
  warnings: string[];
  metadata: Record<string, unknown>;
}

interface ParseInputFileOptions {
  userId: number;
  filename: string;
  dataBase64: string;
  mimeType?: string;
  textModelId?: unknown;
}

const MAX_INPUT_FILE_BYTES = Number(process.env.INPUT_FILE_MAX_BYTES || 18 * 1024 * 1024);
const MAX_IMAGE_FILE_BYTES = Number(process.env.INPUT_IMAGE_MAX_BYTES || 6 * 1024 * 1024);
const MAX_PARSED_TEXT_CHARS = Number(process.env.INPUT_FILE_MAX_TEXT_CHARS || 160_000);
const MAX_VISION_IMAGE_BYTES = Number(process.env.INPUT_VISION_IMAGE_MAX_BYTES || 6 * 1024 * 1024);

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'csv', 'json', 'log', 'html', 'htm', 'xml']);
const LEGACY_OFFICE_EXTENSIONS = new Set(['doc', 'xls', 'ppt']);

const TEXT_PROVIDER_BASE_URLS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  baichuan: 'https://api.baichuan-ai.com/v1',
  minimax: 'https://api.minimax.chat/v1',
  yi: 'https://api.lingyiwanwu.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  perplexity: 'https://api.perplexity.ai',
};

function xmlDecode(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function compactText(value: string, maxLength = MAX_PARSED_TEXT_CHARS) {
  const normalized = value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}\n\n[文件内容较长，已截取前 ${maxLength} 字符]`
    : normalized;
}

function summarize(text: string, fallback: string) {
  const firstLines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join('；');
  return (firstLines || fallback).slice(0, 240);
}

function extractTagText(xml: string, tag: string) {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  return Array.from(xml.matchAll(pattern)).map((match) => xmlDecode(match[1]));
}

function extractParagraphs(xml: string, paragraphTag: string, textTag: string) {
  const pattern = new RegExp(`<${paragraphTag}\\b[^>]*>([\\s\\S]*?)<\\/${paragraphTag}>`, 'gi');
  return Array.from(xml.matchAll(pattern))
    .map((match) => extractTagText(match[1], textTag).join('').trim())
    .filter(Boolean);
}

function naturalPathSort(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

async function parseDocx(buffer: Buffer) {
  if (!isZipLike(buffer)) throw new Error('DOCX 文件内容不是有效的 Office Open XML 包。');
  const zip = await JSZip.loadAsync(buffer);
  const paths = [
    'word/document.xml',
    ...Object.keys(zip.files).filter((name) => /^word\/(?:header|footer)\d+\.xml$/i.test(name)).sort(naturalPathSort),
  ];
  const sections: string[] = [];
  for (const path of paths) {
    const xml = await zip.file(path)?.async('string').catch(() => '');
    if (!xml) continue;
    const paragraphs = extractParagraphs(xml, 'w:p', 'w:t');
    if (paragraphs.length) sections.push(paragraphs.join('\n'));
  }
  return {
    text: compactText(sections.join('\n\n')),
    metadata: { sections: sections.length },
  };
}

async function parsePptx(buffer: Buffer) {
  if (!isZipLike(buffer)) throw new Error('PPTX 文件内容不是有效的 Office Open XML 包。');
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name)).sort(naturalPathSort);
  const notesPaths = Object.keys(zip.files).filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name)).sort(naturalPathSort);
  const pages: string[] = [];

  for (let index = 0; index < slidePaths.length; index += 1) {
    const slideXml = await zip.file(slidePaths[index])?.async('string').catch(() => '');
    const slideText = slideXml ? extractTagText(slideXml, 'a:t').join('\n').trim() : '';
    const notesXml = notesPaths[index] ? await zip.file(notesPaths[index])?.async('string').catch(() => '') : '';
    const notesText = notesXml ? extractTagText(notesXml, 'a:t').join('\n').trim() : '';
    const chunks = [`第 ${index + 1} 页`, slideText, notesText ? `备注：\n${notesText}` : ''].filter(Boolean);
    if (slideText || notesText) pages.push(chunks.join('\n'));
  }

  return {
    text: compactText(pages.join('\n\n')),
    metadata: { slideCount: slidePaths.length, parsedSlideCount: pages.length },
  };
}

function parseRelationships(xml: string) {
  const rels = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b([^>]+)>/gi)) {
    const attrs = match[1];
    const id = attrs.match(/\bId="([^"]+)"/i)?.[1];
    const target = attrs.match(/\bTarget="([^"]+)"/i)?.[1];
    if (id && target) rels.set(id, target);
  }
  return rels;
}

async function parseXlsx(buffer: Buffer) {
  if (!isZipLike(buffer)) throw new Error('XLSX 文件内容不是有效的 Office Open XML 包。');
  const zip = await JSZip.loadAsync(buffer);
  const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('string').catch(() => '') || '';
  const sharedStrings = sharedXml
    ? Array.from(sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)).map((match) => extractTagText(match[1], 't').join(''))
    : [];
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string').catch(() => '') || '';
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string').catch(() => '') || '';
  const rels = parseRelationships(relsXml);
  const sheetRecords = Array.from(workbookXml.matchAll(/<sheet\b([^>]+?)\/?>/gi)).map((match, index) => {
    const attrs = match[1];
    const name = xmlDecode(attrs.match(/\bname="([^"]+)"/i)?.[1] || `工作表 ${index + 1}`);
    const rid = attrs.match(/\br:id="([^"]+)"/i)?.[1] || '';
    const target = rels.get(rid) || `worksheets/sheet${index + 1}.xml`;
    return { name, path: `xl/${target.replace(/^\/?xl\//, '').replace(/^\//, '')}` };
  });
  const fallbackSheets = Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort(naturalPathSort)
    .map((path, index) => ({ name: `工作表 ${index + 1}`, path }));
  const sheets = sheetRecords.length ? sheetRecords : fallbackSheets;
  const output: string[] = [];

  for (const sheet of sheets.slice(0, 30)) {
    const xml = await zip.file(sheet.path)?.async('string').catch(() => '');
    if (!xml) continue;
    const rows: string[] = [];
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
      const cells = Array.from(rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)).map((cellMatch) => {
        const attrs = cellMatch[1];
        const body = cellMatch[2];
        const type = attrs.match(/\bt="([^"]+)"/i)?.[1];
        if (type === 'inlineStr') return extractTagText(body, 't').join('');
        const value = xmlDecode(body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] || '');
        if (type === 's') return sharedStrings[Number(value)] || '';
        return value;
      }).map((cell) => cell.trim());
      if (cells.some(Boolean)) rows.push(cells.join(' | '));
      if (rows.length >= 300) break;
    }
    if (rows.length) output.push(`## ${sheet.name}\n${rows.join('\n')}`);
  }

  return {
    text: compactText(output.join('\n\n')),
    metadata: { sheetCount: sheets.length },
  };
}

async function parsePdf(buffer: Buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return {
      text: compactText(result.text || ''),
      metadata: { pageCount: result.total || result.pages?.length || undefined },
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

function parseTextFile(buffer: Buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  return { text: compactText(text), metadata: { encoding: 'utf-8' } };
}

function imageDataUrl(buffer: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function readImageDimensions(buffer: Buffer, mimeType: string) {
  if (mimeType === 'image/png' && buffer.byteLength >= 24) {
    return buildImageDimensionMetadata(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
  }
  if (mimeType === 'image/gif' && buffer.byteLength >= 10) {
    return buildImageDimensionMetadata(buffer.readUInt16LE(6), buffer.readUInt16LE(8));
  }
  if (mimeType === 'image/jpeg') {
    const dimensions = readJpegDimensions(buffer);
    if (dimensions) return buildImageDimensionMetadata(dimensions.width, dimensions.height);
  }
  if (mimeType === 'image/webp') {
    const dimensions = readWebpDimensions(buffer);
    if (dimensions) return buildImageDimensionMetadata(dimensions.width, dimensions.height);
  }
  return {};
}

function buildImageDimensionMetadata(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return {};
  const aspectRatio = Number((width / height).toFixed(4));
  return {
    width,
    height,
    aspectRatio,
    orientation: aspectRatio > 1.18 ? 'landscape' : aspectRatio < 0.85 ? 'portrait' : 'square',
    layoutHint: aspectRatio > 2
      ? 'ultra-wide'
      : aspectRatio > 1.5
        ? 'wide-landscape'
        : aspectRatio > 1.18
          ? 'landscape'
          : aspectRatio < 0.85
            ? 'portrait'
            : 'near-square',
  };
}

function readJpegDimensions(buffer: Buffer) {
  let offset = 2;
  while (offset + 9 < buffer.byteLength) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function readWebpDimensions(buffer: Buffer) {
  const chunk = buffer.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8 ' && buffer.byteLength >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L' && buffer.byteLength >= 25) {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  if (chunk === 'VP8X' && buffer.byteLength >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  return null;
}

async function describeImageWithModel(
  userId: number,
  buffer: Buffer,
  mimeType: string,
  filename: string,
  textModelId?: unknown
) {
  if (buffer.byteLength > MAX_VISION_IMAGE_BYTES) {
    throw new Error('图片超过内置识别大小限制，请压缩后重试或使用图片识别 Skill。');
  }
  const key = await resolveGenerationApiKey(userId, 'text', textModelId);
  if (!key) throw new Error('未配置文本模型，无法进行图片识别。');
  if (key.provider === 'anthropic' || key.provider === 'google') {
    throw new Error('当前文本模型的图片识别协议暂未接入，请切换 OpenAI 兼容视觉模型或使用图片识别 Skill。');
  }

  const defaultBaseUrl = TEXT_PROVIDER_BASE_URLS[key.provider] || 'https://api.openai.com/v1';
  const baseUrl = normalizeOpenAIBaseUrl(key.base_url || defaultBaseUrl, defaultBaseUrl);
  const response = await fetch(buildOpenAIEndpoint(baseUrl, '/chat/completions', defaultBaseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${decrypt(key.api_key)}`,
    },
    body: JSON.stringify({
      model: key.model || 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 900,
      messages: [
        {
          role: 'system',
          content: '你是 PPT 资料输入阶段的图片识别助手。请提取图片中对生成 PPT 有帮助的信息，避免编造。',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `请识别这张上传图片「${filename}」：概括画面内容、可见文字、图表/表格信息、可能适合放入 PPT 的用途。输出中文要点。` },
            { type: 'image_url', image_url: { url: imageDataUrl(buffer, mimeType), detail: 'high' } },
          ],
        },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `图片识别失败 (${response.status})`);
  }
  return compactText(String(data?.choices?.[0]?.message?.content || '').trim(), 20_000);
}

function buildResult(
  filename: string,
  kind: InputFileKind,
  status: InputFileParseStatus,
  text: string,
  mimeType: string,
  extension: string,
  warnings: string[],
  metadata: Record<string, unknown>
): ParsedInputFile {
  return {
    name: filename,
    kind,
    status,
    text,
    summary: summarize(text, status === 'failed' ? '文件未能完成解析' : '已解析文件内容'),
    mimeType,
    extension,
    warnings,
    metadata,
  };
}

async function parseWithPythonSourceToMarkdownFirst(
  filename: string,
  buffer: Buffer,
  extension: string,
  kind: InputFileKind,
  mimeType: string,
): Promise<ParsedInputFile | null> {
  const converted = await convertInputFileWithSourceToMarkdown(filename, buffer, extension);
  if (!converted) return null;
  if (!converted.text) {
    return buildResult(
      filename,
      kind,
      'partial',
      '',
      mimeType,
      extension,
      converted.warnings,
      { fileSize: buffer.byteLength, ...converted.metadata }
    );
  }
  return buildResult(
    filename,
    kind,
    'parsed',
    compactText(converted.text),
    mimeType,
    extension,
    converted.warnings,
    { fileSize: buffer.byteLength, ...converted.metadata }
  );
}

export async function parseInputFile(options: ParseInputFileOptions): Promise<ParsedInputFile> {
  const filename = String(options.filename || '').trim();
  if (!filename) throw new Error('缺少文件名。');
  const extension = normalizeUploadExtension(filename);
  const declaredMime = normalizeContentType(options.mimeType) || 'application/octet-stream';
  const buffer = decodeBase64Upload(options.dataBase64, '输入文件');

  if (LEGACY_OFFICE_EXTENSIONS.has(extension)) {
    assertUploadSize(buffer, MAX_INPUT_FILE_BYTES, '输入文件');
    const pythonParsed = await parseWithPythonSourceToMarkdownFirst(
      filename,
      buffer,
      extension,
      extension === 'xls' ? 'spreadsheet' : extension === 'ppt' ? 'presentation' : 'document',
      declaredMime
    );
    if (pythonParsed?.text) return pythonParsed;
    return buildResult(
      filename,
      extension === 'xls' ? 'spreadsheet' : extension === 'ppt' ? 'presentation' : 'document',
      'failed',
      '',
      declaredMime,
      extension,
      [`暂不支持旧版二进制 ${extension.toUpperCase()}，请另存为 ${extension}x 或使用文件解析 Skill。`],
      { fileSize: buffer.byteLength }
    );
  }

  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension) || declaredMime.startsWith('image/')) {
    const imageInfo = assertImageUploadSafe(buffer, {
      label: '输入图片',
      maxBytes: MAX_IMAGE_FILE_BYTES,
      declaredMime: declaredMime.startsWith('image/') ? declaredMime : undefined,
      filename,
      allowSvg: false,
    });
    const text = await describeImageWithModel(options.userId, buffer, imageInfo.mimeType, filename, options.textModelId);
    return buildResult(
      filename,
      'image',
      text ? 'parsed' : 'partial',
      text,
      imageInfo.mimeType,
      imageInfo.extension,
      text ? [] : ['图片识别未返回有效文字。'],
      { fileSize: buffer.byteLength, imageAnalysis: readImageDimensions(buffer, imageInfo.mimeType) }
    );
  }

  assertUploadSize(buffer, MAX_INPUT_FILE_BYTES, '输入文件');

  if (extension === 'docx') {
    const pythonParsed = await parseWithPythonSourceToMarkdownFirst(filename, buffer, extension, 'document', declaredMime);
    if (pythonParsed?.text) return pythonParsed;
    const parsed = await parseDocx(buffer);
    return buildResult(filename, 'document', parsed.text ? 'parsed' : 'partial', parsed.text, declaredMime, extension, parsed.text ? [] : ['未从 DOCX 中提取到正文。'], { fileSize: buffer.byteLength, ...parsed.metadata });
  }
  if (extension === 'xlsx' || extension === 'xlsm') {
    const pythonParsed = await parseWithPythonSourceToMarkdownFirst(filename, buffer, extension, 'spreadsheet', declaredMime);
    if (pythonParsed?.text) return pythonParsed;
    const parsed = await parseXlsx(buffer);
    return buildResult(filename, 'spreadsheet', parsed.text ? 'parsed' : 'partial', parsed.text, declaredMime, extension, parsed.text ? [] : ['未从 Excel 中提取到可用单元格内容。'], { fileSize: buffer.byteLength, ...parsed.metadata });
  }
  if (['pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm'].includes(extension)) {
    const pythonParsed = await parseWithPythonSourceToMarkdownFirst(filename, buffer, extension, 'presentation', declaredMime);
    if (pythonParsed?.text) return pythonParsed;
    const parsed = await parsePptx(buffer);
    return buildResult(filename, 'presentation', parsed.text ? 'parsed' : 'partial', parsed.text, declaredMime, extension, parsed.text ? [] : ['未从 PPTX 中提取到页面文字。'], { fileSize: buffer.byteLength, ...parsed.metadata });
  }
  if (extension === 'pdf' || declaredMime === 'application/pdf') {
    const pythonParsed = await parseWithPythonSourceToMarkdownFirst(filename, buffer, extension || 'pdf', 'pdf', declaredMime);
    if (pythonParsed?.text) return pythonParsed;
    const parsed = await parsePdf(buffer);
    return buildResult(filename, 'pdf', parsed.text ? 'parsed' : 'partial', parsed.text, declaredMime, extension || 'pdf', parsed.text ? [] : ['PDF 可能是扫描件，未提取到文字；建议使用 OCR/文件解析 Skill。'], { fileSize: buffer.byteLength, ...parsed.metadata });
  }
  if (TEXT_EXTENSIONS.has(extension) || declaredMime.startsWith('text/')) {
    const pythonParsed = await parseWithPythonSourceToMarkdownFirst(filename, buffer, extension, 'text', declaredMime);
    if (pythonParsed?.text) return pythonParsed;
    const parsed = parseTextFile(buffer);
    return buildResult(filename, 'text', parsed.text ? 'parsed' : 'partial', parsed.text, declaredMime, extension, parsed.text ? [] : ['文本文件为空或无法读取。'], { fileSize: buffer.byteLength, ...parsed.metadata });
  }

  return buildResult(filename, 'unsupported', 'failed', '', declaredMime, extension, ['暂不支持该文件格式，请转换为 PDF/DOCX/XLSX/PPTX/TXT 或使用文件解析 Skill。'], { fileSize: buffer.byteLength });
}
