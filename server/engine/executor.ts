import type { DesignSpec, SpecLock, SpecSlide } from './spec.js';
import { renderSpecLockMarkdown } from './ppt-exporter.js';

const IMAGE_INTENT_PATTERN =
  /(配图|图片|插图|图示|示意图|视觉|场景图|海报|照片|封面图|背景图|产品图|架构图|流程图|路线图|信息图|生成图|image|illustration|visual|photo|poster|diagram|infographic)/i;

export function buildExecutorSystemPrompt(spec: DesignSpec, lock: SpecLock): string {
  const { canvas } = spec;
  const specLockMarkdown = renderSpecLockMarkdown({ ...lock, skillExtensions: [] });

  return `你是 PPT Master 的 Executor，只负责当前单页 SVG 排版。

硬性要求：
1. 只输出 SVG，不要 Markdown，不要解释。
2. SVG 必须是合法 XML，根元素 viewBox="0 0 ${canvas.width} ${canvas.height}"，width="${canvas.width}"，height="${canvas.height}"。
3. 只能使用 spec_lock 中列出的颜色、字体和字号。
4. 禁止使用渐变、<style>、class、<foreignObject>、<mask>、rgba()、@font-face、<animate>、<script>、<textPath>、<g opacity>、<image opacity>。
5. 文本使用 <text> 和 <tspan>，XML 保留字符必须转义。
6. 顶层内容使用 <g id="..."> 分组，id 使用英文 kebab-case。
7. 不要引用不存在的图片；除非用户提供短 http/https 图片 URL，否则不要写 <image>。如果提供了图片 URL，当前页必须至少使用一次 <image href="图片URL">，并用 x/y/width/height 明确放置。
8. 模板、提示词和 Skill 已经在 Strategist 阶段折算进规格；本阶段不要追加 Skill 规则。
9. 不要输出通用灰底 bullet 页。必须根据 layout/rhythm 设计当前页构图：cover 强视觉中心，toc 有目录结构，content-chart 有图表结构，content-image 有图片区，ending 有收束感。即使没有图片，也要用 SVG 形状、分栏、编号、轴线或信息框表达差异。

spec_lock:
${specLockMarkdown}`;
}

export function buildExecutorPagePrompt(
  slide: SpecSlide,
  spec: DesignSpec,
  lock: SpecLock,
  imageUrl?: string
): string {
  const pageKey = `P${String(slide.pageNumber).padStart(2, '0')}`;
  const rhythm = lock.pageRhythm[pageKey] || slide.rhythm;
  const layout = lock.pageLayouts[pageKey] || slide.layout;
  const chart = lock.pageCharts[pageKey] || slide.chartHint || '';
  const bullets = slide.bullets.slice(0, 8).join(' | ') || '无';
  const needsVisual = Boolean(
    slide.visualPrompt ||
    ['content-image', 'text-image', 'image-text', 'full-image'].includes(String(slide.layout)) ||
    IMAGE_INTENT_PATTERN.test([slide.title, ...slide.bullets, slide.speakerNotes, slide.chartHint].filter(Boolean).join(' '))
  );
  const imageInstruction = imageUrl
    ? `必须使用这张生成图片：${imageUrl}。请写入 <image href="${imageUrl}" x="..." y="..." width="..." height="..." preserveAspectRatio="xMidYMid slice"/>，并与文字排版协调。`
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

设计方向：${spec.visualTheme.style}
请让本页构图明显匹配 layout=${layout} 与 rhythm=${rhythm}，不要复用上一页版式。

输出纯 SVG。`;
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
  return svg.trim();
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function ensureImageUsedInSvg(svg: string, slide: SpecSlide, spec: DesignSpec, imageUrl?: string): string {
  if (!imageUrl || !svg || /<image\b/i.test(svg)) return svg;

  const canvas = spec.canvas;
  const layout = String(slide.layout || '').toLowerCase();
  const isFull = layout.includes('full') || layout.includes('cover');
  const isLeftImage = layout.includes('image-text');
  const margin = Math.round(canvas.width * 0.055);
  const top = Math.round(canvas.height * 0.19);
  const imageWidth = isFull ? Math.round(canvas.width * 0.46) : Math.round(canvas.width * 0.34);
  const imageHeight = isFull ? Math.round(canvas.height * 0.64) : Math.round(canvas.height * 0.52);
  const x = isLeftImage ? margin : canvas.width - margin - imageWidth;
  const y = isFull ? Math.round(canvas.height * 0.22) : top;
  const imageGroup = `
  <g id="generated-image">
    <rect x="${x - 8}" y="${y - 8}" width="${imageWidth + 16}" height="${imageHeight + 16}" fill="${spec.visualTheme.colors.surface}" stroke="${spec.visualTheme.colors.border}" stroke-width="1"/>
    <image href="${escapeAttribute(imageUrl)}" x="${x}" y="${y}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="xMidYMid slice"/>
  </g>`;

  const closeIndex = svg.toLowerCase().lastIndexOf('</svg>');
  if (closeIndex < 0) return svg;
  return `${svg.slice(0, closeIndex)}${imageGroup}\n${svg.slice(closeIndex)}`;
}
