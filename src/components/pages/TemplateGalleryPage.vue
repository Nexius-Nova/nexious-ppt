<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  Eye,
  FileText,
  FileUp,
  Layers,
  ListTree,
  Palette,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-vue-next';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiButton from '@/components/ui/UiButton.vue';
import UiEmpty from '@/components/ui/UiEmpty.vue';
import UiFeedbackState from '@/components/ui/UiFeedbackState.vue';
import UiField from '@/components/ui/UiField.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiTextarea from '@/components/ui/UiTextarea.vue';
import DeleteConfirmModal from '@/components/common/DeleteConfirmModal.vue';
import PageLoadingState from '@/components/common/PageLoadingState.vue';
import PrivateSvg from '@/components/common/PrivateSvg.vue';
import { templateApi, type Template } from '@/services/api';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import { buildTemplatePayloadFromProject } from '@/utils/templateFromProject';
import type { AgentParameters, PptProjectState, SlideOutline, TemplateAssetSettings } from '@/types/agent';
import { translateErrorMessage } from '@/utils/errorMessages';

type EditorForm = {
  name: string;
  category: string;
  description: string;
  slide_count: number;
  accent: string;
  is_public: boolean;
  visualTone: string;
  colorPalette: string;
  typography: string;
  iconStyle: string;
  coverLayout: string;
  sectionLayout: string;
  contentLayouts: string;
  dataLayouts: string;
  summaryLayout: string;
  outlinePattern: string;
  previewSlides: string;
  suitableFor: string;
  avoid: string;
};

type EditorSectionId = 'basic' | 'style' | 'layout' | 'outline' | 'rules';
type ImportedPptSlide = {
  pageNumber: number;
  title: string;
  bullets: string[];
  description: string;
  layout: string;
  svg?: string;
  visualSummary?: string;
};
type ImportedPptParseResult = {
  importId?: string;
  slideCount: number;
  slides: ImportedPptSlide[];
  allText: string;
  draft?: {
    name: string;
    category: string;
    description: string;
    slide_count: number;
    accent: string;
    settings: TemplateAssetSettings;
  };
  diagnostics?: {
    importId?: string;
    slideCount?: number;
    previewSlideCount?: number;
    colorCount?: number;
    layoutCount?: number;
  };
};

const toastStore = useToastStore();
const agentStore = useAgentStore();
const route = useRoute();

const templates = ref<Template[]>([]);
const loading = ref(false);
const loadError = ref('');
const saving = ref(false);
const searchQuery = ref('');
const selectedCategory = ref('全部');
const previewTemplate = ref<Template | null>(null);
const editingTemplate = ref<Template | null>(null);
const templateToDelete = ref<Template | null>(null);
const showPreviewModal = ref(false);
const showEditor = ref(false);
const showDeleteModal = ref(false);
const zoomPreviewSlide = ref<NonNullable<TemplateAssetSettings['previewSlides']>[number] | null>(null);
const activeEditorSection = ref<EditorSectionId>('basic');
const focusedTemplateId = ref<string | null>(null);
const importFileInput = ref<HTMLInputElement | null>(null);
const importingPpt = ref(false);
const importDraft = ref<{
  importId?: string;
  name: string;
  category: string;
  description: string;
  slide_count: number;
  accent: string;
  settings: TemplateAssetSettings;
} | null>(null);

const editorForm = ref<EditorForm>(createEmptyForm());

const editorSections: Array<{ id: EditorSectionId; title: string; desc: string }> = [
  { id: 'basic', title: '基础', desc: '名称、分类、页数' },
  { id: 'style', title: '主题', desc: '气质、颜色、字体' },
  { id: 'layout', title: '布局', desc: '封面、内容、数据页' },
  { id: 'outline', title: '大纲', desc: '结构和示例页' },
  { id: 'rules', title: '边界', desc: '适用和避免事项' },
];

const categories = computed(() => {
  const values = templates.value.map((template) => template.category).filter(Boolean) as string[];
  return ['全部', ...Array.from(new Set(values))];
});

const filteredTemplates = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase();
  return templates.value.filter((template) => {
    const settings = normalizeSettings(template);
    const content = [
      template.name,
      template.category,
      template.description,
      settings.styleGuide?.visualTone,
      ...(settings.outlinePattern || []),
      ...(settings.layoutGuide?.contentLayouts || []),
    ].join(' ').toLowerCase();
    const categoryMatched = selectedCategory.value === '全部' || template.category === selectedCategory.value;
    const keywordMatched = !keyword || content.includes(keyword);
    return categoryMatched && keywordMatched;
  });
});

const editorColors = computed(() => {
  const colors = splitLines(editorForm.value.colorPalette)
    .map((color) => color.trim())
    .filter((color) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color));
  return colors.length ? colors : [editorForm.value.accent || '#334155'];
});

const editorContentLayouts = computed(() => splitLines(editorForm.value.contentLayouts));
const editorDataLayouts = computed(() => splitLines(editorForm.value.dataLayouts));
const editorOutlineItems = computed(() => splitLines(editorForm.value.outlinePattern));
const editorSuitableItems = computed(() => splitLines(editorForm.value.suitableFor || editorForm.value.category));
const editorAvoidItems = computed(() => splitLines(editorForm.value.avoid));
const editorPreviewSlides = computed(() => parsePreviewSlideLines(editorForm.value.previewSlides));
const importPreviewSlides = computed(() => importDraft.value?.settings.previewSlides || []);
const importHeroSlide = computed(() => importPreviewSlides.value[0] || null);
const previewTemplateSlides = computed(() => previewTemplate.value
  ? sampleTemplatePreviewSlides(normalizeSettings(previewTemplate.value).previewSlides || [], 6)
  : []
);
const isTemplateNameDuplicated = computed(() => {
  const name = normalizeTemplateText(editorForm.value.name);
  if (!name) return false;
  return templates.value.some((template) =>
    normalizeTemplateText(template.name) === name && template.id !== editingTemplate.value?.id
  );
});
const editorCompleteness = computed(() => {
  const checks = [
    Boolean(editorForm.value.name.trim()),
    Boolean(editorForm.value.visualTone.trim()),
    editorColors.value.length >= 2,
    editorContentLayouts.value.length > 0,
    editorOutlineItems.value.length > 0,
    editorPreviewSlides.value.length > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
});

function createEmptyForm(): EditorForm {
  return {
    name: '',
    category: '',
    description: '',
    slide_count: 10,
    accent: '#334155',
    is_public: false,
    visualTone: '',
    colorPalette: '#334155, #172026, #C9A227',
    typography: '清晰中文无衬线字体，标题层级明确',
    iconStyle: '简洁线性图标',
    coverLayout: '封面突出主题和关键结论',
    sectionLayout: '章节页承接叙事转折',
    contentLayouts: '图文页\n三段式要点页\n对比页',
    dataLayouts: '指标卡\n趋势图\n矩阵分析',
    summaryLayout: '总结页提炼结论和下一步行动',
    outlinePattern: '背景与目标\n核心洞察\n方案设计\n执行路径\n总结展望',
    previewSlides: '封面|cover|展示主题、受众和场景\n核心内容|content|承载主要观点和论据\n总结|ending|收束结论和行动建议',
    suitableFor: '',
    avoid: '不要照搬示例文字\n不要固定套用到未选择模板的项目',
  };
}

function parseSettings(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? value as Record<string, any> : {};
}

function normalizeTemplateText(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function splitLines(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function parsePreviewSlideLines(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [title, layout, description] = line.split('|').map((item) => item?.trim());
      return {
        title: title || `示例页 ${index + 1}`,
        layout: layout || 'content',
        description: description || undefined,
      };
    });
}

function sampleTemplatePreviewSlides<T>(slides: T[], maxCount = 6): T[] {
  if (!Array.isArray(slides) || slides.length <= maxCount) return slides || [];
  const indexes = new Set<number>([0, slides.length - 1]);
  const slots = Math.max(0, maxCount - 2);
  for (let index = 1; index <= slots; index += 1) {
    indexes.add(Math.round((index * (slides.length - 1)) / (slots + 1)));
  }
  return Array.from(indexes)
    .sort((a, b) => a - b)
    .slice(0, maxCount)
    .map((index) => slides[index])
    .filter(Boolean);
}

function normalizeSettings(template: Template): TemplateAssetSettings {
  const raw = parseSettings(template.settings);
  return {
    sourceProjectId: raw.sourceProjectId ? String(raw.sourceProjectId) : undefined,
    sourceProjectTitle: raw.sourceProjectTitle ? String(raw.sourceProjectTitle) : undefined,
    styleGuide: {
      visualTone: raw.styleGuide?.visualTone || template.description || '按主题定制的演示风格',
      colorPalette: splitLines(raw.styleGuide?.colorPalette).length
        ? splitLines(raw.styleGuide?.colorPalette)
        : [template.accent || '#334155', '#172026', '#C9A227'],
      typography: raw.styleGuide?.typography || '清晰中文无衬线字体',
      iconStyle: raw.styleGuide?.iconStyle || '简洁线性图标',
    },
    layoutGuide: {
      cover: raw.layoutGuide?.cover || '封面突出主题和关键结论',
      section: raw.layoutGuide?.section || '章节页承接叙事转折',
      contentLayouts: splitLines(raw.layoutGuide?.contentLayouts).length
        ? splitLines(raw.layoutGuide?.contentLayouts)
        : ['图文页', '三段式要点页', '对比页'],
      dataLayouts: splitLines(raw.layoutGuide?.dataLayouts).length
        ? splitLines(raw.layoutGuide?.dataLayouts)
        : ['指标卡', '趋势图', '矩阵分析'],
      summary: raw.layoutGuide?.summary || '总结页提炼结论和下一步行动',
    },
    outlinePattern: splitLines(raw.outlinePattern).length
      ? splitLines(raw.outlinePattern)
      : ['背景与目标', '核心洞察', '方案设计', '执行路径', '总结展望'],
    previewSlides: Array.isArray(raw.previewSlides) && raw.previewSlides.length
      ? raw.previewSlides.map((slide: any) => ({
          title: String(slide.title || '示例页'),
          layout: String(slide.layout || 'content'),
          description: slide.description ? String(slide.description) : undefined,
          svg: typeof slide.svg === 'string' && slide.svg.trim() ? slide.svg : undefined,
          pageNumber: Number(slide.pageNumber) || undefined,
          visualSummary: slide.visualSummary ? String(slide.visualSummary) : undefined,
        }))
      : [
          { title: '封面', layout: 'cover', description: '展示主题、受众和场景' },
          { title: '核心内容', layout: 'content', description: '承载主要观点和论据' },
          { title: '总结', layout: 'ending', description: '收束结论和行动建议' },
        ],
    constraints: {
      preferredSlideCount: raw.constraints?.preferredSlideCount || template.slide_count || 10,
      suitableFor: splitLines(raw.constraints?.suitableFor).length
        ? splitLines(raw.constraints?.suitableFor)
        : [template.category || '通用'],
      avoid: splitLines(raw.constraints?.avoid).length
        ? splitLines(raw.constraints?.avoid)
        : ['不要照搬示例文字', '不要固定套用到未选择模板的项目'],
    },
  };
}

function buildSettingsFromForm(): TemplateAssetSettings {
  const existingSlides = editingTemplate.value ? normalizeSettings(editingTemplate.value).previewSlides || [] : [];
  const existingSettings = editingTemplate.value ? normalizeSettings(editingTemplate.value) : {};
  return {
    sourceProjectId: existingSettings.sourceProjectId,
    sourceProjectTitle: existingSettings.sourceProjectTitle,
    styleGuide: {
      visualTone: editorForm.value.visualTone.trim(),
      colorPalette: splitLines(editorForm.value.colorPalette),
      typography: editorForm.value.typography.trim(),
      iconStyle: editorForm.value.iconStyle.trim(),
    },
    layoutGuide: {
      cover: editorForm.value.coverLayout.trim(),
      section: editorForm.value.sectionLayout.trim(),
      contentLayouts: splitLines(editorForm.value.contentLayouts),
      dataLayouts: splitLines(editorForm.value.dataLayouts),
      summary: editorForm.value.summaryLayout.trim(),
    },
    outlinePattern: splitLines(editorForm.value.outlinePattern),
    previewSlides: editorForm.value.previewSlides
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const [title, layout, description] = line.split('|').map((item) => item?.trim());
        const normalizedTitle = title || '示例页';
        const normalizedLayout = layout || 'content';
        const existing = existingSlides.find((slide) => slide.title === normalizedTitle && slide.layout === normalizedLayout);
        return {
          title: normalizedTitle,
          layout: normalizedLayout,
          description: description || existing?.description || `示例页面 ${index + 1}`,
          svg: existing?.svg,
          pageNumber: existing?.pageNumber,
          visualSummary: existing?.visualSummary,
        };
      }),
    constraints: {
      preferredSlideCount: editorForm.value.slide_count,
      suitableFor: splitLines(editorForm.value.suitableFor || editorForm.value.category),
      avoid: splitLines(editorForm.value.avoid),
    },
  };
}

const LAYOUT_LABELS: Record<string, string> = {
  cover: '封面页',
  toc: '目录页',
  chapter: '章节页',
  section: '章节页',
  content: '内容页',
  'content-image': '图文页',
  'content-chart': '图表页',
  ending: '收束页',
  summary: '总结页',
  'text-only': '纯文本页',
  'text-image': '左文右图',
  'image-text': '左图右文',
  'full-image': '全图页',
  'title-center': '居中标题页',
  'two-column': '双栏页',
  comparison: '对比页',
  process: '流程页',
  timeline: '时间轴',
  matrix: '矩阵页',
  matrix_2x2: '四象限矩阵',
  bar_chart: '柱状图',
  line_chart: '折线图',
  pie_chart: '饼图',
  indicator_cards: '指标卡',
  data_table: '数据表格',
};

function formatLayoutLabel(value?: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '内容页';
  const normalized = raw.toLowerCase();
  return LAYOUT_LABELS[normalized] || raw.replace(/[-_]+/g, ' ');
}

function openZoomPreview(slide: NonNullable<TemplateAssetSettings['previewSlides']>[number]) {
  zoomPreviewSlide.value = slide;
}

function metricCount(template: Template, key: 'layouts' | 'outline' | 'preview') {
  const settings = normalizeSettings(template);
  if (key === 'layouts') {
    return (settings.layoutGuide?.contentLayouts?.length || 0) + (settings.layoutGuide?.dataLayouts?.length || 0);
  }
  if (key === 'outline') return settings.outlinePattern?.length || 0;
  return settings.previewSlides?.length || 0;
}

async function fetchTemplates() {
  loading.value = true;
  try {
    const response = await templateApi.getAll();
    if (response.success && response.data) {
      loadError.value = '';
      templates.value = response.data;
      focusTemplateFromRoute();
    } else {
      loadError.value = translateErrorMessage(response.message, '加载模板失败，请稍后重试');
      toastStore.error('加载模板失败', loadError.value);
    }
  } catch (error) {
    loadError.value = translateErrorMessage(error, '加载模板失败，请稍后重试');
    toastStore.error('加载模板失败', loadError.value);
  } finally {
    loading.value = false;
  }
}

function openPreviewModal(template: Template) {
  previewTemplate.value = template;
  showPreviewModal.value = true;
}

function focusTemplateFromRoute() {
  const queryValue = route.query.templateId;
  const templateId = Array.isArray(queryValue) ? queryValue[0] : queryValue;
  if (!templateId) {
    focusedTemplateId.value = null;
    return;
  }
  if (focusedTemplateId.value === String(templateId)) return;

  const template = templates.value.find((item) => String(item.id) === String(templateId));
  focusedTemplateId.value = String(templateId);
  if (!template) {
    toastStore.warning('未找到模板', '模板可能已删除或当前账号无权访问');
    return;
  }

  selectedCategory.value = '全部';
  searchQuery.value = '';
  openPreviewModal(template);
  toastStore.info('已打开模板详情', template.name);
}

function triggerPptImport() {
  if (importingPpt.value) return;
  importFileInput.value?.click();
}

function escapeSvgText(value: unknown) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clampText(value: unknown, maxLength: number) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function inferImportedSlideLayout(index: number, total: number, texts: string[]) {
  if (index === 0) return 'cover';
  if (index === total - 1 && total > 1) return 'ending';
  if (texts.some((text) => /[%％]|同比|环比|增长|下降|数据|指标|表格|图表|趋势|矩阵/.test(text))) return 'content-chart';
  if (texts.length >= 5) return 'content-image';
  return 'content';
}

function buildImportedSlideSvg(slide: ImportedPptSlide, accent = '#334155') {
  const title = escapeSvgText(clampText(slide.title, 34));
  const bullets = slide.bullets.length
    ? slide.bullets.slice(0, 4)
    : [slide.description].filter(Boolean).slice(0, 1);
  const bulletRows = bullets.map((bullet, index) => {
    const y = 220 + index * 54;
    return `
      <circle cx="110" cy="${y - 6}" r="5" fill="${accent}" opacity="0.72" />
      <text x="130" y="${y}" font-size="25" fill="#334155">${escapeSvgText(clampText(bullet, 34))}</text>
    `;
  }).join('');
  const label = escapeSvgText(formatLayoutLabel(slide.layout));
  const pageNumber = String(slide.pageNumber).padStart(2, '0');
  const visualBlock = slide.layout === 'content-chart'
    ? `
      <rect x="724" y="250" width="60" height="150" rx="8" fill="${accent}" opacity="0.72" />
      <rect x="808" y="198" width="60" height="202" rx="8" fill="#C9A227" opacity="0.82" />
      <rect x="892" y="296" width="60" height="104" rx="8" fill="#172026" opacity="0.72" />
      <path d="M724 438H980" stroke="#CBD5E1" stroke-width="3" />
    `
    : `
      <rect x="720" y="212" width="270" height="192" rx="18" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="2" />
      <path d="M750 360L810 302L858 342L910 282L960 360Z" fill="${accent}" opacity="0.24" />
      <circle cx="792" cy="268" r="24" fill="#C9A227" opacity="0.82" />
    `;

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 630" role="img" aria-label="${title}">
  <rect width="1120" height="630" fill="#FFFFFF" />
  <rect x="34" y="34" width="1052" height="562" rx="24" fill="#F8FAFC" stroke="#E2E8F0" stroke-width="2" />
  <rect x="68" y="68" width="132" height="8" rx="4" fill="${accent}" />
  <text x="68" y="124" font-size="24" font-weight="700" fill="${accent}">${pageNumber}</text>
  <text x="68" y="184" font-size="46" font-weight="800" fill="#172026">${title}</text>
  <text x="68" y="546" font-size="18" font-weight="700" fill="#64748B">${label}</text>
  ${slide.layout === 'cover' || slide.layout === 'ending'
    ? `<text x="68" y="278" font-size="28" fill="#475569">${escapeSvgText(clampText(slide.description, 38))}</text>
       <rect x="68" y="420" width="420" height="10" rx="5" fill="${accent}" opacity="0.16" />
       <rect x="68" y="450" width="310" height="10" rx="5" fill="#CBD5E1" />`
    : `${bulletRows}${visualBlock}`}
</svg>`.trim();
}

function createFallbackImportedSlides(slideCount: number, baseName: string): ImportedPptSlide[] {
  const count = Math.max(3, Math.min(slideCount || 3, 6));
  return Array.from({ length: count }, (_, index) => {
    const pageNumber = index + 1;
    const layout = index === 0 ? 'cover' : index === count - 1 ? 'ending' : 'content';
    const title = index === 0 ? baseName : index === count - 1 ? '总结页' : `内容页 ${pageNumber}`;
    return {
      pageNumber,
      title,
      bullets: ['参考原 PPT 的页面节奏', '保留版式结构用于生成新内容'],
      description: '从导入 PPT 生成的模板参考页',
      layout,
    };
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取 PPTX 文件失败'));
    reader.readAsDataURL(file);
  });
}

function buildImportedProjectState(baseName: string, fileName: string, parsed: ImportedPptParseResult): PptProjectState {
  const slides = parsed.slides.length ? parsed.slides : createFallbackImportedSlides(parsed.slideCount, baseName);
  const parameters: AgentParameters = {
    summaryLength: 'auto',
    slideCount: parsed.slideCount || slides.length,
    tone: 'auto',
    imageStyle: 'auto',
    template: 'auto',
    skillIntensity: 0,
    animationEnabled: 'auto',
    animationEffect: 'auto',
  };
  const outline: SlideOutline[] = slides.map((slide) => ({
    id: `imported-slide-${slide.pageNumber}`,
    title: slide.title,
    bullets: slide.bullets,
    speakerNotes: slide.description,
    visualPrompt: '参考导入 PPT 的页面布局与视觉层级，不复用原业务文案。',
    chartHint: slide.layout === 'content-chart' ? 'content-chart' : undefined,
    layout: 'text-only',
  }));
  const specOutline = slides.map((slide) => ({
    id: `imported-slide-${slide.pageNumber}`,
    pageNumber: slide.pageNumber,
    title: slide.title,
    bullets: slide.bullets,
    speakerNotes: slide.description,
    visualPrompt: '参考导入 PPT 的页面布局与视觉层级，不复用原业务文案。',
    layout: slide.layout,
    rhythm: slide.layout === 'cover' || slide.layout === 'ending' ? 'anchor' as const : 'dense' as const,
    chartHint: slide.layout === 'content-chart' ? 'content-chart' : undefined,
  }));
  const colors = {
    primary: '#172026',
    secondary: '#334155',
    accent: '#C9A227',
    background: '#FFFFFF',
    surface: '#F8FAFC',
    text: '#172026',
    muted: '#64748B',
    border: '#E2E8F0',
  };
  const typography = {
    fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
    titleFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
    bodyFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
    emphasisFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
    codeFamily: 'Consolas, monospace',
    bodySize: 24,
    titleSize: 44,
    subtitleSize: 28,
    annotationSize: 16,
  };

  return {
    input: { topic: baseName, content: parsed.allText || baseName, files: [fileName] },
    uploadedFileContents: [],
    processedInputContent: parsed.allText || '',
    parameters,
    selectedTemplate: null,
    outline,
    images: [],
    exportArtifacts: [],
    enabledSkillIds: [],
    selectedPromptId: '',
    inputProcessSteps: [],
    activityLog: [],
    steps: [],
    designSpec: {
      projectInfo: {
        title: baseName,
        topic: baseName,
        audience: '通用汇报受众',
        occasion: '导入 PPT 模板复用',
      },
      canvas: { format: 'ppt169', width: 1120, height: 630 },
      visualTheme: {
        mode: 'versatile',
        style: '沿用导入 PPT 的整体版式节奏与表达风格',
        colors,
      },
      typography,
      iconStyle: '匹配导入 PPT 的图标与装饰风格',
      imageUsage: '仅参考图片区域和视觉占位，不复用原始图片内容。',
      outline: specOutline,
      skillExtensions: [],
    },
    specLock: {
      colors,
      typography,
      iconStyle: '匹配导入 PPT 的图标与装饰风格',
      imageStyle: 'template-reference',
      canvas: { format: 'ppt169', width: 1120, height: 630 },
      pageRhythm: Object.fromEntries(specOutline.map((slide) => [String(slide.pageNumber), slide.rhythm])),
      pageLayouts: Object.fromEntries(specOutline.map((slide) => [String(slide.pageNumber), slide.layout])),
      pageCharts: Object.fromEntries(specOutline.filter((slide) => slide.chartHint).map((slide) => [String(slide.pageNumber), slide.chartHint!])),
      skillExtensions: [],
      forbidden: ['不要照搬原 PPT 的具体业务文案', '仅将导入 PPT 作为设计样式参考'],
    },
    svgPages: slides.map((slide) => ({
      pageNumber: slide.pageNumber,
      svg: slide.svg?.trim() || buildImportedSlideSvg(slide, colors.accent),
      speakerNotes: slide.description,
      visualSummary: slide.visualSummary,
    })),
    paused: false,
    resumeStage: null,
    executorCursor: 0,
    workflowActive: false,
    lastActiveStep: null,
    waitingForImageRetry: false,
  };
}

async function parsePptxPreview(file: File): Promise<ImportedPptParseResult> {
  const response = await templateApi.importPptxPreview({
    filename: file.name,
    dataBase64: await readFileAsDataUrl(file),
  });
  if (!response.success || !response.data) {
    throw new Error(response.message || 'PPTX 转 SVG 失败');
  }
  return {
    importId: response.data.importId || response.data.diagnostics?.importId,
    slideCount: response.data.slideCount,
    allText: response.data.allText,
    draft: response.data.draft,
    diagnostics: response.data.diagnostics,
    slides: response.data.slides.map((slide, index) => ({
      pageNumber: slide.pageNumber || index + 1,
      title: slide.title || `示例页 ${index + 1}`,
      bullets: slide.bullets || [],
      description: slide.description || '从 PPTX 页面转换得到的真实 SVG 预览',
      layout: slide.layout || inferImportedSlideLayout(index, response.data!.slideCount, [slide.title, ...(slide.bullets || [])]),
      svg: slide.svg,
      visualSummary: slide.visualSummary,
    })),
  };
}

function normalizeImportedDraft(
  draft: NonNullable<ImportedPptParseResult['draft']>,
  fileName: string,
  baseName: string,
  slideCount: number,
  importId?: string
) {
  const settings = draft.settings || {};
  return {
    importId,
    name: draft.name || baseName,
    category: draft.category || '导入模板',
    description: draft.description || `由 ${fileName} 提取设计 DNA 生成的模板草稿，确认后可作为参考模板使用。`,
    slide_count: draft.slide_count || settings.constraints?.preferredSlideCount || slideCount || 10,
    accent: draft.accent || settings.styleGuide?.colorPalette?.[0] || '#334155',
    settings: {
      ...settings,
      sourceProjectTitle: settings.sourceProjectTitle || fileName,
      styleGuide: {
        visualTone: settings.styleGuide?.visualTone || '从导入 PPT 提取的设计风格',
        colorPalette: settings.styleGuide?.colorPalette?.length ? settings.styleGuide.colorPalette : [draft.accent || '#334155', '#172026', '#F8FAFC'],
        typography: settings.styleGuide?.typography || '参考导入 PPT 的标题层级和中文阅读节奏',
        iconStyle: settings.styleGuide?.iconStyle || '参考导入 PPT 的形状、线条和装饰语言',
      },
      layoutGuide: {
        cover: settings.layoutGuide?.cover || '封面参考导入 PPT 的首屏构图和标题层级',
        section: settings.layoutGuide?.section || '章节页参考导入 PPT 的转场节奏',
        contentLayouts: settings.layoutGuide?.contentLayouts?.length ? settings.layoutGuide.contentLayouts : ['content', 'content-image', 'two-column'],
        dataLayouts: settings.layoutGuide?.dataLayouts?.length ? settings.layoutGuide.dataLayouts : ['content-chart', 'matrix_2x2'],
        summary: settings.layoutGuide?.summary || '总结页参考导入 PPT 的收束结构',
      },
      outlinePattern: settings.outlinePattern?.length
        ? settings.outlinePattern
        : ['背景与目标', '核心洞察', '方案设计', '执行路径', '总结展望'],
      previewSlides: settings.previewSlides?.length
        ? settings.previewSlides
        : [
            { title: baseName, layout: 'cover', description: '导入 PPT 的封面结构参考' },
            { title: '核心内容', layout: 'content', description: '导入 PPT 的内容页结构参考' },
            { title: '总结', layout: 'ending', description: '导入 PPT 的收束页结构参考' },
          ],
      constraints: {
        preferredSlideCount: settings.constraints?.preferredSlideCount || draft.slide_count || slideCount || 10,
        suitableFor: settings.constraints?.suitableFor?.length
          ? settings.constraints.suitableFor
          : ['导入 PPT 同类场景', baseName],
        avoid: settings.constraints?.avoid?.length
          ? settings.constraints.avoid
          : ['不要照搬原 PPT 文案', '只复用版式、色彩、视觉层级和组件节奏'],
      },
    },
  };
}

async function handlePptImport(event: Event) {
  const inputEl = event.target as HTMLInputElement;
  const file = inputEl.files?.[0];
  inputEl.value = '';
  if (!file) return;

  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith('.pptx')) {
    toastStore.warning('文件格式不支持', '轻量 pptx_to_svg 转换器仅支持 .pptx，请先将 .ppt 另存为 .pptx 后导入');
    return;
  }

  importingPpt.value = true;
  try {
    const parsed = await parsePptxPreview(file);
    const baseName = file.name.replace(/\.(pptx?|PPTX?)$/, '').trim() || '导入 PPT 模板';
    if (parsed.draft) {
      importDraft.value = normalizeImportedDraft(parsed.draft, file.name, baseName, parsed.slideCount, parsed.importId);
      toastStore.success('已生成模板草稿', '请在预览弹窗中确认后添加');
      return;
    }
    const importedState = buildImportedProjectState(baseName, file.name, parsed);
    const payload = buildTemplatePayloadFromProject(
      {
        id: `import-${Date.now()}`,
        title: baseName,
        topic: baseName,
        description: parsed.allText || `由 ${file.name} 导入生成的模板方案`,
        content: parsed.allText,
        state: importedState,
      },
      {
        name: baseName,
        category: '导入模板',
        isPublic: false,
      }
    );
    importDraft.value = {
      importId: parsed.importId,
      name: payload.name,
      category: '导入模板',
      description: `由 ${file.name} 生成的模板草稿，确认后可在 PPT 输入页作为参考模板使用。`,
      slide_count: payload.slide_count,
      accent: payload.accent,
      settings: {
        ...payload.settings,
        sourceProjectTitle: file.name,
        constraints: {
          ...payload.settings.constraints,
          suitableFor: ['导入 PPT 同类场景', baseName, ...(payload.settings.constraints?.suitableFor || [])],
          avoid: ['不要照搬原 PPT 文案', '仅参考版式和视觉风格'],
        },
      },
    };
  } catch (error) {
    toastStore.error('导入失败', error instanceof Error ? error.message : '无法读取 PPT 模板');
  } finally {
    importingPpt.value = false;
  }
}

async function cancelImportDraft() {
  const importId = importDraft.value?.importId;
  importDraft.value = null;
  if (importId) {
    await templateApi.deletePptxPreviewImport(importId).catch(() => undefined);
  }
}

async function confirmImportTemplate() {
  if (!importDraft.value) return;
  saving.value = true;
  try {
    const response = await templateApi.create({
      name: importDraft.value.name,
      category: importDraft.value.category,
      description: importDraft.value.description,
      slide_count: importDraft.value.slide_count,
      accent: importDraft.value.accent,
      settings: importDraft.value.settings,
      is_public: false,
    });
    if (response.success) {
      toastStore.success('模板已添加', importDraft.value.name);
      importDraft.value = null;
      await fetchTemplates();
      await agentStore.fetchTemplates();
    } else {
      toastStore.error(response.message || '添加模板失败');
    }
  } catch (error: any) {
    toastStore.error('添加模板失败', error.message || '未知错误');
  } finally {
    saving.value = false;
  }
}

function openEditModal(template: Template) {
  const settings = normalizeSettings(template);
  editingTemplate.value = template;
  editorForm.value = {
    name: template.name,
    category: template.category || '',
    description: template.description || '',
    slide_count: template.slide_count || settings.constraints?.preferredSlideCount || 10,
    accent: template.accent || '#334155',
    is_public: Boolean(template.is_public),
    visualTone: settings.styleGuide?.visualTone || '',
    colorPalette: (settings.styleGuide?.colorPalette || []).join(', '),
    typography: settings.styleGuide?.typography || '',
    iconStyle: settings.styleGuide?.iconStyle || '',
    coverLayout: settings.layoutGuide?.cover || '',
    sectionLayout: settings.layoutGuide?.section || '',
    contentLayouts: (settings.layoutGuide?.contentLayouts || []).join('\n'),
    dataLayouts: (settings.layoutGuide?.dataLayouts || []).join('\n'),
    summaryLayout: settings.layoutGuide?.summary || '',
    outlinePattern: (settings.outlinePattern || []).join('\n'),
    previewSlides: (settings.previewSlides || []).map((slide) => [slide.title, slide.layout, slide.description].filter(Boolean).join('|')).join('\n'),
    suitableFor: (settings.constraints?.suitableFor || []).join('\n'),
    avoid: (settings.constraints?.avoid || []).join('\n'),
  };
  activeEditorSection.value = 'basic';
  showEditor.value = true;
}

async function saveTemplate() {
  if (!editorForm.value.name.trim()) {
    toastStore.warning('请输入模板名称');
    activeEditorSection.value = 'basic';
    return;
  }
  if (isTemplateNameDuplicated.value) {
    toastStore.error('模板名称重复', `「${editorForm.value.name.trim()}」已存在，请换一个名称`);
    activeEditorSection.value = 'basic';
    return;
  }
  if (!editorForm.value.visualTone.trim()) {
    toastStore.warning('请填写视觉气质');
    activeEditorSection.value = 'style';
    return;
  }
  if (editorOutlineItems.value.length === 0) {
    toastStore.warning('请至少填写一段大纲结构');
    activeEditorSection.value = 'outline';
    return;
  }

  const payload = {
    name: editorForm.value.name.trim(),
    category: editorForm.value.category.trim() || '通用',
    description: editorForm.value.description.trim(),
    slide_count: Number(editorForm.value.slide_count) || 10,
    accent: editorForm.value.accent || '#334155',
    is_public: editorForm.value.is_public,
    settings: buildSettingsFromForm(),
  };

  saving.value = true;
  toastStore.info(editingTemplate.value ? '正在更新模板' : '正在创建模板', payload.name);
  try {
    const response = editingTemplate.value
      ? await templateApi.update(editingTemplate.value.id, payload)
      : await templateApi.create(payload);
    if (response.success) {
      toastStore.success(editingTemplate.value ? '模板方案已更新' : '模板方案已创建', payload.name);
      showEditor.value = false;
      await fetchTemplates();
      await agentStore.fetchTemplates();
    } else {
      toastStore.error(response.message || '保存失败');
    }
  } catch (error: any) {
    toastStore.error('保存失败', error.message);
  } finally {
    saving.value = false;
  }
}

function resetEditorDefaults() {
  const base = createEmptyForm();
  editorForm.value = {
    ...editorForm.value,
    visualTone: base.visualTone,
    colorPalette: base.colorPalette,
    typography: base.typography,
    iconStyle: base.iconStyle,
    coverLayout: base.coverLayout,
    sectionLayout: base.sectionLayout,
    contentLayouts: base.contentLayouts,
    dataLayouts: base.dataLayouts,
    summaryLayout: base.summaryLayout,
    outlinePattern: base.outlinePattern,
    previewSlides: base.previewSlides,
    suitableFor: base.suitableFor,
    avoid: base.avoid,
  };
}

function deleteTemplate(template: Template) {
  templateToDelete.value = template;
  showDeleteModal.value = true;
}

function closeDeleteModal(force = false) {
  if (loading.value && !force) return;
  showDeleteModal.value = false;
  templateToDelete.value = null;
}

async function confirmDeleteTemplate() {
  if (!templateToDelete.value) return;

  loading.value = true;
  try {
    const response = await templateApi.delete(templateToDelete.value.id);
    if (response.success) {
      toastStore.success('模板方案已删除');
      closeDeleteModal(true);
      await fetchTemplates();
      await agentStore.fetchTemplates();
    } else {
      toastStore.error(response.message || '删除失败');
    }
  } catch (error: any) {
    toastStore.error('删除失败', error.message);
  } finally {
    loading.value = false;
  }
}

watch(() => route.query.templateId, () => {
  if (templates.value.length > 0) {
    focusedTemplateId.value = null;
    focusTemplateFromRoute();
  }
});

onMounted(fetchTemplates);
</script>

<template>
  <div class="template-page">
    <header class="page-header">
      <div>
        <p class="page-kicker">PPT 方案资产库</p>
        <h2>模板广场</h2>
        <p>管理可复用的主题风格、排版布局、大纲结构和示例预览。模板会在具体 PPT 的输入页中选择使用。</p>
      </div>
      <UiButton variant="primary" :loading="importingPpt" @click="triggerPptImport">
        <FileUp :size="15" />
        导入 PPT 生成模板
      </UiButton>
      <input
        ref="importFileInput"
        class="hidden-input"
        type="file"
        accept=".ppt,.pptx"
        @change="handlePptImport"
      />
    </header>

    <section class="toolbar">
      <UiInput v-model="searchQuery" class="toolbar__search" placeholder="搜索主题、布局、大纲..." :prefix-icon="Search" />
      <div class="category-tabs">
        <button
          v-for="category in categories"
          :key="category"
          class="category-tab"
          :class="{ 'category-tab--active': selectedCategory === category }"
          @click="selectedCategory = category"
        >
          {{ category }}
        </button>
      </div>
    </section>

    <PageLoadingState v-if="loading && templates.length === 0" title="正在加载模板方案" description="正在同步模板预览和排版规则" />
    <UiFeedbackState
      v-else-if="loadError && templates.length === 0"
      tone="error"
      title="模板方案加载失败"
      :description="loadError"
      action-label="重试"
      :loading="loading"
      @action="fetchTemplates"
    />
    <UiEmpty
      v-else-if="filteredTemplates.length === 0"
      class="empty-state"
      :title="searchQuery ? '没有匹配的模板方案' : '暂无模板方案'"
      :description="searchQuery ? '换个关键词或清空分类后再试。' : '导入一个已有 PPT，确认预览后生成可复用模板。'"
    />

    <section v-else class="template-grid">
      <article
        v-for="template in filteredTemplates"
        :key="template.id"
        class="template-card"
      >
        <div class="template-preview" :style="{ '--accent': template.accent || '#334155' }">
          <div class="preview-deck">
            <div
              v-for="(slide, index) in normalizeSettings(template).previewSlides?.slice(0, 3)"
              :key="`${template.id}-${slide.title}-${index}`"
              class="preview-deck__slide"
              :class="[`preview-deck__slide--${slide.layout}`, { 'preview-deck__slide--svg': slide.svg }]"
            >
              <PrivateSvg
                v-if="slide.svg"
                class="preview-deck__svg"
                role="img"
                :aria-label="slide.title"
                :svg="slide.svg"
              />
              <template v-else>
                <span class="preview-deck__index">{{ index + 1 }}</span>
                <strong>{{ slide.title }}</strong>
                <span></span>
                <span></span>
              </template>
            </div>
          </div>
        </div>

        <div class="template-body">
          <div class="template-title-row">
            <h3>{{ template.name }}</h3>
            <UiBadge tone="neutral" size="sm">{{ template.category || '通用' }}</UiBadge>
          </div>
          <p>{{ template.description || normalizeSettings(template).styleGuide?.visualTone }}</p>

          <div class="style-summary">
            <Palette :size="14" />
            <span>{{ normalizeSettings(template).styleGuide?.visualTone }}</span>
          </div>

          <div class="metric-row">
            <div class="metric">
              <Layers :size="14" />
              <span>{{ metricCount(template, 'layouts') }} 类布局</span>
            </div>
            <div class="metric">
              <ListTree :size="14" />
              <span>{{ metricCount(template, 'outline') }} 段大纲</span>
            </div>
            <div class="metric">
              <FileText :size="14" />
              <span>{{ metricCount(template, 'preview') }} 页预览</span>
            </div>
          </div>
        </div>

        <footer class="template-actions">
          <UiButton variant="secondary" size="sm" @click="openPreviewModal(template)">
            <Eye :size="14" />
            查看方案
          </UiButton>
          <button class="icon-action" title="编辑" @click="openEditModal(template)">
            <Pencil :size="14" />
          </button>
          <button class="icon-action icon-action--danger" title="删除" @click="deleteTemplate(template)">
            <Trash2 :size="14" />
          </button>
        </footer>
      </article>
    </section>

    <Teleport to="body">
      <div v-if="showPreviewModal && previewTemplate" class="modal-overlay" @click.self="showPreviewModal = false">
        <div class="modal modal--preview">
          <header class="modal-header">
            <div>
              <p class="modal-kicker">方案详情</p>
              <h3>{{ previewTemplate.name }}</h3>
            </div>
            <button class="modal-close" @click="showPreviewModal = false">
              <X :size="18" />
            </button>
          </header>

          <div class="modal-body">
            <div class="detail-hero" :style="{ '--accent': previewTemplate.accent || '#334155' }">
              <div>
                <UiBadge tone="neutral" size="sm">{{ previewTemplate.category || '通用' }}</UiBadge>
                <p>{{ previewTemplate.description || normalizeSettings(previewTemplate).styleGuide?.visualTone }}</p>
              </div>
              <strong>{{ previewTemplate.slide_count }} 页参考</strong>
            </div>

            <div class="detail-grid">
              <section class="detail-block detail-block--preview">
                <h4><FileText :size="15" /> 示例 PPT 预览</h4>
                <div class="ppt-preview-grid" :style="{ '--accent': previewTemplate.accent || '#334155' }">
                  <div
                    v-for="(slide, index) in previewTemplateSlides"
                    :key="`${slide.title}-${slide.layout}`"
                    class="ppt-preview-slide"
                    :class="[`ppt-preview-slide--${slide.layout}`, { 'ppt-preview-slide--svg': slide.svg }]"
                  >
                    <button class="ppt-preview-slide__stage" type="button" @click="openZoomPreview(slide)">
                      <PrivateSvg
                        v-if="slide.svg"
                        class="ppt-preview-slide__svg"
                        role="img"
                        :aria-label="slide.title"
                        :svg="slide.svg"
                      />
                      <template v-else>
                      <span class="ppt-preview-slide__number">{{ index + 1 }}</span>
                      <strong>{{ slide.title }}</strong>
                      <div class="ppt-preview-slide__body">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                      <p v-if="slide.description">{{ slide.description }}</p>
                      </template>
                    </button>
                    <div class="ppt-preview-slide__meta">{{ formatLayoutLabel(slide.layout) }}</div>
                  </div>
                </div>
              </section>

              <section class="detail-block">
                <h4><Palette :size="15" /> 主题风格</h4>
                <p>{{ normalizeSettings(previewTemplate).styleGuide?.visualTone }}</p>
                <div class="swatches">
                  <span
                    v-for="color in normalizeSettings(previewTemplate).styleGuide?.colorPalette"
                    :key="color"
                    class="swatch"
                    :style="{ background: color }"
                    :title="color"
                  ></span>
                </div>
                <p>{{ normalizeSettings(previewTemplate).styleGuide?.typography }}</p>
                <p>{{ normalizeSettings(previewTemplate).styleGuide?.iconStyle }}</p>
              </section>

              <section class="detail-block">
                <h4><Layers :size="15" /> 排版布局</h4>
                <p>封面：{{ normalizeSettings(previewTemplate).layoutGuide?.cover }}</p>
                <p>章节：{{ normalizeSettings(previewTemplate).layoutGuide?.section }}</p>
                <div class="tag-list">
                  <span v-for="layout in normalizeSettings(previewTemplate).layoutGuide?.contentLayouts" :key="layout">{{ formatLayoutLabel(layout) }}</span>
                  <span v-for="layout in normalizeSettings(previewTemplate).layoutGuide?.dataLayouts" :key="layout">{{ formatLayoutLabel(layout) }}</span>
                </div>
              </section>

              <section class="detail-block">
                <h4><ListTree :size="15" /> 大纲结构</h4>
                <ol class="outline-list">
                  <li v-for="item in normalizeSettings(previewTemplate).outlinePattern" :key="item">{{ item }}</li>
                </ol>
              </section>

            </div>
          </div>

          <footer class="modal-footer">
            <UiButton variant="primary" @click="showPreviewModal = false">关闭</UiButton>
          </footer>
        </div>
      </div>

      <div v-if="zoomPreviewSlide" class="svg-preview-zoom" @click.self="zoomPreviewSlide = null">
        <div class="svg-preview-zoom__panel">
          <header class="svg-preview-zoom__header">
            <div>
              <p class="modal-kicker">示例预览</p>
              <h3>{{ zoomPreviewSlide.title }}</h3>
              <span>{{ formatLayoutLabel(zoomPreviewSlide.layout) }}</span>
            </div>
            <button class="modal-close" title="关闭预览" @click="zoomPreviewSlide = null">
              <X :size="18" />
            </button>
          </header>

          <div class="svg-preview-zoom__body">
            <div class="svg-preview-zoom__canvas">
              <PrivateSvg
                v-if="zoomPreviewSlide.svg"
                class="svg-preview-zoom__svg"
                role="img"
                :aria-label="zoomPreviewSlide.title"
                :svg="zoomPreviewSlide.svg"
              />
              <div v-else class="svg-preview-zoom__fallback" :class="`ppt-preview-slide--${zoomPreviewSlide.layout}`">
                <span class="ppt-preview-slide__number">{{ zoomPreviewSlide.pageNumber || 1 }}</span>
                <strong>{{ zoomPreviewSlide.title }}</strong>
                <div class="ppt-preview-slide__body">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <p v-if="zoomPreviewSlide.description">{{ zoomPreviewSlide.description }}</p>
              </div>
            </div>
          </div>

          <footer class="svg-preview-zoom__footer">
            <UiButton variant="primary" @click="zoomPreviewSlide = null">关闭</UiButton>
          </footer>
        </div>
      </div>

      <DeleteConfirmModal
        :open="showDeleteModal"
        :item-name="templateToDelete?.name || ''"
        :loading="loading"
        @close="closeDeleteModal"
        @confirm="confirmDeleteTemplate"
      />

      <div v-if="importDraft" class="modal-overlay" @click.self="cancelImportDraft">
        <div class="modal modal--preview">
          <header class="modal-header">
            <div>
              <p class="modal-kicker">导入预览</p>
              <h3>{{ importDraft.name }}</h3>
            </div>
            <button class="modal-close" :disabled="saving" @click="cancelImportDraft">
              <X :size="18" />
            </button>
          </header>

          <div class="modal-body">
            <div class="detail-hero" :style="{ '--accent': importDraft.accent }">
              <div>
                <UiBadge tone="neutral" size="sm">{{ importDraft.category }}</UiBadge>
                <p>{{ importDraft.description }}</p>
              </div>
              <strong>{{ importDraft.slide_count }} 页参考</strong>
            </div>

            <div class="detail-grid">
            <section class="detail-block detail-block--preview">
              <h4><FileText :size="15" /> 示例 PPT 预览</h4>
              <div class="ppt-preview-grid" :style="{ '--accent': importDraft.accent }">
                <div
                  v-for="(slide, index) in importPreviewSlides.slice(0, 6)"
                  :key="`${slide.title}-${index}`"
                  class="ppt-preview-slide"
                  :class="[`ppt-preview-slide--${slide.layout}`, { 'ppt-preview-slide--svg': slide.svg }]"
                >
                  <button class="ppt-preview-slide__stage" type="button" @click="openZoomPreview(slide)">
                    <PrivateSvg
                      v-if="slide.svg"
                      class="ppt-preview-slide__svg"
                      role="img"
                      :aria-label="slide.title"
                      :svg="slide.svg"
                    />
                    <template v-else>
                      <span class="ppt-preview-slide__number">{{ slide.pageNumber || index + 1 }}</span>
                      <strong>{{ slide.title }}</strong>
                      <div class="ppt-preview-slide__body">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                      <p v-if="slide.description">{{ slide.description }}</p>
                    </template>
                  </button>
                  <div class="ppt-preview-slide__meta">{{ formatLayoutLabel(slide.layout) }}</div>
                </div>
              </div>
            </section>

            <section class="detail-block">
              <h4><Palette :size="15" /> 主题风格</h4>
              <p>{{ importDraft.settings.styleGuide?.visualTone }}</p>
              <div class="swatches">
                <span
                  v-for="color in importDraft.settings.styleGuide?.colorPalette"
                  :key="color"
                  class="swatch"
                  :style="{ background: color }"
                  :title="color"
                ></span>
              </div>
              <p>{{ importDraft.settings.styleGuide?.typography }}</p>
              <p>{{ importDraft.settings.styleGuide?.iconStyle }}</p>
            </section>

            <section class="detail-block">
              <h4><Layers :size="15" /> 排版布局</h4>
              <p>封面：{{ importDraft.settings.layoutGuide?.cover }}</p>
              <p>章节：{{ importDraft.settings.layoutGuide?.section }}</p>
              <div class="tag-list">
                <span v-for="layout in importDraft.settings.layoutGuide?.contentLayouts" :key="layout">{{ formatLayoutLabel(layout) }}</span>
                <span v-for="layout in importDraft.settings.layoutGuide?.dataLayouts" :key="layout">{{ formatLayoutLabel(layout) }}</span>
              </div>
            </section>

            <section class="detail-block">
              <h4><ListTree :size="15" /> 大纲结构</h4>
              <ol class="outline-list">
                <li v-for="item in importDraft.settings.outlinePattern" :key="item">{{ item }}</li>
              </ol>
            </section>
            <section class="detail-block">
              <h4><FileText :size="15" /> 复用边界</h4>
              <p>适用：{{ importDraft.settings.constraints?.suitableFor?.join('、') || '导入 PPT 同类场景' }}</p>
              <p>避免：{{ importDraft.settings.constraints?.avoid?.join('、') || '不要照搬原 PPT 文案' }}</p>
            </section>
            </div>
          </div>

          <footer class="modal-footer">
            <UiButton variant="secondary" :disabled="saving" @click="cancelImportDraft">取消</UiButton>
            <UiButton variant="primary" :loading="saving" @click="confirmImportTemplate">确认添加模板</UiButton>
          </footer>
        </div>
      </div>

      <div v-if="showEditor" class="modal-overlay" @click.self="showEditor = false">
        <div class="modal modal--editor">
          <header class="modal-header">
            <div>
              <p class="modal-kicker">编辑方案</p>
              <h3>{{ editorForm.name }}</h3>
            </div>
            <button class="modal-close" @click="showEditor = false">
              <X :size="18" />
            </button>
          </header>

          <div class="modal-body editor-body editor-body--structured">
            <aside class="editor-nav" aria-label="模板方案编辑分区">
              <button
                v-for="section in editorSections"
                :key="section.id"
                type="button"
                class="editor-nav__item"
                :class="{ 'editor-nav__item--active': activeEditorSection === section.id }"
                @click="activeEditorSection = section.id"
              >
                <strong>{{ section.title }}</strong>
                <span>{{ section.desc }}</span>
              </button>

              <div class="editor-score">
                <span>完整度</span>
                <strong>{{ editorCompleteness }}%</strong>
                <div class="editor-score__bar">
                  <i :style="{ width: `${editorCompleteness}%` }"></i>
                </div>
              </div>

              <button class="editor-reset" type="button" @click="resetEditorDefaults">恢复默认结构</button>
            </aside>

            <section class="editor-workbench">
              <div v-show="activeEditorSection === 'basic'" class="editor-section">
                <h4>基础信息</h4>
                <div class="editor-grid">
                  <UiField label="方案名称" required>
                    <UiInput v-model="editorForm.name" placeholder="例如：年度经营复盘" />
                    <p v-if="isTemplateNameDuplicated" class="field-hint field-hint--error">
                      模板名称已存在，请换一个名称。
                    </p>
                  </UiField>
                  <UiField label="分类">
                    <UiInput v-model="editorForm.category" placeholder="例如：商务、产品、教育" />
                  </UiField>
                </div>
                <UiField label="说明">
                  <UiTextarea v-model="editorForm.description" :rows="4" placeholder="描述适用场景、受众和表达目标" />
                </UiField>
                <div class="editor-grid">
                  <UiField label="参考页数">
                    <input v-model.number="editorForm.slide_count" class="plain-input" type="number" min="3" max="40" />
                  </UiField>
                  <UiField label="主色">
                    <div class="color-row">
                      <input v-model="editorForm.accent" class="color-input" type="color" />
                      <span>{{ editorForm.accent }}</span>
                    </div>
                  </UiField>
                </div>
                <label class="checkbox-row">
                  <input v-model="editorForm.is_public" type="checkbox" />
                  <span>公开给其他用户</span>
                </label>
              </div>

              <div v-show="activeEditorSection === 'style'" class="editor-section">
                <h4>主题风格</h4>
                <UiField label="视觉气质" required>
                  <UiInput v-model="editorForm.visualTone" placeholder="例如：克制、清晰、适合管理层汇报" />
                </UiField>
                <UiField label="色板">
                  <UiTextarea v-model="editorForm.colorPalette" :rows="4" placeholder="每行或逗号分隔一个 HEX 颜色，例如 #334155" />
                </UiField>
                <div class="editor-swatches">
                  <span v-for="color in editorColors" :key="color" :style="{ background: color }" :title="color"></span>
                </div>
                <div class="editor-grid">
                  <UiField label="字体建议">
                    <UiInput v-model="editorForm.typography" />
                  </UiField>
                  <UiField label="图标风格">
                    <UiInput v-model="editorForm.iconStyle" />
                  </UiField>
                </div>
              </div>

              <div v-show="activeEditorSection === 'layout'" class="editor-section">
                <h4>排版布局</h4>
                <div class="editor-grid">
                  <UiField label="封面">
                    <UiInput v-model="editorForm.coverLayout" />
                  </UiField>
                  <UiField label="章节页">
                    <UiInput v-model="editorForm.sectionLayout" />
                  </UiField>
                </div>
                <UiField label="内容页布局">
                  <UiTextarea v-model="editorForm.contentLayouts" :rows="5" placeholder="每行一个布局，例如：图文页" />
                </UiField>
                <UiField label="数据页布局">
                  <UiTextarea v-model="editorForm.dataLayouts" :rows="4" placeholder="每行一个布局，例如：指标卡" />
                </UiField>
                <UiField label="总结页">
                  <UiInput v-model="editorForm.summaryLayout" />
                </UiField>
              </div>

              <div v-show="activeEditorSection === 'outline'" class="editor-section">
                <h4>大纲与示例</h4>
                <UiField label="大纲结构" required>
                  <UiTextarea v-model="editorForm.outlinePattern" :rows="6" placeholder="每行一个章节，例如：背景与目标" />
                </UiField>
                <UiField label="示例 PPT 预览">
                  <UiTextarea v-model="editorForm.previewSlides" :rows="6" placeholder="每行格式：标题|布局|说明" />
                </UiField>
              </div>

              <div v-show="activeEditorSection === 'rules'" class="editor-section">
                <h4>适用边界</h4>
                <div class="editor-grid">
                  <UiField label="适用场景">
                    <UiTextarea v-model="editorForm.suitableFor" :rows="7" placeholder="每行一个场景" />
                  </UiField>
                  <UiField label="避免事项">
                    <UiTextarea v-model="editorForm.avoid" :rows="7" placeholder="每行一条限制" />
                  </UiField>
                </div>
              </div>
            </section>

            <aside class="editor-preview">
              <div class="editor-preview__head">
                <span>实时预览</span>
                <strong>{{ editorForm.name || '未命名方案' }}</strong>
              </div>

              <div class="editor-preview__slide" :style="{ '--accent': editorForm.accent || '#334155' }">
                <span>{{ editorForm.category || '通用' }}</span>
                <h4>{{ editorForm.name || '模板方案' }}</h4>
                <p>{{ editorForm.visualTone || editorForm.description || '填写主题风格后会展示在这里。' }}</p>
                <div class="editor-preview__bars">
                  <i></i>
                  <i></i>
                  <i></i>
                </div>
              </div>

              <div class="editor-preview__block">
                <span>色板</span>
                <div class="editor-swatches">
                  <span v-for="color in editorColors" :key="`preview-${color}`" :style="{ background: color }" :title="color"></span>
                </div>
              </div>

              <div class="editor-preview__block">
                <span>布局</span>
                <div class="editor-chip-list">
                  <i v-for="layout in [...editorContentLayouts, ...editorDataLayouts].slice(0, 6)" :key="layout">{{ formatLayoutLabel(layout) }}</i>
                </div>
              </div>

              <div class="editor-preview__block">
                <span>大纲</span>
                <ol>
                  <li v-for="item in editorOutlineItems.slice(0, 5)" :key="item">{{ item }}</li>
                </ol>
              </div>

              <div class="editor-preview__block">
                <span>示例页</span>
                <div class="editor-mini-slides">
                  <button
                    v-for="slide in editorPreviewSlides.slice(0, 3)"
                    :key="`${slide.title}-${slide.layout}`"
                    type="button"
                  >
                    <strong>{{ slide.title }}</strong>
                    <small>{{ formatLayoutLabel(slide.layout) }}</small>
                  </button>
                </div>
              </div>

              <div class="editor-preview__block">
                <span>边界</span>
                <p>{{ editorSuitableItems.slice(0, 2).join('、') || '未填写适用场景' }}</p>
                <p>{{ editorAvoidItems.slice(0, 2).join('、') || '未填写避免事项' }}</p>
              </div>
            </aside>
          </div>

          <footer class="modal-footer">
            <UiButton variant="secondary" @click="showEditor = false">取消</UiButton>
            <UiButton variant="primary" :loading="saving" :disabled="!editorForm.name.trim() || isTemplateNameDuplicated" @click="saveTemplate">
              保存方案
            </UiButton>
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.template-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
  padding: 20px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--color-border);
}

.hidden-input {
  display: none;
}

.page-kicker,
.modal-kicker {
  margin: 0 0 4px;
  color: var(--color-accent);
  font-size: 12px;
  font-weight: 700;
}

.page-header h2,
.modal-header h3 {
  margin: 0;
  color: var(--color-text);
}

.page-header h2 {
  font-size: 25px;
}

.page-header p:last-child {
  max-width: 720px;
  margin: 8px 0 0;
  color: var(--color-subtle);
  font-size: 14px;
  line-height: 1.6;
}

.toolbar {
  display: grid;
  grid-template-columns: minmax(260px, 360px) 1fr;
  gap: 12px;
  align-items: center;
}

.toolbar__search {
  width: 100%;
}

.category-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.category-tab {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
  font-size: 12px;
  transition: border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
}

.category-tab:hover,
.category-tab--active {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.loading-state,
.empty-state {
  padding: 64px 20px;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.template-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast);
}

.template-card:hover {
  border-color: var(--color-border-strong);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}

.template-preview {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  height: 174px;
  padding: 18px 22px;
  background: color-mix(in srgb, var(--accent) 10%, var(--color-panel));
  border-bottom: 1px solid var(--color-border);
}

.preview-deck {
  position: relative;
  width: min(100%, 272px);
  min-height: 136px;
}

.preview-deck__slide {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 214px;
  aspect-ratio: 16 / 9;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--color-border));
  border-radius: 6px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.preview-deck__slide--svg {
  padding: 0;
  overflow: hidden;
}

.preview-deck__svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--color-surface);
}

.preview-deck__svg :deep(svg),
.ppt-preview-slide__svg :deep(svg),
.svg-preview-zoom__svg :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}

.preview-deck__slide:nth-child(1) {
  left: 0;
  top: 0;
  z-index: 3;
}

.preview-deck__slide:nth-child(2) {
  left: 32px;
  top: 12px;
  z-index: 2;
}

.preview-deck__slide:nth-child(3) {
  left: 58px;
  top: 24px;
  z-index: 1;
}

.preview-deck__index {
  position: absolute;
  right: 8px;
  bottom: 6px;
  color: var(--color-muted);
  font-size: 9px;
  font-weight: 700;
}

.preview-deck__slide strong {
  width: 76%;
  overflow: hidden;
  color: var(--color-text);
  font-size: 10px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-deck__slide > span:not(.preview-deck__index) {
  display: block;
  height: 5px;
  border-radius: 3px;
  background: var(--color-border);
}

.preview-deck__slide > span:nth-of-type(2) {
  width: 82%;
}

.preview-deck__slide > span:nth-of-type(3) {
  width: 52%;
}

.preview-deck__slide--cover strong,
.preview-deck__slide--ending strong {
  margin-top: 18px;
  color: var(--accent);
  font-size: 12px;
}

.preview-deck__slide--content-image::after,
.preview-deck__slide--content-chart::after {
  content: '';
  position: absolute;
  right: 12px;
  top: 30px;
  width: 42px;
  height: 38px;
  border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--color-border));
  border-radius: 5px;
  background: color-mix(in srgb, var(--accent) 8%, var(--color-panel));
}

.template-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 9px;
  padding: 14px 16px 12px;
}

.template-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.template-title-row h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 16px;
  line-height: 1.35;
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.template-body p {
  margin: 0;
  color: var(--color-subtle);
  font-size: 13px;
  line-height: 1.45;
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.style-summary,
.metric {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-muted);
  font-size: 12px;
}

.style-summary {
  align-items: flex-start;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
}

.style-summary span {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-height: 1.45;
}

.metric-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.metric {
  justify-content: center;
  min-height: 30px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.template-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px 12px;
  border-top: 1px solid var(--color-border);
}

.icon-action {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
  transition: border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
}

.icon-action:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
  background: var(--color-panel);
}

.icon-action--danger:hover {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--color-overlay);
}

.modal {
  display: flex;
  flex-direction: column;
  width: min(100%, 920px);
  max-height: min(92vh, 920px);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
}

.modal--editor {
  width: min(100%, 1180px);
}

.modal-header,
.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--color-border);
}

.modal-footer {
  justify-content: flex-end;
  border-top: 1px solid var(--color-border);
  border-bottom: 0;
}

.modal-close {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
}

.modal-body {
  overflow: auto;
  padding: 18px;
}

.svg-preview-zoom {
  position: fixed;
  inset: 0;
  z-index: 10010;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 22px;
  background: var(--color-overlay);
}

.svg-preview-zoom__panel {
  display: flex;
  flex-direction: column;
  width: min(1120px, 96vw);
  max-height: 94vh;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
}

.svg-preview-zoom__header,
.svg-preview-zoom__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
}

.svg-preview-zoom__footer {
  justify-content: flex-end;
  border-top: 1px solid var(--color-border);
  border-bottom: 0;
}

.svg-preview-zoom__header h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 16px;
}

.svg-preview-zoom__header span {
  display: inline-flex;
  margin-top: 4px;
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 600;
}

.svg-preview-zoom__body {
  min-height: 0;
  overflow: auto;
  padding: 18px;
  background: var(--color-panel);
}

.svg-preview-zoom__canvas {
  display: grid;
  place-items: center;
  width: min(100%, 1040px);
  aspect-ratio: 16 / 9;
  margin: 0 auto;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.svg-preview-zoom__svg {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--color-surface);
}

.svg-preview-zoom__fallback {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 100%;
  height: 100%;
  padding: 44px;
  color: var(--color-text);
}

.detail-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 16px;
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--color-border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 8%, var(--color-panel));
}

.detail-hero p {
  margin: 10px 0 0;
  color: var(--color-subtle);
  line-height: 1.6;
}

.detail-hero strong {
  color: var(--color-accent);
  white-space: nowrap;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.detail-block,
.editor-section {
  padding: 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
}

.detail-block--preview {
  grid-column: 1 / -1;
}

.detail-block h4,
.editor-section h4 {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 10px;
  color: var(--color-text);
  font-size: 14px;
}

.detail-block p {
  margin: 6px 0;
  color: var(--color-subtle);
  font-size: 13px;
  line-height: 1.55;
}

.swatches,
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 10px 0;
}

.swatch {
  width: 30px;
  height: 30px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
}

.tag-list span {
  padding: 5px 8px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 12px;
}

.outline-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 20px;
  color: var(--color-text);
  font-size: 13px;
}

.ppt-preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.ppt-preview-slide {
  min-width: 0;
}

.ppt-preview-slide__stage {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 100%;
  aspect-ratio: 16 / 9;
  padding: 14px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--accent) 26%, var(--color-border));
  border-radius: 7px;
  background: var(--color-surface);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: zoom-in;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.ppt-preview-slide__stage:hover {
  border-color: color-mix(in srgb, var(--accent) 54%, var(--color-border-strong));
  box-shadow: var(--shadow-sm);
}

.ppt-preview-slide--svg .ppt-preview-slide__stage {
  padding: 0;
}

.ppt-preview-slide__svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--color-surface);
}

.ppt-preview-slide__number {
  position: absolute;
  right: 10px;
  bottom: 8px;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.ppt-preview-slide__stage strong {
  max-width: 82%;
  color: var(--color-text);
  font-size: 13px;
  line-height: 1.25;
}

.ppt-preview-slide__body {
  display: grid;
  gap: 6px;
  width: 62%;
}

.ppt-preview-slide__body span {
  height: 7px;
  border-radius: 4px;
  background: var(--color-border);
}

.ppt-preview-slide__body span:nth-child(2) {
  width: 80%;
}

.ppt-preview-slide__body span:nth-child(3) {
  width: 56%;
}

.ppt-preview-slide__stage p {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--color-subtle);
  font-size: 10px;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.ppt-preview-slide--cover .ppt-preview-slide__stage,
.ppt-preview-slide--ending .ppt-preview-slide__stage {
  justify-content: center;
}

.ppt-preview-slide--cover .ppt-preview-slide__stage strong,
.ppt-preview-slide--ending .ppt-preview-slide__stage strong {
  color: var(--accent);
  font-size: 15px;
}

.ppt-preview-slide--content-image .ppt-preview-slide__stage::after,
.ppt-preview-slide--content-chart .ppt-preview-slide__stage::after {
  content: '';
  position: absolute;
  right: 14px;
  top: 44px;
  width: 34%;
  height: 38%;
  border: 1px dashed color-mix(in srgb, var(--accent) 44%, var(--color-border));
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 8%, var(--color-panel));
}

.ppt-preview-slide--svg .ppt-preview-slide__stage::after {
  content: none;
}

.modal--preview .ppt-preview-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: start;
}

.modal--preview .ppt-preview-grid .ppt-preview-slide:first-child {
  grid-column: 1 / -1;
}

.modal--preview .ppt-preview-grid .ppt-preview-slide:first-child .ppt-preview-slide__stage {
  max-height: min(58vh, 620px);
}

.ppt-preview-slide__meta {
  margin-top: 6px;
  color: var(--color-accent);
  font-size: 11px;
  font-weight: 600;
}

.editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.editor-body--structured {
  display: grid;
  grid-template-columns: 188px minmax(0, 1fr) 280px;
  gap: 14px;
  align-items: start;
  min-height: 560px;
}

.editor-nav,
.editor-preview {
  position: sticky;
  top: 0;
  display: grid;
  gap: 10px;
  align-self: start;
}

.editor-nav__item,
.editor-reset {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
}

.editor-nav__item {
  display: grid;
  gap: 3px;
  padding: 11px 12px;
}

.editor-nav__item strong {
  font-size: 13px;
}

.editor-nav__item span {
  color: var(--color-muted);
  font-size: 12px;
}

.editor-nav__item:hover,
.editor-nav__item--active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.editor-score {
  display: grid;
  gap: 7px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
}

.editor-score span,
.editor-preview__block > span,
.editor-preview__head span {
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 600;
}

.editor-score strong {
  color: var(--color-text);
  font-size: 20px;
}

.editor-score__bar {
  height: 6px;
  overflow: hidden;
  border-radius: 6px;
  background: var(--color-border);
}

.editor-score__bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-accent);
}

.editor-reset {
  min-height: 34px;
  padding: 0 12px;
  color: var(--color-muted);
  font-size: 12px;
  text-align: center;
}

.editor-workbench {
  min-width: 0;
}

.editor-workbench .editor-section {
  min-height: 540px;
}

.editor-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.editor-swatches span {
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
}

.editor-preview {
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
}

.editor-preview__head {
  display: grid;
  gap: 4px;
}

.editor-preview__head strong {
  overflow: hidden;
  color: var(--color-text);
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-preview__slide {
  display: grid;
  gap: 10px;
  aspect-ratio: 16 / 9;
  padding: 16px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--color-border));
  border-radius: 8px;
  background: var(--color-surface);
}

.editor-preview__slide span {
  justify-self: start;
  padding: 3px 7px;
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--color-border));
  border-radius: 999px;
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
}

.editor-preview__slide h4 {
  margin: 0;
  color: var(--color-text);
  font-size: 16px;
}

.editor-preview__slide p,
.editor-preview__block p {
  margin: 0;
  color: var(--color-subtle);
  font-size: 12px;
  line-height: 1.45;
}

.editor-preview__bars {
  display: grid;
  gap: 5px;
  align-self: end;
}

.editor-preview__bars i {
  height: 6px;
  border-radius: 999px;
  background: var(--color-border);
}

.editor-preview__bars i:nth-child(1) {
  width: 76%;
}

.editor-preview__bars i:nth-child(2) {
  width: 58%;
}

.editor-preview__bars i:nth-child(3) {
  width: 42%;
}

.editor-preview__block {
  display: grid;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border);
}

.editor-chip-list,
.editor-mini-slides {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.editor-chip-list i {
  padding: 4px 7px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 11px;
  font-style: normal;
}

.editor-preview__block ol {
  display: grid;
  gap: 5px;
  margin: 0;
  padding-left: 18px;
  color: var(--color-text);
  font-size: 12px;
}

.editor-mini-slides button {
  display: grid;
  gap: 4px;
  width: calc(50% - 3px);
  min-height: 54px;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text);
  text-align: left;
}

.editor-mini-slides strong {
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-mini-slides small {
  color: var(--color-muted);
  font-size: 10px;
}

.plain-input {
  width: 100%;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
}

.plain-input:focus {
  border-color: var(--color-accent);
  outline: none;
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.field-hint {
  margin: 8px 0 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.5;
}

.field-hint--error {
  color: var(--color-danger);
}

.color-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
}

.color-input {
  width: 42px;
  height: 36px;
  padding: 2px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.color-row span {
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 12px;
}

.checkbox-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-muted);
  font-size: 13px;
}

@media (max-width: 860px) {
  .template-page {
    gap: 12px;
    padding: 14px 12px 18px;
  }

  .page-header {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
    padding-bottom: 12px;
  }

  .page-header h2 {
    font-size: 22px;
    line-height: 1.2;
  }

  .page-header p:last-child {
    margin-top: 6px;
    font-size: 13px;
  }

  .toolbar,
  .detail-grid,
  .editor-body--structured,
  .editor-grid,
  .ppt-preview-grid {
    grid-template-columns: 1fr;
  }

  .editor-nav,
  .editor-preview {
    position: static;
  }

  .editor-nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .editor-score,
  .editor-reset {
    grid-column: 1 / -1;
  }

  .editor-workbench .editor-section {
    min-height: auto;
  }

  .metric-row {
    grid-template-columns: 1fr;
  }

  .template-actions {
    flex-wrap: wrap;
  }

  .toolbar {
    gap: 10px;
  }

  .category-tabs {
    flex-wrap: nowrap;
    margin: 0 -12px;
    padding: 0 12px 4px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }

  .category-tabs::-webkit-scrollbar {
    display: none;
  }

  .category-tab {
    flex: 0 0 auto;
  }

  .loading-state,
  .empty-state {
    padding: 28px 12px;
  }

  .modal-overlay,
  .svg-preview-zoom {
    align-items: stretch;
    padding: 12px;
  }

  .modal,
  .modal--editor,
  .svg-preview-zoom__panel {
    width: 100%;
    max-height: calc(100dvh - 24px);
  }

  .modal-header,
  .svg-preview-zoom__header {
    align-items: flex-start;
  }

  .modal-footer,
  .svg-preview-zoom__footer {
    flex-direction: column-reverse;
  }

  .modal-footer :deep(.ui-button),
  .svg-preview-zoom__footer :deep(.ui-button) {
    width: 100%;
  }
}

@media (max-width: 560px) {
  .template-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .toolbar {
    grid-template-columns: 1fr;
  }

  .template-preview {
    height: 146px;
    padding: 14px 16px;
  }

  .preview-deck {
    min-height: 112px;
  }

  .preview-deck__slide {
    width: 180px;
  }

  .editor-nav {
    grid-template-columns: 1fr;
  }
}
</style>
