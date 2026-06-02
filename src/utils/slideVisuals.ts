const IMAGE_LAYOUTS = new Set(['content-image', 'text-image', 'image-text', 'full-image']);

const IMAGE_INTENT_PATTERN =
  /(配图|图片|插图|图示|示意图|视觉|场景图|海报|照片|封面图|背景图|产品图|架构图|流程图|路线图|信息图|生成图|image|illustration|visual|photo|poster|diagram|infographic)/i;

interface SlideVisualInput {
  title?: string;
  bullets?: string[];
  speakerNotes?: string;
  visualPrompt?: string;
  chartHint?: string;
  layout?: string;
}

export function slideNeedsImage(slide: SlideVisualInput): boolean {
  const visualPrompt = slide.visualPrompt?.trim() || '';
  if (visualPrompt) return true;

  if (slide.layout && IMAGE_LAYOUTS.has(slide.layout)) return true;

  const text = [
    slide.title,
    ...(slide.bullets || []),
    slide.speakerNotes,
    slide.chartHint,
  ].filter(Boolean).join(' ');

  return IMAGE_INTENT_PATTERN.test(text);
}
