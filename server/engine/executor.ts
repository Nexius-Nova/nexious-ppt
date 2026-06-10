import type { DesignSpec, SpecLock, SpecSlide } from './spec.js';
import { renderSpecLockMarkdown } from './ppt-exporter.js';

const IMAGE_INTENT_PATTERN =
  /(配图|图片|插图|图示|示意图|视觉|场景图|海报|照片|封面图|背景图|产品图|架构图|流程图|路线图|信息图|生成图|image|illustration|visual|photo|poster|diagram|infographic)/i;

const IMAGE_LAYOUTS = new Set(['mixed-media', 'visual-focus', 'media-grid', 'content-image', 'text-image', 'image-text', 'full-image']);

export interface ExecutorPromptContext {
  iconGuide?: string;
  chartTemplateSvg?: string;
}

export interface ExecutorImageAsset {
  id?: string;
  url: string;
  title?: string;
  prompt?: string;
  purpose?: string;
  style?: string;
}

export function buildExecutorSystemPrompt(spec: DesignSpec, lock: SpecLock, context: ExecutorPromptContext = {}): string {
  const { canvas } = spec;
  const specLockMarkdown = renderSpecLockMarkdown({ ...lock, skillExtensions: [] });

  return `你是 Nexious PPT 的 Executor，只负责当前单页 SVG 排版。

硬性要求：
1. 只输出 SVG，不要 Markdown，不要解释。
2. SVG 必须是合法 XML，根元素 viewBox="0 0 ${canvas.width} ${canvas.height}"，width="${canvas.width}"，height="${canvas.height}"。
3. 只能使用 spec_lock 中列出的颜色、字体和字号。
4. 禁止使用渐变、<style>、class、<foreignObject>、<mask>、rgba()、@font-face、<animate>、<script>、<textPath>、<g opacity>、<image opacity>。
5. 文本使用 <text> 和 <tspan>，XML 保留字符必须转义。
6. 顶层内容使用 <g id="..."> 分组，id 使用英文 kebab-case。
7. 不要引用不存在的图片；除非本页提供了图片素材 URL，否则不要写 <image>。如果提供了图片素材，必须按素材清单使用，不要编造新 URL。
8. 模板、提示词和 Skill 已经在 Strategist 阶段折算进规格；本阶段不要追加 Skill 规则。
9. 不要输出通用灰底 bullet 页。必须根据 layout/rhythm 设计当前页构图：cover 强视觉中心，toc 有目录结构，content-chart 有图表结构，mixed-media/visual-focus/media-grid 表示视觉内容参与叙事但不固定图片位置，ending 有收束感。即使没有图片，也要用 SVG 形状、分栏、编号、轴线或信息框表达差异。
10. 图片操作能力：可以对 <image> 自主设置 x/y/width/height；可以用 preserveAspectRatio="xMidYMid slice|meet|none" 做裁切或非等比缩放；可以用 transform="rotate(...)"、transform="scale(sx sy)" 或父级 <g transform="..."> 做旋转、等比/非等比缩放和平移；可以用 <clipPath> + rect/circle/ellipse/path/polygon 做规则或不规则剪切。图片不能越界、不能遮挡标题/正文/图表等关键信息。

Animation export structure:
- Use meaningful top-level <g> groups for visible animated content: title-block, hero-visual, key-message, chart-area, timeline, content-card-1, content-card-2, summary-bar.
- Keep background/chrome/static decoration in ids containing background, bg, header, footer, or chrome.
- Do not wrap the whole slide in one visible group; split important content so PPTX export can animate key elements naturally.

spec_lock:
${specLockMarkdown}
${context.iconGuide ? `\nNexious PPT icon guide:\n${context.iconGuide}` : ''}`;
}

export function buildExecutorPagePrompt(
  slide: SpecSlide,
  spec: DesignSpec,
  lock: SpecLock,
  imageInput?: string | ExecutorImageAsset[],
  _imageSlot?: unknown,
  context: ExecutorPromptContext = {}
): string {
  const pageKey = `P${String(slide.pageNumber).padStart(2, '0')}`;
  const rhythm = lock.pageRhythm[pageKey] || slide.rhythm;
  const layout = lock.pageLayouts[pageKey] || slide.layout;
  const chart = lock.pageCharts[pageKey] || slide.chartHint || '';
  const bullets = slide.bullets.slice(0, 8).join(' | ') || '无';
  const layoutText = String(slide.layout || '').toLowerCase();
  const needsVisual = Boolean(
    (slide.imagePlan || []).length ||
    slide.visualPrompt ||
    IMAGE_LAYOUTS.has(layoutText) ||
    IMAGE_INTENT_PATTERN.test([slide.title, ...slide.bullets, slide.speakerNotes, slide.chartHint].filter(Boolean).join(' '))
  );
  const imageAssets = normalizeExecutorImageAssets(imageInput);
  const imageInstruction = imageAssets.length
    ? `本页可用图片素材如下，是否全部使用、使用几张、每张的位置/尺寸/裁切/旋转/缩放都由你根据内容自主决定，但被使用的素材必须来自清单，不能编造 URL：\n${formatExecutorImageAssets(imageAssets)}\n图片工具：使用 <image href="素材URL" x="..." y="..." width="..." height="..." preserveAspectRatio="xMidYMid slice|meet|none"/>；可用 <clipPath> + rect/circle/ellipse/path/polygon 做不规则剪切；可在 <image> 或父级 <g> 上使用 transform="rotate(angle cx cy) scale(sx sy) translate(dx dy)" 做旋转、非等比缩放和移动。不要固定套用某个图片位置，不要让图片压住标题、正文、编号、图表或关键组件。`
    : needsVisual
      ? `需要视觉表达：${slide.visualPrompt || slide.title}。当前没有可用图片 URL，请用 SVG 图形、示意框、图示或抽象插画表达，不要写 <image>。`
      : '不使用图片。';

  return `生成第 ${slide.pageNumber} 页 SVG。

页面：
- key: ${pageKey}
- title: ${slide.title}
- layout: ${layout}
- rhythm: ${rhythm}
- bullets: ${bullets}
- notes: ${slide.speakerNotes || '无'}
${chart ? `- chart: ${chart}` : ''}
- image: ${imageInstruction}
${context.chartTemplateSvg ? `\nNexious PPT chart template SVG reference. Learn only structure, coordinates, hierarchy, and visual proportion; replace all sample content with this slide's real content:\n${context.chartTemplateSvg}` : ''}

设计方向：${spec.visualTheme.style}
请让本页构图明显匹配 layout=${layout} 与 rhythm=${rhythm}，不要复用上一页版式。

输出纯 SVG。`;
}

function normalizeExecutorImageAssets(input?: string | ExecutorImageAsset[]): ExecutorImageAsset[] {
  if (!input) return [];
  if (typeof input === 'string') {
    const url = input.trim();
    return url ? [{ id: 'img-1', url }] : [];
  }
  return input
    .filter((asset) => asset?.url && !String((asset as any).error || '').trim())
    .slice(0, 8)
    .map((asset, index) => ({
      id: String(asset.id || `img-${index + 1}`),
      url: String(asset.url),
      title: asset.title ? String(asset.title) : undefined,
      prompt: asset.prompt ? String(asset.prompt).slice(0, 360) : undefined,
      purpose: asset.purpose ? String(asset.purpose).slice(0, 80) : undefined,
      style: asset.style ? String(asset.style).slice(0, 80) : undefined,
    }));
}

function formatExecutorImageAssets(assets: ExecutorImageAsset[]) {
  return assets.map((asset, index) => [
    `- assetId: ${asset.id || `img-${index + 1}`}`,
    `url: ${asset.url}`,
    asset.purpose ? `purpose: ${asset.purpose}` : '',
    asset.style ? `style: ${asset.style}` : '',
    asset.prompt ? `prompt: ${asset.prompt}` : '',
  ].filter(Boolean).join('；')).join('\n');
}

export function cleanSvgOutput(raw: string): string {
  let svg = raw.trim();
  if (svg.startsWith('```')) {
    svg = svg.replace(/^```(?:svg|xml)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  const startIdx = svg.indexOf('<svg');
  if (startIdx > 0) {
    svg = svg.slice(startIdx);
  }
  const endIdx = svg.lastIndexOf('</svg>');
  if (endIdx >= 0 && endIdx < svg.length - 6) {
    svg = svg.slice(0, endIdx + 6);
  }
  return sanitizeGeneratedSvg(svg.trim());
}

export function sanitizeGeneratedSvg(svg: string): string {
  let result = String(svg || '');
  result = result.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  result = result.replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '');
  result = result.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '');
  result = result.replace(/<object\b[\s\S]*?<\/object>/gi, '');
  result = result.replace(/<embed\b[\s\S]*?<\/embed>/gi, '');
  result = result.replace(/<audio\b[\s\S]*?<\/audio>/gi, '');
  result = result.replace(/<video\b[\s\S]*?<\/video>/gi, '');
  result = result.replace(/\s+on[a-z]+\s*=\s*(['"])[\s\S]*?\1/gi, '');
  result = result.replace(/\s+(?:href|xlink:href)\s*=\s*(['"])\s*javascript:[\s\S]*?\1/gi, '');
  result = result.replace(/\s+(?:href|xlink:href)\s*=\s*(['"])\s*data:(?!image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,)[\s\S]*?\1/gi, '');
  result = result.replace(/<image\b([^>]*?)\s+(?:href|xlink:href)\s*=\s*(['"])(https?:\/\/(?![^'"]*\/generated-images\/)[^'"]+)\2([^>]*)\/?>/gi, '');
  result = result.replace(/<use\b[^>]*(?:href|xlink:href)\s*=\s*(['"])\s*(?:https?:|javascript:)[\s\S]*?\1[^>]*\/?>/gi, '');
  return result.trim();
}

export function ensureImageUsedInSvg(svg: string, _slide: SpecSlide, _spec: DesignSpec, imageInput?: string | ExecutorImageAsset[]): string {
  if (!imageInput || !svg) return svg;
  return svg;
}
