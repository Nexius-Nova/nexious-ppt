import type { DesignSpec, SpecSlide, SkillExtension } from './spec.js';
import { CANVAS_FORMATS, normalizeColors, normalizeTypography } from './spec.js';

type TemplatePreviewSlide = { title: string; layout: string; description?: string; svg?: string; pageNumber?: number; visualSummary?: string };
const MAX_TEMPLATE_SVG_SNIPPET_CHARS = 1600;
const templatePreviewSummaryCache = new Map<string, string>();

function inferTopicFromInput(input: Pick<StrategistInput, 'topic' | 'content'>) {
  const topic = String(input.topic || '').trim();
  if (topic) return topic;

  const content = String(input.content || '').trim().replace(/\s+/g, ' ');
  const explicit = content.match(/(?:PPT\s*)?(?:主题|标题)\s*[：:]\s*([^。；;\n]{2,60})/i)?.[1]?.trim();
  if (explicit) return explicit.slice(0, 60);
  if (content) return content.slice(0, 28);
  return '';
}

export interface StrategistInput {
  topic: string;
  content: string;
  tone: string;
  summaryLength: string;
  slideCount?: number;
  imageStyle: string;
  template: string;
  templateAsset?: {
    id: string;
    name: string;
    category?: string;
    description?: string;
    slideCount?: number;
    accent?: string;
    settings?: {
      styleGuide?: {
        visualTone?: string;
        colorPalette?: string[];
        typography?: string;
        iconStyle?: string;
      };
      layoutGuide?: {
        cover?: string;
        section?: string;
        contentLayouts?: string[];
        dataLayouts?: string[];
        summary?: string;
      };
      outlinePattern?: string[];
      previewSlides?: TemplatePreviewSlide[];
      constraints?: {
        preferredSlideCount?: number;
        suitableFor?: string[];
        avoid?: string[];
      };
    };
  } | null;
  promptContent?: string;
  skills: Array<{ id: string; name: string; instruction?: string }>;
}

const MODE_BY_TONE: Record<string, DesignSpec['visualTheme']['mode']> = {
  professional: 'consulting',
  storytelling: 'versatile',
  teaching: 'versatile',
};

function getPreferredMode(tone: string): DesignSpec['visualTheme']['mode'] {
  if (!tone || tone === 'auto') return 'versatile';
  return MODE_BY_TONE[tone] || 'versatile';
}

export function buildStrategistPrompt(input: StrategistInput): { system: string; user: string } {
  const canvas = CANVAS_FORMATS.ppt169;
  const selectedTemplate = sanitizeTemplateAsset(input.templateAsset);
  const safeInput = { ...input, templateAsset: selectedTemplate };
  const mode = getPreferredMode(input.tone);
  const lengthGuide = getLengthGuide(input.summaryLength);
  const slideCountGuide = getSlideCountGuide(input.slideCount);
  const templateGuide = buildTemplateGuide(safeInput);
  const colorGuide = buildColorGuide(selectedTemplate);

  const skillExtensions: SkillExtension[] = input.skills.map((s) => ({
    skillId: s.id,
    skillName: s.name,
    strategistPrompt: s.instruction || undefined,
  }));

  const system = `你是 PPT Master 流程中的 Strategist。你的任务是把用户输入转换为可执行的 PPT 设计规格 JSON，后续 Executor 会逐页生成 SVG 并导出 PowerPoint。

只输出严格 JSON，不要输出 Markdown，不要解释。JSON 必须符合以下结构：
{
  "projectInfo": {
    "title": "演示文稿标题",
    "topic": "主题",
    "audience": "目标受众",
    "occasion": "使用场景"
  },
  "canvas": { "format": "ppt169", "width": ${canvas.width}, "height": ${canvas.height} },
  "visualTheme": {
    "mode": "versatile|consulting|top-consulting",
    "style": "一句话描述视觉方向，不能使用渐变",
    "colors": {
${colorGuide}
    }
  },
  "typography": {
    "fontFamily": "Microsoft YaHei, PingFang SC, Arial, sans-serif",
    "titleFamily": "Microsoft YaHei, PingFang SC, Arial, sans-serif",
    "bodyFamily": "Microsoft YaHei, PingFang SC, Arial, sans-serif",
    "emphasisFamily": "Georgia, SimSun, serif",
    "codeFamily": "Consolas, \\"Courier New\\", monospace",
    "bodySize": 20,
    "titleSize": 36,
    "subtitleSize": 26,
    "annotationSize": 14
  },
  "iconStyle": "chunk-filled|tabler-filled|tabler-outline|phosphor-duotone|none",
  "imageUsage": "none|ai-generated|user-provided|placeholder",
  "outline": [
    {
      "id": "slide-1",
      "pageNumber": 1,
      "title": "页面标题",
      "bullets": ["要点 1", "要点 2"],
      "speakerNotes": "演讲备注",
      "visualPrompt": "仅当确实需要配图时填写",
      "layout": "cover|chapter|toc|content|content-image|content-chart|ending",
      "rhythm": "anchor|dense|breathing",
      "chartHint": "仅图表页填写，如 bar_chart、timeline、matrix_2x2"
    }
  ]
}

硬性规则：
1. 不要等待确认，直接生成完整规格。
2. 第一页必须是 cover，最后一页建议是 ending；内容足够时可以加入 toc 或 chapter。
3. ${slideCountGuide}
4. rhythm 必须服务叙事：cover、toc、chapter、ending 用 anchor；信息密集页用 dense；单一观点或关键结论页用 breathing。
5. 颜色只能使用 HEX；不能使用渐变、rgba 或透明色；整体至少包含 3 个有区分度的色相，避免一整套单色系。
6. 未选择模板方案时，AI 必须根据主题自主决定主题风格、排版布局、大纲结构和颜色，不得固定套用 business、tech 或任何默认风格。
7. 只有 templateAsset 存在时，才参考模板方案。模板方案只影响当前项目，不允许变成全局风格。
8. 模板只提供视觉设计样式参考，包括色彩、字体、图标、版式节奏、构图比例、留白、装饰方式和 SVG 绘制风格；模板不得影响用户输入内容。
9. outline 的标题、要点、speakerNotes、visualPrompt 的语义内容必须来自用户主题、内容资料和额外提示词，不允许从模板名称、模板说明、模板示例页或模板 SVG 中提取业务内容。
10. layout 要先匹配用户内容，再借鉴模板的视觉版式。图表页用 content-chart；需要配图、场景图、示意图、封面图，或图片能明显提升表达时，用 content-image 并填写 visualPrompt。
11. speakerNotes 使用中文，能帮助演讲者自然讲述。
12. ${lengthGuide}
13. 默认视觉模式为 ${mode}。
14. 页面构图必须有变化，不要连续 3 页使用相同结构；每页 layout、rhythm、visualPrompt 都要和用户内容强相关。
15. 不要输出无法被 SVG 稳定实现的设计要求，例如复杂滤镜、外链字体、渐变背景。`;

  const user = `主题：${input.topic || '未提供，请从内容资料中自动提炼'}
内容资料：${input.content || '用户未提供详细资料，请基于主题生成结构完整、信息可信但不过度编造的演示文稿。'}

语言风格：${input.tone}
目标页数：${getTargetSlideCount(input.slideCount) || '由内容决定'}
图片风格：${input.imageStyle}
主题生成要求：如果主题未提供，请优先从内容资料中显式的“主题：xxx / 标题：xxx”提取；否则根据资料核心内容生成 projectInfo.title 和 projectInfo.topic。

${templateGuide}
${input.promptContent ? `\n额外提示词：\n${input.promptContent}` : ''}
${skillExtensions.length > 0 ? `\n启用的 Skill 扩展：\n${skillExtensions.map((s) => `- ${s.skillName}: ${s.strategistPrompt || '无额外说明'}`).join('\n')}` : ''}

请输出完整 JSON。`;

  return { system, user };
}

export function parseStrategistOutput(raw: string, input: StrategistInput): DesignSpec {
  let parsed: any;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    parsed = buildFallbackSpec(input);
  }

  const canvas = normalizeCanvas(parsed.canvas);
  const colors = normalizeColors(parsed.visualTheme?.colors, resolveFallbackTemplate(input));
  const typography = normalizeTypography(parsed.typography);
  const rawOutline = Array.isArray(parsed.outline) ? parsed.outline : [];
  const outline = normalizeOutline(rawOutline, input);
  const fallbackTopic = inferTopicFromInput(input);

  return {
    projectInfo: {
      title: parsed.projectInfo?.title || fallbackTopic || '未命名 PPT',
      topic: parsed.projectInfo?.topic || fallbackTopic || '未命名主题',
      audience: parsed.projectInfo?.audience || '通用受众',
      occasion: parsed.projectInfo?.occasion || '通用演示',
    },
    canvas,
    visualTheme: {
      mode: normalizeMode(parsed.visualTheme?.mode, input.tone),
      style: parsed.visualTheme?.style || '根据主题定制的清晰演示风格，不使用渐变',
      colors,
    },
    typography,
    iconStyle: normalizeIconStyle(parsed.iconStyle),
    imageUsage: normalizeImageUsage(parsed.imageUsage, input.imageStyle),
    outline,
    skillExtensions: input.skills.map((s) => ({
      skillId: s.id,
      skillName: s.name,
      strategistPrompt: s.instruction || undefined,
    })),
  };
}

function buildColorGuide(templateAsset: StrategistInput['templateAsset']) {
  const palette = templateAsset?.settings?.styleGuide?.colorPalette?.filter(Boolean) || [];
  if (templateAsset && palette.length >= 3) {
    return `      "primary": "${palette[0]}",
      "secondary": "${palette[1]}",
      "accent": "${palette[2]}",
      "background": "根据模板色板选择的 HEX 背景色",
      "surface": "内容承载面的 HEX 颜色",
      "text": "正文 HEX 颜色",
      "muted": "辅助文字 HEX 颜色",
      "border": "边框 HEX 颜色"`;
  }

  return `      "primary": "根据主题选择的 HEX 颜色，不要固定使用默认蓝灰或商务灰绿",
      "secondary": "与 primary 明显区分的 HEX 颜色",
      "accent": "用于强调的 HEX 颜色，必须与 primary/secondary 区分",
      "background": "浅色或深色 HEX 背景，由主题决定",
      "surface": "内容承载面的 HEX 颜色",
      "text": "正文 HEX 颜色",
      "muted": "辅助文字 HEX 颜色",
      "border": "边框 HEX 颜色"`;
}

function buildTemplateGuide(input: StrategistInput) {
  const template = sanitizeTemplateAsset(input.templateAsset);
  if (!template) {
    return '模板方案：未选择。请由 AI 根据当前主题、资料、受众和场景自主决定主题风格、排版布局、大纲结构、色彩和视觉节奏。不要沿用上一次项目或历史模板的风格。';
  }

  const settings = template.settings || {};
  const style = settings.styleGuide || {};
  const layout = settings.layoutGuide || {};
  const constraints = settings.constraints || {};
  return `模板方案：已选择「${template.name}」，仅作为当前项目参考。
分类：${template.category || '未分类'}
说明：${template.description || '无'}
主题风格：
- 视觉气质：${style.visualTone || '未设置'}
- 色彩参考：${(style.colorPalette || []).join('、') || template.accent || '未设置'}
- 字体建议：${style.typography || '清晰中文排版'}
- 图标风格：${style.iconStyle || '简洁图标'}
排版布局：
- 封面：${layout.cover || '按主题设计'}
- 章节：${layout.section || '按叙事需要设置'}
- 内容页：${(layout.contentLayouts || []).join('、') || '结合内容灵活安排'}
- 数据页：${(layout.dataLayouts || []).join('、') || '按数据表达选择'}
- 总结页：${layout.summary || '收束结论和行动建议'}
示例页 SVG 参考（只用于学习视觉样式、构图、元素比例和装饰语言，不得提取或复用其中的业务内容）：${formatTemplatePreviewSlides(settings.previewSlides)}
适用场景：${(constraints.suitableFor || []).join('、') || '未设置'}
避免：${(constraints.avoid || []).join('、') || '不要照搬示例文字'}`;
}

function formatTemplatePreviewSlides(previewSlides?: TemplatePreviewSlide[]) {
  if (!Array.isArray(previewSlides) || previewSlides.length === 0) return '无';
  return previewSlides
    .slice(0, 8)
    .map((slide: any, index) => {
      const meta = `${slide.title || `示例页 ${index + 1}`}（${slide.layout || 'content'}${slide.description ? `：${slide.description}` : ''}）`;
      const svgSummary = slide.visualSummary ? String(slide.visualSummary) : summarizeTemplateSvg(slide.svg);
      return `${meta}${svgSummary ? `\n视觉摘要：${svgSummary}` : ''}`;
    })
    .join('\n\n');
}

function summarizeTemplateSvg(svg?: string) {
  if (typeof svg !== 'string' || !svg.trim()) return '';
  const source = svg.trim();
  const cacheKey = source.slice(0, 4096);
  const cached = templatePreviewSummaryCache.get(cacheKey);
  if (cached) return cached;

  const tags = ['rect', 'circle', 'ellipse', 'line', 'path', 'text', 'image', 'g']
    .map((tag) => `${tag}:${(source.match(new RegExp(`<${tag}\\b`, 'gi')) || []).length}`)
    .join(', ');
  const colors = Array.from(new Set(source.match(/#[0-9a-fA-F]{3,8}\b/g) || [])).slice(0, 10);
  const fontSizes = Array.from(new Set(source.match(/font-size=["']?[\d.]+/gi) || [])).slice(0, 8);
  const viewBox = source.match(/viewBox=["']([^"']+)["']/i)?.[1] || '';
  const compactSnippet = source
    .replace(/>[\s\r\n]+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .slice(0, MAX_TEMPLATE_SVG_SNIPPET_CHARS);
  const summary = [
    viewBox ? `viewBox=${viewBox}` : '',
    `元素统计=${tags}`,
    colors.length ? `主要颜色=${colors.join(', ')}` : '',
    fontSizes.length ? `字号线索=${fontSizes.join(', ')}` : '',
    `短片段=${compactSnippet}`,
  ].filter(Boolean).join('；');

  if (templatePreviewSummaryCache.size > 80) {
    const firstKey = templatePreviewSummaryCache.keys().next().value;
    if (firstKey) templatePreviewSummaryCache.delete(firstKey);
  }
  templatePreviewSummaryCache.set(cacheKey, summary);
  return summary;
}

function sanitizeTemplateAsset(template: StrategistInput['templateAsset']): StrategistInput['templateAsset'] {
  if (!template) return null;
  const settings = template.settings || {};
  return {
    id: String(template.id || ''),
    name: String(template.name || ''),
    category: template.category ? String(template.category) : undefined,
    description: template.description ? String(template.description) : undefined,
    slideCount: Number(template.slideCount) || undefined,
    accent: template.accent ? String(template.accent) : undefined,
    settings: {
      styleGuide: settings.styleGuide
        ? {
            visualTone: settings.styleGuide.visualTone,
            colorPalette: Array.isArray(settings.styleGuide.colorPalette) ? settings.styleGuide.colorPalette.map(String) : undefined,
            typography: settings.styleGuide.typography,
            iconStyle: settings.styleGuide.iconStyle,
          }
        : undefined,
      layoutGuide: settings.layoutGuide
        ? {
            cover: settings.layoutGuide.cover,
            section: settings.layoutGuide.section,
            contentLayouts: Array.isArray(settings.layoutGuide.contentLayouts) ? settings.layoutGuide.contentLayouts.map(String) : undefined,
            dataLayouts: Array.isArray(settings.layoutGuide.dataLayouts) ? settings.layoutGuide.dataLayouts.map(String) : undefined,
            summary: settings.layoutGuide.summary,
          }
        : undefined,
      previewSlides: Array.isArray(settings.previewSlides)
        ? settings.previewSlides.slice(0, 8).map((slide) => ({
            title: String(slide.title || '示例页'),
            layout: String(slide.layout || 'content'),
            description: slide.description ? String(slide.description) : undefined,
            svg: typeof slide.svg === 'string' && slide.svg.trim() ? slide.svg : undefined,
            pageNumber: Number(slide.pageNumber) || undefined,
            visualSummary: slide.visualSummary ? String(slide.visualSummary) : undefined,
          }))
        : undefined,
      constraints: settings.constraints
        ? {
            suitableFor: Array.isArray(settings.constraints.suitableFor) ? settings.constraints.suitableFor.map(String) : undefined,
            avoid: Array.isArray(settings.constraints.avoid) ? settings.constraints.avoid.map(String) : undefined,
          }
        : undefined,
    },
  };
}

function getLengthGuide(summaryLength: string) {
  if (!summaryLength || summaryLength === 'auto') return 'AI 自动：根据资料密度、汇报场景和页面节奏自主决定每页详略。';
  if (summaryLength === 'detailed') return '详细：每页 4-6 个要点，讲稿需要能支撑演讲。';
  if (summaryLength === 'brief') return '简洁：每页 2-3 个要点，避免堆砌信息。';
  return '均衡：每页 3-5 个要点，表达完整但保持可读。';
}

function getTargetSlideCount(slideCount?: number): number | null {
  const parsed = Number(slideCount);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.min(60, Math.round(parsed)));
}

function getSlideCountGuide(slideCount?: number) {
  const target = getTargetSlideCount(slideCount);
  if (!target) return '页数根据内容决定，通常 6-12 页；材料很少时可以 4-6 页。';
  return `目标页数为 ${target} 页，outline 必须尽量输出 ${target} 个页面对象；除非资料严重不足，否则不要自行增减页数。`;
}

function normalizeCanvas(canvas: any): DesignSpec['canvas'] {
  if (canvas?.format === 'ppt43') {
    return CANVAS_FORMATS.ppt43;
  }
  return CANVAS_FORMATS.ppt169;
}

function normalizeMode(value: string | undefined, tone: string): DesignSpec['visualTheme']['mode'] {
  if (value === 'versatile' || value === 'consulting' || value === 'top-consulting') return value;
  return getPreferredMode(tone);
}

function normalizeIconStyle(value: string | undefined): DesignSpec['iconStyle'] {
  if (value === 'chunk-filled' || value === 'tabler-filled' || value === 'tabler-outline' || value === 'phosphor-duotone' || value === 'none') return value;
  return 'tabler-outline';
}

function normalizeImageUsage(value: string | undefined, imageStyle: string): DesignSpec['imageUsage'] {
  if (value === 'none' || value === 'ai-generated' || value === 'user-provided' || value === 'placeholder') return value;
  return imageStyle === 'none' ? 'none' : 'placeholder';
}

function normalizeOutline(rawOutline: any[], input: StrategistInput): SpecSlide[] {
  const source = rawOutline.length > 0 ? rawOutline : buildFallbackSpec(input).outline;
  const targetCount = getTargetSlideCount(input.slideCount);
  const normalizedSource = targetCount ? fitOutlineToTargetCount(source, targetCount, input) : source;
  return normalizedSource.map((item: any, index: number) => {
    const pageNumber = Number(item.pageNumber) || index + 1;
    const layout = normalizeLayout(item.layout, index, normalizedSource.length);
    return {
      id: item.id || `slide-${pageNumber}`,
      pageNumber,
      title: String(item.title || `第 ${pageNumber} 页`),
      bullets: Array.isArray(item.bullets) ? item.bullets.map(String).filter(Boolean).slice(0, 8) : [],
      speakerNotes: String(item.speakerNotes || ''),
      visualPrompt: String(item.visualPrompt || ''),
      layout,
      rhythm: normalizeRhythm(item.rhythm, layout),
      chartHint: item.chartHint ? String(item.chartHint) : undefined,
    };
  });
}

function fitOutlineToTargetCount(source: any[], targetCount: number, input: StrategistInput) {
  const pages = source.slice(0, targetCount).map((item, index) => ({ ...item, pageNumber: index + 1 }));
  while (pages.length < targetCount) {
    const pageNumber = pages.length + 1;
    const isEnding = pageNumber === targetCount;
    pages.push({
      id: `slide-${pageNumber}`,
      pageNumber,
      title: isEnding ? '总结与下一步' : `重点展开 ${pageNumber - 1}`,
      bullets: isEnding
        ? ['回顾核心结论', '明确后续行动', '留下讨论空间']
        : ['补充关键背景', '展开核心观点', '说明执行要点'],
      speakerNotes: isEnding
        ? '收束本次演示内容，并引导听众进入讨论或下一步行动。'
        : `围绕「${input.topic || '当前主题'}」补充一页可讲述、可落地的内容。`,
      visualPrompt: '',
      layout: isEnding ? 'ending' : 'content',
      rhythm: isEnding ? 'anchor' : 'dense',
    });
  }

  if (pages.length > 0) {
    pages[0] = { ...pages[0], layout: 'cover', pageNumber: 1 };
    pages[pages.length - 1] = { ...pages[pages.length - 1], layout: pages.length === 1 ? 'cover' : 'ending', pageNumber: pages.length };
  }

  return pages;
}

function resolveFallbackTemplate(input: StrategistInput): string {
  const text = `${input.topic} ${input.content}`.toLowerCase();
  if (/(金融|财务|投资|基金|银行|证券|保险|finance|financial|bank|invest)/i.test(text)) return 'finance';
  if (/(科技|技术|ai|人工智能|大模型|算法|芯片|软件|平台|数据|tech|software|model|cloud)/i.test(text)) return 'tech';
  if (/(教育|培训|课程|教学|学习|学校|education|training|course|teach)/i.test(text)) return 'education';
  if (/(创意|品牌|发布|路演|营销|设计|文化|creative|brand|marketing|launch|pitch)/i.test(text)) return 'creative';
  return 'business';
}

function normalizeLayout(value: string | undefined, index: number, total: number): SpecSlide['layout'] {
  const allowed = new Set(['cover', 'chapter', 'content', 'content-image', 'content-chart', 'ending', 'toc']);
  if (value && allowed.has(value)) return value;
  if (index === 0) return 'cover';
  if (index === total - 1) return 'ending';
  return 'content';
}

function normalizeRhythm(value: string | undefined, layout: string): SpecSlide['rhythm'] {
  if (value === 'anchor' || value === 'dense' || value === 'breathing') return value;
  if (layout === 'cover' || layout === 'chapter' || layout === 'toc' || layout === 'ending') return 'anchor';
  if (layout === 'content-image') return 'breathing';
  return 'dense';
}

function buildFallbackSpec(input: StrategistInput): DesignSpec {
  const colors = normalizeColors(undefined, resolveFallbackTemplate(input));
  const typography = normalizeTypography(undefined);
  const fallbackTopic = inferTopicFromInput(input);

  return {
    projectInfo: {
      title: fallbackTopic || '未命名 PPT',
      topic: fallbackTopic || '未命名主题',
      audience: '通用受众',
      occasion: '通用演示',
    },
    canvas: CANVAS_FORMATS.ppt169,
    visualTheme: {
      mode: getPreferredMode(input.tone),
      style: '根据主题定制的清晰演示风格，不使用渐变',
      colors,
    },
    typography,
    iconStyle: 'tabler-outline',
    imageUsage: normalizeImageUsage(undefined, input.imageStyle),
    outline: [
      { id: 'slide-1', pageNumber: 1, title: fallbackTopic || '项目概览', bullets: [], speakerNotes: '开场介绍本次演示的主题和目标。', visualPrompt: '', layout: 'cover', rhythm: 'anchor' },
      { id: 'slide-2', pageNumber: 2, title: '核心背景', bullets: ['问题背景与现状', '关键机会与挑战', '本次汇报的判断框架'], speakerNotes: '说明为什么这个主题值得讨论，并建立听众的共同上下文。', visualPrompt: '', layout: 'content', rhythm: 'dense' },
      { id: 'slide-3', pageNumber: 3, title: '关键方案', bullets: ['明确目标与边界', '拆解执行路径', '建立反馈机制'], speakerNotes: '围绕可执行性展开方案，突出主次关系。', visualPrompt: '', layout: 'content', rhythm: 'dense' },
      { id: 'slide-4', pageNumber: 4, title: '总结与下一步', bullets: ['形成共识', '明确责任', '推进落地'], speakerNotes: '收束观点，并给出下一步行动建议。', visualPrompt: '', layout: 'ending', rhythm: 'anchor' },
    ],
    skillExtensions: [],
  };
}
