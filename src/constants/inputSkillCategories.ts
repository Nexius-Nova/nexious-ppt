export const SKILL_WORKFLOW_STAGES = [
  {
    id: 'input',
    title: 'PPT 输入',
    categories: ['Web 搜索', '文件解析', '图片识别'],
    description: '在用户提交资料后执行，负责补充外部信息、解析附件和识别图片内容。'
  },
  {
    id: 'organize',
    title: '资料整理',
    categories: ['行业资料分析', '学术论文解析', '财报分析', '企业知识库检索'],
    description: '把原始资料整理成可用于大纲和页面生成的结构化上下文。'
  },
  {
    id: 'outline',
    title: '生成大纲',
    categories: ['页面类型判断', '图表表格标记', '公式图片时间线标记'],
    description: '辅助大纲阶段判断页面类型，并标记 chart、table、formula、image、timeline 等需求。'
  },
  {
    id: 'image',
    title: '生成图片',
    categories: ['图片搜索', '图片生成'],
    description: '为需要视觉素材的页面寻找或生成图片。'
  },
  {
    id: 'layout',
    title: '生成页面',
    categories: ['数据图表', '数学公式', '图标绘制', 'SVG 布局'],
    description: '在单页 SVG 生成阶段调用，输出图表、公式、图标或布局规则。'
  },
  {
    id: 'quality',
    title: '页面质检',
    categories: ['溢出检查', '图片遮挡检查', '低对比度检查'],
    description: '每页生成后检查文本、图片、重叠和可读性问题，必要时触发修复。'
  }
] as const;

export const INPUT_SKILL_CATEGORIES = SKILL_WORKFLOW_STAGES.flatMap((stage) => stage.categories);

export type InputSkillCategory = (typeof INPUT_SKILL_CATEGORIES)[number];

const LEGACY_CATEGORY_MAP: Record<string, InputSkillCategory> = {
  资料收集: 'Web 搜索',
  文件解析: '文件解析',
  主题提炼: '行业资料分析',
  生成约束: '页面类型判断',
  prompt: '页面类型判断',
  collect: 'Web 搜索',
  search: 'Web 搜索',
  web: 'Web 搜索',
  parse: '文件解析',
  ocr: '图片识别',
  image: '图片生成',
  chart: '数据图表',
  formula: '数学公式',
  icon: '图标绘制',
  layout: 'SVG 布局',
  quality: '溢出检查'
};

export function normalizeInputSkillCategory(value?: string | null): InputSkillCategory {
  const normalized = String(value || '').trim();
  if (INPUT_SKILL_CATEGORIES.includes(normalized as InputSkillCategory)) {
    return normalized as InputSkillCategory;
  }
  return LEGACY_CATEGORY_MAP[normalized] || 'Web 搜索';
}

export function getSkillStageByCategory(category?: string | null) {
  const normalized = normalizeInputSkillCategory(category);
  return SKILL_WORKFLOW_STAGES.find((stage) =>
    (stage.categories as readonly string[]).includes(normalized)
  ) || SKILL_WORKFLOW_STAGES[0];
}

export function getSkillCategoryDescription(category: string) {
  const descriptions: Record<string, string> = {
    'Web 搜索': '根据主题或用户要求联网搜索，补充来源、事实和案例。',
    '文件解析': '解析 PDF、Word、Excel、PPT、CSV、Markdown 等上传文件。',
    '图片识别': '识别上传图片、截图、扫描件中的文字和视觉信息。',
    '行业资料分析': '整理行业背景、市场趋势、竞品、政策和案例。',
    '学术论文解析': '提炼论文结构、研究问题、方法、结论和引用线索。',
    '财报分析': '提取财务指标、增长趋势、风险、业务结构和关键结论。',
    '企业知识库检索': '从企业内部资料中检索产品、案例、术语和标准表达。',
    '页面类型判断': '辅助大纲判断封面、目录、图文、图表、时间线、总结等页面类型。',
    '图表表格标记': '判断哪些内容应转成 chart/table/matrix/dashboard。',
    '公式图片时间线标记': '标记公式、图片、时间线、流程图等页面需求。',
    '图片搜索': '根据页面语义搜索合适图片素材。',
    '图片生成': '根据页面图片素材需求和视觉意图生成图片。',
    '数据图表': '把结构化数据绘制为 SVG 图表或图表配置。',
    '数学公式': '把公式、推导、符号内容渲染成可嵌入页面的 SVG。',
    '图标绘制': '为页面绘制统一风格的图标和示意符号。',
    'SVG 布局': '影响单页 SVG 构图、层级、组件布局和视觉节奏。',
    '溢出检查': '检查并修复文字超出画布或容器的问题。',
    '图片遮挡检查': '检查图片是否遮挡标题、正文、图表或超出槽位。',
    '低对比度检查': '检查文字和背景对比度、弱色可读性和视觉层级。'
  };
  return descriptions[category] || '按工作流阶段调用的 Skill 能力。';
}
