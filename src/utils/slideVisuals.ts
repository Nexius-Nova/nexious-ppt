const IMAGE_LAYOUTS = new Set(['mixed-media', 'visual-focus', 'media-grid', 'content-image', 'text-image', 'image-text', 'full-image']);

const IMAGE_INTENT_PATTERN =
  /(配图|图片|插图|图示|示意图|视觉|场景图|海报|照片|封面图|背景图|产品图|架构图|流程图|路线图|信息图|生成图|image|illustration|visual|photo|poster|diagram|infographic)/i;
const EXPLICIT_IMAGE_INTENT_PATTERN =
  /(配图|图片|插图|图示|示意图|场景图|海报|照片|封面图|背景图|产品图|生成图|image|illustration|photo|poster|cover image|background image)/i;

interface SlideVisualInput {
  title?: string;
  bullets?: string[];
  speakerNotes?: string;
  visualPrompt?: string;
  imagePlan?: Array<{ id?: string; prompt?: string }>;
  chartHint?: string;
  layout?: string;
}

export function slideNeedsImage(slide: SlideVisualInput): boolean {
  if (Array.isArray(slide.imagePlan)) {
    return slide.imagePlan.some((plan) => String(plan?.prompt || '').trim());
  }

  const layout = String(slide.layout || '').toLowerCase();
  const visualPrompt = slide.visualPrompt?.trim() || '';
  if (visualPrompt) {
    return !layout.includes('cover') || EXPLICIT_IMAGE_INTENT_PATTERN.test(visualPrompt);
  }

  if (IMAGE_LAYOUTS.has(layout)) return true;

  const text = [
    slide.title,
    ...(slide.bullets || []),
    slide.speakerNotes,
    slide.chartHint,
  ].filter(Boolean).join(' ');

  if (layout.includes('cover')) {
    return EXPLICIT_IMAGE_INTENT_PATTERN.test(text);
  }

  return IMAGE_INTENT_PATTERN.test(text);
}
