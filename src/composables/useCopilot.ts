import { api } from '@/services/api';

export type SuggestionType = 'polish' | 'condense' | 'expand' | 'data';

export interface Suggestion {
  type: SuggestionType;
  label: string;
  loading: boolean;
  result: string | null;
}

export function getSuggestionLabel(type: SuggestionType): string {
  const map: Record<SuggestionType, string> = {
    polish: '优化措辞',
    condense: '精简内容',
    expand: '补充细节',
    data: '添加数据'
  };
  return map[type];
}

export function buildSuggestionPrompt(
  type: SuggestionType,
  title: string,
  bullets: string[]
): string {
  const content = `标题: ${title}\n要点:\n${bullets.map((b, i) => `${i + 1}. ${b}`).join('\n')}`;

  const prompts: Record<SuggestionType, string> = {
    polish: `请优化以下 PPT 幻灯片的内容，让语言更专业、有说服力。保持核心信息不变，优化措辞和表达方式。\n\n${content}\n\n请直接返回优化后的标题和要点，格式为：\n标题: xxx\n要点:\n1. xxx\n2. xxx`,
    condense: `请精简以下 PPT 幻灯片的内容，保留最核心的信息。减少不必要的修饰词，让每句话更有力。\n\n${content}\n\n请直接返回精简后的标题和要点。`,
    expand: `请为以下 PPT 幻灯片补充更多细节和支持内容。每增加一个要点或补充说明时，确保与原内容逻辑一致。\n\n${content}\n\n请直接返回补充后的标题和要点。`,
    data: `请为以下 PPT 幻灯片添加数据支持的建议。识别可以作为数据点强化的内容，并提供具体的数据表达方式（如"增长 50%"而非"显著增长"）。\n\n${content}\n\n请直接返回添加数据后的标题和要点。`
  };

  return prompts[type];
}

export function parseSuggestionResult(text: string): { title: string; bullets: string[] } | null {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let title = '';
  const bullets: string[] = [];
  let inBullets = false;

  for (const line of lines) {
    if (line.startsWith('标题:') || line.startsWith('title:')) {
      title = line.replace(/^(标题:|title:)\s*/i, '').trim();
    } else if (line.startsWith('要点:') || line.startsWith('要点：') || line.startsWith('bullets:')) {
      inBullets = true;
    } else if (inBullets && /^\d+[\.\、\s]/.test(line)) {
      bullets.push(line.replace(/^\d+[\.\、\s]+/, '').trim());
    } else if (inBullets && line.startsWith('-') || line.startsWith('•')) {
      bullets.push(line.replace(/^[-•]\s*/, '').trim());
    }
  }

  if (!title && bullets.length === 0) return null;
  if (!title) title = text.split('\n')[0]?.replace(/^["""]|["""]$/g, '').trim() || '';

  return { title, bullets };
}

export async function generateSuggestion(
  type: SuggestionType,
  title: string,
  bullets: string[],
  onContent: (text: string) => void
): Promise<string> {
  const prompt = buildSuggestionPrompt(type, title, bullets);

  let fullText = '';

  await api.stream(
    '/api/ai/chat-stream',
    {
      messages: [
        { role: 'user', content: prompt }
      ]
    },
    (parsed) => {
      if (parsed.content) {
        fullText += parsed.content;
        onContent(fullText);
      }
      if (parsed.status === 'complete') {
        // done
      }
    },
    (error) => {
      console.error('Copilot suggestion error:', error);
    }
  );

  return fullText;
}
