import { Router, Response, Request } from 'express';
import { getDefaultApiKey } from '../models/apiKey.js';
import { decrypt } from '../utils/crypto.js';

const router = Router();

const DEFAULT_USER_ID = 1;

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

function normalizeBaseUrl(baseUrl: string, defaultUrl: string): string {
  let url = baseUrl || defaultUrl;
  url = url.replace(/\/+$/, '');
  if (!url.endsWith('/v1') && !url.includes('/v1/')) {
    url = `${url}/v1`;
  }
  return url;
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
  const url = data.data?.[0]?.url || data.data?.[0]?.b64_json || data.url || data.image_url || '';
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('http')) return url;
  return `data:image/png;base64,${url}`;
}

async function generateWithOpenAIProtocol(
  apiKey: string,
  model: string,
  prompt: string,
  style: string,
  baseUrl: string,
  config: ImageProviderConfig
): Promise<string> {
  const normalizedUrl = normalizeBaseUrl(baseUrl, config.defaultBaseUrl);
  const url = `${normalizedUrl}/images/generations`;
  const fullPrompt = `${prompt}，${getStylePrompt(style)}，高质量，适合PPT展示`.slice(0, 4000);

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
      size: '1024x1024',
      quality: 'medium',
    }),
  });

  const data = response;
  const imageUrl = extractImageUrl(data);
  if (!imageUrl) throw new Error('API 返回数据格式错误，未找到图片');
  return imageUrl;
}

async function generateImage(
  provider: string,
  apiKey: string,
  model: string,
  prompt: string,
  style: string,
  baseUrl: string
): Promise<string> {
  const effectiveProvider = resolveProvider(provider, model);
  const config = IMAGE_PROVIDERS[effectiveProvider] || IMAGE_PROVIDERS.openai;
  const effectiveModel = model || config.defaultModel;

  return generateWithOpenAIProtocol(apiKey, effectiveModel, prompt, style, baseUrl, config);
}

async function streamOpenAI(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Message[],
  res: Response
): Promise<void> {
  let normalizedBaseUrl = baseUrl || 'https://api.openai.com/v1';
  normalizedBaseUrl = normalizedBaseUrl.replace(/\/+$/, '');
  if (!normalizedBaseUrl.endsWith('/v1') && !normalizedBaseUrl.includes('/v1/')) {
    normalizedBaseUrl = `${normalizedBaseUrl}/v1`;
  }
  const url = `${normalizedBaseUrl}/chat/completions`;

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

router.post('/generate-outline-stream', async (req: Request, res: Response) => {
  try {
    const { topic, content, slideCount, tone, summaryLength } = req.body;

    const defaultKey = await getDefaultApiKey(DEFAULT_USER_ID, 'text');
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

    const lengthGuide = summaryLength === 'detailed'
      ? '详细展开，每页6-8个要点，每个要点2-3句话详细说明'
      : summaryLength === 'concise'
      ? '精简扼要，每页2-3个要点，每个要点一句话概括'
      : '适中平衡，每页3-5个要点，每个要点适当展开';

    const systemPrompt = `你是一个专业的PPT内容策划专家。请根据用户提供的主题和内容，生成一份结构清晰、逻辑连贯的PPT大纲。

要求：
1. 每页PPT需要包含：标题、要点、演讲备注
2. 标题要简洁有力，能概括该页核心内容
3. 要点要具体、可执行，避免空洞表述
4. 演讲备注要给出该页的讲述重点和过渡提示
5. 风格要${tone === 'professional' ? '专业严谨' : tone === 'creative' ? '创意活泼' : '通俗易懂'}
6. 内容详细程度：${lengthGuide}

请以JSON数组格式返回，每项包含：title, bullets(数组), speakerNotes, visualPrompt(配图提示词)`;

    const userPrompt = `主题：${topic}
内容概述：${content}
期望页数：${slideCount || 6}页
内容详细程度：${lengthGuide}

请生成PPT大纲：`;

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
      outline = parseOutlineFromText(fullContent, slideCount || 6);
    }

    outline = outline.map((item: any, index: number) => ({
      id: `slide-${index + 1}`,
      title: item.title || `第${index + 1}页`,
      bullets: item.bullets || [],
      speakerNotes: item.speakerNotes || '',
      visualPrompt: item.visualPrompt || '',
      chartHint: item.chartHint,
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

router.get('/proxy-image', async (req: Request, res: Response) => {
  try {
    const imageUrl = req.query.url as string;
    if (!imageUrl) {
      return res.status(400).json({ success: false, message: 'Missing url parameter' });
    }

    const decodedUrl = decodeURIComponent(imageUrl);

    if (!/^https?:\/\//.test(decodedUrl)) {
      return res.status(400).json({ success: false, message: 'Only http/https URLs are supported' });
    }

    const response = await fetch(decodedUrl);
    if (!response.ok) {
      return res.status(502).json({ success: false, message: `Image server returned ${response.status}` });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/png';

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

router.post('/generate-image-stream', async (req: Request, res: Response) => {
  try {
    const { slideId, title, prompt, style } = req.body;

    const defaultKey = await getDefaultApiKey(DEFAULT_USER_ID, 'image');
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
      const imageUrl = await generateImage(provider, apiKey, model, prompt, style, baseUrl);

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

router.post('/chat-stream', async (req: Request, res: Response) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'messages 不能为空',
      });
    }

    const defaultKey = await getDefaultApiKey(DEFAULT_USER_ID, 'text');
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

router.post('/test-text-model', async (req: Request, res: Response) => {
  try {
    const defaultKey = await getDefaultApiKey(DEFAULT_USER_ID, 'text');
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
        let normalizedBaseUrl = effectiveBaseUrl || 'https://api.openai.com/v1';
        normalizedBaseUrl = normalizedBaseUrl.replace(/\/+$/, '');
        if (!normalizedBaseUrl.endsWith('/v1') && !normalizedBaseUrl.includes('/v1/')) {
          normalizedBaseUrl = `${normalizedBaseUrl}/v1`;
        }
        testUrl = `${normalizedBaseUrl}/chat/completions`;
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

router.post('/test-image-model', async (req: Request, res: Response) => {
  try {
    const defaultKey = await getDefaultApiKey(DEFAULT_USER_ID, 'image');
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
      const normalizedUrl = normalizeBaseUrl(baseUrl, config.defaultBaseUrl);
      testUrl = `${normalizedUrl}${config.testEndpoint}`;
    } else {
      testUrl = `${config.defaultBaseUrl}${config.testEndpoint}`;
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

export default router;
