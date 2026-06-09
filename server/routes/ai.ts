import { Router, Response, Request } from 'express';
import path from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import net from 'net';
import { getDefaultApiKey } from '../models/apiKey.js';
import { decrypt } from '../utils/crypto.js';
import { resolveGenerationApiKey } from '../services/modelSelection.js';
import { authMiddleware, AuthRequest } from './auth.js';
import { buildOpenAIEndpoint, normalizeOpenAIBaseUrl } from '../utils/openaiUrl.js';
import { generatedImagesRoot, publicBaseUrl } from '../utils/storage.js';
import { assertImageUploadSafe, normalizeContentType } from '../utils/uploadSecurity.js';
import { buildImageSlotPrompt, type ImageSlotHint } from '../engine/imageComposition.js';

const router = Router();

const GENERATED_IMAGE_DIR = generatedImagesRoot;
const PUBLIC_BASE_URL = publicBaseUrl();
const MAX_PROXY_IMAGE_BYTES = Math.max(1024 * 1024, Number(process.env.PROXY_IMAGE_MAX_BYTES || 8 * 1024 * 1024));
const IMAGE_GENERATION_SIZE = process.env.IMAGE_GENERATION_SIZE || '1024x1024';

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

type AuthType = 'bearer' | 'token' | 'x-api-key' | 'query' | 'none';

type ApiProtocol = 'openai-images';

interface ImageProviderConfig {
  defaultModel: string;
  defaultBaseUrl: string;
  authType: AuthType;
  protocol: ApiProtocol;
  supportsBaseUrl: boolean;
  testEndpoint: string;
  testMethod: 'GET' | 'POST';
}

const STYLE_PROMPTS_ZH: Record<string, string> = {
  flat: '扁平化设计，简洁现代',
  '3d': '3D渲染，立体效果',
  illustration: '插画风格，艺术感强',
  photo: '摄影风格，真实感',
};

const STYLE_PROMPTS_EN: Record<string, string> = {
  flat: 'flat design, minimalist',
  '3d': '3D render, volumetric',
  illustration: 'illustration style, artistic',
  photo: 'photorealistic, photography',
};

function getStylePrompt(style: string, locale: 'zh' | 'en' = 'zh'): string {
  const map = locale === 'zh' ? STYLE_PROMPTS_ZH : STYLE_PROMPTS_EN;
  return map[style] || (locale === 'zh' ? '专业设计' : 'professional design');
}

const IMAGE_PROVIDERS: Record<string, ImageProviderConfig> = {
  openai: {
    defaultModel: 'gpt-image-2',
    defaultBaseUrl: 'https://api.openai.com/v1',
    authType: 'bearer',
    protocol: 'openai-images',
    supportsBaseUrl: true,
    testEndpoint: '/models',
    testMethod: 'GET',
  },
  dalle: {
    defaultModel: 'gpt-image-2',
    defaultBaseUrl: 'https://api.openai.com/v1',
    authType: 'bearer',
    protocol: 'openai-images',
    supportsBaseUrl: true,
    testEndpoint: '/models',
    testMethod: 'GET',
  },
  custom: {
    defaultModel: 'gpt-image-2',
    defaultBaseUrl: 'https://api.openai.com/v1',
    authType: 'bearer',
    protocol: 'openai-images',
    supportsBaseUrl: true,
    testEndpoint: '/models',
    testMethod: 'GET',
  },
};

const CUSTOM_PROVIDER_HINTS: Array<{ patterns: string[]; provider: string }> = [
  { patterns: ['gpt-image', 'dall-e', 'dalle'], provider: 'openai' },
];

function resolveProvider(provider: string, model: string): string {
  if (provider !== 'custom') return provider;
  const lowerModel = model.toLowerCase();
  for (const hint of CUSTOM_PROVIDER_HINTS) {
    if (hint.patterns.some(p => lowerModel.includes(p))) {
      return hint.provider;
    }
  }
  return 'openai';
}

function buildAuthHeaders(authType: AuthType, apiKey: string): Record<string, string> {
  switch (authType) {
    case 'bearer':
      return { Authorization: `Bearer ${apiKey}` };
    case 'token':
      return { Authorization: `Token ${apiKey}` };
    case 'x-api-key':
      return { 'x-api-key': apiKey };
    case 'query':
    case 'none':
      return {};
  }
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3
): Promise<any> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = '未知错误';

        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error?.message || errorJson.message || errorText;
        } catch {
          errorMessage = errorText;
        }

        if (response.status === 401) {
          throw new Error('API Key 无效或已过期，请检查配置');
        }
        if (response.status === 400) {
          throw new Error(`请求参数错误: ${errorMessage}`);
        }
        if (response.status === 404) {
          throw new Error(`API 端点不存在 (404)，请检查 Base URL 是否正确`);
        }
        if (response.status === 429) {
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
            continue;
          }
          throw new Error('API 调用频率超限，请稍后重试');
        }
        if (response.status >= 500) {
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            continue;
          }
          throw new Error(
            `服务暂时不可用 (${response.status})，请稍后重试或更换其他图像模型`
          );
        }

        throw new Error(`图片生成失败 (${response.status}): ${errorMessage}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('未知错误');
      if (
        attempt < maxRetries &&
        !lastError.message.includes('API Key') &&
        !lastError.message.includes('参数错误') &&
        !lastError.message.includes('404')
      ) {
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError || new Error('图片生成失败');
}

function extractImageUrl(data: any): string {
  const first =
    Array.isArray(data.data) ? data.data[0] :
    Array.isArray(data.images) ? data.images[0] :
    Array.isArray(data.output) ? data.output[0] :
    data;

  const nested =
    first?.url ||
    first?.b64_json ||
    first?.base64 ||
    first?.image ||
    first?.image_url ||
    first?.asset_url ||
    first?.content?.[0]?.image_url?.url ||
    first?.content?.[0]?.url ||
    first?.content?.[0]?.b64_json;

  const url =
    nested ||
    data.url ||
    data.image_url ||
    data.output_url ||
    data.result?.url ||
    data.result?.image_url ||
    data.result?.b64_json ||
    '';

  if (!url) return '';
  if (typeof url !== 'string') return '';
  if (url.startsWith('data:') || url.startsWith('http')) return url;
  return `data:image/png;base64,${url}`;
}

function imageExtension(mime: string): string {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'png';
}

function isPrivateAddress(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  const ipVersion = net.isIP(lower);
  if (ipVersion === 4) {
    const parts = lower.split('.').map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    );
  }
  if (ipVersion === 6) {
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
  }
  return false;
}

function isAllowedProxyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const publicOrigin = new URL(PUBLIC_BASE_URL).origin;
    if (url.origin === publicOrigin && url.pathname.startsWith('/generated-images/')) return true;
    return !isPrivateAddress(url.hostname);
  } catch {
    return false;
  }
}

export async function persistDataImage(imageUrl: string, slideId: string): Promise<string> {
  if (!imageUrl) return imageUrl;
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return persistRemoteImage(imageUrl, slideId);
  }
  if (!imageUrl.startsWith('data:image/')) return imageUrl;
  const match = imageUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return imageUrl;

  await mkdir(GENERATED_IMAGE_DIR, { recursive: true });
  const ext = imageExtension(match[1]);
  const fileName = buildGeneratedImageFileName(slideId, ext);
  await writeFile(path.join(GENERATED_IMAGE_DIR, fileName), Buffer.from(match[2], 'base64'));
  return `${PUBLIC_BASE_URL.replace(/\/+$/, '')}/generated-images/${fileName}`;
}

function buildGeneratedImageFileName(slideId: string, ext: string) {
  const safeSlideId = String(slideId || 'slide')
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'slide';
  return `${safeSlideId}_${Date.now()}_${randomUUID()}.${ext}`;
}

function isPersistedGeneratedImageUrl(value: string) {
  try {
    const url = new URL(value);
    const publicOrigin = new URL(PUBLIC_BASE_URL).origin;
    return url.origin === publicOrigin && url.pathname.startsWith('/generated-images/');
  } catch {
    return false;
  }
}

async function persistRemoteImage(imageUrl: string, slideId: string): Promise<string> {
  if (isPersistedGeneratedImageUrl(imageUrl)) return imageUrl;
  if (!isAllowedProxyUrl(imageUrl)) {
    throw new Error('图片地址不允许保存，请使用公网 http/https 图片或 data:image 数据。');
  }

  const response = await fetch(imageUrl, {
    headers: {
      Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8',
      'User-Agent': 'Nexious-PPT/1.0',
    },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`远程图片下载失败 (${response.status})`);
  }

  const contentType = normalizeContentType(response.headers.get('content-type'));
  if (!contentType.startsWith('image/')) {
    throw new Error('远程地址返回的不是图片内容');
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_PROXY_IMAGE_BYTES) {
    throw new Error(`远程图片超过大小限制（最大 ${Math.round(MAX_PROXY_IMAGE_BYTES / 1024 / 1024)}MB）`);
  }

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new Error('远程图片响应不可读取');
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.byteLength;
    if (total > MAX_PROXY_IMAGE_BYTES) {
      throw new Error(`远程图片超过大小限制（最大 ${Math.round(MAX_PROXY_IMAGE_BYTES / 1024 / 1024)}MB）`);
    }
    chunks.push(chunk);
  }

  const buffer = Buffer.concat(chunks);
  const imageInfo = assertImageUploadSafe(buffer, {
    label: '远程生成图片',
    maxBytes: MAX_PROXY_IMAGE_BYTES,
    declaredMime: contentType,
    allowSvg: false,
  });
  await mkdir(GENERATED_IMAGE_DIR, { recursive: true });
  const fileName = buildGeneratedImageFileName(slideId, imageInfo.extension || imageExtension(imageInfo.mimeType));
  await writeFile(path.join(GENERATED_IMAGE_DIR, fileName), buffer);
  return `${PUBLIC_BASE_URL.replace(/\/+$/, '')}/generated-images/${fileName}`;
}

async function generateWithOpenAIProtocol(
  apiKey: string,
  model: string,
  prompt: string,
  style: string,
  baseUrl: string,
  config: ImageProviderConfig,
  imageSlot?: ImageSlotHint
): Promise<string> {
  const url = buildOpenAIEndpoint(baseUrl, '/images/generations', config.defaultBaseUrl);
  const slotPrompt = buildImageSlotPrompt(imageSlot, prompt);
  const fullPrompt = [
    prompt,
    getStylePrompt(style),
    slotPrompt,
    '高质量，适合 PPT 展示，不要文字水印，不要截图边框'
  ].join('，').slice(0, 4000);

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(config.authType, apiKey),
    },
    body: JSON.stringify({
      model: model || config.defaultModel,
      prompt: fullPrompt,
      n: 1,
      size: IMAGE_GENERATION_SIZE,
      quality: 'medium',
    }),
  });

  const data = response;
  const imageUrl = extractImageUrl(data);
  if (!imageUrl) throw new Error('API 返回数据格式错误，未找到图片');
  return imageUrl;
}

export async function generateImage(
  provider: string,
  apiKey: string,
  model: string,
  prompt: string,
  style: string,
  baseUrl: string,
  imageSlot?: ImageSlotHint
): Promise<string> {
  const effectiveProvider = resolveProvider(provider, model);
  const config = IMAGE_PROVIDERS[effectiveProvider] || IMAGE_PROVIDERS.openai;
  const effectiveModel = model || config.defaultModel;

  return generateWithOpenAIProtocol(apiKey, effectiveModel, prompt, style, baseUrl, config, imageSlot);
}

async function streamOpenAI(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Message[],
  res: Response
): Promise<void> {
  const url = buildOpenAIEndpoint(baseUrl, '/chat/completions');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 4096,
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No reader available');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          res.write(`data: [DONE]\n\n`);
          continue;
        }
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        } catch {
          // ignore parse errors
        }
      }
    }
  }
}

async function streamAnthropic(
  apiKey: string,
  model: string,
  messages: Message[],
  res: Response
): Promise<void> {
  const systemMessage = messages.find(m => m.role === 'system');
  const otherMessages = messages.filter(m => m.role !== 'system');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemMessage?.content || '',
      messages: otherMessages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${error}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No reader available');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            res.write(`data: ${JSON.stringify({ content: parsed.delta.text })}\n\n`);
          }
        } catch {
          // ignore parse errors
        }
      }
    }
  }
  res.write(`data: [DONE]\n\n`);
}

async function streamGoogleAI(
  apiKey: string,
  model: string,
  messages: Message[],
  res: Response
): Promise<void> {
  const systemMessage = messages.find(m => m.role === 'system');
  const userMessages = messages.filter(m => m.role === 'user');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: userMessages.map(m => ({
        parts: [{ text: m.content }],
      })),
      systemInstruction: systemMessage
        ? {
            parts: [{ text: systemMessage.content }],
          }
        : undefined,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google AI API error: ${error}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No reader available');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        try {
          const parsed = JSON.parse(data);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
          }
        } catch {
          // ignore parse errors
        }
      }
    }
  }
  res.write(`data: [DONE]\n\n`);
}

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

async function streamTextModel(
  provider: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  messages: Message[],
  res: Response
): Promise<void> {
  switch (provider) {
    case 'anthropic':
      return streamAnthropic(apiKey, model, messages, res);
    case 'google':
      return streamGoogleAI(apiKey, model, messages, res);
    case 'openai':
      return streamOpenAI(baseUrl, apiKey, model, messages, res);
    case 'custom':
    default: {
      const effectiveBaseUrl = TEXT_PROVIDER_BASE_URLS[provider]
        ? TEXT_PROVIDER_BASE_URLS[provider]
        : baseUrl;
      return streamOpenAI(effectiveBaseUrl, apiKey, model, messages, res);
    }
  }
}

router.post('/generate-outline-stream', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { topic, content, slideCount, tone, summaryLength, promptContent } = req.body;

    const defaultKey = await getDefaultApiKey(req.userId!, 'text');
    if (!defaultKey) {
      return res.status(400).json({
        success: false,
        message: '未配置文本模型，请先在设置中添加 API Key',
      });
    }

    const apiKey = decrypt(defaultKey.api_key);
    const provider = defaultKey.provider;
    const baseUrl = defaultKey.base_url || '';
    const model = defaultKey.model || 'gpt-4o';
    const requestedSlideCount = Number(slideCount);
    const effectiveSlideCount = Number.isFinite(requestedSlideCount) && requestedSlideCount > 0
      ? Math.round(requestedSlideCount)
      : undefined;
    const slideCountText = effectiveSlideCount
      ? `${effectiveSlideCount}页（AI可根据内容自主调整）`
      : '由 AI 根据内容量自主决定';
    const toneGuide = tone === 'professional'
      ? '专业严谨'
      : tone === 'creative'
      ? '创意活泼'
      : tone === 'auto'
      ? '由 AI 根据主题、资料和使用场景自主判断'
      : '通俗易懂';

    const lengthGuide = summaryLength === 'detailed'
      ? '详细展开，每页6-8个要点，每个要点2-3句话详细说明'
      : summaryLength === 'concise'
      ? '精简扼要，每页2-3个要点，每个要点一句话概括'
      : summaryLength === 'auto'
      ? '由 AI 根据资料密度和页面节奏自主决定详略'
      : '适中平衡，每页3-5个要点，每个要点适当展开';

    const systemPrompt = `你是一个专业的PPT内容策划专家。请根据用户提供的主题和内容，生成一份结构清晰、逻辑连贯的PPT大纲。

要求：
1. 每页PPT需要包含：标题、要点、演讲备注、配图提示词、推荐版式
2. 标题要简洁有力，能概括该页核心内容
3. 要点要具体、可执行，避免空洞表述
4. 演讲备注要给出该页的讲述重点和过渡提示
5. 风格要${toneGuide}
6. 内容详细程度：${lengthGuide}
7. 请根据内容量和逻辑结构自主决定合适的页数，确保内容完整且不过于冗长
8. 推荐版式（layout）必须是以下之一：
   - "text-only"：纯文字，适合概念阐述、总结归纳
   - "text-image"：左文右图，适合图文并重的说明
   - "image-text"：左图右文，适合以图为主的内容
   - "full-image"：全幅图片背景+少量文字，适合视觉冲击力强的页面
   - "title-center"：居中标题+要点，适合开场、过渡、总结
   - "two-column"：双栏布局，适合对比、并列内容
   根据每页内容特点选择最合适的版式，让排版丰富多样，避免所有页面使用同一种版式

请以JSON数组格式返回，每项包含：title, bullets(数组), speakerNotes, visualPrompt(配图提示词), layout(推荐版式)`;

    const userPrompt = `主题：${topic}
内容概述：${content}
参考页数：${slideCountText}
内容详细程度：${lengthGuide}
${promptContent ? `\n额外提示词指导：\n${promptContent}\n` : ''}
请根据以上信息自主决定合适的页数，生成PPT大纲：`;

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write(`data: ${JSON.stringify({ status: 'start', message: '开始生成大纲...' })}\n\n`);

    let fullContent = '';

    const originalWrite = res.write.bind(res);
    (res as any).write = (chunk: any) => {
      const str = chunk.toString();
      if (str.startsWith('data: ') && !str.includes('[DONE]') && !str.includes('status')) {
        try {
          const data = JSON.parse(str.slice(6));
          if (data.content) {
            fullContent += data.content;
          }
        } catch {
          // ignore
        }
      }
      return originalWrite(chunk);
    };

    await streamTextModel(provider, apiKey, baseUrl, model, messages, res);

    let outline;
    try {
      const jsonMatch = fullContent.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        outline = JSON.parse(jsonMatch[0]);
      } else {
        outline = JSON.parse(fullContent);
      }
    } catch {
      outline = parseOutlineFromText(fullContent, effectiveSlideCount || 6);
    }

    outline = outline.map((item: any, index: number) => ({
      id: `slide-${index + 1}`,
      title: item.title || `第${index + 1}页`,
      bullets: item.bullets || [],
      speakerNotes: item.speakerNotes || '',
      visualPrompt: item.visualPrompt || '',
      chartHint: item.chartHint,
      layout: item.layout || undefined,
    }));

    res.write(`data: ${JSON.stringify({ status: 'complete', data: outline })}\n\n`);
    res.end();
  } catch (error) {
    console.error('生成大纲错误:', error);
    res.write(
      `data: ${JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : '生成大纲失败' })}\n\n`
    );
    res.end();
  }
});

function parseOutlineFromText(text: string, count: number): any[] {
  const slides: any[] = [];
  const lines = text.split('\n').filter((line: string) => line.trim());

  let currentSlide: any = null;

  for (const line of lines) {
    if (line.match(/^[一二三四五六七八九十\d]+[、.．]/) || line.match(/^#+\s/)) {
      if (currentSlide) {
        slides.push(currentSlide);
      }
      currentSlide = {
        title: line
          .replace(/^[一二三四五六七八九十\d]+[、.．\s]+/, '')
          .replace(/^#+\s*/, ''),
        bullets: [],
        speakerNotes: '',
        visualPrompt: '',
      };
    } else if (currentSlide && line.match(/^[-•·]\s/)) {
      currentSlide.bullets.push(line.replace(/^[-•·]\s*/, ''));
    }
  }

  if (currentSlide) {
    slides.push(currentSlide);
  }

  while (slides.length < count) {
    slides.push({
      title: `第${slides.length + 1}页`,
      bullets: ['要点一', '要点二', '要点三'],
      speakerNotes: '',
      visualPrompt: '',
    });
  }

  return slides.slice(0, count);
}

router.get('/proxy-image', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const imageUrl = req.query.url as string;
    if (!imageUrl) {
      return res.status(400).json({ success: false, message: 'Missing url parameter' });
    }

    const decodedUrl = decodeURIComponent(imageUrl);

    if (!isAllowedProxyUrl(decodedUrl)) {
      return res.status(400).json({ success: false, message: '图片地址不允许代理' });
    }

    const response = await fetch(decodedUrl, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      return res.status(502).json({ success: false, message: `Image server returned ${response.status}` });
    }

    const contentType = normalizeContentType(response.headers.get('content-type') || 'image/png');
    if (!/^image\/(?:png|jpe?g|webp|gif|svg\+xml)\b/i.test(contentType)) {
      return res.status(415).json({ success: false, message: '代理资源不是受支持的图片类型' });
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_PROXY_IMAGE_BYTES) {
      return res.status(413).json({ success: false, message: '图片过大，已拒绝代理' });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_PROXY_IMAGE_BYTES) {
      return res.status(413).json({ success: false, message: '图片过大，已拒绝代理' });
    }
    try {
      assertImageUploadSafe(buffer, {
        label: '代理图片',
        maxBytes: MAX_PROXY_IMAGE_BYTES,
        declaredMime: contentType,
        allowSvg: true,
      });
    } catch (error) {
      return res.status(415).json({
        success: false,
        message: error instanceof Error ? error.message : '代理资源不是受支持的图片类型'
      });
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (error) {
    res.status(502).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to proxy image'
    });
  }
});

router.post('/generate-image-stream', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { slideId, title, prompt, style, imageModelId } = req.body;

    const defaultKey = await resolveGenerationApiKey(req.userId!, 'image', imageModelId);
    if (!defaultKey) {
      return res.status(400).json({
        success: false,
        message: '未配置图像模型，请先在设置中添加 API Key',
      });
    }

    const apiKey = decrypt(defaultKey.api_key);
    const provider = defaultKey.provider;
    const model = defaultKey.model || 'dall-e-3';
    const baseUrl = defaultKey.base_url || '';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write(
      `data: ${JSON.stringify({ status: 'start', message: `正在为"${title}"生成图片...` })}\n\n`
    );

    try {
      const rawImageUrl = await generateImage(provider, apiKey, model, prompt, style, baseUrl);
      const imageUrl = await persistDataImage(rawImageUrl, slideId);

      res.write(
        `data: ${JSON.stringify({
          status: 'complete',
          data: {
            id: `${slideId}-image-1`,
            slideId,
            title,
            prompt,
            style,
            url: imageUrl,
            selected: true,
          },
        })}\n\n`
      );
    } catch (error) {
      console.error(`生成图片失败: ${slideId}`, error);

      let errorMessage = error instanceof Error ? error.message : '生成图片失败';

      if (errorMessage.includes('500') || errorMessage.includes('内部错误')) {
        errorMessage =
          '图像生成服务暂时不可用，建议检查API配置或稍后重试。您可以继续生成PPT，稍后手动添加图片。';
      } else if (errorMessage.includes('未找到图片') || errorMessage.includes('格式错误')) {
        errorMessage = '图像模型没有返回可用图片，已继续生成页面。';
      }

      res.write(
        `data: ${JSON.stringify({
          status: 'error',
          message: errorMessage,
          data: {
            id: `${slideId}-image-1`,
            slideId,
            title,
            prompt,
            style,
            url: '',
            selected: true,
            error: true,
          },
        })}\n\n`
      );
    }

    res.end();
  } catch (error) {
    console.error('生成图片错误:', error);
    res.write(
      `data: ${JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : '生成图片失败' })}\n\n`
    );
    res.end();
  }
});

router.post('/persist-generated-image', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { slideId, imageUrl } = req.body;
    if (typeof imageUrl !== 'string' || !imageUrl) {
      return res.status(400).json({ success: false, message: '缺少图片数据' });
    }

    const url = await persistDataImage(imageUrl, slideId || 'slide');
    res.json({ success: true, data: { url } });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : '保存图片失败',
    });
  }
});

router.post('/chat-stream', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'messages 不能为空',
      });
    }

    const defaultKey = await getDefaultApiKey(req.userId!, 'text');
    if (!defaultKey) {
      return res.status(400).json({
        success: false,
        message: '未配置文本模型，请先在设置中添加 API Key',
      });
    }

    const apiKey = decrypt(defaultKey.api_key);
    const provider = defaultKey.provider;
    const baseUrl = defaultKey.base_url || '';
    const model = defaultKey.model || 'gpt-4o';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write(`data: ${JSON.stringify({ status: 'start', message: 'AI 思考中...' })}\n\n`);

    let fullContent = '';

    const originalWrite = res.write.bind(res);
    (res as any).write = (chunk: any) => {
      const str = chunk.toString();
      if (str.startsWith('data: ') && !str.includes('[DONE]') && !str.includes('status')) {
        try {
          const data = JSON.parse(str.slice(6));
          if (data.content) {
            fullContent += data.content;
          }
        } catch {
          // ignore
        }
      }
      return originalWrite(chunk);
    };

    await streamTextModel(provider, apiKey, baseUrl, model, messages, res);

    res.write(`data: ${JSON.stringify({ status: 'complete', data: { fullContent } })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Chat stream error:', error);
    res.write(
      `data: ${JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : 'AI 对话失败' })}\n\n`
    );
    res.end();
  }
});

router.post('/test-text-model', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const defaultKey = await getDefaultApiKey(req.userId!, 'text');
    if (!defaultKey) {
      return res.json({
        success: false,
        message: '未配置文本模型，请先在设置中添加 API Key',
      });
    }

    const apiKey = decrypt(defaultKey.api_key);
    const provider = defaultKey.provider;
    const baseUrl = defaultKey.base_url || '';
    const model = defaultKey.model || 'gpt-4o';

    const testMessages: Message[] = [{ role: 'user', content: '你好，请回复"测试成功"' }];

    let testUrl = '';
    let testBody: any = {};

    switch (provider) {
      case 'anthropic':
        testUrl = 'https://api.anthropic.com/v1/messages';
        testBody = {
          model,
          max_tokens: 10,
          messages: testMessages.filter(m => m.role !== 'system'),
        };
        break;
      case 'google':
        testUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        testBody = {
          contents: testMessages
            .filter(m => m.role === 'user')
            .map(m => ({ parts: [{ text: m.content }] })),
        };
        break;
      default: {
        const effectiveBaseUrl = TEXT_PROVIDER_BASE_URLS[provider] || baseUrl;
        testUrl = buildOpenAIEndpoint(effectiveBaseUrl, '/chat/completions');
        testBody = {
          model,
          messages: testMessages,
          max_tokens: 10,
        };
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (provider === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (provider !== 'google') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(testUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(testBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'API 测试失败';

      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }

      if (response.status === 401) {
        return res.json({
          success: false,
          message: 'API Key 无效或已过期',
        });
      }

      if (response.status === 429) {
        return res.json({
          success: false,
          message: 'API 调用频率超限，请稍后重试',
        });
      }

      return res.json({
        success: false,
        message: `测试失败 (${response.status}): ${errorMessage}`,
      });
    }

    res.json({
      success: true,
      message: `文本模型 ${model} 连接成功`,
    });
  } catch (error) {
    console.error('测试文本模型错误:', error);
    res.json({
      success: false,
      message: error instanceof Error ? error.message : '测试失败',
    });
  }
});

router.post('/test-image-model', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const defaultKey = await getDefaultApiKey(req.userId!, 'image');
    if (!defaultKey) {
      return res.json({
        success: false,
        message: '未配置图像模型，请先在设置中添加 API Key',
      });
    }

    const apiKey = decrypt(defaultKey.api_key);
    const provider = defaultKey.provider;
    const baseUrl = defaultKey.base_url || '';
    const model = defaultKey.model || 'dall-e-3';

    const effectiveProvider = resolveProvider(provider, model);
    const config = IMAGE_PROVIDERS[effectiveProvider] || IMAGE_PROVIDERS.openai;

    let testUrl = '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(config.authType, apiKey),
    };

    if (config.supportsBaseUrl && baseUrl) {
      testUrl = buildOpenAIEndpoint(baseUrl, config.testEndpoint, config.defaultBaseUrl);
    } else {
      testUrl = buildOpenAIEndpoint(config.defaultBaseUrl, config.testEndpoint, config.defaultBaseUrl);
    }

    const response = await fetch(testUrl, {
      method: config.testMethod,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'API 测试失败';

      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }

      if (response.status === 401) {
        return res.json({
          success: false,
          message: 'API Key 无效或已过期',
        });
      }

      if (response.status === 429) {
        return res.json({
          success: false,
          message: 'API 调用频率超限，请稍后重试',
        });
      }

      if (response.status === 404 && config.testMethod === 'GET') {
        return res.json({
          success: true,
          message: `图像模型 ${model} 配置有效（无法验证具体模型，但 API Key 有效）`,
        });
      }

      return res.json({
        success: false,
        message: `测试失败 (${response.status}): ${errorMessage}`,
      });
    }

    res.json({
      success: true,
      message: `图像模型 ${model} 连接成功`,
    });
  } catch (error) {
    console.error('测试图像模型错误:', error);
    res.json({
      success: false,
      message: error instanceof Error ? error.message : '测试失败',
    });
  }
});

router.post('/run-skill', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { skillId, skillName, slides, params, intensity } = req.body;

    const defaultKey = await getDefaultApiKey(req.userId!, 'text');
    if (!defaultKey) {
      return res.status(400).json({
        success: false,
        message: '未配置文本模型，请先在设置中添加 API Key',
      });
    }

    const apiKey = decrypt(defaultKey.api_key);
    const provider = defaultKey.provider;
    const baseUrl = defaultKey.base_url || '';
    const model = defaultKey.model || 'gpt-4o';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write(`data: ${JSON.stringify({ status: 'start', message: `正在执行 Skill: ${skillName}...` })}\n\n`);

    let systemPrompt = '';
    let userPrompt = '';

    if (skillId === 'speaker-notes' || skillName?.includes('讲稿')) {
      const style = params?.style || 'professional';
      const length = params?.length || 'medium';
      const styleGuide = style === 'storytelling' ? '叙事风格，用故事和案例引入' : style === 'professional' ? '专业严谨，数据和逻辑驱动' : '轻松自然，对话式表达';
      const lengthGuide = length === 'long' ? '每页讲稿200-300字' : length === 'short' ? '每页讲稿50-80字' : '每页讲稿100-150字';

      systemPrompt = `你是一个专业的演讲稿撰写专家。请为每页PPT生成演讲备注/讲稿。
要求：
1. 风格：${styleGuide}
2. 长度：${lengthGuide}
3. 包含自然转场提示
4. 以JSON数组格式返回，每项包含 slideId 和 speakerNotes`;

      userPrompt = `请为以下PPT页面生成演讲讲稿：\n${JSON.stringify(slides.map((s: any) => ({ slideId: s.id, title: s.title, bullets: s.bullets })))}`;
    } else if (skillId === 'data-chart' || skillName?.includes('图表') || skillName?.includes('数据')) {
      systemPrompt = `你是一个数据可视化专家。请分析PPT页面内容，识别数据表达机会，为适合的页面推荐图表类型。
要求：
1. 只为包含数字、百分比、对比、趋势等数据的页面推荐图表
2. 推荐合适的图表类型（柱状图、折线图、饼图、雷达图等）
3. 以JSON数组格式返回，每项包含 slideId 和 chartHint`;

      userPrompt = `请分析以下PPT页面，推荐图表：\n${JSON.stringify(slides.map((s: any) => ({ slideId: s.id, title: s.title, bullets: s.bullets })))}`;
    } else if (skillId === 'design-polish' || skillName?.includes('设计') || skillName?.includes('优化')) {
      const level = params?.level || 'medium';
      systemPrompt = `你是一个PPT设计优化专家。请优化每页PPT的标题和要点。
要求：
1. 优化等级：${level === 'high' ? '深度优化，标题精简到12字内，要点聚焦到4条以内' : level === 'low' ? '轻度优化，仅微调措辞' : '中度优化，标题精简到16字内，要点聚焦到5条以内'}
2. 标题要简洁有力
3. 要点要具体可执行，避免空洞
4. 以JSON数组格式返回，每项包含 slideId、title 和 bullets`;

      userPrompt = `请优化以下PPT页面：\n${JSON.stringify(slides.map((s: any) => ({ slideId: s.id, title: s.title, bullets: s.bullets })))}`;
    } else if (skillName?.includes('摘要') || skillName?.includes('总结')) {
      const maxLen = params?.maxLength || 200;
      systemPrompt = `你是一个内容摘要专家。请为每页PPT生成核心要点摘要。
要求：
1. 每页摘要不超过${maxLen}字
2. 提炼最核心的观点
3. 以JSON数组格式返回，每项包含 slideId 和 summary`;

      userPrompt = `请为以下PPT页面生成摘要：\n${JSON.stringify(slides.map((s: any) => ({ slideId: s.id, title: s.title, bullets: s.bullets })))}`;
    } else {
      systemPrompt = `你是一个PPT内容优化专家。请根据用户的要求优化PPT内容。以JSON数组格式返回结果。`;
      userPrompt = `Skill: ${skillName}\n参数: ${JSON.stringify(params)}\nPPT内容: ${JSON.stringify(slides.map((s: any) => ({ slideId: s.id, title: s.title, bullets: s.bullets, speakerNotes: s.speakerNotes || '' })))}`;
    }

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    let fullContent = '';

    const originalWrite = res.write.bind(res);
    (res as any).write = (chunk: any) => {
      const str = chunk.toString();
      if (str.startsWith('data: ') && !str.includes('[DONE]') && !str.includes('status')) {
        try {
          const data = JSON.parse(str.slice(6));
          if (data.content) {
            fullContent += data.content;
          }
        } catch {
          // ignore
        }
      }
      return originalWrite(chunk);
    };

    await streamTextModel(provider, apiKey, baseUrl, model, messages, res);

    let result;
    try {
      const jsonMatch = fullContent.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        result = JSON.parse(fullContent);
      }
    } catch {
      result = { rawContent: fullContent };
    }

    res.write(`data: ${JSON.stringify({ status: 'complete', data: { skillId, skillName, result } })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Skill 执行错误:', error);
    res.write(
      `data: ${JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : 'Skill 执行失败' })}\n\n`
    );
    res.end();
  }
});

export default router;
