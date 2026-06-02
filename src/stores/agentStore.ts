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

const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

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
  const streamingText = ref('');
  const designSpec = ref<DesignSpec | null>(null);
  const specLock = ref<SpecLock | null>(null);
  const svgPages = ref<Array<{ pageNumber: number; svg: string; speakerNotes: string }>>([]);
  const selectedPromptId = ref<string>('');
  const currentGeneratingSlide = ref<string | null>(null);
  const generatedSlides = ref<Set<string>>(new Set());
  const isDataLoaded = ref(false);

  const enabledSkills = computed(() => skills.value.filter((skill) => skill.enabled).sort((a, b) => a.order - b.order));
  const selectedImages = computed(() => images.value.filter((image) => image.selected));
  const activeStepMeta = computed(() => steps.value.find((step) => step.id === activeStep.value));
  const activePpt = computed(() => pptProjects.value.find((project) => project.id === activePptId.value) || null);

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
      svgPages: []
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
        : svgPages.value
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

    if (state.activityLog && state.activityLog.length > 0) {
      activityLog.value = [...state.activityLog];
    } else {
      activityLog.value = [];
    }

    if (state.steps && state.steps.length > 0) {
      const restoredSteps = state.steps.map(s => ({
        ...s,
        status: s.status === 'running' ? 'idle' : s.status,
        progress: s.status === 'running' ? 0 : s.progress,
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
    if (!activePpt.value) return;
    const state = snapshotProjectState();
    activePpt.value.state = state;
    activePpt.value.updatedAt = Date.now();

    persistActiveProjectState(snapshotProjectState({ persistable: true })).catch((error) => {
      console.warn('同步项目状态失败', error);
    });
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
    activityLog.value = [`${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${message}`, ...activityLog.value].slice(0, 8);
  }

  function setStepStatus(id: WorkflowStepId, status: WorkflowStep['status'], progress: number) {
    const step = steps.value.find((item) => item.id === id);
    if (!step) return;
    step.status = status;
    step.progress = progress;
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
    activePptId.value = project.id;
    restoreProjectState(freshState);
    pushLog(`已添加 PPT：${project.title}`);
  }

  async function addPptProjectPersisted(data: { title: string; topic: string; description: string; templateId: string }) {
    const freshState = makeDefaultProjectState();
    freshState.input.topic = data.topic.trim();
    freshState.input.content = data.description.trim();
    freshState.parameters.template = mapTemplateToStyle(data.templateId);

    try {
      const response = await projectApi.create({
        title: data.title.trim() || data.topic.trim() || '未命名 PPT',
        topic: data.topic.trim(),
        content: data.description.trim(),
        status: 'draft',
        state: freshState,
      });

      if (response.success && response.data?.id) {
        const now = Date.now();
        const project: PptProject = {
          id: String(response.data.id),
          title: data.title.trim() || data.topic.trim() || '未命名 PPT',
          topic: data.topic.trim(),
          description: data.description.trim(),
          templateId: data.templateId,
          createdAt: now,
          updatedAt: now,
          state: freshState,
        };
        pptProjects.value = [project, ...pptProjects.value.filter(p => p.id !== project.id)];
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
            pptProjects.value = [project, ...pptProjects.value];
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
      pptProjects.value = [freshProject, ...pptProjects.value];
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

  async function runStrategist() {
    if (!checkActivePpt() || !checkApiKeys()) return;

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
            pushLog(message);
            setStepStatus('outline', 'running', 20);
          },
          onContent: (content) => {
            streamingText.value += content;
            const progress = Math.min(90, 20 + streamingText.value.length / 100);
            setStepStatus('outline', 'running', progress);
          },
          onComplete: (data) => {
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
            syncToProject();
          },
          onError: (message) => {
            pushLog(`大纲生成失败：${message}`);
            setStepStatus('outline', 'idle', 0);
            const toastStore = useToastStore();
            toastStore.error('大纲生成失败', message);
          },
        }
      );
    } catch (error) {
      setStepStatus('outline', 'idle', 0);
      pushLog('大纲生成失败，请检查 API Key 配置。');
      throw error;
    }
  }

  const runOutline = runStrategist;

  function needsImageGeneration(): boolean {
    const slides = designSpec.value?.outline || outline.value;
    return slides.some((slide: any) => slideNeedsImage(slide));
  }

  async function runImages() {
    if (!checkActivePpt() || !checkApiKeys()) return;

    if (outline.value.length === 0) {
      await runStrategist();
    }
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
        syncToProject();
        return;
      }

      await generateSlideImages(
        slidesRequiringImages.map(s => ({
          id: s.id,
          title: s.title,
          bullets: [...s.bullets],
          speakerNotes: s.speakerNotes || '',
          visualPrompt: s.visualPrompt || [s.title, ...(s.bullets || [])].filter(Boolean).join('，'),
        })),
        parameters.value.imageStyle,
        {
          onStart: (slideId, message) => {
            currentGeneratingSlide.value = slideId;
            pushLog(message);
          },
          onComplete: (slideId, image) => {
            if (slideId === '__progress__') {
              const progress = (image as any)._progress || 0;
              setStepStatus('images', 'running', progress);
              return;
            }
            generatedSlides.value.add(slideId);
            currentGeneratingSlide.value = null;

            if (image.url && !image.error) {
              const existingIdx = images.value.findIndex(img => img.slideId === slideId);
              if (existingIdx >= 0) {
                images.value[existingIdx] = image;
              } else {
                images.value = [...images.value, image];
              }
            }

            const progress = Math.round((generatedSlides.value.size / slidesRequiringImages.length) * 100);
            setStepStatus('images', 'running', progress);
            pushLog(image.error
              ? `图片未生成：${image.title}，继续生成页面。`
              : `图片完成：${image.title}，${generatedSlides.value.size}/${slidesRequiringImages.length}`);
          },
          onError: (_slideId, message) => {
            currentGeneratingSlide.value = null;
            pushLog(`图片未生成：${message}`);
          },
          onAllComplete: () => {
            pushLog(generatedSlides.value.size > 0
              ? `图片生成完成，共 ${generatedSlides.value.size} 张。`
              : '没有生成可用图片，页面会使用 SVG 图示。');
            setStepStatus('images', 'done', 100);
            syncToProject();
          }
        }
      );
    } catch (error) {
      setStepStatus('images', 'idle', 0);
      pushLog('图片生成失败，请检查 API Key 配置。');
      throw error;
    }
  }

  async function runExecutor() {
    if (!checkActivePpt()) return;

    if (!designSpec.value || !specLock.value) {
      await runStrategist();
    }
    if (!designSpec.value || !specLock.value) return;

    activeStep.value = 'layout';
    isRunning.value = true;
    setStepStatus('layout', 'running', 5);
    pushLog('开始生成页面。');
    svgPages.value = [];

    try {
      const totalPages = designSpec.value.outline.length;

      for (let i = 0; i < totalPages; i++) {
        const slide = designSpec.value.outline[i];
        const progress = Math.round(((i) / totalPages) * 100);
        setStepStatus('layout', 'running', progress);
        pushLog(`正在生成第 ${slide.pageNumber} 页：${slide.title}`);

        const imageForSlide = images.value.find(img =>
          img.slideId === slide.id &&
          img.selected &&
          img.url &&
          !img.url.startsWith('data:')
        );
        const imageUrl = imageForSlide?.url || undefined;

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

        try {
          const svg = await aiApi.executorPageStream(
            { spec: slimSpec as any, lock: slimLock as any, slide, imageUrl },
            {
              onStart: () => {},
              onContent: () => {},
              onComplete: () => {},
              onError: (message) => {
                pushLog(`第 ${slide.pageNumber} 页 API 错误：${message}`);
              },
            }
          );

          if (!svg || !svg.includes('<svg')) {
            throw new Error('AI 返回的 SVG 内容无效');
          }

          svgPages.value.push({
            pageNumber: slide.pageNumber,
            svg,
            speakerNotes: slide.speakerNotes,
          });

          pushLog(`第 ${slide.pageNumber} 页生成完成。`);
        } catch (pageError) {
          const errMsg = pageError instanceof Error ? pageError.message : '未知错误';
          pushLog(`第 ${slide.pageNumber} 页生成失败（${errMsg}），已使用备用页面。`);
          svgPages.value.push({
            pageNumber: slide.pageNumber,
            svg: buildFallbackSvg(slide),
            speakerNotes: slide.speakerNotes,
          });
        }
      }

      setStepStatus('layout', 'done', 100);
      pushLog('页面生成完成。');
      syncToProject();
    } catch (error) {
      setStepStatus('layout', 'idle', 0);
      const errMsg = error instanceof Error ? error.message : '页面生成失败';
      pushLog(`页面生成失败：${errMsg}`);
      const toastStore = useToastStore();
      toastStore.error('页面生成失败', errMsg);
      throw error;
    } finally {
      isRunning.value = false;
    }
  }

  function buildFallbackSvg(slide: SpecSlide): string {
    const spec = designSpec.value;
    if (!spec) return '';
    const { canvas, visualTheme, typography } = spec;
    const { colors } = visualTheme;
    const isCover = slide.layout === 'cover';
    const isEnding = slide.layout === 'ending';

    if (isCover) {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}" width="${canvas.width}" height="${canvas.height}">
  <rect width="${canvas.width}" height="${canvas.height}" fill="${colors.background}"/>
  <rect x="0" y="${canvas.height * 0.35}" width="${canvas.width}" height="4" fill="${colors.accent}"/>
  <text x="${canvas.width / 2}" y="${canvas.height * 0.45}" font-size="${typography.titleSize + 8}" fill="${colors.text}" text-anchor="middle" font-family="${typography.titleFamily}" font-weight="bold">${slide.title}</text>
  <text x="${canvas.width / 2}" y="${canvas.height * 0.55}" font-size="${typography.bodySize}" fill="${colors.muted}" text-anchor="middle" font-family="${typography.bodyFamily}">${spec.projectInfo.occasion || ''}</text>
</svg>`;
    }

    if (isEnding) {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}" width="${canvas.width}" height="${canvas.height}">
  <rect width="${canvas.width}" height="${canvas.height}" fill="${colors.background}"/>
  <text x="${canvas.width / 2}" y="${canvas.height * 0.42}" font-size="${typography.titleSize + 12}" fill="${colors.text}" text-anchor="middle" font-family="${typography.titleFamily}" font-weight="bold">璋㈣阿</text>
  <rect x="${canvas.width * 0.4}" y="${canvas.height * 0.5}" width="${canvas.width * 0.2}" height="3" fill="${colors.accent}"/>
  <text x="${canvas.width / 2}" y="${canvas.height * 0.58}" font-size="${typography.bodySize}" fill="${colors.muted}" text-anchor="middle" font-family="${typography.bodyFamily}">${slide.title}</text>
</svg>`;
    }

    const bulletLines = slide.bullets.map((b, i) =>
      `<circle cx="100" cy="${canvas.height * 0.35 + i * 40}" r="4" fill="${colors.accent}"/><text x="116" y="${canvas.height * 0.35 + i * 40 + 5}" font-size="${typography.bodySize}" fill="${colors.text}" font-family="${typography.bodyFamily}">${b}</text>`
    ).join('\n  ');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}" width="${canvas.width}" height="${canvas.height}">
  <rect width="${canvas.width}" height="${canvas.height}" fill="${colors.background}"/>
  <rect x="0" y="0" width="6" height="${canvas.height}" fill="${colors.accent}"/>
  <text x="60" y="80" font-size="${typography.titleSize}" fill="${colors.text}" font-family="${typography.titleFamily}" font-weight="bold">${slide.title}</text>
  <rect x="60" y="96" width="80" height="3" fill="${colors.accent}" fill-opacity="0.5"/>
  ${bulletLines}
</svg>`;
  }

  const runLayout = runExecutor;

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

  async function runFullWorkflow() {
    const toastStore = useToastStore();

    if (!activePpt.value) {
      if (!input.value.topic.trim()) {
        toastStore.warning('请填写主题', '请先填写 PPT 主题，再开始生成');
        return;
      }
      
      await addPptProjectPersisted({
        title: input.value.topic.trim(),
        topic: input.value.topic.trim(),
        description: input.value.content.trim() || '自动创建的 PPT 项目',
        templateId: parameters.value.template || 'auto'
      });
      
      toastStore.info('已创建 PPT 项目', `已自动创建项目：${input.value.topic.trim()}`);
    }

    if (!checkApiKeys()) return;

    if (isRunning.value) {
      toastStore.warning('正在生成', '请等待当前任务完成');
      return;
    }

    isRunning.value = true;

    try {
      toastStore.info('开始生成 PPT', '正在处理，请稍候。');

      const imagesStep = steps.value.find(s => s.id === 'images');
      await runStrategist();

      activeStep.value = 'images';

      if (!needsImageGeneration()) {
        pushLog('本次不需要图片。');
        setStepStatus('images', 'done', 100);
      } else if (imagesStep && imagesStep.status !== 'done') {
        const apiKeyStore = useApiKeyStore();
        if (apiKeyStore.isImageModelConfigured) {
          try {
            await runImages();
          } catch (imgError) {
            pushLog(`图片生成失败（${imgError instanceof Error ? imgError.message : '未知错误'}），跳过图片继续生成页面。`);
          }
        } else {
          pushLog('图像模型未配置，跳过图片生成。');
          setStepStatus('images', 'done', 100);
        }
      } else {
        pushLog('图片已完成，跳过图片生成。');
      }

      activeStep.value = 'layout';
      await runExecutor();

      activeStep.value = 'preview';

      toastStore.success('PPT 生成完成', '可以在预览区查看结果');
    } catch (error) {
      toastStore.error('PPT 生成失败', error instanceof Error ? error.message : '未知错误');
    } finally {
      isRunning.value = false;
      streamingText.value = '';
      currentGeneratingSlide.value = null;
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
      toastStore.error('导出失败', error instanceof Error ? error.message : '未知错误');
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
      pptProjects.value = (snapshot.pptProjects || []).map((p: any) => ({
        ...p,
        state: p.state ? {
          ...p.state,
          input: { ...p.state.input, files: [] }
        } : makeDefaultProjectState()
      }));
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
    const restored = await restoreWorkflow();
    await Promise.all([fetchPrompts(), fetchSkills(), fetchTemplates()]);
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
    streamingText,
    designSpec,
    specLock,
    svgPages,
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
    runImages,
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

