import type { Response } from 'express';
import { buildOpenAIEndpoint, normalizeOpenAIBaseUrl } from '../utils/openaiUrl.js';

export interface Message {
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

export async function streamText(
  provider: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  messages: Message[],
  res?: Response
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
      if (apiMessage) errorMessage = apiMessage;
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
          res?.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      } catch {
        // ignore malformed provider chunks
      }
    }
  }

  return fullContent;
}
