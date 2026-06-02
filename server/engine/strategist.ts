import type { DesignSpec, SpecSlide, SkillExtension } from './spec.js';
import { CANVAS_FORMATS, INDUSTRY_COLORS, normalizeColors, normalizeTypography } from './spec.js';

export interface StrategistInput {
  topic: string;
  content: string;
  tone: string;
  summaryLength: string;
  imageStyle: string;
  template: string;
  promptContent?: string;
  skills: Array<{ id: string; name: string; instruction?: string }>;
}

const MODE_BY_TONE: Record<string, DesignSpec['visualTheme']['mode']> = {
  professional: 'consulting',
  storytelling: 'versatile',
  teaching: 'versatile',
};

export function buildStrategistPrompt(input: StrategistInput): { system: string; user: string } {
  const canvas = CANVAS_FORMATS.ppt169;
  const isAutoTemplate = !input.template || input.template === 'auto';
  const colors = INDUSTRY_COLORS[input.template] || INDUSTRY_COLORS[resolveFallbackTemplate(input)];
  const mode = MODE_BY_TONE[input.tone] || 'versatile';
  const lengthGuide =
    input.summaryLength === 'detailed'
      ? '详细：每页 4-6 个要点，讲稿需要能支撑演讲。'
      : input.summaryLength === 'brief'
        ? '简洁：每页 2-3 个要点，避免堆叠信息。'
        : '均衡：每页 3-5 个要点，表达完整但保持可读。';

  const skillExtensions: SkillExtension[] = input.skills.map((s) => ({
    skillId: s.id,
    skillName: s.name,
    strategistPrompt: s.instruction || undefined,
  }));
  const colorGuide = isAutoTemplate
    ? `      "primary": "${colors.primary}",
      "secondary": "${colors.secondary}",
      "accent": "${colors.accent}",
      "background": "${colors.background}",
      "surface": "${colors.surface}",
      "text": "${colors.text}",
      "muted": "${colors.muted}",
      "border": "${colors.border}"`
    : `      "primary": "${colors.primary}",
      "secondary": "${colors.secondary}",
      "accent": "${colors.accent}",
      "background": "${colors.background}",
      "surface": "${colors.surface}",
      "text": "${colors.text}",
      "muted": "${colors.muted}",
      "border": "${colors.border}"`;
  const templateGuide = isAutoTemplate
    ? '模板风格：AI 自动决定。不要套用固定 business 模板；每次都要根据主题重新选择页面节奏、版式组合、颜色和视觉气质。'
    : `模板风格：${input.template}。这是当前用户明确选择的风格参考。`;

  const system = `你是 PPT Master 管线中的 Strategist。你要把用户输入转成可执行的设计规格 JSON，后续 Executor 会逐页手写 SVG，并由 ppt-master/scripts/finalize_svg.py 与 svg_to_pptx.py 导出为 PowerPoint。

请只输出严格 JSON，不要 Markdown，不要解释文字。JSON 必须符合以下结构：
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
    "style": "一句话描述视觉方向，不使用渐变",
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
  "iconStyle": "tabler-outline",
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
      "chartHint": "仅图表页填写，使用 ppt-master/templates/charts 中常见类型，如 bar_chart、timeline、matrix_2x2"
    }
  ]
}

硬性规则：
1. 不要提出等待确认；当前应用内直接执行生成。
2. 第一页必须是 cover，最后一页建议是 ending。内容足够时可加入 toc 或 chapter。
3. 页面数量根据内容决定，通常 6-12 页；若材料很少可 4-6 页。
4. rhythm 必须服务叙事：cover、toc、chapter、ending 用 anchor；信息密集页用 dense；单一观点或关键结论页用 breathing。
5. 颜色只能用 HEX，必须避免渐变和一整套单色系；至少包含 3 个有区分度的色相，整体与主题一致。
6. visualTheme.colors 中必须保留上方字段，不要增加 rgba、透明色或渐变描述。
7. layout 与内容一致：图表页用 content-chart；内容明确要求配图、插图、场景图、示意图、封面图，或图片能明显提升表达时，用 content-image 并填写 visualPrompt。
8. speakerNotes 使用中文，能帮助演讲者自然讲述。
9. ${lengthGuide}
10. 默认视觉模式为 ${mode}。
11. ${templateGuide}`;

  const user = `主题：${input.topic}
内容资料：
${input.content || '用户未提供详细资料，请基于主题生成结构完整、信息可信但不过度编造的演示文稿。'}

语气：${input.tone}
图片风格：${input.imageStyle}
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

  return {
    projectInfo: {
      title: parsed.projectInfo?.title || input.topic || '未命名 PPT',
      topic: parsed.projectInfo?.topic || input.topic || '未命名主题',
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

function normalizeCanvas(canvas: any): DesignSpec['canvas'] {
  if (canvas?.format === 'ppt43') {
    return CANVAS_FORMATS.ppt43;
  }
  return CANVAS_FORMATS.ppt169;
}

function normalizeMode(value: string | undefined, tone: string): DesignSpec['visualTheme']['mode'] {
  if (value === 'versatile' || value === 'consulting' || value === 'top-consulting') return value;
  return MODE_BY_TONE[tone] || 'versatile';
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
  return source.map((item: any, index: number) => {
    const pageNumber = Number(item.pageNumber) || index + 1;
    const layout = normalizeLayout(item.layout, index, source.length);
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

function resolveFallbackTemplate(input: StrategistInput): string {
  if (input.template && input.template !== 'auto') return input.template;
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

  return {
    projectInfo: { title: input.topic || '未命名 PPT', topic: input.topic || '未命名主题', audience: '通用受众', occasion: '通用演示' },
    canvas: CANVAS_FORMATS.ppt169,
    visualTheme: { mode: MODE_BY_TONE[input.tone] || 'versatile', style: '根据主题定制的清晰演示风格，不使用渐变', colors },
    typography,
    iconStyle: 'tabler-outline',
    imageUsage: input.imageStyle === 'none' ? 'none' : 'placeholder',
    outline: [
      { id: 'slide-1', pageNumber: 1, title: input.topic || '项目概览', bullets: [], speakerNotes: '开场介绍本次演示的主题和目标。', visualPrompt: '', layout: 'cover', rhythm: 'anchor' },
      { id: 'slide-2', pageNumber: 2, title: '核心背景', bullets: ['问题背景与现状', '关键机会与挑战', '本次汇报的判断框架'], speakerNotes: '说明为什么这个主题值得讨论，并建立听众的共同上下文。', visualPrompt: '', layout: 'content', rhythm: 'dense' },
      { id: 'slide-3', pageNumber: 3, title: '关键方案', bullets: ['方案一：明确目标与边界', '方案二：拆解执行路径', '方案三：建立反馈机制'], speakerNotes: '围绕可执行性展开方案，突出主次关系。', visualPrompt: '', layout: 'content', rhythm: 'dense' },
      { id: 'slide-4', pageNumber: 4, title: '总结与下一步', bullets: ['形成共识', '明确责任', '推进落地'], speakerNotes: '收束观点，并给出下一步行动建议。', visualPrompt: '', layout: 'ending', rhythm: 'anchor' },
    ],
    skillExtensions: [],
  };
}
