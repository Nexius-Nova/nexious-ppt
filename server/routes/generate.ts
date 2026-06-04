import { Router, Response, Request } from 'express';
import { getDefaultApiKey } from '../models/apiKey.js';
import { decrypt } from '../utils/crypto.js';
import {
  buildStrategistPrompt,
  parseStrategistOutput,
  buildSpecLock,
  buildExecutorSystemPrompt,
  buildExecutorPagePrompt,
  cleanSvgOutput,
  ensureImageUsedInSvg
} from '../engine/index.js';
import { DEFAULT_FORBIDDEN, normalizeTypography } from '../engine/spec.js';
import type { StrategistInput, DesignSpec, SpecLock } from '../engine/index.js';
import { inlineRemoteImages, sanitizeSvgForResvg } from '../engine/svg-to-pptx.js';
import { exportWithNexiousPpt } from '../engine/ppt-exporter.js';
import { authMiddleware, AuthRequest } from './auth.js';
import { buildOpenAIEndpoint, normalizeOpenAIBaseUrl } from '../utils/openaiUrl.js';

const router = Router();

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/+$/, '');
}

function normalizeExecutorImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const imageUrl = value.trim();
  if (!imageUrl || imageUrl.length > 4000) return undefined;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  if (imageUrl.startsWith('/generated-images/')) return `${publicBaseUrl()}${imageUrl}`;
  return undefined;
}

function buildAttachmentDisposition(fileName: string): string {
  const safeName = fileName.trim() || `nexious-deck-${Date.now()}.pptx`;
  const asciiName = safeName
    .replace(/[^\x20-\x7E]+/g, '_')
    .replace(/["\\]/g, '_')
    .replace(/[;]+/g, '_')
    || `nexious-deck-${Date.now()}.pptx`;
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
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

async function streamText(
  provider: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  messages: Message[],
  res: Response
): Promise<string> {
  let normalizedBaseUrl = baseUrl || 'https://api.openai.com/v1';
  if (provider !== 'anthropic' && provider !== 'google') {
    const effectiveBaseUrl = TEXT_PROVIDER_BASE_URLS[provider] || baseUrl;
    normalizedBaseUrl = normalizeOpenAIBaseUrl(effectiveBaseUrl, 'https://api.openai.com/v1');
  }

  let url: string;
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let body: any;

  if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    const systemMsg = messages.find(m => m.role === 'system');
    body = {
      model,
      max_tokens: 8192,
      system: systemMsg?.content || '',
      messages: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })),
      stream: true,
    };
  } else if (provider === 'google') {
    const systemMsg = messages.find(m => m.role === 'system');
    const userMsgs = messages.filter(m => m.role === 'user');
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;
    body = {
      contents: userMsgs.map(m => ({ parts: [{ text: m.content }] })),
      systemInstruction: systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined,
      generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
    };
  } else {
    url = buildOpenAIEndpoint(normalizedBaseUrl, '/chat/completions');
    headers['Authorization'] = `Bearer ${apiKey}`;
    body = { model, messages, temperature: 0.7, max_tokens: 8192, stream: true };
  }

  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `API error (${response.status}): ${errorText}`;
    try {
      const errorJson = JSON.parse(errorText);
      const apiMessage = errorJson.error?.message || errorJson.message || errorJson.error?.type || '';
      if (apiMessage) {
        if (apiMessage.includes('Insufficient Balance') || apiMessage.includes('insufficient_quota') || apiMessage.includes('billing_hard_limit_reached')) {
          errorMessage = 'API 余额不足，请充值后重试';
        } else if (apiMessage.includes('invalid_api_key') || apiMessage.includes('Incorrect API key')) {
          errorMessage = 'API Key 无效，请检查配置';
        } else if (apiMessage.includes('model_not_found') || apiMessage.includes('Model not found')) {
          errorMessage = '模型不可用，请检查模型名称';
        } else if (apiMessage.includes('rate_limit') || apiMessage.includes('Rate limit')) {
          errorMessage = 'API 请求频率超限，请稍后重试';
        } else if (apiMessage.includes('maximum context length') || apiMessage.includes('context_length_exceeded') || apiMessage.includes('too many tokens')) {
          errorMessage = '请求内容超出模型上下文长度限制，请减少内容后重试';
        } else {
          errorMessage = apiMessage;
        }
      }
    } catch {}
    throw new Error(errorMessage);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No reader available');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        let content = '';

        if (provider === 'anthropic') {
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            content = parsed.delta.text;
          }
        } else if (provider === 'google') {
          content = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else {
          content = parsed.choices?.[0]?.delta?.content || '';
        }

        if (content) {
          fullContent += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      } catch {
        // ignore
      }
    }
  }

  return fullContent;
}

router.post('/strategist', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const input: StrategistInput = req.body;

    const defaultKey = await getDefaultApiKey(req.userId!, 'text');
    if (!defaultKey) {
      return res.status(400).json({ success: false, message: '未配置文本模型' });
    }

    const apiKey = decrypt(defaultKey.api_key);
    const provider = defaultKey.provider;
    const baseUrl = defaultKey.base_url || '';
    const model = defaultKey.model || 'gpt-4o';

    const { system, user } = buildStrategistPrompt(input);
    const estimatedTokens = Math.ceil((system.length + user.length) / 3);
    console.log(`[Strategist] systemPrompt=${system.length}chars, userPrompt=${user.length}chars, ~${estimatedTokens}tokens`);
    const messages: Message[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write(`data: ${JSON.stringify({ status: 'start', phase: 'strategist', message: 'Strategist 正在分析内容...' })}\n\n`);

    const fullContent = await streamText(provider, apiKey, baseUrl, model, messages, res);

    const spec = parseStrategistOutput(fullContent, input);
    const lock = buildSpecLock(spec);

    res.write(`data: ${JSON.stringify({ status: 'complete', phase: 'strategist', data: { spec, lock } })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Strategist error:', error);
    res.write(`data: ${JSON.stringify({ status: 'error', phase: 'strategist', message: error instanceof Error ? error.message : '策略分析失败' })}\n\n`);
    res.end();
  }
});

router.post('/executor-page', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { spec, lock, slide, imageUrl } = req.body;

    const defaultKey = await getDefaultApiKey(req.userId!, 'text');
    if (!defaultKey) {
      return res.status(400).json({ success: false, message: '未配置文本模型' });
    }

    const apiKey = decrypt(defaultKey.api_key);
    const provider = defaultKey.provider;
    const baseUrl = defaultKey.base_url || '';
    const model = defaultKey.model || 'gpt-4o';

    const effectiveLock = {
      ...lock,
      typography: normalizeTypography(lock?.typography || spec?.typography),
      colors: {
        ...(spec?.visualTheme?.colors || {}),
        ...(lock?.colors || {}),
        border: lock?.colors?.border || spec?.visualTheme?.colors?.border || lock?.colors?.muted || '#D8DED9',
      },
      forbidden: lock?.forbidden || DEFAULT_FORBIDDEN,
      skillExtensions: lock?.skillExtensions || [],
      pageRhythm: lock?.pageRhythm || {},
      pageLayouts: lock?.pageLayouts || {},
      pageCharts: lock?.pageCharts || {},
    };

    let messages: Message[];
    const safeImageUrl = normalizeExecutorImageUrl(imageUrl);
    const systemPrompt = buildExecutorSystemPrompt(spec, effectiveLock);
    const userPrompt = buildExecutorPagePrompt(slide, spec, effectiveLock, safeImageUrl);

    const estimatedTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 3);
    console.log(`[Executor] Page ${slide.pageNumber}: systemPrompt=${systemPrompt.length}chars, userPrompt=${userPrompt.length}chars, ~${estimatedTokens}tokens`);

    if (estimatedTokens > 500000) {
      console.warn(`[Executor] Page ${slide.pageNumber}: prompt too large (~${estimatedTokens}tokens), using simplified prompt`);
      const simplifiedSystem = `你是PPT SVG执行器。画布: ${spec.canvas.width}x${spec.canvas.height}。颜色: primary=${lock.colors.primary}, accent=${lock.colors.accent}, bg=${lock.colors.background}, text=${lock.colors.text}, surface=${lock.colors.surface}, muted=${lock.colors.muted}。字体: ${spec.typography.titleFamily}。输出纯SVG代码，viewBox="0 0 ${spec.canvas.width} ${spec.canvas.height}"。禁止<style>,class,<foreignObject>,rgba()。`;
      const simplifiedUser = `生成第${slide.pageNumber}页SVG。标题: ${slide.title}。要点: ${slide.bullets.slice(0, 5).join(' | ')}。布局: ${slide.layout}。${safeImageUrl ? `必须使用图片：${safeImageUrl}，写入 <image href="${safeImageUrl}" x="..." y="..." width="..." height="..." preserveAspectRatio="xMidYMid slice"/>。` : ''}输出纯SVG：`;
      messages = [
        { role: 'system', content: simplifiedSystem },
        { role: 'user', content: simplifiedUser },
      ];
    } else {
      messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write(`data: ${JSON.stringify({ status: 'start', phase: 'executor', pageNumber: slide.pageNumber, message: `正在生成第${slide.pageNumber}页...` })}\n\n`);

    const fullContent = await streamText(provider, apiKey, baseUrl, model, messages, res);

    const svg = ensureImageUsedInSvg(cleanSvgOutput(fullContent), slide, spec, safeImageUrl);

    res.write(`data: ${JSON.stringify({ status: 'complete', phase: 'executor', pageNumber: slide.pageNumber, data: { svg } })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Executor error:', error);
    res.write(`data: ${JSON.stringify({ status: 'error', phase: 'executor', message: error instanceof Error ? error.message : '页面生成失败' })}\n\n`);
    res.end();
  }
});

router.post('/export-pptx', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { pages, spec, lock } = req.body;

    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ success: false, message: '没有可导出的页面' });
    }

    const effectiveLock = lock
      ? {
          ...lock,
          typography: normalizeTypography(lock.typography || spec?.typography),
          colors: {
            ...(spec?.visualTheme?.colors || {}),
            ...(lock.colors || {}),
            border: lock.colors?.border || spec?.visualTheme?.colors?.border || lock.colors?.muted || '#D8DED9',
          },
          forbidden: lock.forbidden || DEFAULT_FORBIDDEN,
        }
      : buildSpecLock(spec);

    const result = await exportWithNexiousPpt(
      pages.map((page: any, index: number) => ({
        pageNumber: page.pageNumber || index + 1,
        svg: page.svg,
        speakerNotes: page.speakerNotes || ''
      })),
      spec,
      effectiveLock
    );

    const fileName = result.fileName || `nexious-deck-${Date.now()}.pptx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', buildAttachmentDisposition(fileName));
    res.send(result.buffer);
  } catch (error) {
    console.error('Export PPTX error:', error);
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : '导出失败' });
  }
});

router.post('/render-png', async (req: Request, res: Response) => {
  try {
    const { svg, width } = req.body;
    if (!svg) {
      return res.status(400).json({ success: false, message: '缺少 SVG 内容' });
    }

    const { Resvg } = await import('@resvg/resvg-js');

    let processedSvg = await inlineRemoteImages(svg);
    processedSvg = sanitizeSvgForResvg(processedSvg);

    const renderWidth = (width || 1280) * 2;

    const resvg = new Resvg(processedSvg, {
      fitTo: { mode: 'width', value: renderWidth },
      font: { fontFiles: [], defaultFontFamily: 'sans-serif' },
    });

    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(pngBuffer);
  } catch (error) {
    console.error('Render PNG error:', error);
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : '渲染失败' });
  }
});

export default router;
