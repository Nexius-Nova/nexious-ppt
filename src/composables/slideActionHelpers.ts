import type { SlideOutline } from '@/types/agent';

export interface SlideAction {
  type: string;
  params: Record<string, string>;
}

/**
 * Parse [action:xxx] directives from AI response text.
 * Example: [action:updateSlideTitle] slideId="s1" title="新标题"
 */
export function parseSlideActions(text: string): SlideAction[] {
  const actions: SlideAction[] = [];
  const regex = /\[action:(\w+)\]\s*([^\[]*)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const type = match[1];
    const paramStr = match[2].trim();
    const params: Record<string, string> = {};

    // Parse key="value" pairs
    const paramRegex = /(\w+)\s*=\s*"([^"]*)"/g;
    let pm: RegExpExecArray | null;
    while ((pm = paramRegex.exec(paramStr)) !== null) {
      params[pm[1]] = pm[2];
    }

    actions.push({ type, params });
  }

  return actions;
}

/**
 * Strip action directives from text for clean display.
 */
export function stripActionDirectives(text: string): string {
  return text.replace(/\[action:\w+\]\s*([^\[]*)/g, '').trim();
}

export interface ChatActionHandler {
  (action: SlideAction, outline: SlideOutline[]): {
    outline: SlideOutline[];
    feedback: string;
  } | null;
}

export function createSlideActionHandler(): ChatActionHandler {
  return (action: SlideAction, outline: SlideOutline[]): { outline: SlideOutline[]; feedback: string } | null => {
    const newOutline = outline.map(s => ({ ...s, bullets: [...s.bullets] }));

    switch (action.type) {
      case 'updateSlideTitle': {
        const slide = newOutline.find(s => s.id === action.params.slideId);
        if (!slide) return null;
        slide.title = action.params.title || slide.title;
        return { outline: newOutline, feedback: `已将「${slide.title}」标题更新为「${action.params.title}」` };
      }

      case 'updateSlideIndex': {
        const index = parseInt(action.params.index, 10) - 1;
        const slide = newOutline[index];
        if (!slide) return null;
        slide.title = action.params.title || slide.title;
        return { outline: newOutline, feedback: `已将第 ${index + 1} 页标题更新` };
      }

      case 'addBullet': {
        const slide = newOutline.find(s => s.id === action.params.slideId);
        if (!slide) return null;
        slide.bullets.push(action.params.text || '新要点');
        return { outline: newOutline, feedback: `已为「${slide.title}」添加要点` };
      }

      case 'addBulletByIndex': {
        const index = parseInt(action.params.index, 10) - 1;
        const slide = newOutline[index];
        if (!slide) return null;
        slide.bullets.push(action.params.text || '新要点');
        return { outline: newOutline, feedback: `已为第 ${index + 1} 页添加要点` };
      }

      case 'deleteBullet': {
        const slide = newOutline.find(s => s.id === action.params.slideId);
        if (!slide) return null;
        const bIndex = parseInt(action.params.index, 10);
        if (isNaN(bIndex) || bIndex < 0 || bIndex >= slide.bullets.length) return null;
        slide.bullets.splice(bIndex, 1);
        return { outline: newOutline, feedback: `已删除「${slide.title}」的要点` };
      }

      case 'updateNotes': {
        const slide = newOutline.find(s => s.id === action.params.slideId);
        if (!slide) return null;
        slide.speakerNotes = action.params.text || '';
        return { outline: newOutline, feedback: `已更新「${slide.title}」的演讲备注` };
      }

      case 'addSlide': {
        const newSlide: SlideOutline = {
          id: `slide-${Date.now()}`,
          title: action.params.title || '新幻灯片',
          bullets: ['点击添加要点'],
          speakerNotes: '',
          visualPrompt: action.params.visualPrompt || ''
        };
        newOutline.push(newSlide);
        return { outline: newOutline, feedback: `已添加新幻灯片「${newSlide.title}」` };
      }

      default:
        return null;
    }
  };
}
