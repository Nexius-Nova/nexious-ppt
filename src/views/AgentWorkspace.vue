<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from "vue";
import { storeToRefs } from "pinia";
import { useRoute, useRouter } from "vue-router";
import {
  Brain,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Image,
  Loader2,
  Maximize2,
  Paintbrush,
  Pause,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  RotateCcw,
  Wand2,
  X
} from "lucide-vue-next";
import AppShell from "@/components/layout/AppShell.vue";
import SideNavigation from "@/components/layout/SideNavigation.vue";
import WorkspaceHeader from "@/components/layout/WorkspaceHeader.vue";
import ActivityLog from "@/components/panels/ActivityLog.vue";
import InputComposer from "@/components/panels/InputComposer.vue";
import OutlineEditor from "@/components/panels/OutlineEditor.vue";
import DeckPreview from "@/components/preview/DeckPreview.vue";
import SvgDeckPreview from "@/components/preview/SvgDeckPreview.vue";
import UiBadge from "@/components/ui/UiBadge.vue";
import UiButton from "@/components/ui/UiButton.vue";
import UiProgress from "@/components/ui/UiProgress.vue";
import MyPptPage from "@/components/pages/MyPptPage.vue";
import PromptManagePage from "@/components/pages/PromptManagePage.vue";
import SkillManagePage from "@/components/pages/SkillManagePage.vue";
import ModelManagePage from "@/components/pages/ModelManagePage.vue";
import TemplateGalleryPage from "@/components/pages/TemplateGalleryPage.vue";
import RunConfigPage from "@/components/pages/RunConfigPage.vue";
import ProfilePage from "@/components/pages/ProfilePage.vue";
import GlobalSearch from "@/components/common/GlobalSearch.vue";
import ShortcutsHelp from "@/components/common/ShortcutsHelp.vue";
import AiChatPanel from "@/components/panels/AiChatPanel.vue";
import VersionHistory from "@/components/common/VersionHistory.vue";
import PageLoadingState from "@/components/common/PageLoadingState.vue";
import PrivateImage from "@/components/common/PrivateImage.vue";
import PrivateSvg from "@/components/common/PrivateSvg.vue";
import { useAgentStore } from "@/stores/agentStore";
import { useApiKeyStore } from "@/stores/apiKeyStore";
import { useShortcuts } from "@/composables/useShortcuts";
import { slideNeedsImage } from "@/utils/slideVisuals";
import type {
  GeneratedImage,
  WorkflowStep,
  WorkflowStepId
} from "@/types/agent";
import type { PptxExportOptions } from "@/services/api";

const route = useRoute();
const router = useRouter();
const store = useAgentStore();
const apiKeyStore = useApiKeyStore();

const {
  activityLog,
  activePpt,
  exportArtifacts,
  images,
  isPaused,
  pauseRequested,
  resumeStage,
  input,
  isRunning,
  outline,
  parameters,
  selectedImages,
  steps,
  svgPages,
  currentGeneratingSlide,
  isDataLoaded,
  configOptions,
  prompts,
  skills,
  selectedPromptId,
  selectedTextModelId,
  selectedImageModelId,
  inputProcessSteps,
  uploadedFileContents,
  templates,
  selectedTemplate,
  designSpec,
  specLock,
  retryingPageNumbers
} = storeToRefs(store);

const {
  textModels,
  imageModels
} = storeToRefs(apiKeyStore);

const showRightPanel = ref(true);
const isSideNavCollapsed = ref(false);
const previewPageIndex = ref(0);
const showPresentation = ref(false);
const presentationIndex = ref(0);
const showGlobalSearch = ref(false);
const showShortcutsHelp = ref(false);
const exportProgress = ref(0);
const isExporting = ref(false);
const exportHistory = ref<
  Array<{
    id: string;
    filename: string;
    format: "pptx" | "pdf";
    status: "ready" | "queued" | "exporting";
    createdAt: number;
  }>
>([]);
const previewingImage = ref<GeneratedImage | null>(null);
const routeReady = ref(false);
const resourcesSyncing = ref(false);
const lastResourceSyncedAt = ref(0);

useShortcuts([
  {
    key: "k",
    ctrl: true,
    description: "打开全局搜索",
    handler: () => {
      showGlobalSearch.value = true;
    }
  },
  {
    key: "s",
    ctrl: true,
    description: "保存工作流",
    handler: () => store.saveWorkflow()
  },
  {
    key: "Enter",
    ctrl: true,
    description: "运行当前阶段",
    handler: () => runFromCurrentStep()
  },
  {
    key: "/",
    shift: true,
    description: "显示快捷键帮助",
    handler: () => {
      showShortcutsHelp.value = true;
    }
  },
  {
    key: "z",
    ctrl: true,
    description: "撤销",
    handler: () => store.undoOutline()
  },
  {
    key: "z",
    ctrl: true,
    shift: true,
    description: "重做",
    handler: () => store.redoOutline()
  }
]);

const pageRouteToStep: Record<string, WorkflowStepId> = {
  "/": "my-ppt",
  "/my-ppt": "my-ppt",
  "/prompts": "prompts",
  "/skills": "skills",
  "/models": "models",
  "/templates": "templates",
  "/config": "config",
  "/profile": "profile"
};

function routePageStep(path: string): WorkflowStepId | null {
  return pageRouteToStep[path] || null;
}

function selectInputTemplate(templateId: string) {
  const template = templates.value.find((item) => item.id === templateId);
  if (template) {
    store.applyGalleryTemplate(template);
  }
}

const activeStep = computed<WorkflowStepId>({
  get: () => {
    if (!isProjectRoute.value) {
      return routePageStep(route.path) || "my-ppt";
    }
    return store.activeStep;
  },
  set: (value) => {
    const step = value as WorkflowStepId;
    if (isWorkflowTab(step)) {
      goToWorkflowStep(step);
    } else {
      store.activeStep = step;
    }
  }
});

const stepTitles: Record<string, string> = {
  "my-ppt": "我的 PPT",
  templates: "模板广场",
  prompts: "提示词管理",
  skills: "Skill 管理",
  models: "模型管理",
  config: "运行配置",
  input: "输入内容",
  outline: "生成大纲",
  images: "生成图片",
  layout: "生成页面",
  preview: "预览导出"
};

const currentStepTitle = computed(
  () => stepTitles[activeStep.value] || "工作区"
);
const isPageView = computed(() =>
  [
    "my-ppt",
    "prompts",
    "skills",
    "models",
    "templates",
    "config",
    "profile"
  ].includes(activeStep.value)
);
const isProjectRoute = computed(
  () => route.name === "project-edit" || route.path.startsWith("/project/")
);
const routeProjectId = computed(() => {
  const id = route.params.id;
  return Array.isArray(id) ? id[0] || "" : String(id || "");
});
const showProjectAssistant = computed(() =>
  Boolean(
    isProjectRoute.value &&
    activePpt.value &&
    routeProjectId.value &&
    String(activePpt.value.id) === routeProjectId.value
  )
);
const assistantProject = computed(() =>
  showProjectAssistant.value ? activePpt.value : null
);
const layoutTotalPages = computed(
  () =>
    designSpec.value?.outline.length ||
    outline.value.length ||
    parameters.value.slideCount ||
    0
);
const svgPageByNumber = computed(() => {
  const map = new Map<number, (typeof svgPages.value)[number]>();
  svgPages.value.forEach((page) => {
    if (Number.isInteger(page.pageNumber) && page.pageNumber > 0) {
      map.set(page.pageNumber, page);
    }
  });
  return map;
});
const layoutDisplayPages = computed(() => {
  const maxExistingPage = svgPages.value.reduce(
    (max, page) => Math.max(max, Number(page.pageNumber) || 0),
    0
  );
  const total = Math.max(layoutTotalPages.value, maxExistingPage);
  return Array.from({ length: total }, (_, index) => {
    const pageNumber = index + 1;
    const page = svgPageByNumber.value.get(pageNumber);
    return {
      pageNumber,
      svg: page?.svg || "",
      speakerNotes: page?.speakerNotes || "",
      visualSummary: page?.visualSummary,
      missing: !page?.svg,
      fallback: Boolean(page?.svg && isFallbackPageSvg(page.svg))
    };
  });
});
const hasAnySvgPage = computed(() =>
  layoutDisplayPages.value.some((page) => page.svg.trim())
);
const layoutCompletedPages = computed(
  () =>
    layoutDisplayPages.value.filter(
      (page) => page.svg.trim() && !page.fallback
    ).length
);
const layoutProgressPercent = computed(() => {
  if (layoutTotalPages.value === 0) return 0;
  return Math.min(
    100,
    Math.round((layoutCompletedPages.value / layoutTotalPages.value) * 100)
  );
});
const exportReadiness = computed(() => store.exportReadiness());
const canExportDeck = computed(
  () => exportReadiness.value.ready && !isExporting.value
);
const latestSvgPage = computed(
  () =>
    [...layoutDisplayPages.value]
      .reverse()
      .find((page) => page.svg.trim() && !page.fallback) ||
    [...layoutDisplayPages.value].reverse().find((page) => page.svg.trim()) ||
    null
);
const layoutPreviewPage = computed(() => {
  const retryingPageNumber = [...retryingPageNumbers.value][0];
  if (retryingPageNumber) {
    return layoutDisplayPages.value.find((page) => page.pageNumber === retryingPageNumber) || {
      pageNumber: retryingPageNumber,
      svg: "",
      speakerNotes: "",
      missing: true,
      fallback: false
    };
  }
  return latestSvgPage.value;
});
const presentationPages = computed(() => layoutDisplayPages.value);
const presentationPage = computed(() => {
  if (!presentationPages.value.length) return null;
  const index = Math.min(
    Math.max(presentationIndex.value, 0),
    presentationPages.value.length - 1
  );
  return presentationPages.value[index] || null;
});
const slidesNeedingImages = computed(() => {
  const slides = designSpec.value?.outline || outline.value;
  return slides.filter((slide: any) => slideNeedsImage(slide));
});
const imageStepSkipped = computed(() => {
  const step = steps.value.find((s) => s.id === "images");
  return Boolean(
    designSpec.value &&
    slidesNeedingImages.value.length === 0 &&
    step?.status === "done"
  );
});
const completedImageCount = computed(
  () =>
    images.value.filter(
      (image) => image.selected && !image.error && Boolean(image.url)
    ).length
);
function normalizeSlideImagePlansForView(slide: any) {
  const rawPlans = Array.isArray(slide?.imagePlan) ? slide.imagePlan : [];
  const plans = rawPlans
    .slice(0, 4)
    .map((plan: any, index: number) => ({
      id: String(plan?.id || `img-${index + 1}`),
      prompt: String(plan?.prompt || '').trim(),
      purpose: plan?.purpose ? String(plan.purpose) : undefined,
    }))
    .filter((plan: any) => plan.prompt);
  if (plans.length) return plans;
  const legacyPrompt = String(slide?.visualPrompt || '').trim();
  if (!legacyPrompt || Array.isArray(slide?.imagePlan)) return [];
  return [{ id: 'img-1', prompt: legacyPrompt, purpose: 'supporting' }];
}

function firstImageForSlide(slideId: string) {
  return imagesBySlideId.value.get(slideId)?.[0] || null;
}

function imageStatusForSlide(slide: any) {
  const plans = normalizeSlideImagePlansForView(slide);
  const slideImages = imagesBySlideId.value.get(slide.id) || [];
  const readyKeys = new Set(slideImages.filter((image) => image.selected && !image.error && image.url).map((image) => image.assetId || 'img-1'));
  const failedImage = slideImages.find((image) => image.error);
  if (failedImage) return 'error';
  if (plans.length > 0 && plans.every((plan: any) => readyKeys.has(plan.id))) return 'done';
  if (currentGeneratingSlide.value === slide.id) return 'running';
  return 'waiting';
}

const pendingRequiredImageSlides = computed(() =>
  slidesNeedingImages.value.filter(
    (slide: any) => imageStatusForSlide(slide) !== 'done'
  )
);
const hasPendingRequiredImages = computed(
  () => pendingRequiredImageSlides.value.length > 0
);
const imagesBySlideId = computed(() => {
  const map = new Map<string, Array<(typeof images.value)[number]>>();
  for (const image of images.value) {
    const list = map.get(image.slideId) || [];
    list.push(image);
    map.set(image.slideId, list);
  }
  return map;
});
const previewingImageSlide = computed(() => {
  if (!previewingImage.value) return null;
  return (
    (designSpec.value?.outline || outline.value).find(
      (slide: any) => slide.id === previewingImage.value?.slideId
    ) || null
  );
});
const activeProjectTitle = computed(
  () => activePpt.value?.title || input.value.topic || "尚未选择 PPT 项目"
);
const inputReadyLabel = computed(() =>
  hasInputContent() ? "已完成" : "待输入"
);
const outlineBulletCount = computed(() =>
  outline.value.reduce((sum, slide) => sum + slide.bullets.length, 0)
);
const outlineStepStatus = computed(
  () =>
    workflowDisplaySteps.value.find((step) => step.id === "outline")?.status ||
    "idle"
);
const pausedStageId = computed<WorkflowStepId | null>(() => {
  if (!isPaused.value) return null;
  if (
    isWorkflowTab(activeStep.value) &&
    stepState(activeStep.value)?.status === "running"
  ) {
    return activeStep.value;
  }
  const runningStage = [...workflowTabs]
    .reverse()
    .find((id) => stepState(id)?.status === "running");
  if (runningStage) return runningStage;
  const stage = resumeStage.value || activeStep.value;
  return isWorkflowTab(stage) ? stage : null;
});
const isOutlinePaused = computed(() => pausedStageId.value === "outline");
const isOutlineRunning = computed(
  () => outlineStepStatus.value === "running" && !isOutlinePaused.value
);
const hasRunningWorkflowStep = computed(() =>
  workflowTabs.some((id) => stepState(id)?.status === "running")
);
const canPauseWorkflow = computed(
  () =>
    !isPaused.value &&
    (isRunning.value || hasRunningWorkflowStep.value || pauseRequested.value)
);
const outlineStatusText = computed(() => {
  if (isOutlinePaused.value) return "已暂停";
  if (isOutlineRunning.value) return "生成中";
  if (outline.value.length > 0 || designSpec.value) return "已生成";
  return "待生成";
});
const canRunCurrentStage = computed(() => {
  if (canPauseWorkflow.value) return false;
  if (!isWorkflowTab(activeStep.value)) return false;
  if (activeStep.value === "input") return true;
  return canOpenWorkflowStep(activeStep.value);
});
const workflowDisplaySteps = computed<WorkflowStep[]>(() =>
  steps.value.map((step) => {
    if (isPaused.value && step.status === "running") {
      return {
        ...step,
        status: "idle"
      };
    }
    if (
      hasPendingRequiredImages.value &&
      step.id === "layout" &&
      step.status !== "idle"
    ) {
      return {
        ...step,
        status: "idle",
        progress: 0
      };
    }
    if (
      hasPendingRequiredImages.value &&
      step.id === "preview" &&
      step.status !== "idle"
    ) {
      return {
        ...step,
        status: "idle",
        progress: 0
      };
    }
    if (
      hasPendingRequiredImages.value &&
      step.id === "images" &&
      step.status === "done"
    ) {
      return {
        ...step,
        status: "idle",
        progress: Math.round(
          (completedImageCount.value /
            Math.max(1, slidesNeedingImages.value.length)) *
            100
        )
      };
    }
    if (step.id !== "input" || !hasInputContent()) return step;
    return {
      ...step,
      status: "done",
      progress: 100
    };
  })
);
const currentProgress = computed(
  () =>
    workflowDisplaySteps.value.find((step) => step.id === activeStep.value)
      ?.progress || 0
);
const pipelineStages = computed(() => {
  const byId = new Map(
    workflowDisplaySteps.value.map((step) => [step.id, step])
  );
  const stageInput = byId.get("input");
  const stageOutline = byId.get("outline");
  const stageImages = byId.get("images");
  const stageLayout = byId.get("layout");
  const stagePreview = byId.get("preview");

  const stages = [
    {
      id: "input" as WorkflowStepId,
      icon: FileText,
      title: "输入内容",
      description: input.value.files.length
        ? `${input.value.files.length} 个文件`
        : hasInputContent()
          ? "内容已准备"
          : "等待输入",
      status: stageInput?.status || "idle",
      progress: stageInput?.progress || 0,
      metric: hasInputContent() ? "内容就绪" : "待输入",
      action: "编辑内容"
    },
    {
      id: "outline" as WorkflowStepId,
      icon: Brain,
      title: "生成大纲",
      description:
        designSpec.value && specLock.value ? "大纲已生成" : "整理内容结构",
      status: stageOutline?.status || "idle",
      progress: stageOutline?.progress || 0,
      metric: designSpec.value ? `${outline.value.length} 页大纲` : "待生成",
      action: designSpec.value ? "查看大纲" : "生成大纲"
    },
    {
      id: "images" as WorkflowStepId,
      icon: Image,
      title: "生成图片",
      description: imageStepSkipped.value
        ? "无需图片"
        : slidesNeedingImages.value.length > 0
          ? `${slidesNeedingImages.value.length} 页需要图片`
          : "等待判断",
      status: stageImages?.status || "idle",
      progress: imageStepSkipped.value ? 100 : stageImages?.progress || 0,
      metric: imageStepSkipped.value
        ? "无需图片"
        : `${completedImageCount.value}/${Math.max(1, slidesNeedingImages.value.length)} 张`,
      action: "查看状态",
      skipped: imageStepSkipped.value
    },
    {
      id: "layout" as WorkflowStepId,
      icon: Paintbrush,
      title: "生成页面",
      description: isPaused.value ? "已暂停，可继续" : "页面会实时出现",
      status: stageLayout?.status || "idle",
      progress:
        stageLayout?.status === "done" ? 100 : layoutProgressPercent.value,
      metric: `${layoutCompletedPages.value}/${layoutTotalPages.value || 0} 页`,
      action: hasAnySvgPage.value ? "查看预览" : "开始生成"
    },
    {
      id: "preview" as WorkflowStepId,
      icon: ShieldCheck,
      title: "预览导出",
      description: "生成 PPTX",
      status: stagePreview?.status || "idle",
      progress: stagePreview?.progress || 0,
      metric: exportArtifacts.value.length
        ? `${exportArtifacts.value.length} 个文件`
        : "待导出",
      action: "预览导出"
    }
  ];

  return stages.map((stage) => {
    const paused = pausedStageId.value === stage.id;
    return {
      ...stage,
      description: paused ? "已暂停，可继续" : stage.description,
      paused,
      disabled: !canOpenWorkflowStep(stage.id)
    };
  });
});

const workflowTabs = [
  "input",
  "outline",
  "images",
  "layout",
  "preview"
] as const;
const workflowTabSet = new Set<string>(workflowTabs);

function isWorkflowTab(step: string): step is WorkflowStepId {
  return workflowTabSet.has(step);
}

function stepState(step: WorkflowStepId) {
  return steps.value.find((item) => item.id === step);
}

function hasInputContent() {
  return Boolean(
    input.value.topic.trim() ||
    input.value.content.trim() ||
    input.value.files.length > 0
  );
}

function hasOutlineContent() {
  return Boolean(
    (designSpec.value && specLock.value) || outline.value.length > 0
  );
}

function canOpenWorkflowStep(step: WorkflowStepId) {
  if (step === "input") return true;
  if (step === "outline") return hasInputContent();
  if (step === "images") return hasOutlineContent();
  if (step === "layout") {
    const layoutStep = stepState("layout");
    return Boolean(
      (hasOutlineContent() && !hasPendingRequiredImages.value) ||
      hasAnySvgPage.value ||
      layoutStep?.status === "running" ||
      layoutStep?.status === "done"
    );
  }
  if (step === "preview") return hasAnySvgPage.value;
  return false;
}

function nearestAvailableWorkflowStep(target: WorkflowStepId) {
  if (canOpenWorkflowStep(target)) return target;
  const targetIndex = workflowTabs.indexOf(
    target as (typeof workflowTabs)[number]
  );
  for (let i = targetIndex - 1; i >= 0; i--) {
    const candidate = workflowTabs[i];
    if (canOpenWorkflowStep(candidate)) return candidate;
  }
  return "input";
}

function routeWorkflowTab(): WorkflowStepId {
  const tab = String(route.params.tab || "input");
  return isWorkflowTab(tab) ? tab : "input";
}

function projectStepPath(projectId: string, step: WorkflowStepId) {
  return `/project/${projectId}/${step}`;
}

function goToWorkflowStep(step: WorkflowStepId) {
  if (!isWorkflowTab(step)) {
    store.activeStep = step;
    return;
  }

  if (!canOpenWorkflowStep(step)) return;

  const projectId = String(route.params.id || store.activePptId || "");
  if (!projectId) {
    store.activeStep = step;
    return;
  }

  const target = projectStepPath(projectId, step);
  if (route.path !== target) {
    void router.push(target);
    return;
  }

  store.activeStep = step;
}

let routeSyncToken = 0;
let isSyncingRouteStep = false;
let resourceRefreshPromise: Promise<void> | null = null;

function reconcileSelectedModels() {
  if (
    selectedTextModelId.value &&
    !textModels.value.some((model) => model.id === selectedTextModelId.value)
  ) {
    store.selectProjectTextModel(null);
  }

  if (
    selectedImageModelId.value &&
    !imageModels.value.some((model) => model.id === selectedImageModelId.value)
  ) {
    store.selectProjectImageModel(null);
  }
}

async function refreshWorkspaceResources() {
  if (resourceRefreshPromise) return resourceRefreshPromise;

  resourcesSyncing.value = true;
  resourceRefreshPromise = Promise.all([
    store.fetchPrompts(),
    store.fetchSkills(),
    store.fetchTemplates(),
    store.fetchConfigs(),
    apiKeyStore.fetchApiKeys()
  ])
    .then(() => {
      reconcileSelectedModels();
      lastResourceSyncedAt.value = Date.now();
    })
    .finally(() => {
      resourceRefreshPromise = null;
      resourcesSyncing.value = false;
    });

  return resourceRefreshPromise;
}

async function refreshPromptResources() {
  resourcesSyncing.value = true;
  try {
    await store.fetchPrompts();
    lastResourceSyncedAt.value = Date.now();
  } finally {
    resourcesSyncing.value = false;
  }
}

async function refreshSkillResources() {
  resourcesSyncing.value = true;
  try {
    await store.fetchSkills();
    lastResourceSyncedAt.value = Date.now();
  } finally {
    resourcesSyncing.value = false;
  }
}

async function refreshTemplateResources() {
  resourcesSyncing.value = true;
  try {
    await store.fetchTemplates();
    lastResourceSyncedAt.value = Date.now();
  } finally {
    resourcesSyncing.value = false;
  }
}

async function refreshModelResources() {
  resourcesSyncing.value = true;
  try {
    await apiKeyStore.fetchApiKeys();
    reconcileSelectedModels();
    lastResourceSyncedAt.value = Date.now();
  } finally {
    resourcesSyncing.value = false;
  }
}

function openComposerResource(module: "prompt" | "template" | "skills" | "config") {
  const target: Record<typeof module, string> = {
    prompt: "prompts",
    template: "templates",
    skills: "skills",
    config: "models"
  };
  handleNavigate(target[module]);
}

async function handleRouteChange() {
  await syncStepWithRoute();
  if (isProjectRoute.value && isWorkflowTab(activeStep.value)) {
    void refreshWorkspaceResources();
  }
}

async function syncStepWithRoute() {
  const token = ++routeSyncToken;
  routeReady.value = false;
  const path = route.path;

  if (path.startsWith("/project/")) {
    const routeProjectId = String(route.params.id || "");
    const rawTab = String(route.params.tab || "");
    const requestedTab = routeWorkflowTab();
    isSyncingRouteStep = true;
    try {
      store.activeStep = requestedTab;
      if (routeProjectId && store.activePptId !== routeProjectId) {
        await store.selectPptProject(routeProjectId);
        if (token !== routeSyncToken) return;
      }
      const tab = nearestAvailableWorkflowStep(requestedTab);
      store.activeStep = tab;
      if (
        (!route.params.tab ||
          (rawTab && !isWorkflowTab(rawTab)) ||
          tab !== requestedTab) &&
        routeProjectId
      ) {
        void router.replace(projectStepPath(routeProjectId, tab));
      }
    } finally {
      if (token === routeSyncToken) {
        isSyncingRouteStep = false;
        routeReady.value = true;
      }
    }
  } else {
    isSyncingRouteStep = false;
    store.activeStep = routePageStep(path) || "my-ppt";
    if (token === routeSyncToken) {
      routeReady.value = true;
    }
  }
}

watch(
  () => route.fullPath,
  () => {
    void handleRouteChange();
  }
);

watch(
  () => store.activeStep,
  (step) => {
    if (isSyncingRouteStep) return;
    if (!route.path.startsWith("/project/") || !isWorkflowTab(step)) return;
    const projectId = String(route.params.id || store.activePptId || "");
    if (!projectId) return;
    const target = projectStepPath(projectId, step);
    if (route.path !== target) {
      void router.replace(target);
    }
  }
);

onMounted(async () => {
  window.addEventListener("keydown", onPresentationKeydown);
  await Promise.all([store.initializeData(), apiKeyStore.fetchApiKeys()]);
  await syncStepWithRoute();
  if (isProjectRoute.value && isWorkflowTab(activeStep.value)) {
    void refreshWorkspaceResources();
  }
  void store.resumeRecoveredWorkflow();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onPresentationKeydown);
  store.syncToProject();
});

function handleNavigate(step: string) {
  const pageSteps = [
    "my-ppt",
    "prompts",
    "skills",
    "models",
    "templates",
    "config",
    "profile"
  ];
  if (pageSteps.includes(step)) {
    const stepToRoute: Record<string, string> = {
      "my-ppt": "/my-ppt",
      prompts: "/prompts",
      skills: "/skills",
      models: "/models",
      templates: "/templates",
      config: "/config",
      profile: "/profile"
    };
    const routePath = stepToRoute[step];
    if (routePath) router.push(routePath);
  } else {
    goToWorkflowStep(step as WorkflowStepId);
  }
}

function returnToMyPpt() {
  void router.push("/my-ppt");
}

function openPresentation() {
  if (!presentationPages.value.length) return;
  presentationIndex.value = Math.min(
    Math.max(previewPageIndex.value, 0),
    presentationPages.value.length - 1
  );
  showPresentation.value = true;
}

function closePresentation() {
  showPresentation.value = false;
}

function previousPresentationPage() {
  presentationIndex.value = Math.max(0, presentationIndex.value - 1);
}

function nextPresentationPage() {
  presentationIndex.value = Math.min(
    presentationPages.value.length - 1,
    presentationIndex.value + 1
  );
}

function onPresentationKeydown(event: KeyboardEvent) {
  if (!showPresentation.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closePresentation();
    return;
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    event.preventDefault();
    previousPresentationPage();
    return;
  }
  if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === " ") {
    event.preventDefault();
    nextPresentationPage();
  }
}

async function runFromCurrentStep() {
  try {
    if (isPaused.value) {
      await store.continueWorkflow();
      return;
    }
    switch (activeStep.value) {
      case "input":
        await store.runInputStage({ advance: false });
        break;
      case "outline":
        await store.runOutline();
        break;
      case "images":
        await store.runImages();
        break;
      case "layout":
        await store.runLayout();
        break;
      case "preview":
        if (!exportReadiness.value.ready) {
          goToWorkflowStep("layout");
          await store.runLayout();
          return;
        }
        await handleExport("pptx", {
          filename: "presentation",
          pageRange: "all"
        });
        break;
      default:
        await store.runInputStage();
    }
  } catch {
    // Store actions already surface the actionable message.
  }
}

function buildExportOptions(format: "pptx" | "pdf"): PptxExportOptions {
  const enabledSetting = String(parameters.value.animationEnabled || "auto");
  const effectSetting = String(parameters.value.animationEffect || "auto");
  const enabled = format === "pptx" && enabledSetting === "enabled";
  const effect = [
    "appear",
    "fade",
    "fly",
    "cut",
    "zoom",
    "wipe",
    "split",
    "blinds",
    "checkerboard",
    "dissolve",
    "random_bars",
    "peek",
    "wheel",
    "box",
    "circle",
    "diamond",
    "plus",
    "strips",
    "wedge",
    "stretch",
    "expand",
    "swivel",
    "auto",
    "mixed",
    "random"
  ].includes(effectSetting)
    ? (effectSetting as NonNullable<PptxExportOptions["animation"]>["effect"])
    : "auto";
  return {
    animation: {
      enabled,
      effect: enabled ? effect : "none",
      duration: 0.62,
      stagger: 0.2,
      trigger: "after-previous",
      transitionEffect: enabled ? "push" : "none",
      transitionDuration: 0.55
    }
  };
}

async function handleExport(
  format: "pptx" | "pdf",
  options: { filename: string; pageRange: string }
) {
  if (isExporting.value) return;
  isExporting.value = true;
  exportProgress.value = 0;
  const exportId = `export-${Date.now()}`;

  exportHistory.value.unshift({
    id: exportId,
    filename: `${options.filename}.${format}`,
    format,
    status: "exporting",
    createdAt: Date.now()
  });

  const progressInterval = window.setInterval(() => {
    exportProgress.value = Math.min(90, exportProgress.value + 12);
  }, 300);

  try {
    await store.exportCurrentDeck(format, buildExportOptions(format));
    exportProgress.value = 100;
    window.clearInterval(progressInterval);
    const item = exportHistory.value.find((h) => h.id === exportId);
    if (item) item.status = "ready";
  } catch {
    window.clearInterval(progressInterval);
    const item = exportHistory.value.find((h) => h.id === exportId);
    if (item) item.status = "queued";
  } finally {
    window.setTimeout(() => {
      isExporting.value = false;
    }, 500);
  }
}

function stageTone(status: WorkflowStep["status"], skipped?: boolean) {
  if (skipped) return "neutral";
  if (status === "done") return "success";
  if (status === "running") return "accent";
  return "neutral";
}

function stageLabel(
  status: WorkflowStep["status"],
  skipped?: boolean,
  paused?: boolean
) {
  if (paused) return "已暂停";
  if (skipped) return "已完成";
  if (status === "done") return "已完成";
  if (status === "running") return "运行中";
  return "等待中";
}

function imagePageNumber(slide: unknown, index: number) {
  if (slide && typeof slide === "object" && "pageNumber" in slide) {
    const pageNumber = Number((slide as { pageNumber?: number }).pageNumber);
    if (Number.isFinite(pageNumber) && pageNumber > 0) return pageNumber;
  }
  return index + 1;
}

function isFallbackPageSvg(svg?: string) {
  return Boolean(svg && svg.includes("本页待重试"));
}

function openImagePreview(slideId: string) {
  const image = firstImageForSlide(slideId);
  if (!image?.url || image.error) return;
  previewingImage.value = image;
}

async function retryImage(slideId: string) {
  await store.retrySlideImage(slideId);
  const updated = firstImageForSlide(slideId);
  if (previewingImage.value?.slideId === slideId) {
    previewingImage.value =
      updated && !updated.error && updated.url ? updated : null;
  }
}
</script>

<template>
  <AppShell
    :class="{
      'app-shell--nav-collapsed': isSideNavCollapsed,
      'app-shell--workflow-focus': isProjectRoute
    }"
  >
    <WorkspaceHeader />
    <SideNavigation
      v-if="!isProjectRoute"
      :collapsed="isSideNavCollapsed"
      @toggle-collapse="isSideNavCollapsed = !isSideNavCollapsed"
    />

    <main class="workspace-main">
      <div v-if="!routeReady" class="workspace-route-loading">
        <PageLoadingState
          compact
          title="正在打开页面"
          description="正在准备工作区和项目上下文"
        />
      </div>

      <template v-else-if="isPageView">
        <MyPptPage v-if="activeStep === 'my-ppt'" />
        <PromptManagePage
          v-else-if="activeStep === 'prompts'"
          @changed="refreshPromptResources"
        />
        <SkillManagePage
          v-else-if="activeStep === 'skills'"
          @changed="refreshSkillResources"
        />
        <ModelManagePage
          v-else-if="activeStep === 'models'"
          @changed="refreshModelResources"
        />
        <TemplateGalleryPage
          v-else-if="activeStep === 'templates'"
          @changed="refreshTemplateResources"
        />
        <RunConfigPage v-else-if="activeStep === 'config'" />
        <ProfilePage v-else-if="activeStep === 'profile'" />
      </template>

      <template v-else>
        <section class="workspace-step-header">
          <div class="workspace-step-header__info">
            <button
              class="workflow-back-button"
              type="button"
              title="返回我的 PPT"
              @click="returnToMyPpt"
            >
              <ChevronLeft :size="16" />
            </button>
            <div>
              <h2>{{ currentStepTitle }}</h2>
              <p>{{ activeProjectTitle }}</p>
            </div>
            <UiProgress
              v-if="currentProgress > 0 && currentProgress < 100"
              :value="currentProgress"
              size="sm"
              show-label
            />
          </div>
          <div class="workspace-step-header__actions">
            <VersionHistory />
            <UiButton variant="ghost" @click="store.saveWorkflow">
              <Save :size="14" />
              保存
            </UiButton>
            <UiButton
              v-if="canPauseWorkflow"
              variant="secondary"
              :disabled="pauseRequested"
              @click="void store.requestPauseWorkflow()"
            >
              <Pause :size="14" />
              {{ pauseRequested ? "暂停中" : "暂停" }}
            </UiButton>
            <UiButton
              v-else-if="isPaused"
              variant="primary"
              @click="store.continueWorkflow"
            >
              <Play :size="14" />
              继续
            </UiButton>
            <UiButton
              variant="secondary"
              :disabled="!canRunCurrentStage"
              @click="runFromCurrentStep"
            >
              <Play :size="14" />
              运行当前阶段
            </UiButton>
            <button
              class="workspace-step-header__toggle"
              @click="showRightPanel = !showRightPanel"
              title="切换运行日志"
            >
              <component
                :is="showRightPanel ? ChevronRight : ChevronLeft"
                :size="16"
              />
            </button>
          </div>
        </section>

        <div
          class="workspace-content-wrapper"
          :class="{ 'workspace-content-wrapper--single': !showRightPanel }"
        >
          <section class="workspace-content-main">
            <div class="pipeline-console">
              <section class="pipeline-stages" aria-label="PPT 生成流程">
                <button
                  v-for="stage in pipelineStages"
                  :key="stage.id"
                  class="pipeline-stage"
                  type="button"
                  :disabled="stage.disabled"
                  :aria-disabled="stage.disabled"
                  :title="`${stage.title}：${stageLabel(stage.status, stage.skipped, stage.paused)}，${stage.metric}`"
                  :class="{
                    'pipeline-stage--active': activeStep === stage.id,
                    'pipeline-stage--running':
                      stage.status === 'running' && !stage.paused,
                    'pipeline-stage--paused': stage.paused,
                    'pipeline-stage--done': stage.status === 'done',
                    'pipeline-stage--skipped': stage.skipped,
                    'pipeline-stage--disabled': stage.disabled
                  }"
                  @click="goToWorkflowStep(stage.id)"
                >
                  <span class="pipeline-stage__icon">
                    <component
                      :is="
                        stage.status === 'running' && !stage.paused
                          ? Loader2
                          : stage.icon
                      "
                      :size="18"
                      :class="{
                        'pipeline-stage__spin':
                          stage.status === 'running' && !stage.paused
                      }"
                    />
                  </span>
                  <span class="pipeline-stage__body">
                    <span class="pipeline-stage__head">
                      <strong>{{ stage.title }}</strong>
                      <UiBadge
                        :tone="
                          stage.paused
                            ? 'warning'
                            : stageTone(stage.status, stage.skipped)
                        "
                        size="sm"
                        >{{
                          stageLabel(stage.status, stage.skipped, stage.paused)
                        }}</UiBadge
                      >
                    </span>
                    <span class="pipeline-stage__desc">{{
                      stage.description
                    }}</span>
                    <span class="pipeline-stage__foot">
                      <span>{{ stage.metric }}</span>
                      <span>{{ stage.action }}</span>
                    </span>
                  </span>
                  <span
                    v-if="stage.status === 'running' && !stage.paused"
                    class="pipeline-stage__bar"
                  >
                    <span :style="{ width: `${stage.progress}%` }" />
                  </span>
                </button>
              </section>

              <section class="workspace-panel">
                <div v-show="activeStep === 'input'" class="stage-panel">
                  <PageLoadingState
                    v-if="!isDataLoaded"
                    compact
                    title="正在加载项目数据"
                    description="正在恢复当前 PPT 工作流状态"
                  />
                  <InputComposer
                    v-else
                    v-model="input"
                    :parameters="parameters"
                    :config-options="configOptions"
                    :prompts="prompts"
                    :selected-prompt-id="selectedPromptId"
                    :text-models="textModels"
                    :image-models="imageModels"
                    :selected-text-model-id="selectedTextModelId"
                    :selected-image-model-id="selectedImageModelId"
                    :skills="skills"
                    :input-process-steps="inputProcessSteps"
                    :uploaded-file-contents="uploadedFileContents"
                    :templates="templates"
                    :selected-template="selectedTemplate"
                    :resources-syncing="resourcesSyncing"
                    :last-resource-synced-at="lastResourceSyncedAt"
                    @update:parameters="parameters = $event"
                    @select-prompt="store.selectPrompt"
                    @select-text-model="store.selectProjectTextModel"
                    @select-image-model="store.selectProjectImageModel"
                    @toggle-skill="store.toggleSkill"
                    @select-template="selectInputTemplate"
                    @clear-template="store.clearGalleryTemplate()"
                    @attach="store.attachFiles"
                    @remove-file="store.removeAttachedFile"
                    @open-resource="openComposerResource"
                    @run="store.runFullWorkflow()"
                  />
                </div>

                <div v-show="activeStep === 'outline'" class="stage-panel">
                  <section class="outline-control">
                    <div class="outline-control__header">
                      <span class="outline-control__icon">
                        <Wand2 :size="18" />
                      </span>
                      <div>
                        <h3>大纲</h3>
                        <p>{{ outlineStatusText }}</p>
                      </div>
                    </div>

                    <div class="outline-control__stats">
                      <div>
                        <span>内容</span>
                        <strong>{{ inputReadyLabel }}</strong>
                      </div>
                      <div>
                        <span>页数</span>
                        <strong>{{ outline.length || "-" }}</strong>
                      </div>
                      <div>
                        <span>要点</span>
                        <strong>{{ outlineBulletCount || "-" }}</strong>
                      </div>
                      <div>
                        <span>配图</span>
                        <strong>{{ slidesNeedingImages.length || 0 }}</strong>
                      </div>
                    </div>

                    <div class="outline-control__actions">
                      <UiButton
                        variant="primary"
                        size="sm"
                        :disabled="isRunning || !canOpenWorkflowStep('outline')"
                        @click="store.runOutline"
                      >
                        <Loader2
                          v-if="isOutlineRunning"
                          :size="13"
                          class="spin"
                        />
                        <RefreshCw v-else :size="13" />
                        {{ outline.length ? "重新生成" : "生成大纲" }}
                      </UiButton>
                    </div>
                  </section>

                  <OutlineEditor
                    :outline="outline"
                    :is-running="isOutlineRunning"
                    :show-run-action="false"
                    @update-title="store.updateSlideTitle"
                    @update-bullet="store.updateSlideBullet"
                    @add-bullet="store.addSlideBullet"
                    @delete-bullet="store.deleteSlideBullet"
                    @reorder-bullet="store.reorderBullet"
                    @update-notes="store.updateSlideNotes"
                    @update-visual-prompt="store.updateSlideVisualPrompt"
                    @reorder="store.reorderOutline"
                    @batch-delete="
                      (ids: string[]) => {
                        store.saveHistory();
                        store.outline = store.outline.filter(
                          (s) => !ids.includes(s.id)
                        );
                      }
                    "
                    @run="store.runOutline"
                  />
                </div>

                <div v-show="activeStep === 'images'" class="stage-panel">
                  <div class="image-gate">
                    <div class="image-gate__main">
                      <div class="image-gate__icon">
                        <Image :size="22" />
                      </div>
                      <div>
                        <h3>图片</h3>
                        <p v-if="imageStepSkipped">本次不需要图片。</p>
                        <p v-else-if="slidesNeedingImages.length">
                          这些页面需要图片。
                        </p>
                        <p v-else>生成大纲后自动判断。</p>
                      </div>
                    </div>
                    <div class="image-gate__stats">
                      <span>{{ slidesNeedingImages.length }} 页需要图片</span>
                      <strong>{{ completedImageCount }} 张已完成</strong>
                    </div>
                  </div>

                  <div
                    v-if="slidesNeedingImages.length"
                    class="image-page-list"
                  >
                    <div
                      v-for="(slide, index) in slidesNeedingImages"
                      :key="slide.id"
                      class="image-page-item"
                      :class="{
                        'image-page-item--running':
                          currentGeneratingSlide === slide.id
                      }"
                    >
                      <span>{{ imagePageNumber(slide, index) }}</span>
                      <button
                        type="button"
                        class="image-page-item__preview"
                        :class="{
                          'image-page-item__preview--clickable':
                            firstImageForSlide(slide.id)?.url &&
                            !firstImageForSlide(slide.id)?.error
                        }"
                        :disabled="
                          !firstImageForSlide(slide.id)?.url ||
                          firstImageForSlide(slide.id)?.error
                        "
                        @click="openImagePreview(slide.id)"
                      >
                        <PrivateImage
                          v-if="
                            firstImageForSlide(slide.id)?.url &&
                            !firstImageForSlide(slide.id)?.error
                          "
                          :src="firstImageForSlide(slide.id)?.url"
                          :alt="slide.title"
                        />
                        <Maximize2
                          v-if="
                            firstImageForSlide(slide.id)?.url &&
                            !firstImageForSlide(slide.id)?.error
                          "
                          :size="14"
                          class="image-page-item__zoom"
                        />
                        <Image v-else :size="18" />
                      </button>
                      <div>
                        <strong>{{ slide.title }}</strong>
                        <p class="image-page-item__prompt">
                          {{ slide.visualPrompt || "暂无图片提示词" }}
                        </p>
                        <p
                          v-if="firstImageForSlide(slide.id)?.errorMessage"
                          class="image-page-item__error"
                        >
                          {{ firstImageForSlide(slide.id)?.errorMessage }}
                        </p>
                      </div>
                      <div class="image-page-item__actions">
                        <UiBadge
                          :tone="
                            imageStatusForSlide(slide) === 'error'
                              ? 'danger'
                              : imageStatusForSlide(slide) === 'done'
                                ? 'success'
                                : imageStatusForSlide(slide) === 'running'
                                  ? 'accent'
                                  : 'neutral'
                          "
                          size="sm"
                        >
                          {{
                            imageStatusForSlide(slide) === 'error'
                              ? "未生成"
                              : imageStatusForSlide(slide) === 'done'
                                ? "已生成"
                                : imageStatusForSlide(slide) === 'running'
                                  ? "生成中"
                                  : "等待"
                          }}
                        </UiBadge>
                        <UiButton
                          v-if="(imagesBySlideId.get(slide.id) || []).length"
                          variant="text"
                          size="sm"
                          :disabled="currentGeneratingSlide === slide.id"
                          @click="retryImage(slide.id)"
                        >
                          <RotateCcw :size="13" />
                          {{
                            imageStatusForSlide(slide) === 'error'
                              ? "重试"
                              : "重新生成"
                          }}
                        </UiButton>
                      </div>
                    </div>
                  </div>

                </div>

                <div v-show="activeStep === 'layout'" class="stage-panel">
                  <div v-if="isPaused" class="pause-notice">
                    <div>
                      <strong>已暂停</strong>
                      <span>点击继续后，会从下一页接着生成。</span>
                    </div>
                    <UiButton variant="primary" @click="store.continueWorkflow">
                      <Play :size="14" />
                      继续
                    </UiButton>
                  </div>
                  <div
                    v-else-if="pauseRequested"
                    class="pause-notice pause-notice--pending"
                  >
                    <div>
                      <strong>准备暂停</strong>
                      <span>当前步骤完成后会停下。</span>
                    </div>
                  </div>

                  <div class="executor-board">
                    <div class="executor-board__header">
                      <div>
                        <h3>生成页面</h3>
                        <p>页面生成后会出现在预览中。</p>
                      </div>
                      <div class="executor-board__metric">
                        <strong
                          >{{ layoutCompletedPages }}/{{
                            layoutTotalPages || 0
                          }}</strong
                        >
                        <span>{{ layoutProgressPercent }}%</span>
                      </div>
                    </div>
                    <div class="executor-preview">
                      <div class="executor-preview__live">
                        <PrivateSvg
                          v-if="layoutPreviewPage?.svg"
                          class="executor-preview__canvas"
                          :svg="layoutPreviewPage.svg"
                        />
                        <div
                          v-else-if="layoutPreviewPage"
                          class="executor-preview__empty executor-preview__empty--generating"
                        >
                          <Loader2 :size="28" class="spin" />
                          <strong>正在生成第 {{ layoutPreviewPage.pageNumber }} 页</strong>
                          <span>本页完成后会自动替换预览和缩略图</span>
                        </div>
                        <div v-else class="executor-preview__empty">
                          <Paintbrush :size="28" />
                          <span>等待第一张 SVG 页面</span>
                        </div>
                      </div>
                    </div>

                    <div class="executor-thumbs" v-if="layoutDisplayPages.length">
                      <template v-for="page in layoutDisplayPages" :key="page.pageNumber">
                        <div v-if="page.svg" class="executor-thumb-wrap">
                          <button
                            class="executor-thumb executor-thumb--done"
                            :class="{
                              'executor-thumb--retry': page.fallback
                            }"
                            @click="
                              previewPageIndex = page.pageNumber - 1;
                              goToWorkflowStep('preview');
                            "
                          >
                            <span>{{ page.pageNumber }}</span>
                            <PrivateSvg :svg="page.svg" />
                          </button>
                          <button
                            v-if="page.fallback"
                            class="executor-thumb-retry"
                            :disabled="retryingPageNumbers.has(page.pageNumber)"
                            @click="store.retrySlidePage(page.pageNumber)"
                          >
                            <Loader2
                              v-if="retryingPageNumbers.has(page.pageNumber)"
                              :size="12"
                              class="spin"
                            />
                            {{
                              retryingPageNumbers.has(page.pageNumber) ? "重试中" : "重试本页"
                            }}
                          </button>
                        </div>
                        <div
                          v-else
                          class="executor-thumb-wrap executor-thumb-wrap--pending"
                        >
                          <button class="executor-thumb executor-thumb--pending" disabled>
                            <span>{{ page.pageNumber }}</span>
                            <em>
                              {{
                                retryingPageNumbers.has(page.pageNumber) ? "生成中" : "待生成"
                              }}
                            </em>
                          </button>
                        </div>
                      </template>
                    </div>
                  </div>

                </div>

                <div v-show="activeStep === 'preview'" class="stage-panel">
                  <div class="quality-strip preview-shell__header">
                    <div>
                      <h3>导出</h3>
                      <p>确认预览后导出 PPTX。</p>
                    </div>
                    <div class="preview-export-actions">
                      <UiButton
                        variant="secondary"
                        :disabled="!exportReadiness.ready || !hasAnySvgPage"
                        @click="openPresentation"
                      >
                        <Maximize2 :size="14" />
                        放映 PPT
                      </UiButton>
                      <UiButton
                        variant="primary"
                        :disabled="!canExportDeck"
                        @click="
                          handleExport('pptx', {
                            filename: 'presentation',
                            pageRange: 'all'
                          })
                        "
                      >
                        <Download :size="14" />
                        {{ isExporting ? "导出中..." : "导出 PPTX" }}
                      </UiButton>
                    </div>
                  </div>
                  <p v-if="!exportReadiness.ready" class="preview-export-warning">
                    {{ exportReadiness.message }}
                  </p>
                  <UiProgress
                    v-if="isExporting"
                    :value="exportProgress"
                    size="md"
                    show-label
                  />

                  <div class="preview-shell">
                    <SvgDeckPreview
                      v-if="hasAnySvgPage"
                      :pages="layoutDisplayPages"
                      v-model:active-index="previewPageIndex"
                    />
                    <DeckPreview
                      v-else
                      :artifacts="exportArtifacts"
                      :outline="outline"
                      :parameters="parameters"
                      :selected-images="selectedImages"
                      :show-export-actions="false"
                    />
                  </div>
                </div>
              </section>
            </div>
          </section>

          <aside v-show="showRightPanel" class="workspace-content-right">
            <div class="right-panel-title">
              <div>
                <h3>运行日志</h3>
                <span>实时记录每个阶段</span>
              </div>
              <button
                class="right-panel-title__close"
                title="隐藏右侧面板"
                @click="showRightPanel = false"
              >
                <ChevronRight :size="15" />
              </button>
            </div>
            <div class="right-panel-content">
              <ActivityLog :logs="activityLog" />
            </div>
          </aside>
        </div>
      </template>
    </main>

    <GlobalSearch :show="showGlobalSearch" @close="showGlobalSearch = false" />
    <ShortcutsHelp
      :show="showShortcutsHelp"
      @close="showShortcutsHelp = false"
    />
    <div
      v-if="previewingImage"
      class="image-preview-modal"
      @click.self="previewingImage = null"
    >
      <div class="image-preview-modal__panel">
        <header class="image-preview-modal__header">
          <div>
            <h3>{{ previewingImageSlide?.title || previewingImage.title }}</h3>
            <p>{{ previewingImage.prompt }}</p>
          </div>
          <button
            class="image-preview-modal__close"
            @click="previewingImage = null"
          >
            <X :size="18" />
          </button>
        </header>
        <div class="image-preview-modal__canvas">
          <PrivateImage
            :src="previewingImage.url"
            :alt="previewingImage.title"
          />
        </div>
        <footer class="image-preview-modal__footer">
          <UiButton
            variant="secondary"
            @click="retryImage(previewingImage.slideId)"
          >
            <RotateCcw :size="14" />
            重新生成这张
          </UiButton>
          <UiButton variant="primary" @click="previewingImage = null"
            >关闭</UiButton
          >
        </footer>
      </div>
    </div>
    <Teleport to="body">
      <div
        v-if="showPresentation && presentationPage"
        class="presentation-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="沉浸式放映 PPT"
      >
        <aside class="presentation-sidebar" aria-label="PPT 页面列表">
          <div class="presentation-sidebar__title">
            <span>页面</span>
            <strong>{{ presentationIndex + 1 }} / {{ presentationPages.length }}</strong>
          </div>
          <button
            v-for="(page, index) in presentationPages"
            :key="page.pageNumber"
            type="button"
            class="presentation-page-tab"
            :class="{
              'presentation-page-tab--active': index === presentationIndex,
              'presentation-page-tab--empty': !page.svg
            }"
            @click="presentationIndex = index"
          >
            <span>{{ page.pageNumber }}</span>
            <div v-if="page.svg" class="presentation-page-tab__thumb">
              <PrivateSvg :svg="page.svg" />
            </div>
            <div v-else class="presentation-page-tab__empty">待生成</div>
          </button>
        </aside>

        <section class="presentation-player">
          <header class="presentation-toolbar">
            <div>
              <span>放映中</span>
              <strong>第 {{ presentationPage.pageNumber }} 页</strong>
            </div>
            <button
              type="button"
              class="presentation-close"
              title="退出放映"
              @click="closePresentation"
            >
              <X :size="18" />
            </button>
          </header>

          <button
            type="button"
            class="presentation-nav presentation-nav--prev"
            :disabled="presentationIndex === 0"
            title="上一页"
            @click="previousPresentationPage"
          >
            <ChevronLeft :size="28" />
          </button>

          <main class="presentation-stage">
            <PrivateSvg
              v-if="presentationPage.svg"
              :key="presentationPage.pageNumber"
              class="presentation-slide"
              :svg="presentationPage.svg"
            />
            <div v-else class="presentation-slide presentation-slide--empty">
              <Paintbrush :size="30" />
              <span>第 {{ presentationPage.pageNumber }} 页尚未生成</span>
            </div>
          </main>

          <button
            type="button"
            class="presentation-nav presentation-nav--next"
            :disabled="presentationIndex >= presentationPages.length - 1"
            title="下一页"
            @click="nextPresentationPage"
          >
            <ChevronRight :size="28" />
          </button>

          <footer class="presentation-footer">
            <div v-if="presentationPage.speakerNotes" class="presentation-notes">
              {{ presentationPage.speakerNotes }}
            </div>
            <div class="presentation-dots">
              <button
                v-for="(page, index) in presentationPages"
                :key="page.pageNumber"
                type="button"
                :class="{ 'presentation-dot--active': index === presentationIndex }"
                :title="`第 ${page.pageNumber} 页`"
                @click="presentationIndex = index"
              />
            </div>
          </footer>
        </section>
      </div>
    </Teleport>
    <AiChatPanel
      v-if="assistantProject"
      :key="assistantProject.id"
      :project-id="assistantProject.id"
      :project-title="assistantProject.title"
    />
  </AppShell>
</template>

<style scoped>
.workspace-main {
  grid-area: main;
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: var(--color-bg);
}

.workspace-route-loading {
  display: grid;
  place-items: center;
  min-height: 100%;
  padding: 24px;
}

.workspace-step-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.workspace-step-header__info {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.workflow-back-button {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    color var(--transition-fast),
    background var(--transition-fast),
    transform var(--transition-fast);
}

.workflow-back-button:hover {
  transform: translateX(-1px);
  border-color: var(--color-border-strong);
  color: var(--color-text);
  background: var(--color-panel);
}

.workspace-step-header__info h2 {
  margin: 0;
  color: var(--color-text);
  font-size: 15px;
  font-weight: 700;
}

.workspace-step-header__info p {
  margin: 4px 0 0;
  color: var(--color-subtle);
  font-size: 12px;
}

.workspace-step-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.workspace-step-header__toggle {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  transition: all var(--transition-fast);
}

.workspace-step-header__toggle:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.workspace-content-wrapper {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  min-height: 0;
  overflow: hidden;
}

.workspace-content-wrapper--single {
  grid-template-columns: minmax(0, 1fr);
}

.workspace-content-main {
  padding: 16px;
  overflow-y: auto;
  min-width: 0;
}

.workspace-panel {
  min-width: 0;
}

.workspace-content-right {
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--color-border);
  background: var(--color-surface);
  overflow: hidden;
}

.right-panel-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
}

.right-panel-title h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text);
}

.right-panel-title span {
  display: block;
  margin-top: 4px;
  color: var(--color-subtle);
  font-size: 11px;
}

.right-panel-title__close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
}

.right-panel-title__close:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.right-panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.workspace-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 16px;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
  min-height: 52px;
}

.workspace-status-bar__left {
  flex: 1;
  min-width: 0;
}

.workspace-status-bar__right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-subtle);
  font-size: 11px;
  white-space: nowrap;
}

.pipeline-console {
  display: grid;
  grid-template-columns: 214px minmax(0, 1fr);
  align-items: start;
  gap: 12px;
  max-width: 1360px;
  margin: 0 auto;
}

.pipeline-stages {
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
  position: sticky;
  top: 0;
  align-self: start;
}

.pipeline-stage {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-height: 64px;
  padding: 9px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-card);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    transform var(--transition-fast),
    box-shadow var(--transition-fast);
}

.pipeline-stage:hover {
  transform: translateY(-1px);
  border-color: var(--color-border-strong);
  box-shadow: var(--shadow-sm);
}

.pipeline-stage--disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.pipeline-stage--disabled:hover {
  transform: none;
  border-color: var(--color-border);
  box-shadow: none;
}

.pipeline-stage--active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.pipeline-stage--done .pipeline-stage__icon {
  color: var(--color-accent);
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.pipeline-stage--running .pipeline-stage__icon {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.pipeline-stage--paused {
  border-color: color-mix(
    in srgb,
    var(--color-warning) 56%,
    var(--color-border)
  );
  background: var(--color-warning-soft);
}

.pipeline-stage--paused .pipeline-stage__icon {
  color: var(--color-warning);
  border-color: color-mix(
    in srgb,
    var(--color-warning) 68%,
    var(--color-border)
  );
  background: var(--color-surface);
}

.pipeline-stage--skipped {
  border-style: dashed;
}

.pipeline-stage__icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-muted);
  background: var(--color-surface);
}

.pipeline-stage__body {
  display: grid;
  gap: 4px;
  min-width: 0;
  width: 100%;
}

.pipeline-stage__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.pipeline-stage__head strong {
  color: var(--color-text);
  font-size: 12px;
  line-height: 1.35;
}

.pipeline-stage__desc {
  display: none;
}

.pipeline-stage__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  color: var(--color-subtle);
  font-size: 10px;
}

.pipeline-stage__foot span:first-child {
  color: var(--color-text);
  font-weight: 700;
}

.pipeline-stage__bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: var(--color-border);
}

.pipeline-stage__bar span {
  display: block;
  height: 100%;
  background: var(--color-accent);
  transition: width 0.3s ease;
}

.pipeline-stage__spin,
.spin {
  animation: spin 1s linear infinite;
}

.stage-panel {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.loading-placeholder,
.outline-control,
.image-gate,
.executor-board,
.quality-strip {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-card);
}

.loading-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 240px;
  color: var(--color-muted);
  font-size: 13px;
}

.outline-control {
  display: grid;
  grid-template-columns: minmax(190px, 1fr) minmax(320px, 1.35fr) auto;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
}

.outline-control__header,
.image-gate__main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.outline-control__icon,
.image-gate__icon {
  color: var(--color-accent);
}

.outline-control__icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.outline-control h3,
.image-gate h3,
.executor-board h3,
.quality-strip h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 15px;
  font-weight: 700;
}

.outline-control p,
.image-gate p,
.executor-board p,
.quality-strip p {
  margin: 5px 0 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.6;
}

.outline-control__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.outline-control__stats > div {
  display: grid;
  gap: 5px;
  min-height: 54px;
  padding: 9px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
}

.outline-control__stats span {
  color: var(--color-subtle);
  font-size: 11px;
}

.outline-control__stats strong {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: 16px;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.outline-control__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 132px;
}

.outline-control__actions :deep(.ui-button) {
  width: 100%;
}

.image-gate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px;
}

.image-gate__icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.image-gate__stats {
  display: grid;
  justify-items: end;
  gap: 4px;
  white-space: nowrap;
}

.image-gate__stats span {
  color: var(--color-subtle);
  font-size: 12px;
}

.image-gate__stats strong {
  color: var(--color-text);
  font-size: 18px;
}

.image-page-list {
  display: grid;
  gap: 8px;
}

.image-page-item {
  display: grid;
  grid-template-columns: 36px 88px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-card);
}

.image-page-item--running {
  border-color: var(--color-accent);
}

.image-page-item > span:first-child {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: var(--color-text);
  background: var(--color-panel);
  font-size: 12px;
  font-weight: 800;
}

.image-page-item__preview {
  position: relative;
  display: grid;
  place-items: center;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-panel);
  color: var(--color-subtle);
  cursor: default;
}

.image-page-item__preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.image-page-item__preview--clickable {
  cursor: zoom-in;
}

.image-page-item__preview--clickable:hover {
  border-color: var(--color-accent);
}

.image-page-item__zoom {
  position: absolute;
  right: 5px;
  bottom: 5px;
  padding: 2px;
  border-radius: 5px;
  color: var(--color-inverse);
  background: var(--color-overlay);
}

.image-page-item strong {
  color: var(--color-text);
  font-size: 13px;
}

.image-page-item p {
  margin: 4px 0 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.5;
}

.image-page-item__prompt {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.image-page-item__error {
  color: var(--color-danger) !important;
  font-weight: 600;
}

.image-page-item__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 104px;
}

.pause-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid
    color-mix(in srgb, var(--color-warning) 56%, var(--color-border));
  border-radius: 8px;
  background: var(--color-warning-soft);
}

.pause-notice--pending {
  border-color: color-mix(
    in srgb,
    var(--color-warning) 34%,
    var(--color-border)
  );
  background: var(--color-panel);
}

.pause-notice strong {
  display: block;
  color: var(--color-text);
  font-size: 13px;
}

.pause-notice span {
  display: block;
  margin-top: 4px;
  color: var(--color-muted);
  font-size: 12px;
}

.executor-board {
  display: grid;
  gap: 14px;
  padding: 16px;
}

.executor-board__header,
.quality-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.executor-board__metric {
  display: grid;
  justify-items: end;
  gap: 2px;
  white-space: nowrap;
}

.executor-board__metric strong {
  color: var(--color-text);
  font-size: 22px;
}

.executor-board__metric span {
  color: var(--color-subtle);
  font-size: 12px;
}

.executor-preview {
  display: grid;
  gap: 12px;
}

.executor-preview__live {
  display: grid;
  place-items: center;
  min-height: 340px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  overflow: hidden;
}

.executor-preview__canvas {
  width: min(100%, 760px);
  aspect-ratio: 16 / 9;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
}

.executor-preview__canvas :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}

.executor-preview__empty {
  display: grid;
  justify-items: center;
  gap: 10px;
  color: var(--color-subtle);
  font-size: 13px;
}

.executor-preview__empty--generating {
  align-content: center;
  width: min(100%, 760px);
  aspect-ratio: 16 / 9;
  border: 1px dashed var(--color-border-strong);
  border-radius: 8px;
  background: var(--color-surface);
}

.executor-preview__empty--generating strong {
  color: var(--color-text);
  font-size: 15px;
}

.executor-thumbs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.executor-thumb-wrap {
  display: grid;
  flex: 0 0 160px;
  gap: 6px;
}

.executor-thumb {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  overflow: hidden;
}

.executor-thumb--done {
  cursor: pointer;
}

.executor-thumb--done:hover {
  border-color: var(--color-accent);
}

.executor-thumb--retry {
  border-color: var(--color-danger);
}

.executor-thumb-retry {
  min-height: 26px;
  border: 1px solid var(--color-danger);
  border-radius: 6px;
  background: var(--color-danger-soft);
  color: var(--color-danger);
  font-size: 11px;
  cursor: pointer;
}

.executor-thumb-retry:hover {
  border-color: var(--color-danger);
  background: var(--color-surface);
}

.executor-thumb-retry:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.executor-thumb-retry:disabled:hover {
  background: var(--color-danger-soft);
}

.executor-thumb--pending {
  display: grid;
  place-items: center;
}

.executor-thumb--pending em {
  color: var(--color-subtle);
  font-size: 12px;
  font-style: normal;
}

.executor-thumb span {
  position: absolute;
  left: 6px;
  top: 6px;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  color: var(--color-text);
  background: var(--color-card);
  font-size: 11px;
  font-weight: 800;
}

.executor-thumb div {
  width: 100%;
  height: 100%;
}

.executor-thumb :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}

.quality-strip {
  padding: 16px;
}

.preview-shell {
  width: min(100%, 1280px);
  margin: 0 auto;
  min-width: 0;
}

.preview-shell__header {
  width: min(100%, 1280px);
  margin: 0 auto;
}

.preview-export-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.presentation-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  grid-template-columns: 184px minmax(0, 1fr);
  background: #090806;
  color: #f8f3e7;
}

.presentation-sidebar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  padding: 14px 12px;
  overflow-y: auto;
  background: #11100e;
  border-right: 1px solid rgba(255, 255, 255, 0.12);
}

.presentation-sidebar__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: rgba(248, 243, 231, 0.72);
  font-size: 12px;
}

.presentation-sidebar__title strong {
  color: #f8f3e7;
  font-variant-numeric: tabular-nums;
}

.presentation-page-tab {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: #f8f3e7;
  cursor: pointer;
  text-align: left;
}

.presentation-page-tab:hover,
.presentation-page-tab--active {
  border-color: rgba(210, 162, 70, 0.72);
  background: rgba(210, 162, 70, 0.14);
}

.presentation-page-tab > span {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  font-size: 11px;
  font-weight: 800;
}

.presentation-page-tab__thumb {
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 5px;
  background: #171512;
}

.presentation-page-tab__thumb :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}

.presentation-page-tab__empty {
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 1px dashed rgba(255, 255, 255, 0.18);
  border-radius: 5px;
  color: rgba(248, 243, 231, 0.58);
  font-size: 12px;
}

.presentation-player {
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
}

.presentation-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 18px;
  background: rgba(9, 8, 6, 0.92);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.presentation-toolbar div {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.presentation-toolbar span {
  color: rgba(248, 243, 231, 0.62);
  font-size: 12px;
}

.presentation-toolbar strong {
  color: #f8f3e7;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.presentation-close,
.presentation-nav,
.presentation-dots button {
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.08);
  color: #f8f3e7;
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    transform var(--transition-fast);
}

.presentation-close {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
}

.presentation-close:hover,
.presentation-nav:hover:not(:disabled),
.presentation-dots button:hover {
  border-color: rgba(255, 255, 255, 0.34);
  background: rgba(255, 255, 255, 0.14);
}

.presentation-stage {
  display: grid;
  place-items: center;
  min-width: 0;
  min-height: 0;
  padding: 32px 72px;
}

.presentation-slide {
  width: min(100%, calc((100vh - 160px) * 16 / 9));
  aspect-ratio: 16 / 9;
  max-height: calc(100vh - 160px);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: #111;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.42);
}

.presentation-slide--empty {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 12px;
  color: rgba(248, 243, 231, 0.68);
  font-size: 14px;
}

.presentation-nav {
  position: absolute;
  top: 50%;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 46px;
  height: 58px;
  border-radius: 8px;
  transform: translateY(-50%);
}

.presentation-nav:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.presentation-nav--prev {
  left: 18px;
}

.presentation-nav--next {
  right: 18px;
}

.presentation-footer {
  display: grid;
  gap: 10px;
  justify-items: center;
  padding: 12px 18px 18px;
  background: rgba(9, 8, 6, 0.92);
  border-top: 1px solid rgba(255, 255, 255, 0.12);
}

.presentation-notes {
  max-width: 920px;
  max-height: 56px;
  overflow: hidden;
  color: rgba(248, 243, 231, 0.72);
  font-size: 12px;
  line-height: 1.55;
  text-align: center;
}

.presentation-dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  max-width: min(760px, 80vw);
  overflow-x: auto;
  padding-bottom: 2px;
}

.presentation-dots button {
  width: 22px;
  height: 5px;
  padding: 0;
  border-radius: 999px;
}

.presentation-dots .presentation-dot--active {
  border-color: #d2a246;
  background: #d2a246;
}

.image-preview-modal {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--color-overlay);
}

.image-preview-modal__panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(960px, 92vw);
  max-height: 88vh;
  overflow: hidden;
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
}

.image-preview-modal__header,
.image-preview-modal__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
}

.image-preview-modal__footer {
  border-top: 1px solid var(--color-border);
  border-bottom: none;
}

.image-preview-modal__header h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 15px;
}

.image-preview-modal__header p {
  max-width: 720px;
  margin: 5px 0 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.5;
}

.image-preview-modal__close {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
}

.image-preview-modal__close:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.image-preview-modal__canvas {
  display: grid;
  place-items: center;
  min-height: 320px;
  overflow: auto;
  padding: 16px;
  background: var(--color-panel);
}

.image-preview-modal__canvas img {
  display: block;
  max-width: 100%;
  max-height: 68vh;
  border-radius: 6px;
  object-fit: contain;
}

.preview-export-warning {
  margin: 10px 0 0;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.5;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1180px) {
  .pipeline-console {
    grid-template-columns: 1fr;
  }

  .pipeline-stages {
    position: static;
    grid-template-columns: repeat(5, minmax(136px, 1fr));
  }

  .pipeline-stage {
    min-height: 62px;
  }

  .outline-control {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .outline-control__actions {
    flex-direction: row;
    min-width: 0;
  }

  .outline-control__actions :deep(.ui-button) {
    width: auto;
  }
}

@media (max-width: 920px) {
  .workspace-main {
    overflow: hidden;
  }

  .workspace-content-wrapper {
    grid-template-columns: 1fr;
  }

  .workspace-content-right {
    display: none;
  }

  .workspace-step-header,
  .image-gate,
  .executor-board__header,
  .quality-strip {
    align-items: stretch;
    flex-direction: column;
  }

  .workspace-step-header__actions {
    flex-wrap: wrap;
  }

  .pipeline-stages {
    display: flex;
    gap: 8px;
    margin: 0 -10px;
    padding: 0 10px 4px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    scroll-snap-type: x mandatory;
  }

  .pipeline-stages::-webkit-scrollbar {
    display: none;
  }

  .pipeline-stage {
    flex: 0 0 176px;
    min-height: 58px;
    scroll-snap-align: start;
  }

  .outline-control__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .executor-preview {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .workspace-main {
    grid-template-rows: auto minmax(0, 1fr) auto;
  }

  .workspace-step-header,
  .workspace-status-bar,
  .workspace-status-bar__right,
  .pause-notice,
  .image-preview-modal__header,
  .image-preview-modal__footer {
    align-items: stretch;
    flex-direction: column;
  }

  .workspace-step-header {
    padding: 10px 12px;
  }

  .workspace-step-header__info {
    width: 100%;
  }

  .workspace-step-header__info > div {
    min-width: 0;
  }

  .workspace-step-header__info h2,
  .workspace-step-header__info p {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .workspace-step-header__actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
    gap: 8px;
  }

  .workspace-step-header__actions :deep(.ui-button) {
    width: 100%;
    min-width: 0;
  }

  .workspace-content-main {
    padding: 10px;
  }

  .pipeline-stage {
    flex-basis: 156px;
  }

  .outline-control__stats {
    grid-template-columns: 1fr;
  }

  .outline-control__actions {
    flex-direction: column;
  }

  .outline-control__actions :deep(.ui-button) {
    width: 100%;
  }

  .image-page-item {
    grid-template-columns: 1fr;
  }

  .image-page-item__actions {
    justify-content: stretch;
    min-width: 0;
  }

  .image-page-item__actions :deep(.ui-button),
  .pause-notice :deep(.ui-button),
  .image-preview-modal__footer :deep(.ui-button) {
    width: 100%;
  }

  .preview-export-actions {
    width: 100%;
    justify-content: stretch;
  }

  .preview-export-actions :deep(.ui-button) {
    flex: 1 1 140px;
  }

  .presentation-stage {
    padding: 18px 12px;
  }

  .presentation-overlay {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .presentation-sidebar {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 128px;
    overflow-x: auto;
    overflow-y: hidden;
    border-right: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  }

  .presentation-sidebar__title {
    grid-column: 1 / -1;
  }

  .presentation-slide {
    width: 100%;
    max-height: calc(100dvh - 178px);
  }

  .presentation-nav {
    top: auto;
    bottom: 82px;
    width: 42px;
    height: 42px;
    transform: none;
  }

  .presentation-nav--prev {
    left: 14px;
  }

  .presentation-nav--next {
    right: 14px;
  }

  .executor-board,
  .quality-strip,
  .image-gate,
  .outline-control {
    padding: 12px;
  }

  .image-preview-modal {
    padding: 12px;
  }

  .image-preview-modal__panel {
    width: 100%;
    max-height: calc(100dvh - 24px);
  }
}
</style>
