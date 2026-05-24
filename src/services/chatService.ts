import { api } from './api';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatContext {
  currentStep: string;
  totalSlides: number;
  slideTitles: string[];
  parameters: Record<string, unknown>;
}

export interface ChatStreamCallbacks {
  onContent: (text: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
}

const SYSTEM_PROMPT = `你是一个 AI PPT 生成助手，帮助用户编辑和优化演示文稿。

## 你的能力
1. 回答关于 PPT 内容、结构、设计的问题
2. 执行用户指令修改幻灯片内容

## 可识别的操作指令
当用户要求修改内容时，在回复中插入以下指令（回复中只能包含一种action指令）：

修改标题: [action:updateSlideTitle] slideId="ID" title="新标题"
修改第N页标题: [action:updateSlideIndex] index="3" title="新标题"
添加要点: [action:addBullet] slideId="ID" text="新的要点内容"
为第N页添加要点: [action:addBulletByIndex] index="3" text="新的要点内容"
删除要点: [action:deleteBullet] slideId="ID" index="2"
编辑讲稿: [action:updateNotes] slideId="ID" text="讲稿内容"
添加页面: [action:addSlide] title="页面标题"

## 回复规则
- 自然对话时不需要使用 action 指令
- 仅当用户明确要求修改时才使用 action 指令
- 一次回复只能包含一个 action 指令
- 先自然回复用户，再用 action 指令执行修改`;

function buildContextBlock(context: ChatContext): string {
  return `\n## 当前文稿上下文\n- 当前步骤: ${context.currentStep}\n- 总页数: ${context.totalSlides}\n- 页面列表:\n${context.slideTitles.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}\n- 参数:\n${Object.entries(context.parameters).map(([k, v]) => `  ${k}: ${v}`).join('\n')}`;
}

export const chatService = {
  async sendMessage(
    messages: ChatMessage[],
    context: ChatContext,
    callbacks: ChatStreamCallbacks
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let fullText = '';

      // Build context message
      const contextMessage: ChatMessage = {
        role: 'system',
        content: SYSTEM_PROMPT + buildContextBlock(context)
      };

      const apiMessages = [contextMessage, ...messages];

      api.stream(
        '/api/ai/chat-stream',
        { messages: apiMessages },
        (parsed) => {
          if (parsed.content) {
            fullText += parsed.content;
            callbacks.onContent(fullText);
          }
          if (parsed.status === 'complete') {
            callbacks.onComplete?.(fullText);
            resolve(fullText);
          }
          if (parsed.status === 'error') {
            const err = new Error(parsed.message || 'AI 回复失败');
            callbacks.onError?.(err);
            reject(err);
          }
        },
        (error) => {
          callbacks.onError?.(error);
          reject(error);
        }
      );
    });
  }
};
