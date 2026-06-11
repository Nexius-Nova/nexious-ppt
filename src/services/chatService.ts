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
  selectedPrompt?: string;
  selectedTemplate?: string;
  enabledSkills?: string[];
  generatedImages?: Array<{ slideId: string; title: string; ready: boolean }>;
  svgPages?: number[];
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
3. 调整当前 PPT 的模板、提示词、生成参数、版本和工作流状态
4. 重试指定图片或 SVG 页面，替换指定 SVG 页中的文本

## 可识别的操作指令
当用户要求修改内容时，在回复中插入以下指令（回复中只能包含一种action指令）：

修改标题: [action:updateSlideTitle] slideId="ID" title="新标题"
修改第N页标题: [action:updateSlideIndex] index="3" title="新标题"
添加要点: [action:addBullet] slideId="ID" text="新的要点内容"
为第N页添加要点: [action:addBulletByIndex] index="3" text="新的要点内容"
删除要点: [action:deleteBullet] slideId="ID" index="2"
编辑讲稿: [action:updateNotes] slideId="ID" text="讲稿内容"
添加页面: [action:addSlide] title="页面标题"
选择提示词: [action:selectPrompt] promptId="ID"
选择模板: [action:selectTemplate] templateId="ID"
仅当用户明确点名要求时启用或停用 Skill: [action:toggleSkill] skillId="ID" enabled="true"
设置参数: [action:setParameter] key="slideCount" value="10"
重试图片: [action:retryImage] slideId="ID"
重试第N页 SVG: [action:retryPage] pageNumber="3"
替换 SVG 文本: [action:editSvgText] pageNumber="3" from="原文字" to="新文字"
保存工作流: [action:saveWorkflow]
暂停工作流: [action:pauseWorkflow]
继续工作流: [action:continueWorkflow]
切换版本: [action:restoreVersion] versionId="ID"
删除图片（前端会二次确认）: [action:deleteImage] slideId="ID"
删除页面（前端会二次确认）: [action:deletePage] pageNumber="3"

## 回复规则
- 自然对话时不需要使用 action 指令
- 仅当用户明确要求修改时才使用 action 指令
- 不要主动推荐、自动选择或自动启用 Skill；用户没有明确选择 Skill 时，生成流程只使用内置功能
- 一次回复只能包含一个 action 指令
- 先自然回复用户，再用 action 指令执行修改`;

function buildContextBlock(context: ChatContext): string {
  return `\n## 当前文稿上下文\n- 当前步骤: ${context.currentStep}\n- 总页数: ${context.totalSlides}\n- 页面列表:\n${context.slideTitles.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}\n- 参数:\n${Object.entries(context.parameters).map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n- 当前提示词: ${context.selectedPrompt || '无'}\n- 当前模板: ${context.selectedTemplate || '无'}\n- 已启用 Skill: ${(context.enabledSkills || []).join('、') || '无'}\n- 已生成图片:\n${(context.generatedImages || []).map((img) => `  ${img.title} (${img.slideId}): ${img.ready ? '可用' : '不可用'}`).join('\n') || '  无'}\n- 已生成 SVG 页: ${(context.svgPages || []).join('、') || '无'}`;
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
