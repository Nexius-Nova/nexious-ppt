import type { TemplateAssetSettings, PptProjectState } from '@/types/agent';

export type TemplateSourceProject = {
  id: string | number;
  title?: string | null;
  topic?: string | null;
  description?: string | null;
  content?: string | null;
  state?: PptProjectState | string | null;
};

export type TemplateProjectPayload = {
  name: string;
  category: string;
  description: string;
  slide_count: number;
  accent: string;
  settings: TemplateAssetSettings;
  is_public: boolean;
};

function parseProjectState(value: TemplateSourceProject['state']): PptProjectState | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as PptProjectState;
    } catch {
      return null;
    }
  }
  return value;
}

function unique(values: Array<string | undefined | null>) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function titleOf(project: TemplateSourceProject) {
  return String(project.title || project.topic || '未命名 PPT').trim();
}

function getOutline(state: PptProjectState | null) {
  return state?.designSpec?.outline?.length ? state.designSpec.outline : state?.outline || [];
}

function describeSlide(slide: any) {
  const bullets = Array.isArray(slide.bullets) ? slide.bullets.filter(Boolean).slice(0, 2).join('；') : '';
  return slide.speakerNotes || bullets || slide.visualPrompt || undefined;
}

function pickPreviewSvgPages(state: PptProjectState | null) {
  const pages = (state?.svgPages || [])
    .filter((page) => page.svg?.trim())
    .sort((a, b) => a.pageNumber - b.pageNumber);
  if (pages.length <= 4) return pages;

  const first = pages[0];
  const last = pages[pages.length - 1];
  const middle = pages.slice(1, -1).slice(0, 2);
  return [first, ...middle, last].filter(Boolean);
}

export function buildTemplatePayloadFromProject(
  project: TemplateSourceProject,
  options: { name?: string; category?: string; isPublic?: boolean } = {}
): TemplateProjectPayload {
  const state = parseProjectState(project.state);
  const spec = state?.designSpec || null;
  const lock = state?.specLock || null;
  const outline = getOutline(state);
  const colors = spec?.visualTheme?.colors || lock?.colors;
  const typography = spec?.typography || lock?.typography;
  const projectTitle = titleOf(project);
  const topic = String(project.topic || state?.input?.topic || projectTitle).trim();
  const content = String(project.content || project.description || state?.input?.content || '').trim();
  const layouts = unique([
    ...outline.map((slide: any) => slide.layout),
    ...Object.values(lock?.pageLayouts || {}),
  ]);
  const contentLayouts = layouts.filter((layout) => !['cover', 'chapter', 'toc', 'ending', 'content-chart'].includes(layout));
  const dataLayouts = unique([
    ...layouts.filter((layout) => layout === 'content-chart'),
    ...outline.map((slide: any) => slide.chartHint),
    ...Object.values(lock?.pageCharts || {}),
  ]);
  const colorPalette = unique([
    colors?.primary,
    colors?.secondary,
    colors?.accent,
    colors?.background,
    colors?.surface,
  ]).slice(0, 5);
  const preferredSlideCount = outline.length || state?.parameters?.slideCount || 10;
  const previewSvgPages = pickPreviewSvgPages(state);
  const slidesForPreview = previewSvgPages.length
    ? previewSvgPages
    : outline.slice(0, 8).map((slide: any, index: number) => ({
        pageNumber: Number(slide.pageNumber) || index + 1,
        svg: '',
        speakerNotes: slide.speakerNotes || '',
      }));

  return {
    name: options.name || `${projectTitle} 模板`,
    category: options.category || '我的 PPT',
    description: spec?.visualTheme?.style || content.slice(0, 120) || `从「${projectTitle}」沉淀的 PPT 方案`,
    slide_count: preferredSlideCount,
    accent: colors?.accent || colors?.primary || '#334155',
    is_public: Boolean(options.isPublic),
    settings: {
      styleGuide: {
        visualTone: spec?.visualTheme?.style || '从现有 PPT 提取的视觉风格',
        colorPalette: colorPalette.length >= 3 ? colorPalette : ['#334155', '#172026', '#C9A227'],
        typography: typography
          ? `${typography.titleFamily || typography.fontFamily} / ${typography.bodyFamily || typography.fontFamily}`
          : '沿用原 PPT 的中文排版层级',
        iconStyle: spec?.iconStyle || lock?.iconStyle || '沿用原 PPT 图标风格',
      },
      layoutGuide: {
        cover: layouts.includes('cover') ? '沿用原 PPT 封面构图' : '封面突出主题和关键结论',
        section: layouts.includes('chapter') ? '沿用原 PPT 章节页节奏' : '按内容需要设置章节页',
        contentLayouts: contentLayouts.length ? contentLayouts : ['内容页', '图文页', '对比页'],
        dataLayouts: dataLayouts.length ? dataLayouts : ['指标卡', '趋势图', '矩阵分析'],
        summary: layouts.includes('ending') ? '沿用原 PPT 总结页收束方式' : '总结页提炼结论和下一步行动',
      },
      outlinePattern: outline.length
        ? outline.map((slide: any) => String(slide.title || `第 ${slide.pageNumber || ''} 页`).trim()).filter(Boolean)
        : ['背景与目标', '核心内容', '方案设计', '执行路径', '总结展望'],
      previewSlides: slidesForPreview.map((page: any, index: number) => {
        const slide = outline.find((item: any) => Number(item.pageNumber) === Number(page.pageNumber)) || outline[index] || {};
        return {
          title: String(slide.title || `示例页 ${index + 1}`),
          layout: String(slide.layout || (index === 0 ? 'cover' : 'content')),
          description: describeSlide(slide),
          svg: page.svg || undefined,
          pageNumber: Number(page.pageNumber) || index + 1,
        };
      }),
      constraints: {
        preferredSlideCount,
        suitableFor: unique([topic, projectTitle, '我的 PPT']),
        avoid: ['不要照搬原 PPT 的具体业务文案', '未主动选择该模板时不要影响其他项目'],
      },
    },
  };
}
