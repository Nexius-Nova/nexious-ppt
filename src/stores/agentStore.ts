import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { analyzeDeckInput, exportDeck, generateSlideImages } from '@/services/agentSimulator';
import { promptApi, skillApi, templateApi, workflowApi, aiApi, versionApi, projectApi, generationJobApi, configApi } from '@/services/api';
import type { GenerationJobStatus, RunConfig } from '@/services/api';
import { applyTemplateLayoutParams, getTemplateColors } from '@/composables/templateColors';
import { slideNeedsImage } from '@/utils/slideVisuals';
import { useApiKeyStore } from './apiKeyStore';
import { useToastStore } from './toastStore';
import { normalizeInputSkillCategory } from '@/constants/inputSkillCategories';
import type {
  AgentParameters,
  ChatMessage,
  DeckInput,
  DesignSpec,
  ExportArtifact,
  ConfigOptionGroups,
  ConfigOptionKey,
  GeneratedImage,
  PromptDefinition,
  PptProject,
  PptProjectState,
  PptTemplate,
  SkillDefinition,
  SkillExtension,
  SlideLayout,
  SlideOutline,
  SpecLock,
  SpecSlide,
  TemplateAsset,
  TemplateAssetSettings,
  TemplateStyle,
  VersionSnapshot,
  WorkflowStep,
  WorkflowStepId,
  InputProcessStep,
  UploadedFileContent
} from '@/types/agent';

const workflowSteps: WorkflowStep[] = [
  {
    id: 'input',
    title: '资料',
    description: '准备资料和需求',
    status: 'idle',
    progress: 0
  },
  {
    id: 'outline',
    title: '大纲',
    description: '整理页面结构',
    status: 'idle',
    progress: 0
  },
  {
    id: 'images',
    title: '图片',
    description: '按需生成图片',
    status: 'idle',
    progress: 0
  },
  {
    id: 'layout',
    title: '页面',
    description: '生成页面预览',
    status: 'idle',
    progress: 0
  },
  {
    id: 'preview',
    title: '导出',
    description: '导出 PPTX',
    status: 'idle',
    progress: 0
  }
];

const defaultSkills: SkillDefinition[] = [
  {
    id: 'speaker-notes',
    name: '讲稿生成',
    description: '辅助生成每页演讲备注与自然转场。',
    enabled: false,
    order: 1,
    params: {
      style: 'professional',
      length: 'medium'
    }
  },
  {
    id: 'data-chart',
    name: '数据图表',
    description: '识别数据表达机会，形成图表建议。',
    enabled: false,
    order: 2,
    params: {
      type: 'auto',
      theme: 'default'
    }
  },
  {
    id: 'design-polish',
    name: '设计优化',
    description: '优化页面节奏、层级和视觉重点。',
    enabled: false,
    order: 3,
    params: {
      level: 'medium',
      preserveStyle: true
    }
  }
];

const defaultPrompts: PromptDefinition[] = [
  {
    id: 'strategy-report',
    title: '战略汇报提示词',
    scene: '年度规划 / 经营复盘',
    content: '请将资料整理为适合管理层汇报的 PPT：先总结关键结论，再展开机会、策略、里程碑和风险。语言保持克制、明确、可执行。',
    updatedAt: Date.now()
  },
  {
    id: 'product-launch',
    title: '产品发布提示词',
    scene: '新品发布 / 路演',
    content: '请围绕用户痛点、产品价值、核心能力、应用场景和行动号召生成演示结构。每页保持一个清晰主张。',
    updatedAt: Date.now()
  }
];

const exampleTemplates: PptTemplate[] = [
  {
    id: 'business-review',
    name: '商务复盘',
    category: '商务',
    description: '适合季度复盘、经营分析和增长策略汇报。',
    slideCount: 8,
    accent: '#ef2d2d'
  },
  {
    id: 'product-roadshow',
    name: '产品路演',
    category: '产品',
    description: '适合产品发布、融资路演和解决方案介绍。',
    slideCount: 10,
    accent: '#334155'
  },
  {
    id: 'training-course',
    name: '培训课程',
    category: '教育',
    description: '适合课程讲义、内部培训和知识分享。',
    slideCount: 12,
    accent: '#2563eb'
  }
];

const cloneSteps = (): WorkflowStep[] => workflowSteps.map((step) => ({ ...step }));
const cloneSkills = (): SkillDefinition[] => defaultSkills.map((skill) => ({ ...skill, params: { ...skill.params } }));
const clonePrompts = (): PromptDefinition[] => defaultPrompts.map((prompt) => ({ ...prompt }));
const createInputProcessSteps = (): InputProcessStep[] => [
  {
    id: 'collect',
    title: '资料收集',
    description: '读取输入内容、上传文件和资料收集类 Skill。',
    status: 'idle',
    progress: 0,
    detail: '等待输入资料'
  },
  {
    id: 'file-parse',
    title: '文件解析',
    description: '当存在上传文件时解析文件内容并合并上下文。',
    status: 'idle',
    progress: 0,
    detail: '未上传文件'
  },
  {
    id: 'topic',
    title: '主题提炼',
    description: '从资料中识别主题、受众和表达目标。',
    status: 'idle',
    progress: 0,
    detail: '等待资料'
  },
  {
    id: 'constraints',
    title: '生成约束',
    description: '整理提示词、参考模板和配置参数。',
    status: 'idle',
    progress: 0,
    detail: '使用默认生成偏好'
  },
  {
    id: 'ready',
    title: '生成就绪',
    description: '输入阶段处理完成，准备进入大纲生成。',
    status: 'idle',
    progress: 0,
    detail: '等待处理完成'
  }
];
const inputProcessStepIds = new Set(createInputProcessSteps().map((step) => step.id));
const cloneInputProcessSteps = (steps?: InputProcessStep[]) => {
  const defaults = createInputProcessSteps();
  if (!steps?.length) return defaults.map((step) => ({ ...step }));

  const savedSteps = new Map(
    (steps as Array<InputProcessStep | Record<string, any>>)
      .filter((step) => inputProcessStepIds.has(step.id))
      .map((step) => [step.id, step])
  );

  return defaults.map((defaultStep) => {
    const saved = savedSteps.get(defaultStep.id);
    if (!saved) return { ...defaultStep };
    return {
      ...defaultStep,
      status: saved.status || defaultStep.status,
      progress: Number.isFinite(Number(saved.progress)) ? Number(saved.progress) : defaultStep.progress,
      detail: saved.detail || defaultStep.detail,
      skillId: typeof saved.skillId === 'string' ? saved.skillId : undefined,
      skillName: typeof saved.skillName === 'string' ? saved.skillName : undefined,
      logs: typeof saved.logs === 'string' ? saved.logs : undefined,
      output: typeof saved.output === 'string' ? saved.output : undefined,
      processedText: typeof saved.processedText === 'string' ? saved.processedText : undefined,
      error: typeof saved.error === 'string' ? saved.error : undefined,
    };
  });
};
const cloneTemplates = (): PptTemplate[] => exampleTemplates.map((template) => ({
  ...template,
  settings: template.settings ? structuredClone(template.settings) : undefined,
}));
const CONFIG_KEYS: ConfigOptionKey[] = ['slideCount', 'summaryLength', 'tone', 'imageStyle', 'skillIntensity'];
const CONFIG_META: Record<ConfigOptionKey, { name: string; description: string; type: RunConfig['type']; min?: number; max?: number }> = {
  slideCount: { name: 'PPT 页数', description: 'PPT 输入页可选择的目标页数。', type: 'number', min: 1, max: 60 },
  summaryLength: { name: '摘要长度', description: '控制内容提炼的详略程度。', type: 'select' },
  tone: { name: '语言风格', description: '控制标题、正文和讲稿的表达口吻。', type: 'select' },
  imageStyle: { name: '图像风格', description: '控制需要配图时的画面方向。', type: 'select' },
  skillIntensity: { name: 'Skill 强度', description: '控制 Skill 扩展功能的处理深度。', type: 'number', min: 0, max: 100 },
};
const cloneConfigOptions = (): ConfigOptionGroups => ({
  slideCount: [
    { value: '6', label: '6 页' },
    { value: '8', label: '8 页' },
    { value: '10', label: '10 页' },
    { value: '12', label: '12 页' }
  ],
  summaryLength: [
    { value: 'brief', label: '简洁' },
    { value: 'balanced', label: '均衡' },
    { value: 'detailed', label: '详细' }
  ],
  tone: [
    { value: 'professional', label: '专业汇报' },
    { value: 'storytelling', label: '叙事表达' },
    { value: 'teaching', label: '教学讲解' }
  ],
  imageStyle: [
    { value: 'realistic', label: '写实' },
    { value: 'illustration', label: '插画' },
    { value: 'comic', label: '漫画' },
    { value: 'flat', label: '扁平化' },
    { value: '3d', label: '3D' },
    { value: 'photo', label: '摄影' }
  ],
  skillIntensity: [
    { value: '30', label: '轻量' },
    { value: '70', label: '标准' },
    { value: '100', label: '深入' }
  ]
});

function normalizeConfigOptions(options?: Partial<ConfigOptionGroups> | null): ConfigOptionGroups {
  const fallback = cloneConfigOptions();
  if (!options) return fallback;

  return {
    slideCount: options.slideCount?.length ? options.slideCount.map(option => ({ ...option })) : fallback.slideCount,
    summaryLength: options.summaryLength?.length ? options.summaryLength.map(option => ({ ...option })) : fallback.summaryLength,
    tone: options.tone?.length ? options.tone.map(option => ({ ...option })) : fallback.tone,
    imageStyle: options.imageStyle?.length ? options.imageStyle.map(option => ({ ...option })) : fallback.imageStyle,
    skillIntensity: options.skillIntensity?.length ? options.skillIntensity.map(option => ({ ...option })) : fallback.skillIntensity,
  };
}

function parseConfigOptions(rawOptions: unknown) {
  if (Array.isArray(rawOptions)) return rawOptions;
  if (typeof rawOptions === 'string') {
    try {
      const parsed = JSON.parse(rawOptions);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeRunConfigGroups(records: RunConfig[]): ConfigOptionGroups {
  const fallback = cloneConfigOptions();
  const groups = cloneConfigOptions();

  for (const key of CONFIG_KEYS) {
    const record = records.find((item) => item.key === key);
    const options = parseConfigOptions(record?.options)
      .map((option: any) => ({
        value: String(option?.value ?? '').trim(),
        label: String(option?.label ?? option?.value ?? '').trim(),
      }))
      .filter((option) => option.value && option.label);

    groups[key] = options.length ? options : fallback[key].map((option) => ({ ...option }));
  }

  return groups;
}

function isAutoParameterValue(key: ConfigOptionKey, value: unknown) {
  const normalized = String(value);
  return key === 'slideCount' || key === 'skillIntensity'
    ? normalized === '0'
    : normalized === 'auto';
}

function normalizeAgentParameters(value?: Partial<AgentParameters> | null): AgentParameters {
  const slideCountValue = value?.slideCount;
  const skillIntensityValue = value?.skillIntensity;
  return {
    summaryLength: String(value?.summaryLength || 'auto'),
    slideCount: slideCountValue === 0 ? 0 : Number(slideCountValue) || 0,
    tone: String(value?.tone || 'auto'),
    imageStyle: String(value?.imageStyle || 'auto'),
    template: (value?.template || 'auto') as TemplateStyle,
    skillIntensity: skillIntensityValue === 0 ? 0 : Number(skillIntensityValue) || 0,
  };
}

const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const MAX_ACTIVITY_LOGS = 5000;
const OUTLINE_STREAM_FLUSH_INTERVAL_MS = 120;
const LAYOUT_GENERATION_CONCURRENCY = 3;
const PROJECT_STATE_SYNC_INTERVAL_MS = 1800;
const PROJECT_STATE_SYNC_PAGE_BATCH = 2;
const TEXT_FILE_PATTERN = /\.(txt|md|markdown|csv|json|log)$/i;
const DOCX_FILE_PATTERN = /\.docx$/i;
const MAX_FILE_TEXT_CHARS = 120_000;
const SKILL_CONTEXT_START = '【Skill 处理结果（自动生成，可重新运行刷新）】';
const SKILL_CONTEXT_END = '【Skill 处理结果结束】';
const normalizeProjectText = (value: unknown) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
const stripFileExtension = (fileName: string) => fileName.replace(/\.[^.]+$/, '');
const inferInputTitle = (content: string, files: string[]) => {
  const normalized = content.trim().replace(/\s+/g, ' ');
  const explicit = normalized.match(/(?:PPT\s*)?(?:主题|标题)\s*[：:]\s*([^。；;\n]{2,60})/i)?.[1]?.trim();
  if (explicit) return explicit.slice(0, 60);
  if (normalized) return normalized.slice(0, 28);
  const firstFileName = files[0] ? stripFileExtension(files[0]).trim() : '';
  return firstFileName.slice(0, 28) || '未命名 PPT';
};
const projectIdentityKey = (project: Pick<PptProject, 'title' | 'topic'>) =>
  `${normalizeProjectText(project.title)}::${normalizeProjectText(project.topic)}`;

class MissingSlideImageError extends Error {
  constructor(public pageNumber: number, public slideTitle: string) {
    super(`第 ${pageNumber} 页需要图片，但图片自动重试后仍未生成：${slideTitle}`);
    this.name = 'MissingSlideImageError';
  }
}

function isMissingSlideImageError(error: unknown): error is MissingSlideImageError {
  return error instanceof MissingSlideImageError ||
    (error instanceof Error && error.name === 'MissingSlideImageError');
}

function isBlockingImageGenerationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /图片/.test(message) && /(未完成|未生成|缺少|失败|重试)/.test(message);
}

const isSameProjectIdentity = (left: Pick<PptProject, 'title' | 'topic'>, right: Pick<PptProject, 'title' | 'topic'>) => {
  const leftTitle = normalizeProjectText(left.title);
  const rightTitle = normalizeProjectText(right.title);
  if (!leftTitle || leftTitle !== rightTitle) return false;

  const leftTopic = normalizeProjectText(left.topic);
  const rightTopic = normalizeProjectText(right.topic);
  return leftTopic === rightTopic || !leftTopic || !rightTopic;
};

function parseStreamingStrategistOutline(raw: string): SlideOutline[] {
  const outlineStart = raw.search(/"outline"\s*:\s*\[/);
  if (outlineStart < 0) return [];

  const arrayStart = raw.indexOf('[', outlineStart);
  if (arrayStart < 0) return [];

  const items: any[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objectStart = -1;

  for (let i = arrayStart + 1; i < raw.length; i += 1) {
    const char = raw[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) objectStart = i;
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        const candidate = raw.slice(objectStart, i + 1);
        try {
          items.push(JSON.parse(candidate));
        } catch {
          // The current object may still be streaming; keep previously parsed slides.
        }
        objectStart = -1;
      }
    }

    if (char === ']' && depth === 0) break;
  }

  return items.map((item, index) => normalizeStreamingOutlineSlide(item, index));
}

function normalizeStreamingOutlineSlide(item: any, index: number): SlideOutline {
  const bullets = Array.isArray(item?.bullets)
    ? item.bullets.map((bullet: unknown) => String(bullet || '').trim()).filter(Boolean)
    : [];

  return {
    id: String(item?.id || `slide-${index + 1}`),
    title: String(item?.title || `第 ${index + 1} 页`),
    bullets,
    speakerNotes: String(item?.speakerNotes || ''),
    visualPrompt: String(item?.visualPrompt || ''),
    chartHint: item?.chartHint ? String(item.chartHint) : undefined,
    layout: item?.layout as SlideLayout | undefined,
  };
}

function specSlideToOutlineSlide(slide: SpecSlide, fallbackIndex: number): SlideOutline {
  return {
    id: String(slide.id || `slide-${fallbackIndex + 1}`),
    title: String(slide.title || `第 ${slide.pageNumber || fallbackIndex + 1} 页`),
    bullets: Array.isArray(slide.bullets) ? slide.bullets.map(item => String(item || '').trim()).filter(Boolean) : [],
    speakerNotes: String(slide.speakerNotes || ''),
    visualPrompt: String(slide.visualPrompt || ''),
    chartHint: slide.chartHint ? String(slide.chartHint) : undefined,
    layout: slide.layout as SlideLayout | undefined,
  };
}

export const useAgentStore = defineStore('agent', () => {
  const activeStep = ref<WorkflowStepId>('input');
  const input = ref<DeckInput>({
    topic: '',
    content: '',
    files: []
  });
  const parameters = ref<AgentParameters>({
    summaryLength: 'auto',
    slideCount: 0,
    tone: 'auto',
    imageStyle: 'auto',
    template: 'auto',
    skillIntensity: 0
  });
  const steps = ref<WorkflowStep[]>(cloneSteps());
  const outline = ref<SlideOutline[]>([]);
  const images = ref<GeneratedImage[]>([]);
  const skills = ref<SkillDefinition[]>(cloneSkills());
  const prompts = ref<PromptDefinition[]>(clonePrompts());
  const pptProjects = ref<PptProject[]>([]);
  const templates = ref<PptTemplate[]>(cloneTemplates());
  const selectedTemplate = ref<TemplateAsset | null>(null);
  const activePptId = ref<string | null>(null);
  const exportArtifacts = ref<ExportArtifact[]>([]);
  const activityLog = ref<string[]>(['系统就绪，等待添加 PPT 项目。']);
  const inputProcessSteps = ref<InputProcessStep[]>(cloneInputProcessSteps());
  const uploadedFileContents = ref<UploadedFileContent[]>([]);
  const processedInputContent = ref('');
  const isRunning = ref(false);
  const isPaused = ref(false);
  const pauseRequested = ref(false);
  const resumeStage = ref<WorkflowStepId | null>(null);
  const executorCursor = ref(0);
  const streamingText = ref('');
  const designSpec = ref<DesignSpec | null>(null);
  const specLock = ref<SpecLock | null>(null);
  const svgPages = ref<Array<{ pageNumber: number; svg: string; speakerNotes: string }>>([]);
  const selectedPromptId = ref<string>('');
  const currentGeneratingSlide = ref<string | null>(null);
  const generatedSlides = ref<Set<string>>(new Set());
  const retryingPageNumbers = ref<Set<number>>(new Set());
  const configOptions = ref<ConfigOptionGroups>(cloneConfigOptions());
  const configRecords = ref<Partial<Record<ConfigOptionKey, RunConfig>>>({});
  const isDataLoaded = ref(false);
  const recoveredActiveWorkflow = ref(false);
  const waitingForImageRetry = ref(false);
  const workflowRunToken = ref(0);
  const runningProjectId = ref<string | null>(null);
  const activeGenerationJobId = ref<number | null>(null);
  const activeQueueJobId = ref<string | null>(null);

  const enabledSkills = computed(() => skills.value.filter((skill) => skill.enabled).sort((a, b) => a.order - b.order));
  const selectedImages = computed(() => images.value.filter((image) => image.selected));
  const activeStepMeta = computed(() => steps.value.find((step) => step.id === activeStep.value));
  const activePpt = computed(() => pptProjects.value.find((project) => project.id === activePptId.value) || null);

  type RunContext = { token: number; projectId: string | null };

  function createRunContext(): RunContext {
    workflowRunToken.value += 1;
    runningProjectId.value = activePptId.value;
    return { token: workflowRunToken.value, projectId: activePptId.value };
  }

  function currentRunContext(): RunContext {
    return { token: workflowRunToken.value, projectId: activePptId.value };
  }

  function isRunContextActive(ctx: RunContext): boolean {
    return workflowRunToken.value === ctx.token && activePptId.value === ctx.projectId;
  }

  function freezeWorkflowStepsForPause(stage: WorkflowStepId) {
    steps.value = steps.value.map((step) => {
      if (step.status !== 'running') return step;
      return {
        ...step,
        status: 'idle',
        progress: Math.max(0, Math.min(99, Math.round(step.progress || (step.id === stage ? 1 : 0)))),
      };
    });
  }

  function applyGeneratedProjectInfo(spec?: DesignSpec | null) {
    if (!activePpt.value || !spec?.projectInfo) return;

    const nextTitle = String(spec.projectInfo.title || '').trim();
    const nextTopic = String(spec.projectInfo.topic || '').trim();
    let changed = false;

    if (nextTitle && nextTitle !== activePpt.value.title) {
      activePpt.value.title = nextTitle;
      changed = true;
    }

    if (nextTopic && nextTopic !== activePpt.value.topic) {
      activePpt.value.topic = nextTopic;
      input.value.topic = nextTopic;
      changed = true;
    }

    if (changed) {
      activePpt.value.updatedAt = Date.now();
    }
  }

  function cancelActiveRunForProjectSwitch() {
    if (!isRunning.value || !activePpt.value) return;
    const previousProject = activePpt.value;
    const previousJobId = activeGenerationJobId.value;
    pushLog('已切换项目，当前工作流已保存，可稍后继续。');
    freezeWorkflowStepsForPause(activeStep.value);
    previousProject.state = {
      ...snapshotProjectState(),
      paused: true,
      workflowActive: false,
      resumeStage: activeStep.value,
      lastActiveStep: activeStep.value,
    };
    previousProject.updatedAt = Date.now();
    workflowRunToken.value += 1;
    runningProjectId.value = null;
    isRunning.value = false;
    isPaused.value = true;
    pauseRequested.value = false;
    currentGeneratingSlide.value = null;
    activeGenerationJobId.value = null;
    if (previousJobId) {
      void generationJobApi.update(previousJobId, {
        status: 'running',
        phase: 'paused',
        progress: steps.value.find((step) => step.id === activeStep.value)?.progress || 0,
        metadata: buildGenerationJobMetadata({ resume: true }),
      });
    }
  }

  function mergePptProjects(projects: PptProject[], preferredActiveId: string | null = activePptId.value): PptProject[] {
    const byId = new Map<string, PptProject>();
    const byIdentity = new Map<string, string>();
    const merged: PptProject[] = [];

    for (const rawProject of projects) {
      const project = {
        ...rawProject,
        id: String(rawProject.id),
        state: normalizeProjectState(rawProject.state || makeDefaultProjectState())
      };
      const existingById = byId.get(project.id);
      if (existingById) {
        Object.assign(existingById, project, {
          state: project.state || existingById.state,
          updatedAt: Math.max(existingById.updatedAt || 0, project.updatedAt || 0)
        });
        continue;
      }

      const identity = projectIdentityKey(project);
      const existingIdentityId = byIdentity.get(identity);
      const existingByLooseIdentity = merged.find((item) => isSameProjectIdentity(item, project));
      const existingByIdentity = existingIdentityId ? byId.get(existingIdentityId) : existingByLooseIdentity;
      const projectIsNumeric = Number.isInteger(Number(project.id)) && Number(project.id) > 0;
      const existingIsNumeric = existingByIdentity
        ? Number.isInteger(Number(existingByIdentity.id)) && Number(existingByIdentity.id) > 0
        : false;

      if (existingByIdentity && normalizeProjectText(project.title)) {
        const shouldReplace =
          project.id === preferredActiveId ||
          (!existingIsNumeric && projectIsNumeric) ||
          ((project.updatedAt || 0) > (existingByIdentity.updatedAt || 0) && existingByIdentity.id !== preferredActiveId);

        if (shouldReplace) {
          const index = merged.findIndex((item) => item.id === existingByIdentity.id);
          if (index >= 0) merged[index] = { ...existingByIdentity, ...project, state: project.state || existingByIdentity.state };
          byId.delete(existingByIdentity.id);
          byId.set(project.id, merged[index]);
          byIdentity.set(identity, project.id);
        } else {
          if (!existingByIdentity.state && project.state) existingByIdentity.state = project.state;
          existingByIdentity.updatedAt = Math.max(existingByIdentity.updatedAt || 0, project.updatedAt || 0);
        }
        continue;
      }

      byId.set(project.id, project);
      if (identity !== '::') byIdentity.set(identity, project.id);
      merged.push(project);
    }

    return merged.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function makeDefaultProjectState(): PptProjectState {
    return {
      input: { topic: '', content: '', files: [] },
      uploadedFileContents: [],
      processedInputContent: '',
      parameters: normalizeAgentParameters(),
      selectedTemplate: null,
      outline: [],
      images: [],
      exportArtifacts: [],
      enabledSkillIds: [],
      selectedPromptId: '',
      inputProcessSteps: cloneInputProcessSteps(),
      activityLog: [],
      steps: workflowSteps.map(s => ({ ...s })),
      designSpec: null,
      specLock: null,
      svgPages: [],
      configOptions: cloneConfigOptions(),
      paused: false,
      resumeStage: null,
      executorCursor: 0,
      workflowActive: false,
      lastActiveStep: null,
      waitingForImageRetry: false,
    };
  }

  function normalizeProjectState(state?: Partial<PptProjectState> | null): PptProjectState {
    const fallback = makeDefaultProjectState();
    if (!state) return fallback;
    return {
      ...fallback,
      ...state,
      input: { ...fallback.input, ...(state.input || {}), files: [...(state.input?.files || [])] },
      uploadedFileContents: (state.uploadedFileContents || []).map((file) => ({
        name: String(file.name || ''),
        text: String(file.text || ''),
      })).filter((file) => file.name && file.text),
      processedInputContent: String(state.processedInputContent || ''),
      parameters: normalizeAgentParameters(state.parameters || fallback.parameters),
      selectedTemplate: state.selectedTemplate ? snapshotTemplateAsset(state.selectedTemplate) : null,
      outline: (state.outline || []).map(s => ({ ...s, bullets: [...(s.bullets || [])] })),
      images: (state.images || []).map(img => ({ ...img })),
      exportArtifacts: (state.exportArtifacts || []).map(item => ({ ...item })),
      enabledSkillIds: [...(state.enabledSkillIds || [])],
      selectedPromptId: state.selectedPromptId || '',
      inputProcessSteps: cloneInputProcessSteps(state.inputProcessSteps),
      activityLog: [...(state.activityLog || [])],
      steps: (state.steps || fallback.steps).map(s => ({ ...s })),
      svgPages: (state.svgPages || []).map(page => ({ ...page })),
      configOptions: state.configOptions || fallback.configOptions,
    };
  }

  function persistCurrentSelectionToActiveProject() {
    if (!activePpt.value) return;
    const baseState = normalizeProjectState(activePpt.value.state);
    activePpt.value.state = {
      ...baseState,
      selectedPromptId: selectedPromptId.value,
      selectedTemplate: selectedTemplate.value ? snapshotTemplateAsset(selectedTemplate.value) : null,
    };
    activePpt.value.templateId = selectedTemplate.value?.id || 'auto';
    activePpt.value.updatedAt = Date.now();
  }

  function getReadyImageSlideIds(sourceImages = images.value) {
    return sourceImages
      .filter((image) => image.selected && !image.error && Boolean(image.url))
      .map((image) => image.slideId);
  }

  function syncGeneratedSlidesFromImages() {
    generatedSlides.value = new Set(getReadyImageSlideIds());
  }

  function slidesRequiringGeneratedImages() {
    const slides = designSpec.value
      ? designSpec.value.outline
      : outline.value.map((s, i) => ({
          ...s,
          pageNumber: i + 1,
          visualPrompt: s.visualPrompt,
          layout: s.layout || 'text-only',
          rhythm: 'breathing' as const,
        }));

    return slides.filter((slide) => slideNeedsImage(slide));
  }

  function upsertGeneratedImage(image: GeneratedImage) {
    const existingIdx = images.value.findIndex(img => img.slideId === image.slideId);
    if (existingIdx >= 0) {
      images.value[existingIdx] = image;
    } else {
      images.value = [...images.value, image];
    }
  }

  function imageGenerationGate() {
    const requiredSlides = slidesRequiringGeneratedImages();
    const readySlideIds = new Set(getReadyImageSlideIds());
    const missingSlides = requiredSlides.filter((slide) => !readySlideIds.has(slide.id));

    return {
      requiredSlides,
      readySlideIds,
      missingSlides,
      readyCount: requiredSlides.filter((slide) => readySlideIds.has(slide.id)).length,
      total: requiredSlides.length,
      complete: missingSlides.length === 0,
    };
  }

  function updateImageStepFromGate(statusWhenIncomplete: WorkflowStep['status'] = 'idle') {
    const gate = imageGenerationGate();
    generatedSlides.value = new Set(gate.readySlideIds);

    if (gate.total === 0) {
      setStepStatus('images', 'done', 100);
      return gate;
    }

    const progress = Math.min(100, Math.round((gate.readyCount / gate.total) * 100));
    setStepStatus('images', gate.complete ? 'done' : statusWhenIncomplete, gate.complete ? 100 : progress);
    return gate;
  }

  async function readDocxText(file: File) {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const documentFile = zip.file('word/document.xml');
    if (!documentFile) return '';

    const xml = await documentFile.async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return Array.from(doc.getElementsByTagName('w:p'))
      .map((paragraph) =>
        Array.from(paragraph.getElementsByTagName('w:t'))
          .map((node) => node.textContent || '')
          .join('')
          .trim()
      )
      .filter(Boolean)
      .join('\n');
  }

  function snapshotProjectState(options: { persistable?: boolean } = {}): PptProjectState {
    const persistable = options.persistable ?? false;
    return {
      input: { ...input.value, files: [...input.value.files] },
      uploadedFileContents: uploadedFileContents.value.map((file) => ({ ...file })),
      processedInputContent: processedInputContent.value,
      parameters: { ...parameters.value },
      selectedTemplate: selectedTemplate.value ? snapshotTemplateAsset(selectedTemplate.value) : null,
      outline: outline.value.map(s => ({ ...s, bullets: [...s.bullets] })),
      images: persistable
        ? images.value.map(img => ({ ...img, url: img.url?.startsWith('data:') ? '' : img.url }))
        : images.value.map(img => ({ ...img })),
      exportArtifacts: [...exportArtifacts.value],
      enabledSkillIds: skills.value.filter(s => s.enabled).map(s => s.id),
      selectedPromptId: selectedPromptId.value,
      inputProcessSteps: cloneInputProcessSteps(inputProcessSteps.value),
      activityLog: [...activityLog.value],
      steps: steps.value.map(s => ({ ...s })),
      designSpec: designSpec.value,
      specLock: specLock.value,
      svgPages: persistable
        ? svgPages.value.map(page => ({
            pageNumber: page.pageNumber,
            svg: page.svg,
            speakerNotes: page.speakerNotes
          }))
        : svgPages.value,
      paused: isPaused.value,
      configOptions: {
        slideCount: configOptions.value.slideCount.map(option => ({ ...option })),
        summaryLength: configOptions.value.summaryLength.map(option => ({ ...option })),
        tone: configOptions.value.tone.map(option => ({ ...option })),
        imageStyle: configOptions.value.imageStyle.map(option => ({ ...option })),
        skillIntensity: configOptions.value.skillIntensity.map(option => ({ ...option })),
      },
      resumeStage: resumeStage.value,
      executorCursor: executorCursor.value,
      workflowActive: isRunning.value || steps.value.some(step => step.status === 'running'),
      lastActiveStep: activeStep.value,
      waitingForImageRetry: waitingForImageRetry.value,
    };
  }

  function restoreProjectState(state: PptProjectState) {
    const normalizedState = normalizeProjectState(state);
    input.value = { ...normalizedState.input, files: [...normalizedState.input.files] };
    uploadedFileContents.value = normalizedState.uploadedFileContents?.map((file) => ({ ...file })) || [];
    processedInputContent.value = normalizedState.processedInputContent || '';
    parameters.value = normalizeAgentParameters(normalizedState.parameters);
    selectedTemplate.value = normalizedState.selectedTemplate
      ? snapshotTemplateAsset(normalizedState.selectedTemplate!)
      : null;
    outline.value = normalizedState.outline.map(s => ({ ...s }));
    images.value = normalizedState.images.map(img => ({ ...img }));
    syncGeneratedSlidesFromImages();
    exportArtifacts.value = [...normalizedState.exportArtifacts];

    const savedSkillIds = new Set(normalizedState.enabledSkillIds || []);
    skills.value = skills.value.map(s => ({
      ...s,
      enabled: savedSkillIds.has(s.id)
    }));

    selectedPromptId.value = normalizedState.selectedPromptId || '';
    inputProcessSteps.value = cloneInputProcessSteps(normalizedState.inputProcessSteps);

    designSpec.value = normalizedState.designSpec || null;
    specLock.value = normalizedState.specLock || null;
    svgPages.value = normalizedState.svgPages || [];
    normalizeParametersAgainstConfig();
    retryingPageNumbers.value = new Set();
    const hasRunningSteps = Boolean(normalizedState.steps?.some(step => step.status === 'running'));
    const hadActiveWorkflow = !normalizedState.paused && Boolean(normalizedState.workflowActive || hasRunningSteps);
    recoveredActiveWorkflow.value = hadActiveWorkflow && !normalizedState.paused;
    isPaused.value = Boolean(normalizedState.paused || hadActiveWorkflow);
    waitingForImageRetry.value = Boolean(normalizedState.waitingForImageRetry);
    pauseRequested.value = false;
    resumeStage.value = normalizedState.resumeStage || normalizedState.lastActiveStep || null;
    executorCursor.value = normalizedState.executorCursor || svgPages.value.length || 0;
    if (normalizedState.lastActiveStep && workflowSteps.some(step => step.id === normalizedState.lastActiveStep)) {
      activeStep.value = normalizedState.lastActiveStep;
    }

    if (normalizedState.activityLog && normalizedState.activityLog.length > 0) {
      activityLog.value = [...normalizedState.activityLog];
    } else {
      activityLog.value = [];
    }

    if (normalizedState.steps && normalizedState.steps.length > 0) {
      const restoredSteps = normalizedState.steps.map(s => ({
        ...s,
        status: (s.status === 'running' ? (hadActiveWorkflow ? 'running' : 'idle') : s.status) as WorkflowStep['status'],
        progress: s.status === 'running' && !hadActiveWorkflow && !normalizedState.paused ? 0 : s.progress,
      }));
      const currentStepIds = new Set(workflowSteps.map(s => s.id));
      const restoredStepIds = new Set(restoredSteps.map(s => s.id));
      if ([...currentStepIds].every(id => restoredStepIds.has(id))) {
        steps.value = restoredSteps;
      } else {
        steps.value = workflowSteps.map(s => {
          const existing = restoredSteps.find(rs => rs.id === s.id);
          return existing || { ...s };
        });
      }
    } else {
      steps.value = workflowSteps.map(s => ({ ...s }));
    }
  }

  async function persistActiveProjectState(state: PptProjectState) {
    if (!activePpt.value) return;
    const numericId = Number(activePpt.value.id);
    if (!Number.isInteger(numericId) || numericId <= 0) return;

    const response = await projectApi.update(numericId, {
      title: activePpt.value.title,
      topic: activePpt.value.topic,
      content: activePpt.value.description,
      state,
    });

    if (response.success && response.data?.id && response.data.id !== numericId) {
      const newId = String(response.data.id);
      activePpt.value.id = newId;
      activePptId.value = newId;
    }
  }

  function syncToProject() {
    if (!activePpt.value) return Promise.resolve();
    const state = snapshotProjectState();
    activePpt.value.state = state;
    activePpt.value.updatedAt = Date.now();

    return persistActiveProjectState(snapshotProjectState({ persistable: true })).catch((error) => {
      console.warn('同步项目状态失败', error);
    });
  }

  async function syncToProjectNow() {
    await syncToProject();
  }

  let lastWorkflowSyncAt = 0;
  let pendingWorkflowSyncCount = 0;
  async function syncWorkflowProgress(force = false) {
    pendingWorkflowSyncCount += 1;
    const now = Date.now();
    const shouldSync = force
      || pendingWorkflowSyncCount >= PROJECT_STATE_SYNC_PAGE_BATCH
      || now - lastWorkflowSyncAt >= PROJECT_STATE_SYNC_INTERVAL_MS;

    if (!shouldSync) return;
    pendingWorkflowSyncCount = 0;
    lastWorkflowSyncAt = now;
    await syncToProjectNow();
  }

  let inputSyncTimer: ReturnType<typeof setTimeout> | null = null;
  function debouncedSyncToProject() {
    if (inputSyncTimer) clearTimeout(inputSyncTimer);
    inputSyncTimer = setTimeout(() => {
      syncToProject();
    }, 300);
  }

  watch([input, parameters], () => {
    if (activePpt.value) {
      debouncedSyncToProject();
    }
  }, { deep: true });

  let logSyncTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleLogSync() {
    if (!activePpt.value) return;
    if (logSyncTimer) clearTimeout(logSyncTimer);
    logSyncTimer = setTimeout(() => {
      syncToProject();
    }, 500);
  }

  function mapTemplateToStyle(templateId: string): TemplateStyle {
    const template = templates.value.find(t => t.id === templateId);
    if (!template) return 'auto';
    const text = `${template.name} ${template.category || ''} ${template.description || ''}`.toLowerCase();
    if (text.includes('教育') || text.includes('培训') || text.includes('课程') || text.includes('education') || text.includes('training') || text.includes('course')) return 'education';
    if (text.includes('科技') || text.includes('技术') || text.includes('ai') || text.includes('tech')) return 'tech';
    if (text.includes('金融') || text.includes('财务') || text.includes('finance')) return 'finance';
    if (text.includes('创意') || text.includes('产品') || text.includes('路演') || text.includes('creative') || text.includes('product') || text.includes('pitch')) return 'creative';
    return 'business';
  }

  function parseSettingsValue(value: unknown): Record<string, any> {
    if (!value) return {};
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    }
    if (typeof value !== 'object') return {};
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null ? value as Record<string, any> : {};
  }

  function toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
    if (typeof value === 'string') {
      return value.split(/[\n,，]/).map(item => item.trim()).filter(Boolean);
    }
    return [];
  }

  function buildDefaultTemplateSettings(template: Partial<PptTemplate & TemplateAsset>): TemplateAssetSettings {
    const category = template.category || '通用';
    const accent = template.accent || '#334155';
    return {
      styleGuide: {
        visualTone: template.description || `${category}场景的完整 PPT 方案`,
        colorPalette: [accent, '#172026', '#F7F8F5'],
        typography: '清晰中文无衬线字体，标题层级明确',
        iconStyle: '简洁线性图标'
      },
      layoutGuide: {
        cover: '封面突出主题和关键信息',
        section: '章节页用于承接叙事转折',
        contentLayouts: ['图文页', '三段式要点页', '对比页'],
        dataLayouts: ['指标卡', '趋势图', '矩阵分析'],
        summary: '结尾页提炼结论和下一步行动'
      },
      outlinePattern: ['背景与目标', '核心洞察', '方案设计', '执行路径', '总结展望'],
      previewSlides: [
        { title: '封面', layout: 'cover', description: '展示主题、受众和场景' },
        { title: '核心内容', layout: 'content', description: '承载主要观点和论据' },
        { title: '总结', layout: 'ending', description: '收束结论和行动建议' },
      ],
      constraints: {
        preferredSlideCount: template.slideCount || 10,
        suitableFor: [category],
        avoid: ['不要照搬示例文字', '不要固定套用到未选择模板的项目']
      }
    };
  }

  function normalizeTemplateSettings(settings: unknown, template: Partial<PptTemplate & TemplateAsset>): TemplateAssetSettings {
    const raw = parseSettingsValue(settings);
    const fallback = buildDefaultTemplateSettings(template);
    return {
      styleGuide: {
        ...fallback.styleGuide,
        ...(raw.styleGuide || {}),
        colorPalette: toStringArray(raw.styleGuide?.colorPalette).length
          ? toStringArray(raw.styleGuide?.colorPalette)
          : fallback.styleGuide?.colorPalette,
      },
      layoutGuide: {
        ...fallback.layoutGuide,
        ...(raw.layoutGuide || {}),
        contentLayouts: toStringArray(raw.layoutGuide?.contentLayouts).length
          ? toStringArray(raw.layoutGuide?.contentLayouts)
          : fallback.layoutGuide?.contentLayouts,
        dataLayouts: toStringArray(raw.layoutGuide?.dataLayouts).length
          ? toStringArray(raw.layoutGuide?.dataLayouts)
          : fallback.layoutGuide?.dataLayouts,
      },
      outlinePattern: toStringArray(raw.outlinePattern).length ? toStringArray(raw.outlinePattern) : fallback.outlinePattern,
      previewSlides: Array.isArray(raw.previewSlides) && raw.previewSlides.length
        ? raw.previewSlides.map((slide: any) => ({
            title: String(slide.title || '示例页'),
            layout: String(slide.layout || 'content'),
            description: slide.description ? String(slide.description) : undefined,
            svg: typeof slide.svg === 'string' && slide.svg.trim() ? slide.svg : undefined,
            pageNumber: Number(slide.pageNumber) || undefined,
          }))
        : fallback.previewSlides,
      constraints: {
        ...fallback.constraints,
        ...(raw.constraints || {}),
        suitableFor: toStringArray(raw.constraints?.suitableFor).length
          ? toStringArray(raw.constraints?.suitableFor)
          : fallback.constraints?.suitableFor,
        avoid: toStringArray(raw.constraints?.avoid).length ? toStringArray(raw.constraints?.avoid) : fallback.constraints?.avoid,
      }
    };
  }

  function toTemplateAsset(template: Partial<PptTemplate & TemplateAsset> & { id: string | number; name: string }): TemplateAsset {
    const base = {
      id: String(template.id),
      name: template.name,
      category: template.category || '',
      description: template.description || '',
      slideCount: Number(template.slideCount || (template as any).slide_count || 10),
      accent: template.accent || '#334155',
    };
    return {
      ...base,
      settings: normalizeTemplateSettings(template.settings, base),
    };
  }

  function snapshotTemplateAsset(template: TemplateAsset): TemplateAsset {
    const base = {
      id: String(template.id),
      name: String(template.name || ''),
      category: String(template.category || ''),
      description: String(template.description || ''),
      slideCount: Number(template.slideCount || 10),
      accent: String(template.accent || '#334155'),
    };

    return {
      ...base,
      settings: normalizeTemplateSettings(template.settings, base),
    };
  }

  function pushLog(message: string) {
    activityLog.value = [
      `${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${compactMultiline(message, 420)}`,
      ...activityLog.value
    ].slice(0, MAX_ACTIVITY_LOGS);
    scheduleLogSync();
  }

  function setStepStatus(id: WorkflowStepId, status: WorkflowStep['status'], progress: number) {
    const step = steps.value.find((item) => item.id === id);
    if (!step) return;
    step.status = status;
    step.progress = progress;
  }

  function buildGenerationJobMetadata(options: { resume?: boolean } = {}) {
    return {
      topic: input.value.topic,
      slideCount: parameters.value.slideCount,
      imageStyle: parameters.value.imageStyle,
      template: selectedTemplate.value?.name || parameters.value.template || 'auto',
      resume: Boolean(options.resume),
    };
  }

  async function startGenerationJob(options: { resume?: boolean } = {}) {
    if (!activePpt.value) return;

    if (activeGenerationJobId.value) {
      await reportGenerationJob(options.resume ? 'resuming' : 'outline', options.resume ? 10 : 5, 'running');
      return;
    }

    try {
      const response = await generationJobApi.create({
        projectId: activePpt.value.id,
        title: activePpt.value.title,
        metadata: buildGenerationJobMetadata(options),
      });

      if (response.success && response.data?.id) {
        activeGenerationJobId.value = response.data.id;
        await reportGenerationJob('outline', 5, 'running');
        return;
      }

      pushLog(`生成任务记录创建失败：${response.message || '服务端未返回任务 ID'}`);
    } catch (error) {
      console.warn('创建生成任务记录失败', error);
    }
  }

  function applyQueuedGenerationResult(
    result: any,
    options: { phase?: WorkflowStepId | 'completed'; progress?: number; final?: boolean } = {}
  ) {
    if (!result?.spec || !result?.lock) {
      throw new Error('服务端生成结果不完整');
    }
    designSpec.value = result.spec;
    specLock.value = result.lock;
    applyGeneratedProjectInfo(designSpec.value);
    outline.value = (result.outline || result.spec.outline || []).map((s: any) => ({
      id: s.id,
      title: s.title,
      bullets: s.bullets || [],
      speakerNotes: s.speakerNotes || '',
      visualPrompt: s.visualPrompt || '',
      chartHint: s.chartHint,
      layout: s.layout as SlideLayout,
    }));
    images.value = Array.isArray(result.images) ? result.images : [];
    svgPages.value = Array.isArray(result.svgPages)
      ? result.svgPages.map((page: any, index: number) => ({
          pageNumber: page.pageNumber || index + 1,
          svg: page.svg || '',
          speakerNotes: page.speakerNotes || '',
        }))
      : [];
    sortSvgPagesByPageNumber();
    executorCursor.value = svgPages.value.length;
    syncGeneratedSlidesFromImages();
    setStepStatus('outline', 'done', 100);

    const imageGate = updateImageStepFromGate(options.phase === 'images' ? 'running' : 'idle');
    if (options.final) {
      setStepStatus('images', 'done', 100);
      setStepStatus('layout', 'done', 100);
      setStepStatus('preview', 'done', 100);
      return;
    }

    if (options.phase === 'images') {
      activeStep.value = 'images';
      setStepStatus(
        'images',
        imageGate.complete ? 'done' : 'running',
        imageGate.complete ? 100 : Math.min(99, options.progress || steps.value.find(step => step.id === 'images')?.progress || 0)
      );
      setStepStatus('layout', 'idle', 0);
      setStepStatus('preview', 'idle', 0);
    } else if (options.phase === 'layout') {
      activeStep.value = 'layout';
      setStepStatus('images', 'done', 100);
      setStepStatus('layout', 'running', Math.min(99, options.progress || steps.value.find(step => step.id === 'layout')?.progress || 0));
      setStepStatus('preview', 'idle', 0);
    }
  }

  async function reportGenerationJob(
    phase: string,
    progress: number,
    status: GenerationJobStatus = 'running',
    errorMessage?: string
  ) {
    if (!activeGenerationJobId.value) return;

    try {
      const response = await generationJobApi.update(activeGenerationJobId.value, {
        status,
        phase,
        progress,
        errorMessage,
        metadata: buildGenerationJobMetadata(),
      });

      if (!response.success) {
        console.warn('更新生成任务记录失败', response.message);
      }
    } catch (error) {
      console.warn('更新生成任务记录失败', error);
    }
  }

  async function finishGenerationJob() {
    await reportGenerationJob('preview', 100, 'completed');
    activeGenerationJobId.value = null;
  }

  async function failGenerationJob(error: unknown) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    await reportGenerationJob(activeStep.value, steps.value.find((step) => step.id === activeStep.value)?.progress || 0, 'failed', errorMessage);
    activeGenerationJobId.value = null;
  }

  function normalizeConfigValue(label: string, key: ConfigOptionKey) {
    const base = label.trim() || '未命名';
    if (key === 'slideCount' || key === 'skillIntensity') {
      const numeric = Number(base.match(/\d+/)?.[0]);
      if (Number.isFinite(numeric) && numeric > 0) {
        const candidate = String(numeric);
        const existing = new Set(configOptions.value[key].map(option => option.value));
        if (!existing.has(candidate)) return candidate;
      }
    }
    const slug = base
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w\u4e00-\u9fa5-]/g, '')
      .slice(0, 40);
    const candidate = slug || `${key}-${Date.now()}`;
    const existing = new Set(configOptions.value[key].map(option => option.value));
    if (!existing.has(candidate)) return candidate;
    return `${candidate}-${Date.now().toString(36).slice(-5)}`;
  }

  function parseConfigParameterValue(key: ConfigOptionKey, value: string) {
    if (key === 'slideCount' || key === 'skillIntensity') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return value;
  }

  function normalizeParametersAgainstConfig() {
    const next = normalizeAgentParameters(parameters.value);

    for (const key of CONFIG_KEYS) {
      const options = configOptions.value[key];
      if (!options.length) continue;
      const current = String(next[key]);
      if (isAutoParameterValue(key, current)) continue;
      if (!options.some((option) => option.value === current)) {
        (next as any)[key] = parseConfigParameterValue(key, options[0].value);
      }
    }

    parameters.value = next;
  }

  async function saveConfigGroup(key: ConfigOptionKey) {
    const meta = CONFIG_META[key];
    const options = configOptions.value[key].map((option) => ({ ...option }));
    const payload = {
      name: meta.name,
      key,
      type: meta.type,
      value: options[0]?.value || '',
      options,
      min_value: meta.min,
      max_value: meta.max,
      description: meta.description,
    };

    try {
      const existing = configRecords.value[key];
      const response = existing?.id
        ? await configApi.update(existing.id, payload)
        : await configApi.create(payload);
      if (response.success && response.data) {
        configRecords.value = { ...configRecords.value, [key]: response.data };
      } else {
        pushLog(`运行配置保存失败：${response.message || meta.name}`);
      }
    } catch (error) {
      console.warn('保存运行配置失败', error);
      pushLog(`运行配置保存失败：${meta.name}`);
    }
  }

  function setConfigOptionValue(key: ConfigOptionKey, value: string) {
    parameters.value = { ...parameters.value, [key]: parseConfigParameterValue(key, value) };
    syncToProject();
  }

  async function addConfigOption(key: ConfigOptionKey, label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    const option = { label: trimmed, value: normalizeConfigValue(trimmed, key) };
    configOptions.value = {
      ...configOptions.value,
      [key]: [...configOptions.value[key], option]
    };
    normalizeParametersAgainstConfig();
    await saveConfigGroup(key);
    pushLog(`已添加配置：${trimmed}`);
    syncToProject();
  }

  async function updateConfigOption(key: ConfigOptionKey, value: string, label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    configOptions.value = {
      ...configOptions.value,
      [key]: configOptions.value[key].map(option => option.value === value ? { ...option, label: trimmed } : option)
    };
    normalizeParametersAgainstConfig();
    await saveConfigGroup(key);
    pushLog(`已更新配置：${trimmed}`);
    syncToProject();
  }

  async function deleteConfigOption(key: ConfigOptionKey, value: string) {
    if (configOptions.value[key].length <= 1) return;
    const target = configOptions.value[key].find(option => option.value === value);
    configOptions.value = {
      ...configOptions.value,
      [key]: configOptions.value[key].filter(option => option.value !== value)
    };
    normalizeParametersAgainstConfig();
    await saveConfigGroup(key);
    pushLog(`已删除配置：${target?.label || value}`);
    syncToProject();
  }

  async function requestPauseWorkflow() {
    if (!isRunning.value) return;
    recoveredActiveWorkflow.value = false;
    pauseRequested.value = true;
    pushLog('已请求暂停，正在停止当前服务端任务。');

    const queueJobId = activeQueueJobId.value;
    if (queueJobId) {
      try {
        await aiApi.cancelQueueJob(queueJobId);
      } catch (error) {
        console.warn('取消队列任务失败', error);
      }
    }

    if (activeGenerationJobId.value) {
      try {
        await generationJobApi.cancel(activeGenerationJobId.value);
      } catch (error) {
        console.warn('取消生成任务记录失败', error);
      }
    }

    markPaused(activeStep.value);
  }

  function markPaused(stage: WorkflowStepId) {
    workflowRunToken.value += 1;
    freezeWorkflowStepsForPause(stage);
    isPaused.value = true;
    recoveredActiveWorkflow.value = false;
    pauseRequested.value = false;
    resumeStage.value = stage;
    isRunning.value = false;
    currentGeneratingSlide.value = null;
    activeQueueJobId.value = null;
    activeGenerationJobId.value = null;
    pushLog('工作流已暂停。');
    syncToProject();
  }

  function clearPauseState() {
    isPaused.value = false;
    pauseRequested.value = false;
    resumeStage.value = null;
    recoveredActiveWorkflow.value = false;
  }

  async function continueWorkflow() {
    if (isRunning.value) return;
    pushLog('继续生成。');
    clearPauseState();
    await runFullWorkflow({ resume: true });
  }

  async function resumeRecoveredWorkflow() {
    if (!recoveredActiveWorkflow.value || isRunning.value) return;
    pushLog('页面已恢复，继续生成。');
    clearPauseState();
    await runFullWorkflow({ resume: true });
  }

  function shouldPauseAt(stage: WorkflowStepId): boolean {
    if (!pauseRequested.value) return false;
    markPaused(stage);
    return true;
  }

  function releaseActiveRunLock() {
    workflowRunToken.value += 1;
    isRunning.value = false;
    pauseRequested.value = false;
    runningProjectId.value = null;
    currentGeneratingSlide.value = null;
    activeQueueJobId.value = null;
  }

  function releaseWorkflowForImageRetry() {
    isRunning.value = false;
    pauseRequested.value = false;
    runningProjectId.value = null;
    currentGeneratingSlide.value = null;
    activeQueueJobId.value = null;
    recoveredActiveWorkflow.value = false;
  }

  function takeoverPendingLayoutPauseForRetry(pageNumber: number) {
    const shouldResumePausedLayoutAfterRetry = Boolean(
      isPaused.value &&
      activeStep.value === 'layout' &&
      (resumeStage.value === 'layout' || hasPendingLayoutPages())
    );
    const shouldResumeAfterRetry = Boolean(
      shouldResumePausedLayoutAfterRetry ||
      (
        isRunning.value &&
        pauseRequested.value &&
        activeStep.value === 'layout' &&
        !isPaused.value
      )
    );

    if (isRunning.value && !pauseRequested.value && !isPaused.value) {
      const toastStore = useToastStore();
      toastStore.warning('页面正在生成', '请先暂停后再重试单页');
      return { allowed: false, shouldResumeAfterRetry: false };
    }

    if (isRunning.value || pauseRequested.value) {
      releaseActiveRunLock();
      if (shouldResumeAfterRetry) {
        pushLog(`已接管暂停中的页面生成，第 ${pageNumber} 页重试成功后会继续后续页面。`);
      }
    } else if (shouldResumePausedLayoutAfterRetry) {
      pushLog(`第 ${pageNumber} 页重试成功后会继续后续页面。`);
    }

    return { allowed: true, shouldResumeAfterRetry };
  }

  function isFallbackSvgPage(svg?: string) {
    return Boolean(svg && svg.includes('本页待重试'));
  }

  function sortSvgPagesByPageNumber() {
    svgPages.value = [...svgPages.value].sort((left, right) => left.pageNumber - right.pageNumber);
  }

  function upsertSvgPage(page: { pageNumber: number; svg: string; speakerNotes: string }) {
    const existingPageIndex = svgPages.value.findIndex(item => item.pageNumber === page.pageNumber);
    if (existingPageIndex >= 0) {
      svgPages.value[existingPageIndex] = page;
    } else {
      svgPages.value.push(page);
    }
    sortSvgPagesByPageNumber();
  }

  function layoutPageCount() {
    return designSpec.value?.outline.length || outline.value.length || parameters.value.slideCount || svgPages.value.length;
  }

  function hasPendingLayoutPages(totalPages = layoutPageCount()) {
    if (totalPages <= 0) return false;
    const pagesByNumber = new Map(svgPages.value.map(page => [page.pageNumber, page]));
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const page = pagesByNumber.get(pageNumber);
      if (!page || isFallbackSvgPage(page.svg)) return true;
    }
    return false;
  }

  function completedLeadingLayoutPages(totalPages = layoutPageCount()) {
    if (totalPages <= 0) return 0;
    const pagesByNumber = new Map(svgPages.value.map(page => [page.pageNumber, page]));

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const page = pagesByNumber.get(pageNumber);
      if (!page || isFallbackSvgPage(page.svg)) return pageNumber - 1;
    }

    return totalPages;
  }

  function updateLayoutStepAfterPageRetry() {
    const totalPages = layoutPageCount();
    if (totalPages <= 0) return;
    const pagesByNumber = new Map(svgPages.value.map(page => [page.pageNumber, page]));
    let completedPages = 0;

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const page = pagesByNumber.get(pageNumber);
      if (page && !isFallbackSvgPage(page.svg)) completedPages += 1;
    }

    const progress = Math.min(100, Math.round((completedPages / totalPages) * 100));
    if (completedPages >= totalPages) {
      executorCursor.value = totalPages;
      setStepStatus('layout', 'done', 100);
      return;
    }

    executorCursor.value = completedLeadingLayoutPages(totalPages);
    setStepStatus('layout', isPaused.value ? 'running' : 'idle', progress);
  }

  function resetDownstreamSteps(afterStepId: WorkflowStepId) {
    const stepOrder: WorkflowStepId[] = ['input', 'outline', 'images', 'layout', 'preview'];
    const afterIndex = stepOrder.indexOf(afterStepId);
    if (afterIndex === -1) return;
    for (let i = afterIndex + 1; i < stepOrder.length; i++) {
      const step = steps.value.find(s => s.id === stepOrder[i]);
      if (step && step.status === 'done') {
        step.status = 'idle';
        step.progress = 0;
      }
    }
  }

  function checkApiKeys(): boolean {
    const apiKeyStore = useApiKeyStore();
    const toastStore = useToastStore();

    if (!apiKeyStore.isTextModelConfigured) {
      toastStore.warning('文本模型未配置', '请先在设置中配置文本模型的 API Key');
      return false;
    }

    return true;
  }

  function checkActivePpt(): boolean {
    const toastStore = useToastStore();

    if (!activePpt.value) {
      activeStep.value = 'input';
      toastStore.warning('请先添加 PPT', '添加或选择一个 PPT 项目后，才能开始生成流程');
      return false;
    }

    return true;
  }

  function setInputProcessStep(
    id: InputProcessStep['id'],
    patch: Partial<Omit<InputProcessStep, 'id'>>
  ) {
    inputProcessSteps.value = inputProcessSteps.value.map((step) =>
      step.id === id ? { ...step, ...patch } : step
    );
  }

  function resetInputProcessSteps() {
    inputProcessSteps.value = createInputProcessSteps();
  }

  function isSearchSkill(skill: SkillDefinition) {
    const text = `${skill.name} ${skill.description} ${skill.category || ''}`.toLowerCase();
    return /web|search|google|bing|搜索|联网|资料收集/.test(text);
  }

  function isFileParseSkill(skill: SkillDefinition) {
    const text = `${skill.name} ${skill.description} ${skill.category || ''}`.toLowerCase();
    return /file|parse|docx|pdf|文件|解析|读取/.test(text);
  }

  function isTopicSkill(skill: SkillDefinition) {
    const text = `${skill.name} ${skill.description} ${skill.category || ''}`.toLowerCase();
    return /topic|title|主题|提炼|标题/.test(text);
  }

  function isConstraintSkill(skill: SkillDefinition) {
    const text = `${skill.name} ${skill.description} ${skill.category || ''}`.toLowerCase();
    return /constraint|config|rule|约束|配置|规则|提示词/.test(text);
  }

  function stripSkillContextBlock(content: string) {
    const pattern = new RegExp(`\\n*${SKILL_CONTEXT_START}[\\s\\S]*?${SKILL_CONTEXT_END}\\n*`, 'g');
    return content.replace(pattern, '\n\n').trim();
  }

  function stripGeneratedInputArtifacts(content: string) {
    return stripSkillContextBlock(content)
      .replace(/\n*【上传资料：[^】]+】[\s\S]*?(?=\n\n【上传资料：|\n\n【Skill 处理结果|$)/g, '\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function buildSkillContextContent(baseContent: string, chunks: string[]) {
    const cleanBase = stripSkillContextBlock(baseContent);
    if (!chunks.length) return cleanBase;
    return [
      cleanBase,
      `${SKILL_CONTEXT_START}\n${chunks.join('\n\n')}\n${SKILL_CONTEXT_END}`,
    ].filter(Boolean).join('\n\n');
  }

  function compactMultiline(value: string, maxLength = 900) {
    const normalized = value.trim().replace(/\n{3,}/g, '\n\n');
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
  }

  function buildUploadedFileContext() {
    return uploadedFileContents.value
      .filter((file) => file.name && file.text.trim())
      .map((file) => `【上传文件：${file.name}】\n${file.text.trim()}`)
      .join('\n\n');
  }

  function buildInputSourceContext(userContent = stripGeneratedInputArtifacts(input.value.content.trim())) {
    return [
      userContent.trim(),
      buildUploadedFileContext(),
    ].filter(Boolean).join('\n\n');
  }

  function generationInputContent() {
    return processedInputContent.value.trim() || buildInputSourceContext();
  }

  function extractSkillOutputText(output: unknown) {
    if (!output) return '';
    if (typeof output === 'string') {
      try {
        const parsed = JSON.parse(output);
        return extractSkillOutputText(parsed);
      } catch {
        return output;
      }
    }
    if (typeof output === 'object') {
      const record = output as Record<string, any>;
      return String(record.text || record.summary || record.instruction || '').trim();
    }
    return String(output || '').trim();
  }

  function hasSkillRunFailureSignal(logs: string) {
    if (!logs.trim()) return false;
    return [
      /Traceback \(most recent call last\)/i,
      /\bException\b/i,
      /\bError\b/i,
      /Error performing/i,
      /Missing required dependency/i,
      /ModuleNotFoundError/i,
      /ImportError/i,
      /Process timeout/i,
    ].some((pattern) => pattern.test(logs));
  }

  function isEmptySkillRunOutput(outputText: string, logs: string, searchLike: boolean) {
    const normalized = outputText.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!normalized) return true;
    if (/^no results found\.?$/.test(normalized)) return true;
    if (/^none$|^null$|^\[\]$|^\{\}$/.test(normalized)) return true;
    if (searchLike && /found\s+0\s+result/i.test(`${outputText}\n${logs}`)) return true;
    return false;
  }

  function validateSkillRunResult(skill: SkillDefinition, stepId: InputProcessStep['id'], outputText: string, logs: string) {
    if (hasSkillRunFailureSignal(logs)) {
      return `Skill 执行异常：${compactMultiline(logs, 180)}`;
    }
    if (isEmptySkillRunOutput(outputText, logs, stepId === 'collect' || isSearchSkill(skill))) {
      return outputText ? `Skill 未返回有效内容：${compactMultiline(outputText, 240)}` : 'Skill 未返回有效内容。';
    }
    return '';
  }

  function countSearchResults(outputText: string) {
    const markdownMatches = outputText.match(/^##\s+\d+\./gm)?.length || 0;
    if (markdownMatches) return markdownMatches;
    const urlMatches = outputText.match(/\bhttps?:\/\/\S+/g)?.length || 0;
    return urlMatches;
  }

  function extractSearchTitles(outputText: string) {
    return Array.from(outputText.matchAll(/^##\s+\d+\.\s+(.+)$/gm))
      .map((match) => match[1].trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  function buildSkillProcessedText(
    skill: SkillDefinition,
    stepId: InputProcessStep['id'],
    outputText: string,
    inputPayload: Record<string, any>
  ) {
    const query = String(inputPayload.query || inputPayload.topic || inputPayload.content || '')
      .replace(/\s+/g, ' ')
      .slice(0, 80);
    if (stepId === 'collect' || isSearchSkill(skill)) {
      const count = countSearchResults(outputText);
      const titles = extractSearchTitles(outputText);
      return [
        query ? `已围绕“${query}”完成资料收集。` : '已完成资料收集。',
        count ? `返回 ${count} 条结果，已合并到资料上下文。` : '已合并返回内容到资料上下文。',
        titles.length ? `重点结果：${titles.join('；')}` : '',
      ].filter(Boolean).join('\n');
    }
    if (stepId === 'file-parse') return '已解析上传文件，并将可用内容合并到资料上下文。';
    if (stepId === 'topic') return outputText ? `已提炼主题线索：${compactMultiline(outputText, 220)}` : '已完成主题提炼。';
    if (stepId === 'constraints') return outputText ? `已整理生成约束：${compactMultiline(outputText, 220)}` : '已完成生成约束整理。';
    return outputText ? compactMultiline(outputText, 220) : `${skill.name} 已完成。`;
  }

  function buildSkillContextChunk(
    skill: SkillDefinition,
    stepId: InputProcessStep['id'],
    outputText: string,
    processedText: string
  ) {
    if (!outputText && !processedText) return '';
    const titleByStep: Record<InputProcessStep['id'], string> = {
      collect: '资料收集结果',
      'file-parse': '文件解析结果',
      topic: '主题提炼结果',
      constraints: '生成约束结果',
      ready: '输入处理结果',
    };
    return compactMultiline([
      `### ${titleByStep[stepId]} - ${skill.name}`,
      processedText,
      outputText ? `\n原始输出：\n${outputText}` : '',
    ].filter(Boolean).join('\n'), 6000);
  }

  async function runInputSkill(
    skill: SkillDefinition,
    stepId: InputProcessStep['id'],
    inputPayload: Record<string, any>
  ) {
    setInputProcessStep(stepId, {
      status: 'running',
      progress: 18,
      detail: `准备 ${skill.name} 的输入`,
      skillId: skill.id,
      skillName: skill.name,
      logs: '',
      output: '',
      processedText: '',
      error: undefined,
    });
    await new Promise((resolve) => window.setTimeout(resolve, 120));

    setInputProcessStep(stepId, {
      progress: 38,
      detail: `正在启动 ${skill.name}`,
      logs: `输入已整理：${compactMultiline(JSON.stringify(inputPayload), 180)}`,
    });

    const response = await skillApi.run(Number(skill.id), {
      projectId: activePpt.value?.id,
      phase: 'input',
      input: inputPayload,
    });

    setInputProcessStep(stepId, {
      progress: 76,
      detail: `正在处理 ${skill.name} 返回内容`,
    });

    if (!response.success || !response.data) {
      throw new Error(response.message || `${skill.name} 执行失败`);
    }

    const outputText = extractSkillOutputText(response.data.output);
    const runLogs = response.data.logs || '';

    if (response.data.status === 'failed') {
      const message = compactMultiline(response.data.error_message || `${skill.name} 执行失败`, 220);
      setInputProcessStep(stepId, {
        progress: 100,
        detail: message,
        error: message,
        logs: runLogs,
        output: outputText ? compactMultiline(outputText, 800) : '',
      });
      throw new Error(message);
    }

    const validationError = validateSkillRunResult(skill, stepId, outputText, runLogs);
    if (validationError) {
      setInputProcessStep(stepId, {
        progress: 100,
        detail: validationError,
        error: validationError,
        logs: runLogs,
        output: outputText ? compactMultiline(outputText, 800) : '',
      });
      throw new Error(validationError);
    }

    const outputPreview = compactMultiline(outputText || 'Skill 执行完成，但没有返回正文。', 1200);
    const processedText = buildSkillProcessedText(skill, stepId, outputText, inputPayload);
    const context = buildSkillContextChunk(skill, stepId, outputText, processedText);

    setInputProcessStep(stepId, {
      status: 'done',
      progress: 100,
      detail: `${skill.name} 已完成，结果已处理`,
      logs: runLogs,
      output: outputPreview,
      processedText,
    });

    return { context, output: outputText, processedText, logs: runLogs };
  }

  async function ensureInputProject(): Promise<boolean> {
    const toastStore = useToastStore();
    const content = input.value.content.trim();
    const topic = input.value.topic.trim();
    const hasInput = Boolean(content || topic || input.value.files.length > 0);

    if (!hasInput) {
      activeStep.value = 'input';
      toastStore.warning('请填写资料', '请先输入资料内容或上传文件后再开始生成');
      return false;
    }

    if (!activePpt.value) {
      const inferredTitle = topic || inferInputTitle(content, input.value.files);
      await addPptProjectPersisted({
        title: inferredTitle,
        topic,
        description: content || '自动创建的 PPT 项目',
        templateId: 'auto'
      });
      toastStore.info('已创建 PPT 项目', `已自动创建项目：${inferredTitle}`);
    }

    setStepStatus('input', 'done', 100);
    pushLog('资料已准备好。');
    syncToProject();
    return true;
  }

  async function runInputStage() {
    const toastStore = useToastStore();
    resetInputProcessSteps();
    activeStep.value = 'input';
    setStepStatus('input', 'running', 5);

    const ready = await ensureInputProject();
    if (!ready) {
      setStepStatus('input', 'idle', 0);
      return;
    }

    const userContent = stripGeneratedInputArtifacts(input.value.content.trim());
    if (input.value.content !== userContent) {
      input.value.content = userContent;
    }
    const content = buildInputSourceContext(userContent);
    processedInputContent.value = '';
    const files = [...input.value.files];
    const activeSkills = enabledSkills.value.filter((skill) => Number.isFinite(Number(skill.id)));
    const collectSkills = activeSkills.filter((skill) => normalizeInputSkillCategory(skill.category) === '资料收集' || isSearchSkill(skill));
    const fileParseSkills = files.length
      ? activeSkills.filter((skill) => normalizeInputSkillCategory(skill.category) === '文件解析' || isFileParseSkill(skill))
      : [];
    const topicSkills = activeSkills.filter((skill) => normalizeInputSkillCategory(skill.category) === '主题提炼' || isTopicSkill(skill));
    const constraintSkills = activeSkills.filter((skill) => normalizeInputSkillCategory(skill.category) === '生成约束' || isConstraintSkill(skill));
    const skillContextChunks: string[] = [];

    try {
      setInputProcessStep('collect', {
        status: 'running',
        progress: 45,
        detail: collectSkills.length ? `正在执行 ${collectSkills.length} 个资料收集 Skill` : files.length ? `已接收 ${files.length} 个文件，正在整理资料` : '正在整理输入资料',
      });

      if (collectSkills.length) {
        for (const skill of collectSkills) {
          try {
            const result = await runInputSkill(skill, 'collect', {
              content,
              query: input.value.topic || inferInputTitle(userContent || content, files),
              files,
              purpose: 'collect and enrich source materials before PPT generation',
            });
            if (result.context) skillContextChunks.push(result.context);
          } catch (error) {
            const message = error instanceof Error ? error.message : '资料收集 Skill 执行失败';
            setInputProcessStep('collect', {
              status: 'failed',
              progress: 100,
              detail: message,
              error: message,
            });
            pushLog(`资料收集增强失败：${message}`);
            throw new Error(message);
          }
        }
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 120));
      }

      setInputProcessStep('collect', {
        status: inputProcessSteps.value.find(step => step.id === 'collect')?.status === 'failed' ? 'failed' : 'done',
        progress: 100,
        detail: inputProcessSteps.value.find(step => step.id === 'collect')?.status === 'failed'
          ? inputProcessSteps.value.find(step => step.id === 'collect')?.detail
          : collectSkills.length
            ? `${collectSkills.length} 个资料收集 Skill 已完成`
            : content
              ? `${content.length} 字资料已进入上下文`
              : `${files.length} 个文件已记录`,
      });
      setStepStatus('input', 'running', 20);

      if (files.length && fileParseSkills.length) {
        for (const skill of fileParseSkills) {
          try {
            const result = await runInputSkill(skill, 'file-parse', {
              content,
              fileContents: uploadedFileContents.value,
              files,
              purpose: 'parse uploaded files before PPT generation',
            });
            if (result.context) skillContextChunks.push(result.context);
          } catch (error) {
            const message = error instanceof Error ? error.message : '文件解析 Skill 执行失败';
            setInputProcessStep('file-parse', {
              status: 'failed',
              progress: 100,
              detail: message,
              error: message,
            });
            pushLog(`文件解析增强失败：${message}`);
            throw new Error(message);
          }
        }
      } else {
        setInputProcessStep('file-parse', {
          status: files.length ? 'done' : 'skipped',
          progress: 100,
          detail: files.length ? '上传文件已通过内置读取流程合并到资料' : '未上传文件，跳过',
        });
      }
      setStepStatus('input', 'running', 48);

      setInputProcessStep('topic', {
        status: 'running',
        progress: 60,
        detail: topicSkills.length ? `正在执行 ${topicSkills.length} 个主题提炼 Skill` : '正在提炼主题、受众和表达目标',
      });
      if (topicSkills.length) {
        for (const skill of topicSkills) {
          try {
            const result = await runInputSkill(skill, 'topic', {
              content: buildSkillContextContent(content, skillContextChunks),
              files,
              purpose: 'extract topic and audience before PPT generation',
            });
            if (result.context) skillContextChunks.push(result.context);
          } catch (error) {
            const message = error instanceof Error ? error.message : '主题提炼 Skill 执行失败';
            setInputProcessStep('topic', {
              status: 'failed',
              progress: 100,
              detail: message,
              error: message,
            });
            pushLog(`主题提炼增强失败：${message}`);
            throw new Error(message);
          }
        }
      }
      const explicitTopic = userContent.match(/(?:主题|题目|标题)\s*[：:]\s*([^\n。；;]+)/)?.[1]?.trim();
      if (explicitTopic && !input.value.topic.trim()) {
        input.value.topic = explicitTopic.slice(0, 80);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      setInputProcessStep('topic', {
        status: inputProcessSteps.value.find(step => step.id === 'topic')?.status === 'failed' ? 'failed' : 'done',
        progress: 100,
        detail: inputProcessSteps.value.find(step => step.id === 'topic')?.status === 'failed'
          ? inputProcessSteps.value.find(step => step.id === 'topic')?.detail
          : input.value.topic.trim() ? `主题：${input.value.topic.trim()}` : '主题将在大纲生成时由 AI 自动确定',
      });
      setStepStatus('input', 'running', 72);

      setInputProcessStep('constraints', {
        status: 'running',
        progress: 70,
        detail: constraintSkills.length ? `正在执行 ${constraintSkills.length} 个生成约束 Skill` : '正在整理提示词、参考模板和配置参数',
      });
      if (constraintSkills.length) {
        for (const skill of constraintSkills) {
          try {
            const result = await runInputSkill(skill, 'constraints', {
              content: buildSkillContextContent(content, skillContextChunks),
              files,
              promptId: selectedPromptId.value,
              templateName: selectedTemplate.value?.name || '',
              parameters: { ...parameters.value },
              purpose: 'prepare generation constraints before PPT generation',
            });
            if (result.context) skillContextChunks.push(result.context);
          } catch (error) {
            const message = error instanceof Error ? error.message : '生成约束 Skill 执行失败';
            setInputProcessStep('constraints', {
              status: 'failed',
              progress: 100,
              detail: message,
              error: message,
            });
            pushLog(`生成约束增强失败：${message}`);
            throw new Error(message);
          }
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      setInputProcessStep('constraints', {
        status: inputProcessSteps.value.find(step => step.id === 'constraints')?.status === 'failed' ? 'failed' : 'done',
        progress: 100,
        detail: inputProcessSteps.value.find(step => step.id === 'constraints')?.status === 'failed'
          ? inputProcessSteps.value.find(step => step.id === 'constraints')?.detail
          : [
              selectedPromptId.value ? '已选择提示词' : '使用默认提示词策略',
              selectedTemplate.value ? `参考模板：${selectedTemplate.value.name}` : '不使用参考模板',
              parameters.value.slideCount > 0 ? `${parameters.value.slideCount} 页` : '页数 AI 自动',
            ].join(' / '),
      });
      setStepStatus('input', 'running', 90);

      processedInputContent.value = buildSkillContextContent(content, skillContextChunks);
      setInputProcessStep('ready', {
        status: 'running',
        progress: 92,
        detail: skillContextChunks.length
          ? `已整理用户输入、上传文件和 ${skillContextChunks.length} 段 Skill 处理结果`
          : uploadedFileContents.value.length
            ? `已整理用户输入和 ${uploadedFileContents.value.length} 个上传文件`
            : '已整理用户输入内容',
        processedText: compactMultiline(processedInputContent.value, 1200),
      });
      if (skillContextChunks.length) {
        pushLog(`已将 ${skillContextChunks.length} 段 Skill 处理结果整理到生成就绪文案。`);
      }

      setInputProcessStep('ready', {
        status: 'done',
        progress: 100,
        detail: skillContextChunks.length
          ? '输入阶段已完成，Skill 结果将参与大纲生成'
          : '输入阶段已完成，准备生成大纲',
      });
      setStepStatus('input', 'done', 100);
      pushLog('输入阶段处理完成。');
      await syncToProjectNow();
      activeStep.value = 'outline';
    } catch (error) {
      const message = error instanceof Error ? error.message : '输入阶段处理失败';
      setInputProcessStep('ready', {
        status: 'failed',
        progress: 100,
        detail: message,
        error: message,
      });
      setStepStatus('input', 'idle', 0);
      syncToProject();
      toastStore.error('输入阶段处理失败', message);
      throw error;
    }
  }

  function addPptProject(data: { title: string; topic: string; description: string; templateId: string }) {
    const now = Date.now();
    if (activePpt.value) {
      syncToProject();
    }

    const freshState = makeDefaultProjectState();
    freshState.input.topic = data.topic.trim();
    freshState.input.content = data.description.trim();

    const project: PptProject = {
      id: createId('ppt'),
      title: data.title.trim() || data.topic.trim() || '未命名 PPT',
      topic: data.topic.trim(),
      description: data.description.trim(),
      templateId: data.templateId,
      createdAt: now,
      updatedAt: now,
      state: freshState
    };

    pptProjects.value = [project, ...pptProjects.value];
    pptProjects.value = mergePptProjects(pptProjects.value, project.id);
    activePptId.value = project.id;
    restoreProjectState(freshState);
    pushLog(`已添加 PPT：${project.title}`);
  }

  async function addPptProjectPersisted(data: { title: string; topic: string; description: string; templateId: string }) {
    const title = data.title.trim() || data.topic.trim() || '未命名 PPT';
    const topic = data.topic.trim();
    const existingProject = mergePptProjects(pptProjects.value).find((project) => isSameProjectIdentity(project, { title, topic }));

    if (existingProject && Number.isInteger(Number(existingProject.id)) && Number(existingProject.id) > 0) {
      pptProjects.value = mergePptProjects(pptProjects.value, existingProject.id);
      activePptId.value = existingProject.id;
      restoreProjectState(existingProject.state);
      pushLog(`已打开 PPT：${existingProject.title}`);
      return existingProject;
    }

    const freshState = makeDefaultProjectState();
    freshState.input.topic = topic;
    freshState.input.content = data.description.trim();

    try {
      const response = await projectApi.create({
        title,
        topic,
        content: data.description.trim(),
        status: 'draft',
        state: freshState,
      });

      if (response.success && response.data?.id) {
        const now = Date.now();
        const project: PptProject = {
          id: String(response.data.id),
          title,
          topic,
          description: data.description.trim(),
          templateId: data.templateId,
          createdAt: now,
          updatedAt: now,
          state: freshState,
        };
        pptProjects.value = mergePptProjects([project, ...pptProjects.value.filter(p => p.id !== project.id)], project.id);
        activePptId.value = project.id;
        restoreProjectState(freshState);
        pushLog(`已添加 PPT：${project.title}`);
        return project;
      }

      if (response.status === 409) {
        const toastStore = useToastStore();
        toastStore.error('项目名称重复', response.message || `「${title}」已存在，请换一个名称`);
        await fetchPptProjects();
        const duplicate = mergePptProjects(pptProjects.value).find((project) => normalizeProjectText(project.title) === normalizeProjectText(title));
        if (duplicate) {
          activePptId.value = duplicate.id;
          restoreProjectState(duplicate.state);
          pushLog(`已打开已有 PPT：${duplicate.title}`);
          return duplicate;
        }
        return null;
      }

      const toastStore = useToastStore();
      toastStore.error('创建项目失败', response.message || '请稍后重试');
      return null;
    } catch (error) {
      console.warn('创建远端项目失败，使用本地项目', error);
    }

    addPptProject(data);
    return activePpt.value;
  }

  function updatePptProject(id: string, data: Partial<Pick<PptProject, 'title' | 'topic' | 'description' | 'templateId'>>) {
    const project = pptProjects.value.find((item) => item.id === id);
    if (!project) return;

    Object.assign(project, data, { updatedAt: Date.now() });
    if (activePptId.value === id) {
      input.value = {
        ...input.value,
        topic: project.topic,
        content: project.description
      };
    }
    pushLog(`已更新 PPT：${project.title}`);
  }

  function deletePptProject(id: string) {
    const project = pptProjects.value.find((item) => item.id === id);
    pptProjects.value = pptProjects.value.filter((item) => item.id !== id);

    if (activePptId.value === id) {
      activePptId.value = pptProjects.value[0]?.id || null;
      if (activePpt.value) {
        selectPptProject(activePpt.value.id);
      } else {
        input.value = { topic: '', content: '', files: [] };
        selectedPromptId.value = '';
        selectedTemplate.value = null;
        outline.value = [];
        images.value = [];
        exportArtifacts.value = [];
      }
    }

    if (project) {
      pushLog(`已删除 PPT：${project.title}`);
    }
  }

  async function selectPptProject(id: string) {
    if (activePpt.value && activePpt.value.id === id) return;

    if (activePpt.value) {
      cancelActiveRunForProjectSwitch();
      await syncToProject();
    }

    const numericId = parseInt(id.replace(/\D/g, '') || '0', 10);
    if (numericId > 0) {
      try {
        const response = await projectApi.getById(numericId);
        if (response.success && response.data) {
          const serverProject = response.data as any;
          const projectState = serverProject.state
            ? (typeof serverProject.state === 'string' ? JSON.parse(serverProject.state) : serverProject.state)
            : null;

          let project = pptProjects.value.find(p => p.id === id);
          if (!project) {
            project = {
              id,
              title: serverProject.title || '未命名 PPT',
              topic: serverProject.topic || '',
              description: serverProject.content || '',
              templateId: 'auto',
              createdAt: new Date(serverProject.created_at).getTime(),
              updatedAt: new Date(serverProject.updated_at).getTime(),
              state: projectState || makeDefaultProjectState()
            };
            pptProjects.value = mergePptProjects([project, ...pptProjects.value], id);
          } else {
            if (projectState) {
              project.state = projectState;
            }
            project.title = serverProject.title || project.title;
            project.updatedAt = new Date(serverProject.updated_at).getTime();
          }
        }
      } catch (error) {
        console.error('加载项目状态失败', error);
      }
    }

    const project = pptProjects.value.find(p => p.id === id);
    if (!project) {
      const freshProject: PptProject = {
        id,
        title: '未命名 PPT',
        topic: '',
        description: '',
        templateId: 'auto',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        state: makeDefaultProjectState()
      };
      pptProjects.value = mergePptProjects([freshProject, ...pptProjects.value], id);
      activePptId.value = id;
      restoreProjectState(freshProject.state);
      return;
    }

    activePptId.value = id;
    restoreProjectState(project.state);
  }

  function addSkill(data: Omit<SkillDefinition, 'id' | 'order' | 'enabled'> & { enabled?: boolean }) {
    const skill: SkillDefinition = {
      id: createId('skill'),
      name: data.name.trim() || '未命名 Skill',
      description: data.description.trim(),
      enabled: data.enabled ?? false,
      order: skills.value.length + 1,
      params: { ...data.params }
    };
    skills.value = [...skills.value, skill];
    pushLog(`已添加 Skill：${skill.name}`);
  }

  function updateSkill(id: string, data: Partial<Omit<SkillDefinition, 'id'>>) {
    const skill = skills.value.find((item) => item.id === id);
    if (!skill) return;

    Object.assign(skill, data, data.params ? { params: { ...data.params } } : {});
    pushLog(`已更新 Skill：${skill.name}`);
  }

  function deleteSkill(id: string) {
    const skill = skills.value.find((item) => item.id === id);
    skills.value = skills.value.filter((item) => item.id !== id).map((item, index) => ({ ...item, order: index + 1 }));
    if (skill) {
      pushLog(`已删除 Skill：${skill.name}`);
    }
  }

  function addPrompt(data: Omit<PromptDefinition, 'id' | 'updatedAt'>) {
    const prompt: PromptDefinition = {
      id: createId('prompt'),
      title: data.title.trim() || '未命名提示词',
      scene: data.scene.trim(),
      content: data.content.trim(),
      updatedAt: Date.now()
    };
    prompts.value = [prompt, ...prompts.value];
    pushLog(`已添加提示词：${prompt.title}`);
  }

  function updatePrompt(id: string, data: Partial<Omit<PromptDefinition, 'id' | 'updatedAt'>>) {
    const prompt = prompts.value.find((item) => item.id === id);
    if (!prompt) return;

    Object.assign(prompt, data, { updatedAt: Date.now() });
    pushLog(`已更新提示词：${prompt.title}`);
  }

  function deletePrompt(id: string) {
    const prompt = prompts.value.find((item) => item.id === id);
    prompts.value = prompts.value.filter((item) => item.id !== id);
    if (prompt) {
      pushLog(`已删除提示词：${prompt.title}`);
    }
  }

  function setSlideLayout(slideId: string, layout: import('@/types/agent').SlideLayout) {
    const slide = outline.value.find((item) => item.id === slideId);
    if (!slide) return;
    saveHistory();
    slide.layout = layout;
    pushLog(`已调整版式：${slide.title} -> ${layout}`);
    syncToProject();
  }

  function reorderOutline(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    saveHistory();
    const items = [...outline.value];
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);
    outline.value = items;
    pushLog(`已调整幻灯片顺序：第 ${fromIndex + 1} 页 -> 第 ${toIndex + 1} 页`);
    syncToProject();
  }

  function updateSlideTitle(id: string, title: string) {
    const slide = outline.value.find((item) => item.id === id);
    if (slide) {
      saveHistory();
      slide.title = title;
      pushLog(`已更新页面标题：${title}`);
      resetDownstreamSteps('outline');
      syncToProject();
    }
  }

  function updateSlideBullet(slideId: string, bulletIndex: number, text: string) {
    const slide = outline.value.find((item) => item.id === slideId);
    if (slide && slide.bullets[bulletIndex] !== undefined) {
      saveHistory();
      slide.bullets[bulletIndex] = text;
      syncToProject();
    }
  }

  function addSlideBullet(slideId: string) {
    const slide = outline.value.find((item) => item.id === slideId);
    if (slide) {
      saveHistory();
      slide.bullets.push('');
      syncToProject();
    }
  }

  function deleteSlideBullet(slideId: string, bulletIndex: number) {
    const slide = outline.value.find((item) => item.id === slideId);
    if (slide && slide.bullets.length > 1) {
      saveHistory();
      slide.bullets.splice(bulletIndex, 1);
      syncToProject();
    }
  }

  function reorderBullet(slideId: string, fromIndex: number, toIndex: number) {
    const slide = outline.value.find((item) => item.id === slideId);
    if (!slide || fromIndex === toIndex) return;
    saveHistory();
    const [moved] = slide.bullets.splice(fromIndex, 1);
    slide.bullets.splice(toIndex, 0, moved);
    syncToProject();
  }

  function updateSlideNotes(slideId: string, notes: string) {
    const slide = outline.value.find((item) => item.id === slideId);
    if (slide) {
      saveHistory();
      slide.speakerNotes = notes;
      syncToProject();
    }
  }

  function updateSlideVisualPrompt(slideId: string, prompt: string) {
    const slide = outline.value.find((item) => item.id === slideId);
    if (slide) {
      saveHistory();
      slide.visualPrompt = prompt;
      resetDownstreamSteps('outline');
      syncToProject();
    }

    const specSlide = designSpec.value?.outline.find((item) => item.id === slideId);
    if (specSlide) {
      specSlide.visualPrompt = prompt;
    }
  }

  function reorderSkills(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    const items = [...skills.value];
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);
    skills.value = items.map((skill, index) => ({ ...skill, order: index + 1 }));
    pushLog('已调整 Skill 顺序');
  }

  function globalSearch(query: string) {
    if (!query.trim()) return { slides: [], projects: [], prompts: [], templates: [] };
    const q = query.toLowerCase();

    const slides = outline.value.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.bullets.some((b) => b.toLowerCase().includes(q)) ||
        s.speakerNotes.toLowerCase().includes(q)
    );

    const projects = pptProjects.value.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.topic.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
    );

    const promptResults = prompts.value.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.scene.toLowerCase().includes(q) ||
        p.content.toLowerCase().includes(q)
    );

    const templateResults = templates.value.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.category || '').toLowerCase().includes(q)
    );

    return { slides, projects, prompts: promptResults, templates: templateResults };
  }

  // ---- History (undo/redo) ----
  const historyPast = ref<Array<{ outline: SlideOutline[] }>>([]);
  const historyFuture = ref<Array<{ outline: SlideOutline[] }>>([]);
  const MAX_HISTORY = 50;

  const canUndo = computed(() => historyPast.value.length > 0);
  const canRedo = computed(() => historyFuture.value.length > 0);

  function saveHistory() {
    historyPast.value.push({
      outline: outline.value.map(s => ({ ...s, bullets: [...s.bullets] }))
    });
    if (historyPast.value.length > MAX_HISTORY) historyPast.value.shift();
    historyFuture.value = [];
  }

  function undoOutline() {
    if (!canUndo.value) return;
    const entry = historyPast.value.pop()!;
    historyFuture.value.push({
      outline: outline.value.map(s => ({ ...s, bullets: [...s.bullets] }))
    });
    outline.value = entry.outline.map(s => ({ ...s, bullets: [...s.bullets] }));
    pushLog('鎾ら攢');
  }

  function redoOutline() {
    if (!canRedo.value) return;
    const entry = historyFuture.value.pop()!;
    historyPast.value.push({
      outline: outline.value.map(s => ({ ...s, bullets: [...s.bullets] }))
    });
    outline.value = entry.outline.map(s => ({ ...s, bullets: [...s.bullets] }));
    pushLog('閲嶅仛');
  }

  // ---- Chat action execution ----
  function executeChatAction(action: { type: string; params: Record<string, string> }, projectId?: string): string | null {
    if (projectId && activePptId.value !== projectId) return null;

    const newOutline = outline.value.map(s => ({ ...s, bullets: [...s.bullets] }));
    const commitOutline = () => {
      outline.value = newOutline;
      syncToProject();
    };

    switch (action.type) {
      case 'updateSlideTitle': {
        const slide = newOutline.find(s => s.id === action.params.slideId);
        if (!slide) return null;
        slide.title = action.params.title || slide.title;
        commitOutline();
        return `已将「${slide.title}」标题更新`;
      }
      case 'updateSlideIndex': {
        const idx = parseInt(action.params.index, 10) - 1;
        const slide = newOutline[idx];
        if (!slide) return null;
        if (action.params.title) slide.title = action.params.title;
        commitOutline();
        return `已更新第 ${idx + 1} 页`;
      }
      case 'addBullet': {
        const slide = newOutline.find(s => s.id === action.params.slideId);
        if (!slide) return null;
        slide.bullets.push(action.params.text || '新要点');
        commitOutline();
        return `已为「${slide.title}」添加要点`;
      }
      case 'addBulletByIndex': {
        const idx = parseInt(action.params.index, 10) - 1;
        const slide = newOutline[idx];
        if (!slide) return null;
        slide.bullets.push(action.params.text || '新要点');
        commitOutline();
        return `已为第 ${idx + 1} 页添加要点`;
      }
      case 'deleteBullet': {
        const slide = newOutline.find(s => s.id === action.params.slideId);
        if (!slide) return null;
        const bIdx = parseInt(action.params.index, 10);
        if (!isNaN(bIdx) && bIdx >= 0 && bIdx < slide.bullets.length) {
          slide.bullets.splice(bIdx, 1);
          commitOutline();
          return '已删除要点';
        }
        return null;
      }
      case 'addSlide': {
        const newSlide: SlideOutline = {
          id: `slide-${Date.now()}`,
          title: action.params.title || '新幻灯片',
          bullets: ['点击添加要点'],
          speakerNotes: '',
          visualPrompt: action.params.visualPrompt || ''
        };
        newOutline.push(newSlide);
        commitOutline();
        return `已添加新幻灯片「${newSlide.title}」`;
      }
      default:
        return null;
    }
  }

  const MAX_VERSIONS = 30;

  async function getVersions(projectId: string): Promise<VersionSnapshot[]> {
    try {
      const response = await versionApi.getAll(projectId);
      return response.success && response.data ? response.data : [];
    } catch { return []; }
  }

  async function saveVersion(projectId: string, label?: string) {
    try {
      const state = snapshotProjectState({ persistable: true });
      await versionApi.save(projectId, {
        label: label || `鐗堟湰 ${Date.now()}`,
        outline: state.outline,
        parameters: state.parameters,
        slideCount: state.designSpec?.outline?.length || state.outline.length || state.parameters.slideCount || 0,
        state
      });
    } catch { /* ignore */ }
  }

  async function restoreVersion(projectId: string, versionId: string): Promise<boolean> {
    try {
      const versions = await getVersions(projectId);
      const version = versions.find(v => v.id === versionId);
      if (!version) return false;
      const currentProject = pptProjects.value.find(project => project.id === projectId);
      if (!currentProject) return false;

      await saveVersion(projectId, '切换前自动保存');
      saveHistory();
      if (version.state) {
        const restoredState = normalizeProjectState({
          ...version.state,
          workflowActive: false,
          paused: false,
          resumeStage: null,
        });
        currentProject.state = restoredState;
        currentProject.updatedAt = Date.now();
        restoreProjectState(restoredState);
      } else {
        outline.value = version.outline.map(s => ({ ...s, bullets: [...s.bullets] }));
        parameters.value = normalizeAgentParameters(version.parameters);
        normalizeParametersAgainstConfig();
        resetDownstreamSteps('outline');
        currentProject.state = snapshotProjectState();
        currentProject.updatedAt = Date.now();
      }
      clearPauseState();
      recoveredActiveWorkflow.value = false;
      isRunning.value = false;
      currentGeneratingSlide.value = null;
      pushLog(`已切换到版本：${version.label || versionId}`);
      await syncToProject();
      return true;
    } catch { return false; }
  }

  async function deleteVersion(projectId: string, versionId: string) {
    try {
      await versionApi.delete(projectId, versionId);
    } catch { /* ignore */ }
  }

  function selectedPromptContent() {
    if (!selectedPromptId.value) return undefined;
    return prompts.value.find((item) => item.id === selectedPromptId.value)?.content || undefined;
  }

  function selectPrompt(id: string) {
    selectedPromptId.value = id;
    persistCurrentSelectionToActiveProject();
    const prompt = prompts.value.find((item) => item.id === id);
    pushLog(prompt ? `已选择提示词：${prompt.title}` : '已清空提示词选择。');
    syncToProject();
  }

  function applyPrompt(id: string) {
    const prompt = prompts.value.find((item) => item.id === id);
    if (!prompt) return;

    selectedPromptId.value = id;
    persistCurrentSelectionToActiveProject();
    pushLog(`已选择提示词：${prompt.title}，提示词将参与生成但不会写入输入框。`);
    syncToProject();
  }

  async function runStrategist(ctx: RunContext = createRunContext()) {
    if (!checkActivePpt() || !checkApiKeys()) return;
    if (!isRunContextActive(ctx)) return;

    activeStep.value = 'outline';
    setStepStatus('outline', 'running', 10);
    resetDownstreamSteps('outline');
    streamingText.value = '';
    designSpec.value = null;
    specLock.value = null;
    outline.value = [];
    images.value = [];
    svgPages.value = [];
    generatedSlides.value = new Set();
    currentGeneratingSlide.value = null;
    pushLog('正在生成大纲。');

    let streamedOutlineText = '';
    let outlineFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let lastOutlineFlushAt = 0;

    const clearOutlineFlushTimer = () => {
      if (!outlineFlushTimer) return;
      clearTimeout(outlineFlushTimer);
      outlineFlushTimer = null;
    };

    const flushStreamingOutline = () => {
      clearOutlineFlushTimer();
      if (!isRunContextActive(ctx)) return;
      lastOutlineFlushAt = Date.now();
      streamingText.value = streamedOutlineText;
      const draftOutline = parseStreamingStrategistOutline(streamedOutlineText);
      if (draftOutline.length > outline.value.length) {
        outline.value = draftOutline;
      } else if (draftOutline.length && outline.value.length === draftOutline.length) {
        outline.value = draftOutline;
      }
      const progress = Math.min(90, 20 + streamedOutlineText.length / 100);
      setStepStatus('outline', 'running', progress);
    };

    const scheduleStreamingOutlineFlush = () => {
      if (!isRunContextActive(ctx)) return;
      const elapsed = Date.now() - lastOutlineFlushAt;
      if (elapsed >= OUTLINE_STREAM_FLUSH_INTERVAL_MS) {
        flushStreamingOutline();
        return;
      }
      if (!outlineFlushTimer) {
        outlineFlushTimer = setTimeout(flushStreamingOutline, OUTLINE_STREAM_FLUSH_INTERVAL_MS - elapsed);
      }
    };

    try {
      const result = await aiApi.strategistStream(
        {
          topic: input.value.topic,
          content: generationInputContent(),
          tone: parameters.value.tone,
          summaryLength: parameters.value.summaryLength,
          slideCount: parameters.value.slideCount,
          imageStyle: parameters.value.imageStyle,
          template: selectedTemplate.value ? selectedTemplate.value.name : 'auto',
          templateAsset: selectedTemplate.value ? snapshotTemplateAsset(selectedTemplate.value) : null,
          promptContent: selectedPromptContent(),
          skills: [],
        },
        {
          onStart: (message) => {
            if (!isRunContextActive(ctx)) return;
            pushLog(message);
            setStepStatus('outline', 'running', 20);
          },
          onContent: (content) => {
            if (!isRunContextActive(ctx)) return;
            streamedOutlineText += content;
            scheduleStreamingOutlineFlush();
          },
          onOutlineSlide: (slide) => {
            if (!isRunContextActive(ctx)) return;
            const nextSlide = specSlideToOutlineSlide(slide, Math.max(0, outline.value.length));
            const existingIndex = outline.value.findIndex(item => item.id === nextSlide.id);
            if (existingIndex >= 0) {
              const nextOutline = outline.value.slice();
              nextOutline[existingIndex] = nextSlide;
              outline.value = nextOutline;
            } else {
              outline.value = [...outline.value, nextSlide];
            }
            const targetCount = parameters.value.slideCount > 0 ? parameters.value.slideCount : Math.max(outline.value.length + 1, 6);
            const progress = Math.min(90, 20 + Math.round((outline.value.length / Math.max(1, targetCount)) * 65));
            setStepStatus('outline', 'running', progress);
          },
          onComplete: (data) => {
            if (!isRunContextActive(ctx)) return;
            flushStreamingOutline();
            const parsed = data as any;
            designSpec.value = parsed.spec || null;
            specLock.value = parsed.lock || null;
            applyGeneratedProjectInfo(designSpec.value);

            if (designSpec.value) {
              outline.value = designSpec.value.outline.map((slide, index) => specSlideToOutlineSlide(slide, index));
            }

            pushLog(`大纲生成完成，共 ${outline.value.length} 页。`);
            setStepStatus('outline', 'done', 100);
            streamingText.value = '';
            void syncToProject();
          },
          onError: (message) => {
            if (!isRunContextActive(ctx)) return;
            pushLog(`大纲生成失败：${message}`);
            setStepStatus('outline', 'idle', 0);
            const toastStore = useToastStore();
            toastStore.error('大纲生成失败', message);
          },
        }
      );
      if (!isRunContextActive(ctx)) return;
      await syncToProjectNow();
    } catch (error) {
      if (!isRunContextActive(ctx)) return;
      setStepStatus('outline', 'idle', 0);
      pushLog('大纲生成失败，请检查 API Key 配置。');
      await syncToProjectNow();
      throw error;
    } finally {
      clearOutlineFlushTimer();
    }
  }

  async function runOutline() {
    await runStrategist();
  }

  function needsImageGeneration(): boolean {
    const slides = designSpec.value?.outline || outline.value;
    return slides.some((slide: any) => slideNeedsImage(slide));
  }

  async function runImages(ctx: RunContext = createRunContext()) {
    if (!checkActivePpt() || !checkApiKeys()) return false;
    if (!isRunContextActive(ctx)) return false;

    if (outline.value.length === 0) {
      await runStrategist(ctx);
    }
    if (!isRunContextActive(ctx)) return false;
    if (outline.value.length === 0) return false;

    activeStep.value = 'images';
    setStepStatus('images', 'running', 0);
    generatedSlides.value = new Set();
    waitingForImageRetry.value = false;
    pushLog('开始按需生成图片。');

    try {
      const slidesRequiringImages = slidesRequiringGeneratedImages();

      if (slidesRequiringImages.length === 0) {
        pushLog('本次不需要图片。');
        setStepStatus('images', 'done', 100);
        await syncToProjectNow();
        return true;
      }

      const existingGate = updateImageStepFromGate('running');
      const pendingSlides = slidesRequiringImages.filter((slide) => !existingGate.readySlideIds.has(slide.id));

      if (pendingSlides.length === 0) {
        pushLog('图片已完成。');
        setStepStatus('images', 'done', 100);
        await syncToProjectNow();
        return true;
      }

      const toImageRequest = (s: any) => ({
        id: s.id,
        title: s.title,
        bullets: [...(s.bullets || [])],
        speakerNotes: s.speakerNotes || '',
        visualPrompt: s.visualPrompt || [s.title, ...(s.bullets || [])].filter(Boolean).join('，'),
      });

      const runImageBatch = async (batchSlides: typeof pendingSlides, attemptLabel: 'initial' | 'retry') => {
        const baseReadyCount = imageGenerationGate().readyCount;
        await generateSlideImages(
          batchSlides.map(toImageRequest),
          parameters.value.imageStyle,
          {
            onStart: (slideId, message) => {
              if (!isRunContextActive(ctx)) return;
              currentGeneratingSlide.value = slideId;
              pushLog(message);
            },
            onComplete: (slideId, image) => {
              if (!isRunContextActive(ctx)) return;
              if (slideId === '__progress__') {
                const pendingProgress = (image as any)._progress || 0;
                const completedPending = Math.round((pendingProgress / 100) * batchSlides.length);
                const progress = Math.round(((baseReadyCount + completedPending) / slidesRequiringImages.length) * 100);
                setStepStatus('images', 'running', Math.min(99, progress));
                return;
              }
              currentGeneratingSlide.value = null;

              if (image.url || image.error) {
                upsertGeneratedImage(image);
              }

              const gate = updateImageStepFromGate('running');
              pushLog(image.error
                ? `图片未生成：${image.title}${attemptLabel === 'initial' ? '，准备自动重试。' : '，请手动重试。'}`
                : `图片完成：${image.title}，${Math.min(gate.readyCount, gate.total)}/${gate.total}`);
            },
            onError: (_slideId, message) => {
              if (!isRunContextActive(ctx)) return;
              currentGeneratingSlide.value = null;
              pushLog(`图片未生成：${message}`);
            },
            onAllComplete: () => {
              if (!isRunContextActive(ctx)) return;
              updateImageStepFromGate('running');
              syncToProject();
            }
          }
        );
      };

      await runImageBatch(pendingSlides, 'initial');
      if (!isRunContextActive(ctx)) return false;

      let gate = updateImageStepFromGate('running');
      if (!gate.complete) {
        const failedTitles = gate.missingSlides.map((slide) => slide.title).join('、');
        pushLog(`图片生成未全部成功，正在自动重试：${failedTitles}`);
        await runImageBatch(gate.missingSlides, 'retry');
        if (!isRunContextActive(ctx)) return false;
        gate = updateImageStepFromGate('idle');
      }

      if (!gate.complete) {
        const failedTitles = gate.missingSlides.map((slide) => slide.title).join('、');
        pushLog(`图片自动重试后仍未完成：${failedTitles}。请手动重试成功后再继续。`);
        activeStep.value = 'images';
        currentGeneratingSlide.value = null;
        waitingForImageRetry.value = true;
        await syncToProjectNow();
        return false;
      }

      pushLog(`图片生成完成，共 ${gate.readyCount} 张。`);
      setStepStatus('images', 'done', 100);
      if (!isRunContextActive(ctx)) return false;
      await syncToProjectNow();
      return true;
    } catch (error) {
      if (!isRunContextActive(ctx)) return false;
      setStepStatus('images', 'idle', 0);
      const errMsg = error instanceof Error ? error.message : '未知错误';
      pushLog(`图片生成失败：${errMsg}`);
      await syncToProjectNow();
      throw error;
    }
  }

  async function generateSingleSlideImageForWorkflow(
    sourceSlide: { id: string; title: string; bullets?: string[]; speakerNotes?: string; visualPrompt?: string },
    ctx: RunContext,
    options: { announce?: boolean } = {}
  ): Promise<GeneratedImage | null> {
    if (!isRunContextActive(ctx)) return null;
    currentGeneratingSlide.value = sourceSlide.id;
    if (options.announce) {
      pushLog(`重新生成图片：${sourceSlide.title}`);
    }

    try {
      const result = await generateSlideImages(
        [{
          id: sourceSlide.id,
          title: sourceSlide.title,
          bullets: [...(sourceSlide.bullets || [])],
          speakerNotes: sourceSlide.speakerNotes || '',
          visualPrompt: sourceSlide.visualPrompt || [sourceSlide.title, ...(sourceSlide.bullets || [])].filter(Boolean).join('，'),
        }],
        parameters.value.imageStyle,
        {
          onStart: (_id, message) => {
            if (!isRunContextActive(ctx)) return;
            pushLog(message);
          },
          onComplete: (id, image) => {
            if (!isRunContextActive(ctx)) return;
            if (id === '__progress__') return;
            upsertGeneratedImage(image);
            updateImageStepFromGate('idle');
            pushLog(image.error
              ? `图片未生成：${image.title}`
              : `图片完成：${image.title}`);
            syncToProject();
          },
          onError: (_id, message) => {
            if (!isRunContextActive(ctx)) return;
            pushLog(`图片未生成：${message}`);
          },
          onAllComplete: () => {},
        },
        1
      );
      if (!isRunContextActive(ctx)) return null;
      return result[0] || null;
    } finally {
      if (isRunContextActive(ctx)) currentGeneratingSlide.value = null;
    }
  }

  async function retrySlideImage(slideId: string, ctx: RunContext = createRunContext()) {
    if (!checkActivePpt() || !checkApiKeys()) return;
    if (!isRunContextActive(ctx)) return;

    const sourceSlide = (designSpec.value?.outline || outline.value).find((slide: any) => slide.id === slideId) as any;
    if (!sourceSlide) return;
    const shouldResumeWorkflowWhenReady = waitingForImageRetry.value && activeStep.value === 'images';
    waitingForImageRetry.value = shouldResumeWorkflowWhenReady;

    activeStep.value = 'images';

    try {
      const image = await generateSingleSlideImageForWorkflow(sourceSlide, ctx, { announce: true });
      if (!isRunContextActive(ctx)) return;

      if (image?.error || !image?.url) {
        pushLog(`图片仍未生成：${sourceSlide.title}`);
      } else {
        pushLog(`图片重试成功：${sourceSlide.title}`);
      }
      const gate = updateImageStepFromGate('idle');
      await syncToProjectNow();

      if (shouldResumeWorkflowWhenReady && gate.complete) {
        waitingForImageRetry.value = false;
        currentGeneratingSlide.value = null;
        pushLog('图片已全部生成，继续生成页面。');
        await runFullWorkflow({ resume: true });
      }
    } catch (error) {
      if (!isRunContextActive(ctx)) return;
      const errMsg = error instanceof Error ? error.message : '未知错误';
      pushLog(`图片重试失败：${errMsg}`);
      syncToProject();
      throw error;
    }
  }

  async function ensureExecutorImageUrl(image: GeneratedImage | undefined): Promise<string | undefined> {
    if (!image?.url || image.error) return undefined;
    if (/^https?:\/\//i.test(image.url)) return image.url;
    if (!image.url.startsWith('data:image/')) return undefined;

    const response = await aiApi.persistGeneratedImage({
      slideId: image.slideId,
      imageUrl: image.url,
    });
    if (response.success && response.data?.url) {
      image.url = response.data.url;
      syncToProject();
      return response.data.url;
    }
    pushLog(`图片保存失败：${image.title}`);
    return undefined;
  }

  function findReadySlideImage(slideId: string) {
    return images.value.find(img =>
      img.slideId === slideId &&
      img.selected &&
      !img.error &&
      Boolean(img.url)
    );
  }

  async function ensureSlideImageForLayout(slide: SpecSlide, ctx: RunContext): Promise<string | undefined> {
    if (!slideNeedsImage(slide)) return undefined;

    const existingUrl = await ensureExecutorImageUrl(findReadySlideImage(slide.id));
    if (existingUrl) return existingUrl;
    if (!isRunContextActive(ctx)) return undefined;

    pushLog(`第 ${slide.pageNumber} 页缺少可用图片，正在自动重试图片生成。`);
    const image = await generateSingleSlideImageForWorkflow(slide, ctx);
    if (!isRunContextActive(ctx)) return undefined;

    const retryUrl = await ensureExecutorImageUrl(image || findReadySlideImage(slide.id));
    if (retryUrl) {
      pushLog(`第 ${slide.pageNumber} 页图片自动重试成功，继续生成页面。`);
      return retryUrl;
    }

    activeStep.value = 'images';
    waitingForImageRetry.value = true;
    updateImageStepFromGate('idle');
    await syncToProjectNow();
    throw new MissingSlideImageError(slide.pageNumber, slide.title);
  }

  async function generateSlideSvg(slide: SpecSlide, ctx: RunContext): Promise<string> {
    const imageUrl = await ensureSlideImageForLayout(slide, ctx);
    if (!isRunContextActive(ctx)) return '';

    const spec = designSpec.value!;
    const lock = specLock.value!;
    const slimSpec = {
      projectInfo: spec.projectInfo,
      canvas: spec.canvas,
      visualTheme: spec.visualTheme,
      typography: spec.typography,
      iconStyle: spec.iconStyle,
      imageUsage: spec.imageUsage,
      outline: [],
      skillExtensions: [],
    };
    const pageKey = `P${String(slide.pageNumber).padStart(2, '0')}`;
    const slimLock = {
      colors: lock.colors,
      typography: lock.typography,
      iconStyle: lock.iconStyle,
      imageStyle: lock.imageStyle,
      canvas: lock.canvas,
      pageRhythm: { [pageKey]: lock.pageRhythm[pageKey] },
      pageLayouts: { [pageKey]: lock.pageLayouts[pageKey] },
      pageCharts: lock.pageCharts[pageKey] ? { [pageKey]: lock.pageCharts[pageKey] } : {},
      skillExtensions: [],
      forbidden: (lock as any).forbidden || [
        '<style>',
        'class',
        '<foreignObject>',
        '<mask>',
        'rgba()',
        '@font-face',
        '<animate>',
        '<script>',
        'gradient'
      ],
    };

    let svg = '';
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        svg = await aiApi.executorPageStream(
          { spec: slimSpec as any, lock: slimLock as any, slide, imageUrl },
          {
            onStart: () => {},
            onContent: () => {},
            onComplete: () => {},
            onError: (message) => {
              if (!isRunContextActive(ctx)) return;
              pushLog(`第 ${slide.pageNumber} 页 API 错误：${message}`);
            },
          }
        );
        if (!isRunContextActive(ctx)) return '';

        if (!svg || !svg.includes('<svg') || !svg.includes('</svg>')) {
          throw new Error('AI 返回的 SVG 内容不完整');
        }
        return svg;
      } catch (error) {
        if (!isRunContextActive(ctx)) return '';
        lastError = error;
        if (attempt < 3) {
          pushLog(`第 ${slide.pageNumber} 页生成不完整，正在重试。`);
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('AI 返回的 SVG 内容无效');
  }

  async function runExecutor(options: { resume?: boolean; embedded?: boolean; ctx?: RunContext } = {}) {
    if (!checkActivePpt()) return;
    const ctx = options.ctx || createRunContext();
    if (!isRunContextActive(ctx)) return;

    if (!designSpec.value || !specLock.value) {
      await runStrategist(ctx);
    }
    if (!isRunContextActive(ctx)) return;
    if (!designSpec.value || !specLock.value) return;

    activeStep.value = 'layout';
    if (!options.embedded) {
      isRunning.value = true;
    }
    setStepStatus('layout', 'running', 5);
    pushLog('开始生成页面。');
    if (!options.resume) {
      svgPages.value = [];
      executorCursor.value = 0;
    }

    try {
      const spec = designSpec.value;
      if (!spec) return;
      const totalPages = spec.outline.length;
      const startIndex = options.resume
        ? Math.min(Math.max(executorCursor.value || svgPages.value.length, 0), totalPages)
        : 0;

      let nextIndex = startIndex;
      let completedPages = startIndex;
      let stopLayoutWorkers = false;

      async function runNextPage() {
        if (!isRunContextActive(ctx) || stopLayoutWorkers) return;
        const i = nextIndex;
        nextIndex += 1;
        if (i >= totalPages) return;

        const slide = spec.outline[i];
        const progress = Math.round((completedPages / totalPages) * 100);
        setStepStatus('layout', 'running', progress);
        pushLog(`正在生成第 ${slide.pageNumber} 页：${slide.title}`);

        try {
          const svg = await generateSlideSvg(slide, ctx);
          if (!isRunContextActive(ctx)) return;

          upsertSvgPage({
            pageNumber: slide.pageNumber,
            svg,
            speakerNotes: slide.speakerNotes,
          });

          pushLog(`第 ${slide.pageNumber} 页生成完成。`);
        } catch (pageError) {
          if (isMissingSlideImageError(pageError)) {
            stopLayoutWorkers = true;
            activeStep.value = 'images';
            waitingForImageRetry.value = true;
            currentGeneratingSlide.value = null;
            updateImageStepFromGate('idle');
            pushLog(pageError.message);
            await syncWorkflowProgress(true);
            throw pageError;
          }

          const errMsg = pageError instanceof Error ? pageError.message : '未知错误';
          pushLog(`第 ${slide.pageNumber} 页生成失败（${errMsg}），已标记待重试。`);
          upsertSvgPage({
            pageNumber: slide.pageNumber,
            svg: buildFallbackSvg(slide),
            speakerNotes: slide.speakerNotes,
          });
        }

        completedPages += 1;
        executorCursor.value = completedLeadingLayoutPages(totalPages);
        setStepStatus('layout', 'running', Math.min(99, Math.round((completedPages / totalPages) * 100)));
        await syncWorkflowProgress(false);
        if (shouldPauseAt('layout')) {
          stopLayoutWorkers = true;
          return;
        }
        await runNextPage();
      }

      const workerCount = Math.min(LAYOUT_GENERATION_CONCURRENCY, Math.max(1, totalPages - startIndex));
      await Promise.all(Array.from({ length: workerCount }, () => runNextPage()));
      if (!isRunContextActive(ctx)) return;
      if (shouldPauseAt('layout')) {
        await syncWorkflowProgress(true);
        return;
      }

      executorCursor.value = totalPages;
      setStepStatus('layout', 'done', 100);
      pushLog('页面生成完成。');
      await syncWorkflowProgress(true);
    } catch (error) {
      if (!isRunContextActive(ctx)) return;
      if (isMissingSlideImageError(error)) {
        activeStep.value = 'images';
        waitingForImageRetry.value = true;
        currentGeneratingSlide.value = null;
        updateImageStepFromGate('idle');
        pushLog('页面生成已暂停，请先完成缺失图片后再继续。');
        const toastStore = useToastStore();
        toastStore.warning('等待图片生成', error.message);
        await syncToProjectNow();
        return;
      }

      setStepStatus('layout', 'idle', 0);
      const errMsg = error instanceof Error ? error.message : '页面生成失败';
      pushLog(`页面生成失败：${errMsg}`);
      const toastStore = useToastStore();
      toastStore.error('页面生成失败', errMsg);
      throw error;
    } finally {
      if (isRunContextActive(ctx) && !options.embedded && !isPaused.value) {
        isRunning.value = false;
      }
    }
  }

  async function retrySlidePage(pageNumber: number) {
    if (!checkActivePpt() || !checkApiKeys() || !designSpec.value || !specLock.value) return;
    if (retryingPageNumbers.value.has(pageNumber)) return;
    const takeover = takeoverPendingLayoutPauseForRetry(pageNumber);
    if (!takeover.allowed) return;
    const ctx = createRunContext();
    const slide = designSpec.value.outline.find(item => item.pageNumber === pageNumber);
    if (!slide) return;
    retryingPageNumbers.value = new Set([...retryingPageNumbers.value, pageNumber]);
    let shouldContinueAfterRetry = false;

    activeStep.value = 'layout';
    setStepStatus('layout', 'running', Math.round(((pageNumber - 1) / Math.max(1, designSpec.value.outline.length)) * 100));
    pushLog(`重新生成第 ${pageNumber} 页：${slide.title}`);

    try {
      const svg = await generateSlideSvg(slide, ctx);
      if (!isRunContextActive(ctx)) return;
      const page = { pageNumber: slide.pageNumber, svg, speakerNotes: slide.speakerNotes };
      const existingPageIndex = svgPages.value.findIndex(item => item.pageNumber === page.pageNumber);
      if (existingPageIndex >= 0) {
        svgPages.value[existingPageIndex] = page;
      } else {
        svgPages.value.push(page);
      }
      sortSvgPagesByPageNumber();
      updateLayoutStepAfterPageRetry();
      pushLog(`第 ${pageNumber} 页已重新生成。`);
      await syncToProjectNow();
      shouldContinueAfterRetry = takeover.shouldResumeAfterRetry && hasPendingLayoutPages();
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '未知错误';
      if (takeover.shouldResumeAfterRetry) {
        markPaused('layout');
      } else {
        updateLayoutStepAfterPageRetry();
      }
      pushLog(`第 ${pageNumber} 页重试失败：${errMsg}`);
      await syncToProjectNow();
    } finally {
      const nextRetrying = new Set(retryingPageNumbers.value);
      nextRetrying.delete(pageNumber);
      retryingPageNumbers.value = nextRetrying;
    }

    if (shouldContinueAfterRetry) {
      clearPauseState();
      await runFullWorkflow({ resume: true });
    } else if (takeover.shouldResumeAfterRetry && !hasPendingLayoutPages()) {
      clearPauseState();
      activeStep.value = 'preview';
      await finishGenerationJob();
      await syncToProjectNow();
    }
  }

  function buildFallbackSvg(slide: SpecSlide): string {
    const spec = designSpec.value;
    if (!spec) return '';
    const { canvas, visualTheme, typography } = spec;
    const { colors } = visualTheme;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}" width="${canvas.width}" height="${canvas.height}">
  <rect width="${canvas.width}" height="${canvas.height}" fill="${colors.background}"/>
  <rect x="72" y="72" width="${canvas.width - 144}" height="${canvas.height - 144}" rx="18" fill="${colors.surface}" stroke="${colors.border}" stroke-width="2"/>
  <circle cx="132" cy="132" r="18" fill="${colors.accent}"/>
  <text x="132" y="139" font-size="22" fill="${colors.surface}" text-anchor="middle" font-family="${typography.titleFamily}" font-weight="bold">!</text>
  <text x="172" y="126" font-size="${typography.subtitleSize}" fill="${colors.text}" font-family="${typography.titleFamily}" font-weight="bold">本页待重试</text>
  <text x="172" y="160" font-size="${typography.annotationSize}" fill="${colors.muted}" font-family="${typography.bodyFamily}">第 ${slide.pageNumber} 页生成失败，不作为最终页面风格参考</text>
  <text x="96" y="${canvas.height - 118}" font-size="${typography.bodySize}" fill="${colors.text}" font-family="${typography.bodyFamily}" font-weight="bold">${slide.title}</text>
  <rect x="96" y="${canvas.height - 96}" width="160" height="4" fill="${colors.accent}"/>
</svg>`;
  }

  async function runLayout() {
    const imageGate = updateImageStepFromGate('idle');
    if (imageGate.total > 0 && !imageGate.complete) {
      activeStep.value = 'images';
      waitingForImageRetry.value = true;
      pushLog('仍有图片未生成成功，请先完成图片后再生成页面。');
      await syncToProjectNow();
      return;
    }

    const totalPages = designSpec.value?.outline.length || outline.value.length || parameters.value.slideCount;
    const hasPartialPages = svgPages.value.length > 0 && svgPages.value.length < totalPages;
    await runExecutor({ resume: hasPartialPages || executorCursor.value > 0 });
  }

  async function runSkills() {
    if (!checkActivePpt()) return;
    if (outline.value.length === 0) return;

    const activeSkills = enabledSkills.value;
    if (activeSkills.length === 0) {
      pushLog('本次未选择 Skill，跳过。');
      return;
    }

    const effectiveSkillIntensity = parameters.value.skillIntensity > 0 ? parameters.value.skillIntensity : 70;
    const intensityLabel = parameters.value.skillIntensity > 0 ? `${effectiveSkillIntensity}%` : 'AI 自动';
    pushLog(`开始执行本次选择的 ${activeSkills.length} 个 Skill（强度 ${intensityLabel}）。`);

    for (const skill of activeSkills) {
      pushLog(`执行 Skill：${skill.name}`);

      try {
        const slidesData = outline.value.map(s => ({
          id: s.id,
          title: s.title,
          bullets: [...s.bullets],
          speakerNotes: s.speakerNotes || ''
        }));

        const result = await aiApi.runSkillStream(
          {
            skillId: skill.id,
            skillName: skill.name,
            slides: slidesData,
            params: skill.params,
            intensity: effectiveSkillIntensity
          },
          {
            onStart: (message) => {
              pushLog(`    ${message}`);
            },
            onContent: () => {},
            onComplete: () => {
              pushLog(`Skill ${skill.name} AI 处理完成。`);
            },
            onError: (message) => {
              pushLog(`Skill ${skill.name} 执行失败：${message}`);
            }
          }
        );

        if (result?.result && Array.isArray(result.result)) {
          const resultMap = new Map(result.result.map((item: any) => [item.slideId, item]));

          outline.value = outline.value.map(slide => {
            const aiResult = resultMap.get(slide.id);
            if (!aiResult) return slide;

            saveHistory();
            const updated = { ...slide };

            if (aiResult.speakerNotes && typeof aiResult.speakerNotes === 'string') {
              updated.speakerNotes = aiResult.speakerNotes;
            }

            if (aiResult.chartHint && typeof aiResult.chartHint === 'string') {
              updated.chartHint = aiResult.chartHint;
            }

            if (aiResult.title && typeof aiResult.title === 'string') {
              updated.title = aiResult.title;
            }

            if (aiResult.bullets && Array.isArray(aiResult.bullets)) {
              updated.bullets = aiResult.bullets;
            }

            if (aiResult.summary && typeof aiResult.summary === 'string') {
              const existing = updated.speakerNotes || '';
              updated.speakerNotes = existing
                ? `${existing}\n\n[智能摘要] ${aiResult.summary}`
                : `[智能摘要] ${aiResult.summary}`;
            }

            return updated;
          });
        }

        pushLog(`Skill ${skill.name} 执行完成。`);
      } catch (error) {
        pushLog(`Skill ${skill.name} 执行异常：${error instanceof Error ? error.message : '未知错误'}`);
      }

      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }

    pushLog(`Skill 链路完成，共处理 ${activeSkills.length} 个 Skill。`);
    syncToProject();
  }

  async function runFullWorkflow(options: { resume?: boolean } = {}) {
    const toastStore = useToastStore();

    if (!options.resume) {
      try {
        await runInputStage();
      } catch {
        activeStep.value = 'input';
        return;
      }
      const inputFailed = inputProcessSteps.value.some((step) => step.status === 'failed');
      if (!activePpt.value || inputFailed || activeStep.value !== 'outline') return;
    } else if (!activePpt.value) {
      const ready = await ensureInputProject();
      if (!ready) return;
    }

    if (!checkApiKeys()) return;

    if (isRunning.value) {
      toastStore.warning('正在生成', '请等待当前任务完成');
      return;
    }

    isRunning.value = true;
    const ctx = createRunContext();
    if (!options.resume) {
      clearPauseState();
      executorCursor.value = 0;
    }

    try {
      resetDownstreamSteps('outline');
      activeStep.value = 'outline';
      setStepStatus('outline', 'running', 5);
      toastStore.info('开始生成 PPT', '服务端任务已提交，正在排队处理。');
      pushLog('服务端生成任务已提交。');

      const response = await aiApi.createGenerateJob({
        projectId: activePpt.value!.id,
        title: activePpt.value!.title,
        input: {
          topic: input.value.topic,
          content: generationInputContent(),
          tone: parameters.value.tone,
          summaryLength: parameters.value.summaryLength,
          slideCount: parameters.value.slideCount,
          imageStyle: parameters.value.imageStyle,
          template: selectedTemplate.value ? selectedTemplate.value.name : 'auto',
          templateAsset: selectedTemplate.value ? snapshotTemplateAsset(selectedTemplate.value) : null,
          promptContent: selectedPromptContent(),
          skills: [],
        },
        projectState: snapshotProjectState({ persistable: true }),
        includeImages: true,
      });

      if (!response.success || !response.data) {
        throw new Error(response.message || '创建服务端生成任务失败');
      }

      if (pauseRequested.value || isPaused.value || !isRunContextActive(ctx)) {
        await aiApi.cancelQueueJob(response.data.id).catch((error) => console.warn('取消队列任务失败', error));
        if (response.data.dbJobId) {
          await generationJobApi.cancel(response.data.dbJobId).catch((error) => console.warn('取消生成任务记录失败', error));
        }
        if (!isPaused.value) markPaused(activeStep.value);
        return;
      }

      activeQueueJobId.value = response.data.id;
      activeGenerationJobId.value = response.data.dbJobId || null;
      const finalJob = await aiApi.waitForQueueJob(response.data.id, (job) => {
        if (!isRunContextActive(ctx)) return;
        if (job.status === 'cancelled') return;
        pushLog(job.message || `任务进度：${job.phase}`);
        if (job.phase === 'outline' || job.phase === 'starting' || job.phase === 'queued') {
          activeStep.value = 'outline';
          setStepStatus('outline', 'running', Math.min(99, job.progress));
        } else if (job.phase === 'images') {
          activeStep.value = 'images';
          setStepStatus('outline', 'done', 100);
          setStepStatus('images', 'running', Math.min(99, job.progress));
          if (job.result) {
            try {
              applyQueuedGenerationResult(job.result, { phase: 'images', progress: job.progress });
            } catch {
              // 图片阶段可能只有消息，没有完整结果。
            }
          }
        } else if (job.phase === 'layout') {
          activeStep.value = 'layout';
          setStepStatus('outline', 'done', 100);
          setStepStatus('images', 'done', 100);
          setStepStatus('layout', 'running', Math.min(99, job.progress));
          if (job.result) {
            try {
              applyQueuedGenerationResult(job.result, { phase: 'layout', progress: job.progress });
              setStepStatus('layout', 'running', Math.min(99, job.progress));
            } catch {
              // Partial results may be incomplete while the job is running.
            }
          }
        }
      });

      if (!isRunContextActive(ctx)) return;
      applyQueuedGenerationResult(finalJob.result, { final: true });
      activeStep.value = 'preview';
      clearPauseState();
      activeQueueJobId.value = null;
      activeGenerationJobId.value = null;
      await syncToProjectNow();

      toastStore.success('PPT 生成完成', '可以在预览区查看结果');
    } catch (error) {
      if (!isRunContextActive(ctx)) return;
      const errMsg = error instanceof Error ? error.message : '未知错误';
      if (pauseRequested.value || errMsg === '任务已取消') {
        markPaused(activeStep.value);
        return;
      }
      if (isBlockingImageGenerationError(error)) {
        activeStep.value = 'images';
        waitingForImageRetry.value = true;
        currentGeneratingSlide.value = null;
        updateImageStepFromGate('idle');
        pushLog(`图片未全部生成：${errMsg}`);
        await failGenerationJob(error);
        await syncToProjectNow();
        toastStore.warning('等待图片生成', errMsg);
        return;
      }

      pushLog(`PPT 生成失败：${errMsg}`);
      await failGenerationJob(error);
      syncToProject();
      toastStore.error('PPT 生成失败', errMsg);
    } finally {
      if (isRunContextActive(ctx) && !isPaused.value) {
        isRunning.value = false;
        runningProjectId.value = null;
        activeQueueJobId.value = null;
      }
      if (isRunContextActive(ctx)) {
        streamingText.value = '';
        currentGeneratingSlide.value = null;
      }
    }
  }

  async function exportCurrentDeck(format: 'pptx' | 'pdf') {
    if (!checkActivePpt()) return;

    const toastStore = useToastStore();

    if (outline.value.length === 0) {
      await runFullWorkflow();
    }
    if (outline.value.length === 0) return;

    activeStep.value = 'preview';
    setStepStatus('preview', 'running', 40);
    pushLog(`开始导出 ${format.toUpperCase()}。`);

    try {
      let artifact: ExportArtifact;

      if (format === 'pptx') {
        const currentProject = activePpt.value;
        if (!currentProject || svgPages.value.length === 0 || !designSpec.value) {
          throw new Error('请先生成 PPT 页面后再导出可编辑 PPTX');
        }

        const response = await aiApi.createExportPptxJob({
          projectId: currentProject.id,
          title: currentProject.title,
          pages: svgPages.value.map(p => ({ pageNumber: p.pageNumber, svg: p.svg, speakerNotes: p.speakerNotes })),
          spec: designSpec.value,
          lock: specLock.value || undefined
        });
        if (!response.success || !response.data) {
          throw new Error(response.message || '创建导出任务失败');
        }
        const finalJob = await aiApi.waitForQueueJob(response.data.id, (job) => {
          pushLog(job.message || `导出进度：${job.progress}%`);
          setStepStatus('preview', 'running', Math.max(40, Math.min(99, job.progress)));
        });
        const fileName = await aiApi.downloadExportJob(finalJob.id);
        artifact = {
          format,
          name: fileName,
          status: 'ready'
        };
      } else {
        artifact = await exportDeck(format);
      }
      exportArtifacts.value = [artifact, ...exportArtifacts.value.filter((item) => item.format !== format)];
      setStepStatus('preview', 'done', 100);
      pushLog(`${artifact.name} 已准备好。`);
      toastStore.success('导出成功', `${artifact.name} 已准备好`);
    } catch (error) {
      setStepStatus('preview', 'idle', 0);
      const errMsg = error instanceof Error ? error.message : '未知错误';
      pushLog(`导出失败：${errMsg}`);
      syncToProject();
      toastStore.error('导出失败', errMsg);
      throw error;
    }
  }

  function toggleSkill(id: string) {
    const skill = skills.value.find((item) => item.id === id);
    if (skill) {
      skill.enabled = !skill.enabled;
      pushLog(`${skill.name} 已${skill.enabled ? '加入本次输入处理' : '从本次输入处理移除'}。`);
      syncToProject();
    }
  }

  function selectImage(imageId: string) {
    const target = images.value.find((image) => image.id === imageId);
    if (!target) return;
    images.value = images.value.map((image) =>
      image.slideId === target.slideId ? { ...image, selected: image.id === imageId } : image
    );
    pushLog(`已选择插图：${target.title}`);
    syncToProject();
  }

  async function attachFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    input.value.files = fileList.map((file) => file.name);
    const parsedFiles: UploadedFileContent[] = [];
    const skippedFiles: string[] = [];

    for (const file of fileList) {
      const isTextFile = file.type.startsWith('text/') || TEXT_FILE_PATTERN.test(file.name);
      const isDocxFile = DOCX_FILE_PATTERN.test(file.name);
      if (!isTextFile && !isDocxFile) {
        skippedFiles.push(file.name);
        continue;
      }

      try {
        const text = isDocxFile ? await readDocxText(file) : await file.text();
        const clippedText = text.length > MAX_FILE_TEXT_CHARS
          ? `${text.slice(0, MAX_FILE_TEXT_CHARS)}\n\n[文件内容较长，已截取前 ${MAX_FILE_TEXT_CHARS} 字符]`
          : text;
        if (clippedText.trim()) {
          parsedFiles.push({ name: file.name, text: clippedText.trim() });
        }
      } catch {
        skippedFiles.push(file.name);
      }
    }

    uploadedFileContents.value = parsedFiles;
    processedInputContent.value = '';

    pushLog(parsedFiles.length > 0
      ? `已读取 ${parsedFiles.length} 个资料文件，文件正文将进入输入阶段处理流。`
      : `已记录 ${input.value.files.length} 个资料文件。`);

    if (skippedFiles.length > 0) {
      pushLog(`以下文件暂未解析正文：${skippedFiles.join('、')}。`);
    }

    syncToProject();
  }

  async function fetchPrompts() {
    try {
      const response = await promptApi.getAll();
      if (response.success && response.data && response.data.length > 0) {
        const apiBaseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
        const resolvePreviewUrl = (url?: string | null) => {
          if (!url) return '';
          if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
          if (url.startsWith('/generated-images/')) return `${apiBaseUrl}${url}`;
          return url;
        };
        prompts.value = response.data.map((p: any) => ({
          id: String(p.id),
          title: p.title,
          scene: p.scene || '',
          content: p.content,
          previewUrl: resolvePreviewUrl(p.preview_url),
          updatedAt: new Date(p.updated_at || p.created_at).getTime()
        }));
      }
    } catch (error) {
      console.error('加载提示词失败，使用默认数据:', error);
    }
  }

  async function fetchSkills() {
    try {
      const response = await skillApi.getAll();
      if (response.success && response.data) {
        const selectedSkillIds = new Set(skills.value.filter((skill) => skill.enabled).map((skill) => skill.id));
        skills.value = response.data.map((s: any, index: number) => ({
          id: String(s.id),
          name: s.name,
          description: s.description || '',
          enabled: selectedSkillIds.has(String(s.id)),
          order: index + 1,
          params: s.parameters || {},
          instruction: s.parameters?.instruction || '',
          category: normalizeInputSkillCategory(s.category),
          type: s.type || 'prompt-only',
          runtime: s.runtime || 'prompt-only',
          entry: s.entry || null,
          installStatus: s.install_status || 'not_required',
          installLog: s.install_log || '',
          dependencyFile: s.dependency_file || null
        }));
      }
    } catch (error) {
      console.error('加载 Skill 失败，使用默认数据:', error);
    }
  }

  async function fetchTemplates() {
    try {
      const response = await templateApi.getAll();
      if (response.success && response.data && response.data.length > 0) {
        templates.value = response.data.map((t: any) => ({
          id: String(t.id),
          name: t.name,
          category: t.category || '',
          description: t.description || '',
          slideCount: t.slide_count || 10,
          accent: t.accent || '#334155',
          settings: normalizeTemplateSettings(t.settings, {
            id: String(t.id),
            name: t.name,
            category: t.category || '',
            description: t.description || '',
            slideCount: t.slide_count || 10,
            accent: t.accent || '#334155'
          })
        }));
      }
    } catch (error) {
      console.error('加载模板失败，使用默认数据', error);
    }
  }

  async function fetchConfigs() {
    try {
      let response = await configApi.getAll();
      if (response.success && (!response.data || response.data.length === 0)) {
        response = await configApi.reset();
      }

      if (response.success && response.data) {
        configRecords.value = response.data.reduce<Partial<Record<ConfigOptionKey, RunConfig>>>((records, config) => {
          if (CONFIG_KEYS.includes(config.key as ConfigOptionKey)) {
            records[config.key as ConfigOptionKey] = config;
          }
          return records;
        }, {});
        configOptions.value = normalizeRunConfigGroups(response.data);
      } else {
        configOptions.value = cloneConfigOptions();
      }
    } catch (error) {
      console.error('加载运行配置失败，使用默认数据:', error);
      configOptions.value = cloneConfigOptions();
    } finally {
      normalizeParametersAgainstConfig();
    }
  }

  async function fetchPptProjects() {
    try {
      const response = await projectApi.getAll();
      if (response.success && response.data) {
        const remoteProjects: PptProject[] = response.data.map((project: any) => {
          const projectState = project.state
            ? (typeof project.state === 'string' ? JSON.parse(project.state) : project.state)
            : null;

          return {
            id: String(project.id),
            title: project.title || '未命名 PPT',
            topic: project.topic || '',
            description: project.content || '',
            templateId: 'auto',
            createdAt: new Date(project.created_at).getTime(),
            updatedAt: new Date(project.updated_at).getTime(),
            state: projectState || makeDefaultProjectState(),
          };
        });
        pptProjects.value = mergePptProjects([...remoteProjects, ...pptProjects.value], activePptId.value);
      }
    } catch (error) {
      console.error('加载 PPT 项目失败:', error);
    }
  }

  function applyGalleryTemplate(template: Partial<PptTemplate & TemplateAsset> & { id: number | string; name: string }) {
    const templateAsset = toTemplateAsset(template);

    if (activePpt.value) {
      selectedTemplate.value = templateAsset;
      persistCurrentSelectionToActiveProject();
    } else {
      const toastStore = useToastStore();
      toastStore.info('请先选择 PPT 项目', '模板方案只会应用到当前 PPT。');
      return;
    }

    pushLog(`已应用模板方案：${templateAsset.name}`);
    syncToProject();
  }

  function clearGalleryTemplate() {
    selectedTemplate.value = null;
    persistCurrentSelectionToActiveProject();
    if (activePpt.value) {
      activePpt.value.templateId = 'auto';
      activePpt.value.updatedAt = Date.now();
    }
    pushLog('已清除模板方案。');
    syncToProject();
  }

  async function saveWorkflow() {
    const toastStore = useToastStore();
    try {
      // Save current state into active project before persisting
      if (activePpt.value) {
        activePpt.value.state = snapshotProjectState();
        activePpt.value.updatedAt = Date.now();
        // Save version snapshot
        saveVersion(activePpt.value.id, '手动保存');
      }

      const snapshotData = {
        input: { ...input.value, files: [...input.value.files] },
        parameters: { ...parameters.value },
        outline: outline.value.map(s => ({ ...s })),
        images: images.value.map(img => ({ ...img, url: img.url?.startsWith('data:') ? '' : img.url })),
        skills: skills.value.map(s => ({ ...s, params: { ...s.params } })),
        pptProjects: pptProjects.value.map(p => ({
          ...p,
          state: {
            ...p.state,
            input: { ...p.state.input, files: [...(p.state.input?.files || [])] },
            images: (p.state.images || []).map(img => ({ ...img, url: img.url?.startsWith('data:') ? '' : img.url })),
        svgPages: (p.state.svgPages || []).map(page => ({
          pageNumber: page.pageNumber,
          svg: page.svg,
          speakerNotes: page.speakerNotes
        }))
          }
        })),
        activePptId: activePptId.value,
        steps: steps.value.map(s => ({ ...s })),
        savedAt: Date.now()
      };
      const response = await workflowApi.save(snapshotData);
      if (response.success) {
        toastStore.success('保存成功', '工作流数据已保存');
      } else {
        toastStore.error('保存失败', response.message || '保存工作流数据失败');
      }
    } catch (error) {
      toastStore.error('保存失败', '工作流数据保存失败');
    }
  }

  async function restoreWorkflow(): Promise<boolean> {
    try {
      const response = await workflowApi.restore();
      if (!response.success || !response.data?.snapshotData) return false;
      const snapshot = response.data.snapshotData;
      input.value = { ...snapshot.input, files: [...(snapshot.input?.files || [])] };
      parameters.value = normalizeAgentParameters(snapshot.parameters);
      normalizeParametersAgainstConfig();
      outline.value = snapshot.outline || [];
      images.value = snapshot.images || [];
      skills.value = snapshot.skills || cloneSkills();
      const restoredProjects = (snapshot.pptProjects || []).map((p: any) => ({
        ...p,
        id: String(p.id),
        state: p.state ? {
          ...p.state,
          input: { ...p.state.input, files: [...(p.state.input?.files || [])] }
        } : makeDefaultProjectState()
      }));
      pptProjects.value = mergePptProjects([...pptProjects.value, ...restoredProjects], snapshot.activePptId || activePptId.value);
      activePptId.value = snapshot.activePptId || null;
      const restoredSteps = (snapshot.steps || cloneSteps()).map((s: WorkflowStep) => ({
        ...s,
        status: s.status === 'running' ? 'idle' : s.status,
        progress: s.status === 'running' ? 0 : s.progress,
      }));
      const currentStepIds = new Set(workflowSteps.map(s => s.id));
      const restoredStepIds = new Set(restoredSteps.map((s: any) => s.id));
      if ([...currentStepIds].every(id => restoredStepIds.has(id))) {
        steps.value = restoredSteps;
      } else {
        steps.value = workflowSteps.map(s => {
          const existing = restoredSteps.find((rs: any) => rs.id === s.id);
          return existing || { ...s };
        });
      }

      // Restore active project state into global refs
      if (activePpt.value) {
        restoreProjectState(activePpt.value.state);
      }

      isRunning.value = false;
      streamingText.value = '';
      currentGeneratingSlide.value = null;

      return true;
    } catch {
      return false;
    }
  }

  async function hasSavedWorkflow(): Promise<boolean> {
    try {
      const response = await workflowApi.restore();
      return response.success && !!response.data?.snapshotData;
    } catch {
      return false;
    }
  }

  async function clearSavedWorkflow() {
    try {
      await workflowApi.clear();
    } catch {}
  }

  async function initializeData() {
    await fetchPptProjects();
    await fetchConfigs();
    const restored = await restoreWorkflow();
    await Promise.all([fetchPrompts(), fetchSkills(), fetchTemplates()]);
    await fetchPptProjects();
    if (activePpt.value?.state) {
      restoreProjectState(activePpt.value.state);
    }
    isDataLoaded.value = true;
    if (restored) {
      pushLog('已恢复上次保存的工作流数据。');
    }
  }

  return {
    activeStep,
    activeStepMeta,
    input,
    parameters,
    steps,
    outline,
    images,
    selectedImages,
    skills,
    enabledSkills,
    prompts,
    inputProcessSteps,
    pptProjects,
    templates,
    selectedTemplate,
    activePptId,
    activePpt,
    exportArtifacts,
    activityLog,
    isRunning,
    isPaused,
    pauseRequested,
    resumeStage,
    executorCursor,
    streamingText,
    designSpec,
    specLock,
    svgPages,
    configOptions,
    selectedPromptId,
    currentGeneratingSlide,
    generatedSlides,
    isDataLoaded,
    addPptProject,
    addPptProjectPersisted,
    updatePptProject,
    deletePptProject,
    selectPptProject,
    addSkill,
    updateSkill,
    deleteSkill,
    addPrompt,
    updatePrompt,
    deletePrompt,
    selectPrompt,
    applyPrompt,
    attachFiles,
    exportCurrentDeck,
    runFullWorkflow,
    runInputStage,
    setConfigOptionValue,
    addConfigOption,
    updateConfigOption,
    deleteConfigOption,
    requestPauseWorkflow,
    continueWorkflow,
    resumeRecoveredWorkflow,
    runImages: () => runImages(),
    retrySlideImage,
    retrySlidePage,
    retryingPageNumbers,
    runLayout,
    runOutline,
    runSkills,
    selectImage,
    toggleSkill,
    setSlideLayout,
    updateSlideTitle,
    reorderOutline,
    updateSlideBullet,
    addSlideBullet,
    deleteSlideBullet,
    reorderBullet,
    updateSlideNotes,
    updateSlideVisualPrompt,
    reorderSkills,
    globalSearch,
    saveHistory,
    undoOutline,
    redoOutline,
    canUndo,
    canRedo,
    executeChatAction,
    getVersions,
    saveVersion,
    restoreVersion,
    deleteVersion,
    historyPast,
    fetchPrompts,
    fetchSkills,
    fetchTemplates,
    applyGalleryTemplate,
    clearGalleryTemplate,
    initializeData,
    saveWorkflow,
    restoreWorkflow,
    hasSavedWorkflow,
    clearSavedWorkflow,
    syncToProject
  };
});

