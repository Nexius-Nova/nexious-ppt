import type { SpecSlide } from './spec.js';

export type ImageCompositionIntent =
  | 'background'
  | 'diagram'
  | 'product'
  | 'people'
  | 'decorative'
  | 'illustration';

export interface ImageSlotHint {
  width: number;
  height: number;
  aspectRatio: number;
  placement?: string;
  fit?: 'cover' | 'contain';
  layout?: string;
  intent?: ImageCompositionIntent;
}

const DIAGRAM_PATTERN = /(流程|路径|路线|时间线|架构|结构|关系|矩阵|漏斗|地图|图谱|对比|信息图|图解|示意|框架|chart|diagram|flow|timeline|roadmap|architecture|matrix|map|infographic)/i;
const BACKGROUND_PATTERN = /(封面|背景|海报|主视觉|氛围|场景|banner|cover|background|hero|poster|scene)/i;
const PRODUCT_PATTERN = /(产品|设备|手机|电脑|汽车|机器|硬件|界面|应用|app|product|device|phone|car|machine|hardware|interface)/i;
const PEOPLE_PATTERN = /(人物|团队|用户|客户|员工|讲师|学生|医生|人像|people|person|team|user|customer|portrait)/i;
const DECORATIVE_PATTERN = /(装饰|纹理|抽象|图案|点缀|辅助|decorative|texture|abstract|pattern|ornament)/i;

function slideText(slide?: Partial<SpecSlide>) {
  if (!slide) return '';
  return [
    slide.title,
    ...(slide.bullets || []),
    slide.visualPrompt,
    slide.speakerNotes,
    slide.chartHint,
    slide.layout,
  ].filter(Boolean).join(' ');
}

export function inferImageCompositionIntent(input?: Partial<SpecSlide> | string): ImageCompositionIntent {
  const text = typeof input === 'string' ? input : slideText(input);
  const layout = typeof input === 'string' ? '' : String(input?.layout || '');

  if (DIAGRAM_PATTERN.test(text) || layout.includes('chart')) return 'diagram';
  if (BACKGROUND_PATTERN.test(text) || layout.includes('cover') || layout.includes('full')) return 'background';
  if (PRODUCT_PATTERN.test(text)) return 'product';
  if (PEOPLE_PATTERN.test(text)) return 'people';
  if (DECORATIVE_PATTERN.test(text)) return 'decorative';
  return 'illustration';
}

export function shouldUseContainFitForSlide(slide: SpecSlide): boolean {
  return inferImageCompositionIntent(slide) === 'diagram';
}

export function buildImageCompositionPrompt(intent: ImageCompositionIntent, slot?: ImageSlotHint): string {
  const ratioText = slot
    ? `最终用于 PPT 图片槽位：${Math.round(slot.width)}x${Math.round(slot.height)}，比例 ${slot.aspectRatio.toFixed(2)}:1，位置 ${slot.placement || 'content'}。`
    : '最终用于横向 PPT 页面插图。';
  const fit = slot?.fit || (intent === 'diagram' ? 'contain' : 'cover');

  const rules: Record<ImageCompositionIntent, string> = {
    background: '作为封面、背景或主视觉使用，画面要有明确视觉中心和足够延展空间；允许边缘被轻微裁切，但关键主体、人物脸部、产品标识不要贴边或被裁掉。',
    diagram: '作为信息图、流程图、路线图或结构示意使用，优先保证内容完整、层级清楚、关键节点可读；不要把节点贴到边缘，不要为了填满画面而裁切重要信息。',
    product: '作为产品或实物展示使用，主体清晰、有自然留白和使用场景；不要过度放大到只剩局部，也不要让主体变成很小的孤立物。',
    people: '作为人物或团队场景使用，人物姿态自然、面部和关键动作完整；保留适当环境上下文，不要让人物头部或手部被裁切。',
    decorative: '作为装饰或氛围辅助视觉使用，可以是纹理、抽象形态或轻量场景；不要抢占正文信息层级，不要生成大面积纯白空洞区域。',
    illustration: '作为内容插图使用，围绕页面主题组织构图；主体可以居中、偏左或偏右，保留适当呼吸感，不要机械填满画面。',
  };

  const fitRule = fit === 'contain'
    ? '图片后续会以完整显示为优先，请保留安全边距，避免任何关键信息依赖画面边缘。'
    : '图片后续可能按槽位裁切，请把关键视觉放在安全区域内，边缘只放可裁切的环境或装饰。';

  return `${ratioText}${rules[intent]}${fitRule}不要生成文字、水印、截图边框或 UI 截图式外壳。`;
}

export function buildImageSlotPrompt(slot?: ImageSlotHint, promptText = ''): string {
  const intent = slot?.intent || inferImageCompositionIntent(promptText);
  return buildImageCompositionPrompt(intent, slot);
}

export function buildSlideImagePrompt(slide: SpecSlide, slot?: ImageSlotHint): string {
  const basePrompt = slide.visualPrompt || [slide.title, ...(slide.bullets || [])].filter(Boolean).join('，');
  const intent = inferImageCompositionIntent(slide);
  if (!slot) return `${basePrompt}。${buildImageCompositionPrompt(intent)}`;
  return [
    basePrompt,
    `第 ${slide.pageNumber} 页图片用途：${intent}`,
    buildImageCompositionPrompt(intent, { ...slot, intent }),
  ].join('。');
}
