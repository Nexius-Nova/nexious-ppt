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

export function normalizeSlideImagePlans(slide: SlideVisualInput) {
  const rawPlans = Array.isArray(slide.imagePlan) ? slide.imagePlan : [];
  const plans = rawPlans
    .slice(0, 4)
    .map((plan, index) => ({
      id: String(plan?.id || `img-${index + 1}`).replace(/[^\w-]/g, '-').slice(0, 40) || `img-${index + 1}`,
      prompt: String(plan?.prompt || '').trim(),
    }))
    .filter((plan) => plan.prompt);

  if (plans.length) return plans;

  const legacyPrompt = String(slide.visualPrompt || '').trim();
  if (!legacyPrompt || Array.isArray(slide.imagePlan)) return [];
  return [{ id: 'img-1', prompt: legacyPrompt }];
}

export function slideNeedsImage(slide: SlideVisualInput): boolean {
  if (Array.isArray(slide.imagePlan)) {
    return normalizeSlideImagePlans(slide).length > 0;
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
