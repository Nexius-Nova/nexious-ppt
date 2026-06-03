import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { defaultPrompts, defaultSkills, exampleTemplates, workflowSteps } from '@/data/workflow';
import { analyzeDeckInput, exportDeck, generateSlideImages } from '@/services/agentSimulator';
import { exportOutlineToPptx } from '@/services/pptExporter';
import { promptApi, skillApi, templateApi, workflowApi, aiApi, versionApi, projectApi } from '@/services/api';
import { applyTemplateLayoutParams, getTemplateColors } from '@/composables/templateColors';
import { slideNeedsImage } from '@/utils/slideVisuals';
import { useApiKeyStore } from './apiKeyStore';
import { useToastStore } from './toastStore';
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
  TemplateStyle,
  VersionSnapshot,
  WorkflowStep,
  WorkflowStepId
} from '@/types/agent';

const cloneSteps = (): WorkflowStep[] => workflowSteps.map((step) => ({ ...step }));
const cloneSkills = (): SkillDefinition[] => defaultSkills.map((skill) => ({ ...skill, params: { ...skill.params } }));
const clonePrompts = (): PromptDefinition[] => defaultPrompts.map((prompt) => ({ ...prompt }));
const cloneTemplates = (): PptTemplate[] => exampleTemplates.map((template) => ({ ...template }));
const cloneConfigOptions = (): ConfigOptionGroups => ({
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
  ]
});

const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const MAX_ACTIVITY_LOGS = 5000;
const normalizeProjectText = (value: unknown) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
const projectIdentityKey = (project: Pick<PptProject, 'title' | 'topic'>) =>
  `${normalizeProjectText(project.title)}::${normalizeProjectText(project.topic)}`;
const isSameProjectIdentity = (left: Pick<PptProject, 'title' | 'topic'>, right: Pick<PptProject, 'title' | 'topic'>) => {
  const leftTitle = normalizeProjectText(left.title);
  const rightTitle = normalizeProjectText(right.title);
  if (!leftTitle || leftTitle !== rightTitle) return false;

  const leftTopic = normalizeProjectText(left.topic);
  const rightTopic = normalizeProjectText(right.topic);
  return leftTopic === rightTopic || !leftTopic || !rightTopic;
};

export const useAgentStore = defineStore('agent', () => {
  const activeStep = ref<WorkflowStepId>('input');
  const input = ref<DeckInput>({
    topic: '',
    content: '',
    files: []
  });
  const parameters = ref<AgentParameters>({
    summaryLength: 'balanced',
    slideCount: 6,
    tone: 'professional',
    imageStyle: 'flat',
    template: 'auto',
    skillIntensity: 70
  });
  const steps = ref<WorkflowStep[]>(cloneSteps());
  const outline = ref<SlideOutline[]>([]);
  const images = ref<GeneratedImage[]>([]);
  const skills = ref<SkillDefinition[]>(cloneSkills());
  const prompts = ref<PromptDefinition[]>(clonePrompts());
  const pptProjects = ref<PptProject[]>([]);
  const templates = ref<PptTemplate[]>(cloneTemplates());
  const activePptId = ref<string | null>(null);
  const exportArtifacts = ref<ExportArtifact[]>([]);
  const activityLog = ref<string[]>(['系统就绪，等待添加 PPT 项目。']);
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
  const isDataLoaded = ref(false);
  const recoveredActiveWorkflow = ref(false);
  const workflowRunToken = ref(0);
  const runningProjectId = ref<string | null>(null);

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

  function cancelActiveRunForProjectSwitch() {
    if (!isRunning.value || !activePpt.value) return;
    const previousProject = activePpt.value;
    pushLog('已切换项目，当前工作流已保存，可稍后继续。');
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
  }

  function mergePptProjects(projects: PptProject[], preferredActiveId: string | null = activePptId.value): PptProject[] {
    const byId = new Map<string, PptProject>();
    const byIdentity = new Map<string, string>();
    const merged: PptProject[] = [];

    for (const rawProject of projects) {
      const project = {
        ...rawProject,
        id: String(rawProject.id),
        state: rawProject.state || makeDefaultProjectState()
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
      parameters: {
        summaryLength: 'balanced',
        slideCount: 6,
        tone: 'professional',
        imageStyle: 'flat',
        template: 'auto',
        skillIntensity: 70
      },
      outline: [],
      images: [],
      exportArtifacts: [],
      enabledSkillIds: [],
      selectedPromptId: '',
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
    };
  }

  function snapshotProjectState(options: { persistable?: boolean } = {}): PptProjectState {
    const persistable = options.persistable ?? false;
    return {
      input: { ...input.value, files: [...input.value.files] },
      parameters: { ...parameters.value },
      outline: outline.value.map(s => ({ ...s, bullets: [...s.bullets] })),
      images: persistable
        ? images.value.map(img => ({ ...img, url: img.url?.startsWith('data:') ? '' : img.url }))
        : images.value.map(img => ({ ...img })),
      exportArtifacts: [...exportArtifacts.value],
      enabledSkillIds: skills.value.filter(s => s.enabled).map(s => s.id),
      selectedPromptId: selectedPromptId.value,
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
        summaryLength: configOptions.value.summaryLength.map(option => ({ ...option })),
        tone: configOptions.value.tone.map(option => ({ ...option })),
        imageStyle: configOptions.value.imageStyle.map(option => ({ ...option })),
      },
      resumeStage: resumeStage.value,
      executorCursor: executorCursor.value,
      workflowActive: isRunning.value || steps.value.some(step => step.status === 'running'),
      lastActiveStep: activeStep.value,
    };
  }

  function restoreProjectState(state: PptProjectState) {
    input.value = { ...state.input, files: [...state.input.files] };
    parameters.value = { ...state.parameters };
    outline.value = state.outline.map(s => ({ ...s }));
    images.value = state.images.map(img => ({ ...img }));
    exportArtifacts.value = [...state.exportArtifacts];

    const savedSkillIds = new Set(state.enabledSkillIds || []);
    skills.value = skills.value.map(s => ({
      ...s,
      enabled: savedSkillIds.has(s.id)
    }));

    selectedPromptId.value = state.selectedPromptId || '';

    designSpec.value = state.designSpec || null;
    specLock.value = state.specLock || null;
    svgPages.value = state.svgPages || [];
    configOptions.value = state.configOptions || cloneConfigOptions();
    retryingPageNumbers.value = new Set();
    const hadActiveWorkflow = Boolean(state.workflowActive || state.steps?.some(step => step.status === 'running'));
    recoveredActiveWorkflow.value = hadActiveWorkflow && !state.paused;
    isPaused.value = Boolean(state.paused || hadActiveWorkflow);
    pauseRequested.value = false;
    resumeStage.value = state.resumeStage || state.lastActiveStep || null;
    executorCursor.value = state.executorCursor || svgPages.value.length || 0;
    if (state.lastActiveStep && workflowSteps.some(step => step.id === state.lastActiveStep)) {
      activeStep.value = state.lastActiveStep;
    }

    if (state.activityLog && state.activityLog.length > 0) {
      activityLog.value = [...state.activityLog];
    } else {
      activityLog.value = [];
    }

    if (state.steps && state.steps.length > 0) {
      const restoredSteps = state.steps.map(s => ({
        ...s,
        status: (s.status === 'running' ? (hadActiveWorkflow ? 'running' : 'idle') : s.status) as WorkflowStep['status'],
        progress: s.status === 'running' && !hadActiveWorkflow ? 0 : s.progress,
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

  function pushLog(message: string) {
    activityLog.value = [`${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${message}`, ...activityLog.value].slice(0, MAX_ACTIVITY_LOGS);
    scheduleLogSync();
  }

  function setStepStatus(id: WorkflowStepId, status: WorkflowStep['status'], progress: number) {
    const step = steps.value.find((item) => item.id === id);
    if (!step) return;
    step.status = status;
    step.progress = progress;
  }

  function normalizeConfigValue(label: string, key: ConfigOptionKey) {
    const base = label.trim() || '未命名';
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

  function setConfigOptionValue(key: ConfigOptionKey, value: string) {
    parameters.value = { ...parameters.value, [key]: value };
    syncToProject();
  }

  function addConfigOption(key: ConfigOptionKey, label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    const option = { label: trimmed, value: normalizeConfigValue(trimmed, key) };
    configOptions.value = {
      ...configOptions.value,
      [key]: [...configOptions.value[key], option]
    };
    setConfigOptionValue(key, option.value);
    pushLog(`已添加配置：${trimmed}`);
    syncToProject();
  }

  function updateConfigOption(key: ConfigOptionKey, value: string, label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    configOptions.value = {
      ...configOptions.value,
      [key]: configOptions.value[key].map(option => option.value === value ? { ...option, label: trimmed } : option)
    };
    pushLog(`已更新配置：${trimmed}`);
    syncToProject();
  }

  function deleteConfigOption(key: ConfigOptionKey, value: string) {
    if (configOptions.value[key].length <= 1) return;
    const target = configOptions.value[key].find(option => option.value === value);
    configOptions.value = {
      ...configOptions.value,
      [key]: configOptions.value[key].filter(option => option.value !== value)
    };
    if (parameters.value[key] === value) {
      const next = configOptions.value[key][0]?.value || '';
      parameters.value = { ...parameters.value, [key]: next };
    }
    pushLog(`已删除配置：${target?.label || value}`);
    syncToProject();
  }

  function requestPauseWorkflow() {
    if (!isRunning.value) return;
    recoveredActiveWorkflow.value = false;
    pauseRequested.value = true;
    pushLog('已请求暂停，当前步骤完成后会停下。');
  }

  function markPaused(stage: WorkflowStepId) {
    isPaused.value = true;
    recoveredActiveWorkflow.value = false;
    pauseRequested.value = false;
    resumeStage.value = stage;
    isRunning.value = false;
    currentGeneratingSlide.value = null;
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

  async function ensureInputProject(): Promise<boolean> {
    const toastStore = useToastStore();
    const topic = input.value.topic.trim();

    if (!topic) {
      activeStep.value = 'input';
      toastStore.warning('请填写主题', '请先填写 PPT 主题，再开始生成');
      return false;
    }

    if (!activePpt.value) {
      await addPptProjectPersisted({
        title: topic,
        topic,
        description: input.value.content.trim() || '自动创建的 PPT 项目',
        templateId: parameters.value.template || 'auto'
      });
      toastStore.info('已创建 PPT 项目', `已自动创建项目：${topic}`);
    }

    setStepStatus('input', 'done', 100);
    pushLog('资料已准备好。');
    syncToProject();
    return true;
  }

  async function runInputStage() {
    const ready = await ensureInputProject();
    if (ready) {
      activeStep.value = 'outline';
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
    freshState.parameters.template = mapTemplateToStyle(data.templateId);

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
    freshState.parameters.template = mapTemplateToStyle(data.templateId);

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
      syncToProject();
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
  function executeChatAction(action: { type: string; params: Record<string, string> }): string | null {
    const newOutline = outline.value.map(s => ({ ...s, bullets: [...s.bullets] }));

    switch (action.type) {
      case 'updateSlideTitle': {
        const slide = newOutline.find(s => s.id === action.params.slideId);
        if (!slide) return null;
        slide.title = action.params.title || slide.title;
        outline.value = newOutline;
        return `已将「${slide.title}」标题更新`;
      }
      case 'updateSlideIndex': {
        const idx = parseInt(action.params.index, 10) - 1;
        const slide = newOutline[idx];
        if (!slide) return null;
        if (action.params.title) slide.title = action.params.title;
        outline.value = newOutline;
        return `已更新第 ${idx + 1} 页`;
      }
      case 'addBullet': {
        const slide = newOutline.find(s => s.id === action.params.slideId);
        if (!slide) return null;
        slide.bullets.push(action.params.text || '新要点');
        outline.value = newOutline;
        return `已为「${slide.title}」添加要点`;
      }
      case 'addBulletByIndex': {
        const idx = parseInt(action.params.index, 10) - 1;
        const slide = newOutline[idx];
        if (!slide) return null;
        slide.bullets.push(action.params.text || '新要点');
        outline.value = newOutline;
        return `已为第 ${idx + 1} 页添加要点`;
      }
      case 'deleteBullet': {
        const slide = newOutline.find(s => s.id === action.params.slideId);
        if (!slide) return null;
        const bIdx = parseInt(action.params.index, 10);
        if (!isNaN(bIdx) && bIdx >= 0 && bIdx < slide.bullets.length) {
          slide.bullets.splice(bIdx, 1);
          outline.value = newOutline;
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
        outline.value = newOutline;
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
      await versionApi.save(projectId, {
        label: label || `鐗堟湰 ${Date.now()}`,
        outline: outline.value.map(s => ({ ...s, bullets: [...s.bullets] })),
        parameters: { ...parameters.value },
        slideCount: outline.value.length
      });
    } catch { /* ignore */ }
  }

  async function restoreVersion(projectId: string, versionId: string): Promise<boolean> {
    try {
      const versions = await getVersions(projectId);
      const version = versions.find(v => v.id === versionId);
      if (!version) return false;
      saveHistory();
      outline.value = version.outline.map(s => ({ ...s, bullets: [...s.bullets] }));
      parameters.value = { ...version.parameters };
      pushLog(`已回滚到版本：${version.label || versionId}`);
      syncToProject();
      return true;
    } catch { return false; }
  }

  async function deleteVersion(projectId: string, versionId: string) {
    try {
      await versionApi.delete(projectId, versionId);
    } catch { /* ignore */ }
  }

  function applyPrompt(id: string) {
    const prompt = prompts.value.find((item) => item.id === id);
    if (!prompt) return;

    input.value = {
      ...input.value,
      content: [input.value.content, prompt.content].filter(Boolean).join('\n\n')
    };
      pushLog(`已应用提示词：${prompt.title}`);
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

    try {
      const result = await aiApi.strategistStream(
        {
          topic: input.value.topic,
          content: input.value.content,
          tone: parameters.value.tone,
          summaryLength: parameters.value.summaryLength,
          imageStyle: parameters.value.imageStyle,
          template: parameters.value.template || 'auto',
          promptContent: undefined,
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
            streamingText.value += content;
            const progress = Math.min(90, 20 + streamingText.value.length / 100);
            setStepStatus('outline', 'running', progress);
          },
          onComplete: (data) => {
            if (!isRunContextActive(ctx)) return;
            const parsed = data as any;
            designSpec.value = parsed.spec || null;
            specLock.value = parsed.lock || null;

            if (designSpec.value) {
              outline.value = designSpec.value.outline.map(s => ({
                id: s.id,
                title: s.title,
                bullets: s.bullets,
                speakerNotes: s.speakerNotes,
                visualPrompt: s.visualPrompt,
                chartHint: s.chartHint,
                layout: s.layout as SlideLayout,
              }));
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
    if (!checkActivePpt() || !checkApiKeys()) return;
    if (!isRunContextActive(ctx)) return;

    if (outline.value.length === 0) {
      await runStrategist(ctx);
    }
    if (!isRunContextActive(ctx)) return;
    if (outline.value.length === 0) return;

    activeStep.value = 'images';
    setStepStatus('images', 'running', 0);
    generatedSlides.value = new Set();
    pushLog('开始按需生成图片。');

    try {
      const slidesWithPrompt = designSpec.value
        ? designSpec.value.outline
        : outline.value.map((s, i) => ({
            ...s,
            pageNumber: i + 1,
            visualPrompt: s.visualPrompt,
            layout: s.layout || 'text-only',
            rhythm: 'breathing' as const,
          }));
      const slidesRequiringImages = slidesWithPrompt.filter((slide) => slideNeedsImage(slide));

      if (slidesRequiringImages.length === 0) {
        pushLog('本次不需要图片。');
        setStepStatus('images', 'done', 100);
        await syncToProjectNow();
        return;
      }

      const existingReadySlideIds = new Set(
        images.value
          .filter((image) => image.selected && !image.error && image.url)
          .map((image) => image.slideId)
      );
      generatedSlides.value = new Set(existingReadySlideIds);
      const pendingSlides = slidesRequiringImages.filter((slide) => !existingReadySlideIds.has(slide.id));

      if (pendingSlides.length === 0) {
        generatedSlides.value = new Set(existingReadySlideIds);
        pushLog('图片已完成。');
        setStepStatus('images', 'done', 100);
        await syncToProjectNow();
        return;
      }

      await generateSlideImages(
        pendingSlides.map(s => ({
          id: s.id,
          title: s.title,
          bullets: [...s.bullets],
          speakerNotes: s.speakerNotes || '',
          visualPrompt: s.visualPrompt || [s.title, ...(s.bullets || [])].filter(Boolean).join('，'),
        })),
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
              const completedPending = Math.round((pendingProgress / 100) * pendingSlides.length);
              const progress = Math.round(((existingReadySlideIds.size + completedPending) / slidesRequiringImages.length) * 100);
              setStepStatus('images', 'running', progress);
              return;
            }
            generatedSlides.value.add(slideId);
            currentGeneratingSlide.value = null;

            if (image.url || image.error) {
              const existingIdx = images.value.findIndex(img => img.slideId === slideId);
              if (existingIdx >= 0) {
                images.value[existingIdx] = image;
              } else {
                images.value = [...images.value, image];
              }
            }

            const readyCount = images.value.filter((img) => img.selected && !img.error && img.url).length;
            const progress = Math.round((readyCount / slidesRequiringImages.length) * 100);
            setStepStatus('images', 'running', progress);
            pushLog(image.error
              ? `图片未生成：${image.title}，继续生成页面。`
              : `图片完成：${image.title}，${Math.min(readyCount, slidesRequiringImages.length)}/${slidesRequiringImages.length}`);
          },
          onError: (_slideId, message) => {
            if (!isRunContextActive(ctx)) return;
            currentGeneratingSlide.value = null;
            pushLog(`图片未生成：${message}`);
          },
          onAllComplete: () => {
            if (!isRunContextActive(ctx)) return;
            const readyCount = images.value.filter((img) => img.selected && !img.error && img.url).length;
            generatedSlides.value = new Set(
              images.value
                .filter((image) => image.selected && !image.error && image.url)
                .map((image) => image.slideId)
            );
            pushLog(readyCount > 0
              ? `图片生成完成，共 ${readyCount} 张。`
              : '没有生成可用图片，页面会使用 SVG 图示。');
            setStepStatus('images', 'done', 100);
            syncToProject();
          }
        }
      );
      if (!isRunContextActive(ctx)) return;
      await syncToProjectNow();
    } catch (error) {
      if (!isRunContextActive(ctx)) return;
      setStepStatus('images', 'idle', 0);
      const errMsg = error instanceof Error ? error.message : '未知错误';
      pushLog(`图片生成失败：${errMsg}`);
      await syncToProjectNow();
      throw error;
    }
  }

  async function retrySlideImage(slideId: string, ctx: RunContext = createRunContext()) {
    if (!checkActivePpt() || !checkApiKeys()) return;
    if (!isRunContextActive(ctx)) return;

    const sourceSlide = (designSpec.value?.outline || outline.value).find((slide: any) => slide.id === slideId) as any;
    if (!sourceSlide) return;

    activeStep.value = 'images';
    currentGeneratingSlide.value = slideId;
    pushLog(`重新生成图片：${sourceSlide.title}`);

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
            const existingIdx = images.value.findIndex(img => img.slideId === id);
            if (existingIdx >= 0) {
              images.value[existingIdx] = image;
            } else {
              images.value = [...images.value, image];
            }
            if (!image.error && image.url) {
              generatedSlides.value.add(id);
            }
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
      if (!isRunContextActive(ctx)) return;

      const image = result[0];
      if (image?.error || !image?.url) {
        pushLog(`图片仍未生成：${sourceSlide.title}`);
      } else {
        pushLog(`图片重试成功：${sourceSlide.title}`);
      }
      syncToProject();
    } catch (error) {
      if (!isRunContextActive(ctx)) return;
      const errMsg = error instanceof Error ? error.message : '未知错误';
      pushLog(`图片重试失败：${errMsg}`);
      syncToProject();
      throw error;
    } finally {
      if (isRunContextActive(ctx)) currentGeneratingSlide.value = null;
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

  async function generateSlideSvg(slide: SpecSlide, ctx: RunContext): Promise<string> {
    const imageForSlide = images.value.find(img =>
      img.slideId === slide.id &&
      img.selected &&
      img.url
    );
    const imageUrl = await ensureExecutorImageUrl(imageForSlide);
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
      const totalPages = designSpec.value.outline.length;
      const startIndex = options.resume
        ? Math.min(Math.max(executorCursor.value || svgPages.value.length, 0), totalPages)
        : 0;

      for (let i = startIndex; i < totalPages; i++) {
        if (!isRunContextActive(ctx)) return;
        const slide = designSpec.value.outline[i];
        const progress = Math.round(((i) / totalPages) * 100);
        setStepStatus('layout', 'running', progress);
        pushLog(`正在生成第 ${slide.pageNumber} 页：${slide.title}`);

        try {
          const svg = await generateSlideSvg(slide, ctx);
          if (!isRunContextActive(ctx)) return;

          const page = {
            pageNumber: slide.pageNumber,
            svg,
            speakerNotes: slide.speakerNotes,
          };
          const existingPageIndex = svgPages.value.findIndex(item => item.pageNumber === page.pageNumber);
          if (existingPageIndex >= 0) {
            svgPages.value[existingPageIndex] = page;
          } else {
            svgPages.value.push(page);
          }

          pushLog(`第 ${slide.pageNumber} 页生成完成。`);
        } catch (pageError) {
          const errMsg = pageError instanceof Error ? pageError.message : '未知错误';
          pushLog(`第 ${slide.pageNumber} 页生成失败（${errMsg}），已标记待重试。`);
          const page = {
            pageNumber: slide.pageNumber,
            svg: buildFallbackSvg(slide),
            speakerNotes: slide.speakerNotes,
          };
          const existingPageIndex = svgPages.value.findIndex(item => item.pageNumber === page.pageNumber);
          if (existingPageIndex >= 0) {
            svgPages.value[existingPageIndex] = page;
          } else {
            svgPages.value.push(page);
          }
        }

        executorCursor.value = i + 1;
        await syncToProjectNow();
        if (shouldPauseAt('layout')) return;
      }

      executorCursor.value = totalPages;
      setStepStatus('layout', 'done', 100);
      pushLog('页面生成完成。');
      await syncToProjectNow();
    } catch (error) {
      if (!isRunContextActive(ctx)) return;
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
    const ctx = createRunContext();
    const slide = designSpec.value.outline.find(item => item.pageNumber === pageNumber);
    if (!slide) return;
    retryingPageNumbers.value = new Set([...retryingPageNumbers.value, pageNumber]);

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
      setStepStatus('layout', 'done', 100);
      pushLog(`第 ${pageNumber} 页已重新生成。`);
      await syncToProjectNow();
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '未知错误';
      setStepStatus('layout', 'idle', 0);
      pushLog(`第 ${pageNumber} 页重试失败：${errMsg}`);
      await syncToProjectNow();
    } finally {
      const nextRetrying = new Set(retryingPageNumbers.value);
      nextRetrying.delete(pageNumber);
      retryingPageNumbers.value = nextRetrying;
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
    const totalPages = designSpec.value?.outline.length || outline.value.length || parameters.value.slideCount;
    const hasPartialPages = svgPages.value.length > 0 && svgPages.value.length < totalPages;
    await runExecutor({ resume: hasPartialPages || executorCursor.value > 0 });
  }

  async function runSkills() {
    if (!checkActivePpt()) return;
    if (outline.value.length === 0) return;

    const activeSkills = enabledSkills.value;
    if (activeSkills.length === 0) {
      pushLog('没有启用的 Skill，跳过。');
      return;
    }

    const intensity = parameters.value.skillIntensity / 100;
    pushLog(`开始执行 ${activeSkills.length} 个 Skill（强度 ${parameters.value.skillIntensity}%）。`);

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
            intensity: parameters.value.skillIntensity
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
      const ready = await ensureInputProject();
      if (!ready) return;
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
      toastStore.info('开始生成 PPT', '正在处理，请稍候。');

      const imagesStep = steps.value.find(s => s.id === 'images');
      const shouldRunOutline = !options.resume || !designSpec.value || !specLock.value || outline.value.length === 0;
      if (shouldRunOutline) {
        activeStep.value = 'outline';
        await runStrategist(ctx);
        if (!isRunContextActive(ctx)) return;
        if (shouldPauseAt('images')) return;
      }

      if (!isRunContextActive(ctx)) return;
      activeStep.value = 'images';

      if (!needsImageGeneration()) {
        pushLog('本次不需要图片。');
        setStepStatus('images', 'done', 100);
      } else if (imagesStep && imagesStep.status !== 'done') {
        const apiKeyStore = useApiKeyStore();
        if (apiKeyStore.isImageModelConfigured) {
          try {
            await runImages(ctx);
            if (!isRunContextActive(ctx)) return;
            if (shouldPauseAt('layout')) return;
          } catch (imgError) {
            if (!isRunContextActive(ctx)) return;
            pushLog(`图片生成失败（${imgError instanceof Error ? imgError.message : '未知错误'}），跳过图片继续生成页面。`);
          }
        } else {
          pushLog('图像模型未配置，跳过图片生成。');
          setStepStatus('images', 'done', 100);
        }
      } else {
        pushLog('图片已完成，跳过图片生成。');
      }

      if (!isRunContextActive(ctx)) return;
      activeStep.value = 'layout';
      await runExecutor({ resume: options.resume || resumeStage.value === 'layout', embedded: true, ctx });
      if (!isRunContextActive(ctx)) return;
      if (isPaused.value) return;

      activeStep.value = 'preview';
      clearPauseState();

      toastStore.success('PPT 生成完成', '可以在预览区查看结果');
    } catch (error) {
      if (!isRunContextActive(ctx)) return;
      const errMsg = error instanceof Error ? error.message : '未知错误';
      pushLog(`PPT 生成失败：${errMsg}`);
      syncToProject();
      toastStore.error('PPT 生成失败', errMsg);
    } finally {
      if (isRunContextActive(ctx) && !isPaused.value) {
        isRunning.value = false;
        runningProjectId.value = null;
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
        if (svgPages.value.length > 0 && designSpec.value) {
          const fileName = await aiApi.exportPptx(
            svgPages.value.map(p => ({ svg: p.svg, speakerNotes: p.speakerNotes })),
            designSpec.value,
            specLock.value || undefined
          );
          artifact = {
            format,
            name: fileName,
            status: 'ready'
          };
        } else {
          artifact = {
            format,
            name: await exportOutlineToPptx(outline.value, selectedImages.value, parameters.value),
            status: 'ready'
          };
        }
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
      pushLog(`${skill.name} 已${skill.enabled ? '启用' : '停用'}。`);
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

  function attachFiles(files: FileList | null) {
    if (!files) return;
    input.value.files = Array.from(files).map((file) => file.name);
    pushLog(`已接收 ${input.value.files.length} 个资料文件。`);
    syncToProject();
  }

  function addSampleOutline() {
    saveHistory();
    outline.value = [
      { id: 'sample-1', title: '市场概况与行业趋势', bullets: ['市场规模与增长预测', '主要竞争对手分析', '行业技术演进路线', '政策与监管环境'], speakerNotes: '简要介绍行业背景，用数据支撑核心判断。', visualPrompt: '市场增长趋势图表', chartHint: '建议使用折线图展示增长趋势', layout: 'text-only' },
      { id: 'sample-2', title: '核心产品与技术优势', bullets: ['产品架构与核心技术', '与竞品的差异化对比', '技术壁垒与专利布局', '产品路线图'], speakerNotes: '突出技术独特性，用对比说明优势。', visualPrompt: '产品架构示意图', chartHint: '建议使用对比表格', layout: 'text-image' },
      { id: 'sample-3', title: '商业模式与盈利分析', bullets: ['收入模型与定价策略', '成本结构与毛利分析', '客户获取成本与 LTV', '盈亏平衡预测'], speakerNotes: '用数据说明单位经济模型和长期盈利预期。', visualPrompt: '商业模式画布', chartHint: '建议使用柱状图展示收入构成', layout: 'image-text' },
      { id: 'sample-4', title: '实施计划与里程碑', bullets: ['分阶段实施路线图', '关键里程碑与交付物', '资源需求与团队配置', '风险管理计划'], speakerNotes: '明确时间节点和可量化交付标准。', visualPrompt: '项目甘特图', layout: 'text-only' },
      { id: 'sample-5', title: '总结与展望', bullets: ['核心结论与关键数据', '未来发展方向', '合作建议与下一步行动'], speakerNotes: '总结核心观点，明确下一步行动计划。', visualPrompt: '未来愿景图示', layout: 'full-image' }
    ];
    pushLog('已加载示例大纲数据。');
    syncToProject();
  }

  async function fetchPrompts() {
    try {
      const response = await promptApi.getAll();
      if (response.success && response.data && response.data.length > 0) {
        prompts.value = response.data.map((p: any) => ({
          id: String(p.id),
          title: p.title,
          scene: p.scene || '',
          content: p.content,
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
      if (response.success && response.data && response.data.length > 0) {
        skills.value = response.data.map((s: any, index: number) => ({
          id: String(s.id),
          name: s.name,
          description: s.description || '',
          enabled: Boolean(s.is_enabled),
          order: index + 1,
          params: s.parameters || {}
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
          accent: t.accent || '#D9F26E'
        }));
      }
    } catch (error) {
      console.error('加载模板失败，使用默认数据', error);
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

  function applyGalleryTemplate(template: { id: number | string; name: string; category?: string | null }) {
    const templateId = String(template.id);
    const style = mapTemplateToStyle(templateId);

    parameters.value = {
      ...parameters.value,
      template: style
    };

    if (activePpt.value) {
      activePpt.value.templateId = templateId;
      activePpt.value.updatedAt = Date.now();
    } else if (input.value.topic.trim()) {
      addPptProject({
        title: input.value.topic.trim(),
        topic: input.value.topic.trim(),
        description: input.value.content.trim() || '通过模板广场创建',
        templateId
      });
    }

    pushLog(`已应用模板：${template.name}（${template.category || '未分类'}），样式：${style}`);
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
        input: { ...input.value, files: [] },
        parameters: { ...parameters.value },
        outline: outline.value.map(s => ({ ...s })),
        images: images.value.map(img => ({ ...img, url: img.url?.startsWith('data:') ? '' : img.url })),
        skills: skills.value.map(s => ({ ...s, params: { ...s.params } })),
        pptProjects: pptProjects.value.map(p => ({
          ...p,
          state: {
            ...p.state,
            input: { ...p.state.input, files: [] },
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
      input.value = { ...snapshot.input, files: [] };
      parameters.value = { ...snapshot.parameters };
      outline.value = snapshot.outline || [];
      images.value = snapshot.images || [];
      skills.value = snapshot.skills || cloneSkills();
      const restoredProjects = (snapshot.pptProjects || []).map((p: any) => ({
        ...p,
        id: String(p.id),
        state: p.state ? {
          ...p.state,
          input: { ...p.state.input, files: [] }
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
    pptProjects,
    templates,
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
    applyPrompt,
    attachFiles,
    addSampleOutline,
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
    initializeData,
    saveWorkflow,
    restoreWorkflow,
    hasSavedWorkflow,
    clearSavedWorkflow,
    syncToProject
  };
});

