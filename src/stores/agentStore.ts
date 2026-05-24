import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { defaultPrompts, defaultSkills, exampleTemplates, workflowSteps } from '@/data/workflow';
import { analyzeDeckInput, exportDeck, generateSlideImages } from '@/services/agentSimulator';
import { exportOutlineToPptx } from '@/services/pptExporter';
import { promptApi, skillApi, templateApi, workflowApi } from '@/services/api';
import { applyTemplateLayoutParams, getTemplateColors } from '@/composables/templateColors';
import { useApiKeyStore } from './apiKeyStore';
import { useToastStore } from './toastStore';
import type {
  AgentParameters,
  ChatMessage,
  DeckInput,
  ExportArtifact,
  GeneratedImage,
  PromptDefinition,
  PptProject,
  PptProjectState,
  PptTemplate,
  SkillDefinition,
  SlideOutline,
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
    template: 'business',
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
        template: 'business',
        skillIntensity: 70
      },
      outline: [],
      images: [],
      exportArtifacts: []
    };
  }

  function snapshotProjectState(): PptProjectState {
    return {
      input: { ...input.value, files: [...input.value.files] },
      parameters: { ...parameters.value },
      outline: outline.value.map(s => ({ ...s })),
      images: images.value.map(img => ({ ...img })),
      exportArtifacts: [...exportArtifacts.value]
    };
  }

  function restoreProjectState(state: PptProjectState) {
    input.value = { ...state.input, files: [...state.input.files] };
    parameters.value = { ...state.parameters };
    outline.value = state.outline.map(s => ({ ...s }));
    images.value = state.images.map(img => ({ ...img }));
    exportArtifacts.value = [...state.exportArtifacts];
  }

  function mapTemplateToStyle(templateId: string): TemplateStyle {
    const template = templates.value.find(t => t.id === templateId);
    if (!template) return 'business';
    const cat = (template.category || '').toLowerCase();
    if (cat.includes('教育') || cat.includes('培训') || cat.includes('education') || cat.includes('training') || cat.includes('course')) return 'education';
    if (cat.includes('创意') || cat.includes('产品') || cat.includes('路演') || cat.includes('creative') || cat.includes('product') || cat.includes('pitch')) return 'creative';
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

  function checkApiKeys(): boolean {
    const apiKeyStore = useApiKeyStore();
    const toastStore = useToastStore();

    if (!apiKeyStore.isTextModelConfigured) {
      toastStore.warning('文本模型未配置', '请先在设置中配置文本模型的 API Key');
      return false;
    }

    if (!apiKeyStore.isImageModelConfigured) {
      toastStore.warning('图像模型未配置', '请先在设置中配置图像模型的 API Key');
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
    // Save current state to current project before creating a new one
    if (activePpt.value) {
      activePpt.value.state = snapshotProjectState();
      activePpt.value.updatedAt = now;
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
    // Restore the fresh project state into global refs
    restoreProjectState(freshState);
    pushLog(`已添加 PPT：${project.title}`);
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

  function selectPptProject(id: string) {
    const project = pptProjects.value.find((item) => item.id === id);
    if (!project) return;

    // Save current state to the previously active project
    if (activePpt.value && activePpt.value.id !== id) {
      activePpt.value.state = snapshotProjectState();
      activePpt.value.updatedAt = Date.now();
    }

    activePptId.value = id;
    // Restore the selected project's state
    restoreProjectState(project.state);

    // Also ensure topic/content stay in sync with project metadata
    input.value = {
      ...input.value,
      topic: project.topic,
      content: project.description
    };
    parameters.value = {
      ...parameters.value,
      template: mapTemplateToStyle(project.templateId)
    };
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
    pushLog(`已调整版式：${slide.title} → ${layout}`);
  }

  function reorderOutline(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    saveHistory();
    const items = [...outline.value];
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);
    outline.value = items;
    pushLog(`已调整幻灯片顺序：第 ${fromIndex + 1} 页 → 第 ${toIndex + 1} 页`);
  }

  function updateSlideTitle(id: string, title: string) {
    const slide = outline.value.find((item) => item.id === id);
    if (slide) {
      saveHistory();
      slide.title = title;
      pushLog(`已更新页面标题：${title}`);
    }
  }

  function updateSlideBullet(slideId: string, bulletIndex: number, text: string) {
    const slide = outline.value.find((item) => item.id === slideId);
    if (slide && slide.bullets[bulletIndex] !== undefined) {
      saveHistory();
      slide.bullets[bulletIndex] = text;
    }
  }

  function addSlideBullet(slideId: string) {
    const slide = outline.value.find((item) => item.id === slideId);
    if (slide) {
      saveHistory();
      slide.bullets.push('');
    }
  }

  function deleteSlideBullet(slideId: string, bulletIndex: number) {
    const slide = outline.value.find((item) => item.id === slideId);
    if (slide && slide.bullets.length > 1) {
      saveHistory();
      slide.bullets.splice(bulletIndex, 1);
    }
  }

  function reorderBullet(slideId: string, fromIndex: number, toIndex: number) {
    const slide = outline.value.find((item) => item.id === slideId);
    if (!slide || fromIndex === toIndex) return;
    saveHistory();
    const [moved] = slide.bullets.splice(fromIndex, 1);
    slide.bullets.splice(toIndex, 0, moved);
  }

  function updateSlideNotes(slideId: string, notes: string) {
    const slide = outline.value.find((item) => item.id === slideId);
    if (slide) {
      saveHistory();
      slide.speakerNotes = notes;
    }
  }

  function reorderSkills(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    const items = [...skills.value];
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);
    skills.value = items.map((skill, index) => ({ ...skill, order: index + 1 }));
    pushLog(`已调整 Skill 顺序`);
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
    pushLog('撤销');
  }

  function redoOutline() {
    if (!canRedo.value) return;
    const entry = historyFuture.value.pop()!;
    historyPast.value.push({
      outline: outline.value.map(s => ({ ...s, bullets: [...s.bullets] }))
    });
    outline.value = entry.outline.map(s => ({ ...s, bullets: [...s.bullets] }));
    pushLog('重做');
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
          return `已删除要点`;
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

  // ---- Version management ----
  const VERSIONS_KEY = 'nexious-ppt-versions';
  const MAX_VERSIONS = 30;

  function getVersions(projectId: string): VersionSnapshot[] {
    try {
      const data = localStorage.getItem(`${VERSIONS_KEY}-${projectId}`);
      return data ? JSON.parse(data) : [];
    } catch { return []; }
  }

  function saveVersion(projectId: string, label?: string) {
    const versions = getVersions(projectId);
    const snapshot: VersionSnapshot = {
      id: `v-${Date.now()}`,
      projectId,
      timestamp: Date.now(),
      label: label || `版本 ${versions.length + 1}`,
      outline: outline.value.map(s => ({ ...s, bullets: [...s.bullets] })),
      parameters: { ...parameters.value },
      slideCount: outline.value.length
    };
    versions.unshift(snapshot);
    if (versions.length > MAX_VERSIONS) versions.length = MAX_VERSIONS;
    try {
      localStorage.setItem(`${VERSIONS_KEY}-${projectId}`, JSON.stringify(versions));
    } catch { /* ignore */ }
  }

  function restoreVersion(projectId: string, versionId: string): boolean {
    const versions = getVersions(projectId);
    const version = versions.find(v => v.id === versionId);
    if (!version) return false;
    saveHistory();
    outline.value = version.outline.map(s => ({ ...s, bullets: [...s.bullets] }));
    parameters.value = { ...version.parameters };
    pushLog(`已回滚到版本: ${version.label || versionId}`);
    return true;
  }

  function deleteVersion(projectId: string, versionId: string) {
    const versions = getVersions(projectId).filter(v => v.id !== versionId);
    try {
      localStorage.setItem(`${VERSIONS_KEY}-${projectId}`, JSON.stringify(versions));
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
  }

  async function runOutline() {
    if (!checkActivePpt() || !checkApiKeys()) return;

    activeStep.value = 'outline';
    setStepStatus('outline', 'running', 10);
    streamingText.value = '';
    pushLog('开始文本分析，生成 PPT 大纲。');

    try {
      outline.value = await analyzeDeckInput(input.value, parameters.value, {
        onStart: (message) => {
          pushLog(message);
          setStepStatus('outline', 'running', 20);
        },
        onContent: (content) => {
          streamingText.value += content;
          const progress = Math.min(90, 20 + streamingText.value.length / 50);
          setStepStatus('outline', 'running', progress);
        },
        onComplete: (data) => {
          pushLog(`文本分析完成，生成 ${data.length} 页大纲。`);
          setStepStatus('outline', 'done', 100);
        },
        onError: (message) => {
          pushLog(`文本分析失败：${message}`);
          setStepStatus('outline', 'idle', 0);
        }
      });
      streamingText.value = '';
    } catch (error) {
      setStepStatus('outline', 'idle', 0);
      pushLog('文本分析失败，请检查 API Key 配置。');
      throw error;
    }
  }

  async function runImages() {
    if (!checkActivePpt() || !checkApiKeys()) return;

    if (outline.value.length === 0) {
      await runOutline();
    }
    if (outline.value.length === 0) return;

    activeStep.value = 'images';
    setStepStatus('images', 'running', 0);
    generatedSlides.value = new Set();
    pushLog('开始为每页生成候选插图。');

    try {
      const generatedImages = await generateSlideImages(outline.value, parameters.value.imageStyle, {
        onStart: (slideId, message) => {
          currentGeneratingSlide.value = slideId;
          pushLog(message);
          const progress = Math.round((generatedSlides.value.size / outline.value.length) * 100);
          setStepStatus('images', 'running', progress);
        },
        onComplete: (slideId, image) => {
          generatedSlides.value.add(slideId);
          currentGeneratingSlide.value = null;
          const progress = Math.round((generatedSlides.value.size / outline.value.length) * 100);
          setStepStatus('images', 'running', progress);
        },
        onError: (_slideId, message) => {
          currentGeneratingSlide.value = null;
          pushLog(`图片生成失败：${message}`);
        },
        onAllComplete: (allImages) => {
          pushLog(`图像候选完成，共 ${allImages.length} 张。`);
          setStepStatus('images', 'done', 100);
        }
      });

      // Merge new images into existing: only replace when new image has a valid URL
      const existingMap = new Map(images.value.map(img => [img.slideId, img]));
      for (const genImg of generatedImages) {
        if (genImg.url && !genImg.error) {
          existingMap.set(genImg.slideId, genImg);
        } else if (!existingMap.has(genImg.slideId)) {
          existingMap.set(genImg.slideId, genImg);
        }
      }
      images.value = Array.from(existingMap.values());
      console.log('runImages - 生成的图片:', generatedImages.map(img => ({ slideId: img.slideId, url: img.url?.substring(0, 50), selected: img.selected })));
    } catch (error) {
      setStepStatus('images', 'idle', 0);
      pushLog('图像生成失败，请检查 API Key 配置。');
      throw error;
    }
  }

  async function runLayout() {
    if (!checkActivePpt()) return;

    if (images.value.length === 0) {
      await runImages();
    }

    console.log('runLayout - images:', images.value.map(img => ({ slideId: img.slideId, hasUrl: !!img.url, selected: img.selected })));
    console.log('runLayout - selectedImages:', images.value.filter(img => img.selected).map(img => ({ slideId: img.slideId, hasUrl: !!img.url })));
    console.log('runLayout - outline:', outline.value.map(s => ({ id: s.id, title: s.title })));

    activeStep.value = 'layout';
    setStepStatus('layout', 'running', 30);
    pushLog(`应用 ${parameters.value.template} 模板并生成版式。`);

    // Apply template layout parameters to all slides
    const { titleSize, bulletSize, imageRatio, preferredLayout } = applyTemplateLayoutParams(parameters.value.template, 'text-only');

    // Auto-assign layout for slides that don't have one yet
    const imageSlideIds = new Set(images.value.filter(img => img.selected && img.url).map(img => img.slideId));
    let layoutAppliedCount = 0;
    outline.value = outline.value.map(slide => {
      const layout = slide.layout || 
        (imageSlideIds.has(slide.id) ? preferredLayout : 'text-only');
      if (!slide.layout) layoutAppliedCount++;
      return {
        ...slide,
        layout: layout as import('@/types/agent').SlideLayout,
        layoutParams: { titleSize, bulletSize, imageRatio }
      };
    });
    if (layoutAppliedCount > 0) {
      pushLog(`自动分配版式：${layoutAppliedCount} 页（模板推荐: ${preferredLayout}）。`);
    }

    // Run enabled skills as part of layout processing
    const activeSkills = enabledSkills.value;
    if (activeSkills.length > 0) {
      pushLog(`执行 ${activeSkills.length} 个 Skill（强度 ${parameters.value.skillIntensity}%）。`);
      await runSkills();
    }

    setStepStatus('layout', 'done', 100);
    pushLog('PPT 排版完成，可在预览区微调。');
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
      pushLog(`  → 执行 Skill：${skill.name}`);

      if (skill.id === 'speaker-notes' || skill.name.includes('讲稿')) {
        const style = (skill.params.style as string) || 'professional';
        const length = (skill.params.length as string) || 'medium';
        const maxItems = length === 'long' ? 5 : length === 'short' ? 2 : 3;
        const verbosity = Math.round(intensity * maxItems);

        outline.value = outline.value.map((slide, index) => {
          const keyPoints = slide.bullets.slice(0, Math.max(2, verbosity));
          const expandedNotes = keyPoints
            .map((b, i) => {
              const prefix = style === 'storytelling' ? ['开场故事引入：', '核心观点展开：', '案例佐证：'][i % 3] : ['要点阐述：', '数据支撑：', '行动建议：'][i % 3];
              return `${prefix}${b}`;
            })
            .join('\n');

          const nextTitle = outline.value[index + 1]?.title;
          const transition = nextTitle ? `\n\n转场提示：以上内容结束后，自然过渡到"${nextTitle}"。` : '';
          const existing = slide.speakerNotes ? `${slide.speakerNotes}\n\n---\n\n` : '';

          return {
            ...slide,
            speakerNotes: `${existing}[${skill.name}] ${expandedNotes}${transition}`
          };
        });
      }

      if (skill.id === 'data-chart' || skill.name.includes('图表') || skill.name.includes('数据')) {
        const chartTypes = ['bar', 'line', 'pie', 'radar', 'scatter'];
        outline.value = outline.value.map((slide) => {
          const fullText = `${slide.title} ${slide.bullets.join(' ')}`;
          const hasNumbers = /\d+/.test(fullText);
          const hasCompare = /对比|vs|同比|环比|增长|下降|变化|趋势|占比|比例/.test(fullText);
          const hasPercent = /%|百分比/.test(fullText);

          if (!hasNumbers) return slide;

          let chartHint = slide.chartHint || '';
          if (hasCompare) {
            chartHint = chartHint || `建议图表类型: ${chartTypes[Math.floor(Math.random() * 2)]}对比图`;
          } else if (hasPercent) {
            chartHint = chartHint || `建议图表类型: 饼图或环形图`;
          } else {
            chartHint = chartHint || `建议图表类型: ${chartTypes[Math.floor(Math.random() * 3)]}趋势图`;
          }

          return { ...slide, chartHint };
        });
        pushLog(`    数据图表分析完成。`);
      }

      if (skill.id === 'design-polish' || skill.name.includes('设计') || skill.name.includes('优化')) {
        const level = (skill.params.level as string) || 'medium';
        const trimThreshold = level === 'high' ? 12 : level === 'low' ? 20 : 16;

        outline.value = outline.value.map((slide) => {
          const polishedTitle = slide.title.length > trimThreshold
            ? slide.title.slice(0, trimThreshold - 1) + '…'
            : slide.title;

          const polishedBullets = slide.bullets
            .filter(b => b.trim().length > 0)
            .slice(0, level === 'high' ? 4 : level === 'low' ? 6 : 5);

          const notes = slide.speakerNotes || '';
          const designNotes = level === 'high'
            ? '\n\n[设计优化] 标题精简，要点聚焦。建议使用大号字体 + 留白布局。'
            : level === 'medium'
            ? '\n\n[设计优化] 内容结构已优化，要点数适中。'
            : '';

          return {
            ...slide,
            title: polishedTitle,
            bullets: polishedBullets,
            speakerNotes: notes + designNotes
          };
        });
        pushLog(`    设计优化完成（等级: ${level}）。`);
      }

      if (skill.name.includes('摘要') || skill.name.includes('总结')) {
        const maxLen = (skill.params.maxLength as number) || 200;
        const count = Math.round(intensity * 3);
        outline.value = outline.value.map(slide => {
          const keyBullets = slide.bullets.slice(0, Math.max(1, count));
          const summary = keyBullets.join('；');
          const existing = slide.speakerNotes || '';
          return {
            ...slide,
            speakerNotes: existing
              ? `${existing}\n\n[智能摘要] 核心要点：${summary.slice(0, maxLen)}`
              : `[智能摘要] 核心要点：${summary.slice(0, maxLen)}`
          };
        });
        pushLog(`    智能摘要已生成。`);
      }

      if (skill.name.includes('配色') || skill.name.includes('调色')) {
        outline.value = outline.value.map(slide => {
          const notes = slide.speakerNotes || '';
          return {
            ...slide,
            speakerNotes: notes
              ? `${notes}\n\n[配色优化] 建议使用模板主题色 + 互补色强调重点数据。`
              : `[配色优化] 建议使用模板主题色 + 互补色强调重点数据。`
          };
        });
        pushLog(`    配色建议已添加。`);
      }

      if (skill.name.includes('表格') || skill.name.includes('美化')) {
        outline.value = outline.value.map(slide => {
          const hasData = /\d+[万亿千百]|[0-9]+%|同比|环比/.test(
            `${slide.title} ${slide.bullets.join(' ')}`
          );
          const notes = slide.speakerNotes || '';
          const hint = hasData
            ? '\n\n[表格美化] 检测到数据内容，建议使用三线表 + 斑马条纹样式。'
            : '';
          return { ...slide, speakerNotes: notes + hint };
        });
        pushLog(`    表格美化建议已应用。`);
      }

      if (skill.name.includes('图标') || skill.name.includes('推荐')) {
        outline.value = outline.value.map((slide, i) => {
          const iconMap = ['🏢', '📊', '💡', '🚀', '🔧', '📈', '🎯', '⭐', '🌐', '✅'];
          const icon = iconMap[i % iconMap.length];
          const visuals = slide.visualPrompt || '';
          return {
            ...slide,
            visualPrompt: visuals
              ? `${visuals} + 搭配 ${icon} 风格图标`
              : `搭配 ${icon} 风格图标装饰`
          };
        });
        pushLog(`    图标推荐已添加。`);
      }

      if (skill.name.includes('思维导图') || skill.name.includes('脑图')) {
        outline.value = outline.value.map(slide => {
          const notes = slide.speakerNotes || '';
          return {
            ...slide,
            speakerNotes: notes
              ? `${notes}\n\n[思维导图] 可将本页要点转换为层级放射状思维导图。`
              : `[思维导图] 可将本页要点转换为层级放射状思维导图。`
          };
        });
        pushLog(`    思维导图提示已添加。`);
      }

      if (skill.name.includes('翻译')) {
        pushLog(`    翻译助手已就绪（导出时可选多语言版本）。`);
      }

      if (skill.name.includes('动画')) {
        outline.value = outline.value.map(slide => {
          const notes = slide.speakerNotes || '';
          return {
            ...slide,
            speakerNotes: notes
              ? `${notes}\n\n[动画效果] 建议：标题淡入 → 要点逐条滑入 → 图片缩放进入。`
              : `[动画效果] 建议：标题淡入 → 要点逐条滑入 → 图片缩放进入。`
          };
        });
        pushLog(`    动画建议已添加。`);
      }

      // Simulate processing time for realism
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }

    pushLog(`Skill 链路完成，共处理 ${activeSkills.length} 个 Skill。`);
  }

  async function runFullWorkflow() {
    const toastStore = useToastStore();

    if (!activePpt.value) {
      if (!input.value.topic.trim()) {
        toastStore.warning('请填写主题', '请先填写 PPT 主题，再开始生成');
        return;
      }
      
      addPptProject({
        title: input.value.topic.trim(),
        topic: input.value.topic.trim(),
        description: input.value.content.trim() || '自动创建的 PPT 项目',
        templateId: parameters.value.template || 'business'
      });
      
      toastStore.info('已创建 PPT 项目', `已自动创建项目：${input.value.topic.trim()}`);
    }

    if (!checkApiKeys()) return;

    if (isRunning.value) {
      toastStore.warning('工作流正在运行中', '请等待当前任务完成');
      return;
    }

    isRunning.value = true;

    try {
      toastStore.info('开始生成 PPT', '正在处理，请稍候。');

      await runOutline();
      activeStep.value = 'images';
      
      await runImages();
      activeStep.value = 'layout';
      
      await runLayout();
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
    if (!checkActivePpt() || !checkApiKeys()) return;

    const toastStore = useToastStore();

    if (outline.value.length === 0) {
      await runFullWorkflow();
    }
    if (outline.value.length === 0) return;

    activeStep.value = 'preview';
    setStepStatus('preview', 'running', 40);
    pushLog(`开始生成 ${format.toUpperCase()} 导出任务。`);

    try {
      const artifact =
        format === 'pptx'
          ? {
              format,
              name: await exportOutlineToPptx(outline.value, selectedImages.value, parameters.value),
              status: 'ready' as const
            }
          : await exportDeck(format);
      exportArtifacts.value = [artifact, ...exportArtifacts.value.filter((item) => item.format !== format)];
      setStepStatus('preview', 'done', 100);
      pushLog(`${artifact.name} 已准备就绪。`);
      toastStore.success('导出成功', `${artifact.name} 已准备就绪`);
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
    }
  }

  function selectImage(imageId: string) {
    const target = images.value.find((image) => image.id === imageId);
    if (!target) return;
    images.value = images.value.map((image) =>
      image.slideId === target.slideId ? { ...image, selected: image.id === imageId } : image
    );
    pushLog(`已选择插图：${target.title}`);
  }

  function attachFiles(files: FileList | null) {
    if (!files) return;
    input.value.files = Array.from(files).map((file) => file.name);
    pushLog(`已接收 ${input.value.files.length} 个资料文件。`);
  }

  function addSampleOutline() {
    saveHistory();
    outline.value = [
      { id: 'sample-1', title: '市场概况与行业趋势', bullets: ['全球市场规模及增长预测', '主要竞争对手分析', '行业技术演进路线', '政策与监管环境'], speakerNotes: '简要概述行业背景，引用权威数据来源支撑论点。', visualPrompt: '市场增长趋势图表', chartHint: '建议使用折线图展示增长趋势', layout: 'text-only' },
      { id: 'sample-2', title: '核心产品与技术优势', bullets: ['产品架构与核心技术', '与竞品的差异化对比', '技术壁垒与专利布局', '产品路线图'], speakerNotes: '重点突出技术独特性，用对比表格展示差异化优势。', visualPrompt: '产品架构示意图', chartHint: '建议使用对比表格', layout: 'text-image' },
      { id: 'sample-3', title: '商业模式与盈利分析', bullets: ['收入模型与定价策略', '成本结构与毛利分析', '客户获取成本与LTV', '盈亏平衡预测'], speakerNotes: '用数据说话，展示单位经济模型和长期盈利预期。', visualPrompt: '商业模式画布', chartHint: '建议使用柱状图展示收入构成', layout: 'image-text' },
      { id: 'sample-4', title: '实施计划与里程碑', bullets: ['分阶段实施路线图', '关键里程碑与交付物', '资源需求与团队配置', '风险管理计划'], speakerNotes: '明确时间节点和可量化的交付标准，增强可信度。', visualPrompt: '项目甘特图', layout: 'text-only' },
      { id: 'sample-5', title: '总结与展望', bullets: ['核心结论与关键数据', '未来发展方向', '合作建议与下一步行动'], speakerNotes: '总结核心观点，明确下一步行动计划和合作邀约。', visualPrompt: '未来愿景图示', layout: 'full-image' }
    ];
    pushLog('已加载示例大纲数据');
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
      console.error('加载技能失败，使用默认数据:', error);
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
      console.error('加载模板失败，使用默认数据:', error);
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
        description: input.value.content.trim() || '通过模版广场创建',
        templateId
      });
    }

    pushLog(`已应用模版：${template.name}（${template.category || '未分类'}）→ 样式: ${style}`);
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
        images: images.value.map(img => ({ ...img })),
        skills: skills.value.map(s => ({ ...s, params: { ...s.params } })),
        pptProjects: pptProjects.value.map(p => ({
          ...p,
          state: { ...p.state, input: { ...p.state.input, files: [] } }
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
      steps.value = snapshot.steps || cloneSteps();

      // Restore active project state into global refs
      if (activePpt.value) {
        restoreProjectState(activePpt.value.state);
      }

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
      pushLog('已恢复上次保存的工作流数据');
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
    currentGeneratingSlide,
    generatedSlides,
    isDataLoaded,
    addPptProject,
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
    clearSavedWorkflow
  };
});
