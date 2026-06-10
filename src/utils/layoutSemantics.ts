const LEGACY_VISUAL_LAYOUTS = new Set(['text-image', 'image-text', 'content-image']);

export function normalizeSlideLayout(layout?: string | null): string {
  const raw = String(layout || '').trim().toLowerCase();
  if (!raw) return 'text-only';
  if (LEGACY_VISUAL_LAYOUTS.has(raw)) return 'mixed-media';
  if (raw === 'full-image') return 'visual-focus';
  return raw;
}

export function layoutNeedsVisual(layout?: string | null): boolean {
  const normalized = normalizeSlideLayout(layout);
  return normalized !== 'text-only'
    && normalized !== 'title-center'
    && normalized !== 'two-column'
    && normalized !== 'content'
    && normalized !== 'toc'
    && normalized !== 'chapter'
    && normalized !== 'ending';
}

export function getLayoutLabel(layout?: string | null): string {
  const normalized = normalizeSlideLayout(layout);
  const labels: Record<string, string> = {
    'text-only': '纯文字',
    content: '内容页',
    cover: '封面页',
    toc: '目录页',
    chapter: '章节页',
    ending: '收束页',
    'mixed-media': '图文混排',
    'visual-focus': '视觉主导',
    'media-grid': '多图素材',
    'content-chart': '图表页',
    'full-image': '视觉主导',
    'title-center': '居中标题',
    'two-column': '双栏'
  };
  return labels[normalized] || normalized.replace(/[-_]+/g, ' ');
}
