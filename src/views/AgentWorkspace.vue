<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import {
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Image,
  Loader2,
  Paintbrush,
  Pause,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  RotateCcw,
  Wand2
} from 'lucide-vue-next';
import AppShell from '@/components/layout/AppShell.vue';
import SideNavigation from '@/components/layout/SideNavigation.vue';
import WorkspaceHeader from '@/components/layout/WorkspaceHeader.vue';
import ActivityLog from '@/components/panels/ActivityLog.vue';
import InputComposer from '@/components/panels/InputComposer.vue';
import OutlineEditor from '@/components/panels/OutlineEditor.vue';
import DeckPreview from '@/components/preview/DeckPreview.vue';
import SvgDeckPreview from '@/components/preview/SvgDeckPreview.vue';
import WorkflowRail from '@/components/workflow/WorkflowRail.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiButton from '@/components/ui/UiButton.vue';
import UiProgress from '@/components/ui/UiProgress.vue';
import MyPptPage from '@/components/pages/MyPptPage.vue';
import PromptManagePage from '@/components/pages/PromptManagePage.vue';
import SkillManagePage from '@/components/pages/SkillManagePage.vue';
import ModelManagePage from '@/components/pages/ModelManagePage.vue';
import TemplateGalleryPage from '@/components/pages/TemplateGalleryPage.vue';
import RunConfigPage from '@/components/pages/RunConfigPage.vue';
import GlobalSearch from '@/components/common/GlobalSearch.vue';
import ShortcutsHelp from '@/components/common/ShortcutsHelp.vue';
import AiChatPanel from '@/components/panels/AiChatPanel.vue';
import VersionHistory from '@/components/common/VersionHistory.vue';
import { useAgentStore } from '@/stores/agentStore';
import { useShortcuts } from '@/composables/useShortcuts';
import { slideNeedsImage } from '@/utils/slideVisuals';
import type { WorkflowStep, WorkflowStepId } from '@/types/agent';

const route = useRoute();
const router = useRouter();
const store = useAgentStore();

const {
  activityLog,
  activePpt,
  exportArtifacts,
  generatedSlides,
  images,
  isPaused,
  pauseRequested,
  input,
  isRunning,
  outline,
  parameters,
  selectedImages,
  steps,
  streamingText,
  svgPages,
  currentGeneratingSlide,
  isDataLoaded,
  designSpec,
  specLock
} = storeToRefs(store);

const showRightPanel = ref(true);
const previewPageIndex = ref(0);
const showGlobalSearch = ref(false);
const showShortcutsHelp = ref(false);
const exportProgress = ref(0);
const isExporting = ref(false);
const exportHistory = ref<Array<{ id: string; filename: string; format: 'pptx' | 'pdf'; status: 'ready' | 'queued' | 'exporting'; createdAt: number }>>([]);

useShortcuts([
  {
    key: 'k',
    ctrl: true,
    description: '打开全局搜索',
    handler: () => { showGlobalSearch.value = true; }
  },
  {
    key: 's',
    ctrl: true,
    description: '保存工作流',
    handler: () => store.saveWorkflow()
  },
  {
    key: 'Enter',
    ctrl: true,
    description: '运行当前阶段',
    handler: () => runFromCurrentStep()
  },
  {
    key: '/',
    shift: true,
    description: '显示快捷键帮助',
    handler: () => { showShortcutsHelp.value = true; }
  },
  {
    key: 'z',
    ctrl: true,
    description: '撤销',
    handler: () => store.undoOutline()
  },
  {
    key: 'z',
    ctrl: true,
    shift: true,
    description: '重做',
    handler: () => store.redoOutline()
  }
]);

const activeStep = computed({
  get: () => store.activeStep,
  set: (value) => { store.activeStep = value as WorkflowStepId; }
});

const stepTitles: Record<string, string> = {
  'my-ppt': '我的 PPT',
  prompts: '提示词管理',
  skills: 'Skill 管理',
  models: '模型管理',
  templates: '模板广场',
  config: '运行配置',
  input: '输入资料',
  outline: '生成大纲',
  images: '图片',
  layout: '生成页面',
  preview: '导出'
};

const currentStepTitle = computed(() => stepTitles[activeStep.value] || '工作区');
const currentProgress = computed(() => steps.value.find((step) => step.id === activeStep.value)?.progress || 0);
const isPageView = computed(() => ['my-ppt', 'prompts', 'skills', 'models', 'templates', 'config'].includes(activeStep.value));
const latestSvgPage = computed(() => svgPages.value[svgPages.value.length - 1] || null);
const layoutTotalPages = computed(() => designSpec.value?.outline.length || outline.value.length || parameters.value.slideCount || 0);
const layoutCompletedPages = computed(() => svgPages.value.length);
const layoutProgressPercent = computed(() => {
  if (layoutTotalPages.value === 0) return 0;
  return Math.min(100, Math.round((layoutCompletedPages.value / layoutTotalPages.value) * 100));
});
const slidesNeedingImages = computed(() => {
  const slides = designSpec.value?.outline || outline.value;
  return slides.filter((slide: any) => slideNeedsImage(slide));
});
const imageStepSkipped = computed(() => {
  const step = steps.value.find(s => s.id === 'images');
  return Boolean(designSpec.value && slidesNeedingImages.value.length === 0 && step?.status === 'done');
});
const imageBySlideId = computed(() => {
  const map = new Map<string, (typeof images.value)[number]>();
  for (const image of images.value) {
    map.set(image.slideId, image);
  }
  return map;
});
const activeProjectTitle = computed(() => activePpt.value?.title || input.value.topic || '尚未选择 PPT 项目');
const pipelineProgress = computed(() => {
  const workflow = steps.value.filter(step => ['input', 'outline', 'images', 'layout', 'preview'].includes(step.id));
  if (workflow.length === 0) return 0;
  const doneWeight = workflow.reduce((sum, step) => {
    if (step.status === 'done') return sum + 100;
    if (step.status === 'running') return sum + step.progress;
    return sum;
  }, 0);
  return Math.round(doneWeight / workflow.length);
});
const workflowStatusText = computed(() => {
  if (isPaused.value) return '已暂停，可继续生成';
  if (pauseRequested.value) return '当前步骤完成后暂停';
  if (isRunning.value) return '正在生成';
  if (svgPages.value.length > 0) return '可预览导出';
  return '准备开始';
});

const pipelineStages = computed(() => {
  const byId = new Map(steps.value.map(step => [step.id, step]));
  const stageInput = byId.get('input');
  const stageOutline = byId.get('outline');
  const stageImages = byId.get('images');
  const stageLayout = byId.get('layout');
  const stagePreview = byId.get('preview');

  return [
    {
      id: 'input' as WorkflowStepId,
      icon: FileText,
      title: '输入资料',
      description: input.value.files.length
        ? `${input.value.files.length} 个文件`
        : input.value.content.trim()
          ? '文本已准备'
          : '等待输入',
      status: stageInput?.status || (input.value.topic.trim() ? 'done' : 'idle'),
      progress: input.value.topic.trim() ? 100 : stageInput?.progress || 0,
      metric: input.value.topic.trim() ? '资料就绪' : '待输入',
      action: '编辑资料'
    },
    {
      id: 'outline' as WorkflowStepId,
      icon: Brain,
      title: '生成大纲',
      description: designSpec.value && specLock.value
        ? '大纲已生成'
        : '整理内容结构',
      status: stageOutline?.status || 'idle',
      progress: stageOutline?.progress || 0,
      metric: designSpec.value ? `${outline.value.length} 页大纲` : '待生成',
      action: designSpec.value ? '查看大纲' : '生成大纲'
    },
    {
      id: 'images' as WorkflowStepId,
      icon: Image,
      title: '图片',
      description: imageStepSkipped.value
        ? '无需图片'
        : slidesNeedingImages.value.length > 0
          ? `${slidesNeedingImages.value.length} 页需要图片`
          : '等待判断',
      status: stageImages?.status || 'idle',
      progress: imageStepSkipped.value ? 100 : stageImages?.progress || 0,
      metric: imageStepSkipped.value ? '无需图片' : `${generatedSlides.value.size}/${Math.max(1, slidesNeedingImages.value.length)} 张`,
      action: '查看状态',
      skipped: imageStepSkipped.value
    },
    {
      id: 'layout' as WorkflowStepId,
      icon: Paintbrush,
      title: '生成页面',
      description: isPaused.value ? '已暂停，可继续' : '页面会实时出现',
      status: stageLayout?.status || 'idle',
      progress: stageLayout?.status === 'done' ? 100 : layoutProgressPercent.value,
      metric: `${layoutCompletedPages.value}/${layoutTotalPages.value || 0} 页`,
      action: svgPages.value.length > 0 ? '查看预览' : '开始生成'
    },
    {
      id: 'preview' as WorkflowStepId,
      icon: ShieldCheck,
      title: '导出',
      description: '生成 PPTX',
      status: stagePreview?.status || 'idle',
      progress: stagePreview?.progress || 0,
      metric: exportArtifacts.value.length ? `${exportArtifacts.value.length} 个文件` : '待导出',
      action: '预览导出'
    }
  ];
});

function syncStepWithRoute() {
  const path = route.path;
  const routeToStep: Record<string, string> = {
    '/': 'my-ppt',
    '/my-ppt': 'my-ppt',
    '/prompts': 'prompts',
    '/skills': 'skills',
    '/models': 'models',
    '/templates': 'templates',
    '/config': 'config'
  };

  if (path.startsWith('/project/')) {
    store.activeStep = 'input' as WorkflowStepId;
    const routeProjectId = String(route.params.id || '');
    if (routeProjectId && store.activePptId !== routeProjectId) {
      void store.selectPptProject(routeProjectId);
    }
  } else {
    store.activeStep = (routeToStep[path] || 'my-ppt') as WorkflowStepId;
  }
}

watch(() => route.path, syncStepWithRoute, { immediate: true });

onMounted(async () => {
  await store.initializeData();
  syncStepWithRoute();
  void store.resumeRecoveredWorkflow();
});

onBeforeUnmount(() => {
  store.syncToProject();
});

function handleNavigate(step: string) {
  const pageSteps = ['my-ppt', 'prompts', 'skills', 'models', 'templates', 'config'];
  if (pageSteps.includes(step)) {
    const stepToRoute: Record<string, string> = {
      'my-ppt': '/my-ppt',
      prompts: '/prompts',
      skills: '/skills',
      models: '/models',
      templates: '/templates',
      config: '/config'
    };
    const routePath = stepToRoute[step];
    if (routePath) router.push(routePath);
  } else {
    store.activeStep = step as WorkflowStepId;
  }
}

async function runFromCurrentStep() {
  switch (activeStep.value) {
    case 'input':
      await store.runInputStage();
      break;
    case 'outline':
      await store.runOutline();
      break;
    case 'images':
      await store.runImages();
      break;
    case 'layout':
      await store.runLayout();
      break;
    case 'preview':
      await handleExport('pptx', { filename: 'presentation', pageRange: 'all' });
      break;
    default:
      await store.runInputStage();
  }
}

async function handleExport(format: 'pptx' | 'pdf', options: { filename: string; pageRange: string }) {
  if (isExporting.value) return;
  isExporting.value = true;
  exportProgress.value = 0;
  const exportId = `export-${Date.now()}`;

  exportHistory.value.unshift({
    id: exportId,
    filename: `${options.filename}.${format}`,
    format,
    status: 'exporting',
    createdAt: Date.now()
  });

  const progressInterval = window.setInterval(() => {
    exportProgress.value = Math.min(90, exportProgress.value + 12);
  }, 300);

  try {
    await store.exportCurrentDeck(format);
    exportProgress.value = 100;
    window.clearInterval(progressInterval);
    const item = exportHistory.value.find(h => h.id === exportId);
    if (item) item.status = 'ready';
  } catch {
    window.clearInterval(progressInterval);
    const item = exportHistory.value.find(h => h.id === exportId);
    if (item) item.status = 'queued';
  } finally {
    window.setTimeout(() => { isExporting.value = false; }, 500);
  }
}

function stageTone(status: WorkflowStep['status'], skipped?: boolean) {
  if (skipped) return 'neutral';
  if (status === 'done') return 'success';
  if (status === 'running') return 'accent';
  return 'neutral';
}

function stageLabel(status: WorkflowStep['status'], skipped?: boolean) {
  if (isPaused.value && status === 'running') return '已暂停';
  if (skipped) return '已完成';
  if (status === 'done') return '已完成';
  if (status === 'running') return '运行中';
  return '等待中';
}

function imagePageNumber(slide: unknown, index: number) {
  if (slide && typeof slide === 'object' && 'pageNumber' in slide) {
    const pageNumber = Number((slide as { pageNumber?: number }).pageNumber);
    if (Number.isFinite(pageNumber) && pageNumber > 0) return pageNumber;
  }
  return index + 1;
}
</script>

<template>
  <AppShell>
    <WorkspaceHeader />
    <SideNavigation />

    <main class="workspace-main">
      <template v-if="isPageView">
        <MyPptPage v-if="activeStep === 'my-ppt'" />
        <PromptManagePage v-else-if="activeStep === 'prompts'" />
        <SkillManagePage v-else-if="activeStep === 'skills'" />
        <ModelManagePage v-else-if="activeStep === 'models'" />
        <TemplateGalleryPage v-else-if="activeStep === 'templates'" />
        <RunConfigPage v-else-if="activeStep === 'config'" />
      </template>

      <template v-else>
        <section class="workspace-step-header">
          <div class="workspace-step-header__info">
            <div>
              <h2>{{ currentStepTitle }}</h2>
              <p>{{ activeProjectTitle }}</p>
            </div>
            <UiProgress v-if="currentProgress > 0 && currentProgress < 100" :value="currentProgress" size="sm" show-label />
          </div>
          <div class="workspace-step-header__actions">
            <VersionHistory />
            <UiButton variant="ghost" @click="store.saveWorkflow">
              <Save :size="14" />
              保存
            </UiButton>
            <UiButton v-if="isRunning" variant="secondary" :disabled="pauseRequested" @click="store.requestPauseWorkflow">
              <Pause :size="14" />
              {{ pauseRequested ? '暂停中' : '暂停' }}
            </UiButton>
            <UiButton v-else-if="isPaused" variant="primary" @click="store.continueWorkflow">
              <Play :size="14" />
              继续
            </UiButton>
            <UiButton variant="secondary" :disabled="isRunning || isPaused" @click="runFromCurrentStep">
              <Play :size="14" />
              运行当前阶段
            </UiButton>
            <UiButton variant="primary" :disabled="isRunning || isPaused" @click="store.runFullWorkflow">
              <RefreshCw :size="14" />
              完整生成
            </UiButton>
            <button class="workspace-step-header__toggle" @click="showRightPanel = !showRightPanel" title="切换运行日志">
              <component :is="showRightPanel ? ChevronRight : ChevronLeft" :size="16" />
            </button>
          </div>
        </section>

        <div class="workspace-content-wrapper" :class="{ 'workspace-content-wrapper--single': !showRightPanel }">
          <section class="workspace-content-main">
            <div class="pipeline-console">
              <section class="pipeline-hero">
                <div class="pipeline-hero__copy">
                  <span class="pipeline-kicker">PPT 生成流程</span>
                  <h1>{{ activeProjectTitle }}</h1>
                  <p>按顺序完成资料、大纲、图片、页面和导出。每一步都会显示当前进度。</p>
                </div>
                <div class="pipeline-hero__status">
                  <div class="pipeline-meter">
                    <strong>{{ pipelineProgress }}%</strong>
                    <span>
                      <i :style="{ width: `${pipelineProgress}%` }" />
                    </span>
                  </div>
                  <div>
                    <strong>{{ workflowStatusText }}</strong>
                    <span>{{ layoutCompletedPages }}/{{ layoutTotalPages || 0 }} 页面</span>
                  </div>
                </div>
              </section>

              <section class="pipeline-stages" aria-label="PPT 生成流程">
                <button
                  v-for="stage in pipelineStages"
                  :key="stage.id"
                  class="pipeline-stage"
                  :class="{
                    'pipeline-stage--active': activeStep === stage.id,
                    'pipeline-stage--running': stage.status === 'running',
                    'pipeline-stage--done': stage.status === 'done',
                    'pipeline-stage--skipped': stage.skipped
                  }"
                  @click="activeStep = stage.id"
                >
                  <span class="pipeline-stage__icon">
                    <component :is="stage.status === 'running' ? Loader2 : stage.icon" :size="18" :class="{ 'pipeline-stage__spin': stage.status === 'running' }" />
                  </span>
                  <span class="pipeline-stage__body">
                    <span class="pipeline-stage__head">
                      <strong>{{ stage.title }}</strong>
                      <UiBadge :tone="stageTone(stage.status, stage.skipped)" size="sm">{{ stageLabel(stage.status, stage.skipped) }}</UiBadge>
                    </span>
                    <span class="pipeline-stage__desc">{{ stage.description }}</span>
                    <span class="pipeline-stage__foot">
                      <span>{{ stage.metric }}</span>
                      <span>{{ stage.action }}</span>
                    </span>
                  </span>
                  <span v-if="stage.status === 'running'" class="pipeline-stage__bar">
                    <span :style="{ width: `${stage.progress}%` }" />
                  </span>
                </button>
              </section>

              <section class="workspace-panel">
                <div v-show="activeStep === 'input'" class="stage-panel">
                  <div v-if="!isDataLoaded" class="loading-placeholder">
                    <Loader2 :size="18" class="spin" />
                    正在加载项目数据...
                  </div>
                  <InputComposer
                    v-else
                    v-model="input"
                    :parameters="parameters"
                    @update:parameters="parameters = $event"
                    @attach="store.attachFiles"
                    @run="store.runFullWorkflow()"
                  />
                </div>

                <div v-show="activeStep === 'outline'" class="stage-panel stage-panel--split">
                  <div class="strategy-summary">
                    <div class="strategy-summary__header">
                      <Wand2 :size="18" />
                      <div>
                        <h3>当前生成设置</h3>
                        <p>只使用本次输入内容，不使用历史提示词、模板或 Skill。</p>
                      </div>
                    </div>
                    <div class="strategy-stack">
                      <div class="strategy-item">
                        <span>资料</span>
                        <strong>{{ input.content.trim() || input.files.length ? '已准备' : '待输入' }}</strong>
                        <button @click="activeStep = 'input'">编辑</button>
                      </div>
                      <div class="strategy-item">
                        <span>大纲</span>
                        <strong>{{ outline.length ? `${outline.length} 页` : '待生成' }}</strong>
                        <button :disabled="isRunning" @click="store.runOutline">生成</button>
                      </div>
                      <div class="strategy-item">
                        <span>图片</span>
                        <strong>{{ slidesNeedingImages.length ? `${slidesNeedingImages.length} 页需要` : '按需跳过' }}</strong>
                        <button :disabled="!designSpec" @click="activeStep = 'images'">查看</button>
                      </div>
                      <div class="strategy-item">
                        <span>页面</span>
                        <strong>{{ svgPages.length ? `${svgPages.length} 页完成` : '待生成' }}</strong>
                        <button :disabled="!designSpec" @click="activeStep = 'layout'">查看</button>
                      </div>
                    </div>
                    <div v-if="streamingText" class="strategy-stream">
                      <Loader2 :size="14" class="spin" />
                      <span>{{ streamingText.slice(-140) }}</span>
                    </div>
                  </div>

                  <OutlineEditor
                    :outline="outline"
                    :is-running="isRunning && activeStep === 'outline'"
                    :streaming-text="streamingText"
                    @update-title="store.updateSlideTitle"
                    @update-bullet="store.updateSlideBullet"
                    @add-bullet="store.addSlideBullet"
                    @delete-bullet="store.deleteSlideBullet"
                    @reorder-bullet="store.reorderBullet"
                    @update-notes="store.updateSlideNotes"
                    @update-visual-prompt="store.updateSlideVisualPrompt"
                    @reorder="store.reorderOutline"
                    @batch-delete="(ids: string[]) => { store.saveHistory(); store.outline = store.outline.filter(s => !ids.includes(s.id)) }"
                    @add-sample="store.addSampleOutline"
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
                        <p v-else-if="slidesNeedingImages.length">这些页面需要图片。</p>
                        <p v-else>生成大纲后自动判断。</p>
                      </div>
                    </div>
                    <div class="image-gate__stats">
                      <span>{{ slidesNeedingImages.length }} 页需要图片</span>
                      <strong>{{ generatedSlides.size }} 张已完成</strong>
                    </div>
                  </div>

                  <div v-if="slidesNeedingImages.length" class="image-page-list">
                    <div
                      v-for="(slide, index) in slidesNeedingImages"
                      :key="slide.id"
                      class="image-page-item"
                      :class="{ 'image-page-item--running': currentGeneratingSlide === slide.id }"
                    >
                      <span>{{ imagePageNumber(slide, index) }}</span>
                      <div class="image-page-item__preview">
                        <img
                          v-if="imageBySlideId.get(slide.id)?.url && !imageBySlideId.get(slide.id)?.error"
                          :src="imageBySlideId.get(slide.id)?.url"
                          :alt="slide.title"
                          loading="lazy"
                        />
                        <Image v-else :size="18" />
                      </div>
                      <div>
                        <strong>{{ slide.title }}</strong>
                        <p>{{ imageBySlideId.get(slide.id)?.errorMessage || slide.visualPrompt }}</p>
                      </div>
                      <div class="image-page-item__actions">
                        <UiBadge :tone="imageBySlideId.get(slide.id)?.error ? 'danger' : imageBySlideId.get(slide.id) && !imageBySlideId.get(slide.id)?.error ? 'success' : currentGeneratingSlide === slide.id ? 'accent' : 'neutral'" size="sm">
                          {{ imageBySlideId.get(slide.id)?.error ? '未生成' : imageBySlideId.get(slide.id) && !imageBySlideId.get(slide.id)?.error ? '已生成' : currentGeneratingSlide === slide.id ? '生成中' : '等待' }}
                        </UiBadge>
                        <UiButton
                          v-if="imageBySlideId.get(slide.id)?.error"
                          variant="text"
                          size="sm"
                          :disabled="isRunning || currentGeneratingSlide === slide.id"
                          @click="store.retrySlideImage(slide.id)"
                        >
                          <RotateCcw :size="13" />
                          重试
                        </UiButton>
                      </div>
                    </div>
                  </div>

                  <div class="stage-actions">
                    <UiButton variant="primary" :disabled="isRunning || !designSpec" @click="store.runImages">
                      <Sparkles :size="14" />
                      生成图片
                    </UiButton>
                    <UiButton variant="secondary" :disabled="isRunning || !designSpec" @click="store.runLayout">
                      <Paintbrush :size="14" />
                      生成页面
                    </UiButton>
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
                  <div v-else-if="pauseRequested" class="pause-notice pause-notice--pending">
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
                        <strong>{{ layoutCompletedPages }}/{{ layoutTotalPages || 0 }}</strong>
                        <span>{{ layoutProgressPercent }}%</span>
                      </div>
                    </div>
                    <UiProgress :value="layoutProgressPercent" size="md" show-label />

                    <div class="executor-preview">
                      <div class="executor-preview__live">
                        <div v-if="latestSvgPage" class="executor-preview__canvas" v-html="latestSvgPage.svg" />
                        <div v-else class="executor-preview__empty">
                          <Paintbrush :size="28" />
                          <span>等待第一张 SVG 页面</span>
                        </div>
                      </div>
                      <div class="executor-preview__side">
                        <div class="executor-step-card">
                          <span>状态</span>
                          <strong>{{ isPaused ? '已暂停' : isRunning && activeStep === 'layout' ? '生成中' : svgPages.length ? '生成完成' : '待启动' }}</strong>
                        </div>
                        <div class="executor-step-card">
                          <span>大纲</span>
                          <strong>{{ designSpec ? '已生成' : '未生成' }}</strong>
                        </div>
                        <div class="executor-step-card">
                          <span>图片</span>
                          <strong>{{ selectedImages.length ? `${selectedImages.length} 张` : '无' }}</strong>
                        </div>
                      </div>
                    </div>

                    <div class="executor-thumbs" v-if="layoutTotalPages">
                      <template v-for="i in layoutTotalPages" :key="i">
                        <button
                          v-if="svgPages[i - 1]"
                          class="executor-thumb executor-thumb--done"
                          @click="previewPageIndex = i - 1; activeStep = 'preview'"
                        >
                          <span>{{ i }}</span>
                          <div v-html="svgPages[i - 1].svg" />
                        </button>
                        <div v-else class="executor-thumb executor-thumb--pending">
                          <span>{{ i }}</span>
                        </div>
                      </template>
                    </div>
                  </div>

                  <div class="stage-actions">
                    <UiButton variant="primary" :disabled="isRunning || !designSpec" @click="store.runLayout">
                      <Play :size="14" />
                      生成页面
                    </UiButton>
                    <UiButton variant="secondary" :disabled="svgPages.length === 0" @click="activeStep = 'preview'">
                      <Eye :size="14" />
                      查看预览
                    </UiButton>
                  </div>
                </div>

                <div v-show="activeStep === 'preview'" class="stage-panel">
                  <div class="quality-strip">
                    <div>
                      <h3>导出</h3>
                      <p>确认预览后导出 PPTX。</p>
                    </div>
                    <UiButton variant="primary" :disabled="isExporting || svgPages.length === 0" @click="handleExport('pptx', { filename: 'presentation', pageRange: 'all' })">
                      <Download :size="14" />
                      {{ isExporting ? '导出中...' : '导出 PPTX' }}
                    </UiButton>
                  </div>
                  <UiProgress v-if="isExporting" :value="exportProgress" size="md" show-label />

                  <SvgDeckPreview
                    v-if="svgPages.length > 0"
                    :pages="svgPages"
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
              </section>
            </div>
          </section>

          <aside v-show="showRightPanel" class="workspace-content-right">
            <div class="right-panel-title">
              <h3>运行日志</h3>
              <span>实时记录每个阶段</span>
            </div>
            <div class="right-panel-content">
              <ActivityLog :logs="activityLog" />
            </div>
          </aside>
        </div>

        <footer class="workspace-status-bar">
          <div class="workspace-status-bar__left">
            <WorkflowRail :steps="steps" :active-step="activeStep" @select="(stepId) => { store.activeStep = stepId as WorkflowStepId; }" />
          </div>
          <div class="workspace-status-bar__right">
            <span class="status-item">
              <Brain :size="12" />
              文本模型就绪
            </span>
            <span class="status-item">{{ outline.length }} 页大纲</span>
            <span class="status-item">{{ images.length }} 张图片</span>
          </div>
        </footer>
      </template>
    </main>

    <GlobalSearch
      :show="showGlobalSearch"
      @close="showGlobalSearch = false"
    />
    <ShortcutsHelp
      :show="showShortcutsHelp"
      @close="showShortcutsHelp = false"
    />
    <AiChatPanel />
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
  gap: 16px;
  min-width: 0;
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
  gap: 14px;
  max-width: 1180px;
  margin: 0 auto;
}

.pipeline-hero {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 18px;
  padding: 20px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-card);
}

.pipeline-kicker {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  color: var(--color-muted);
  background: var(--color-panel);
  font-size: 11px;
  font-weight: 600;
}

.pipeline-hero h1 {
  margin: 10px 0 8px;
  color: var(--color-text);
  font-size: 24px;
  line-height: 1.2;
  letter-spacing: 0;
}

.pipeline-hero p {
  max-width: 720px;
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.7;
}

.pipeline-hero__status {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 210px;
  padding-left: 18px;
  border-left: 1px solid var(--color-border);
}

.pipeline-meter {
  display: grid;
  gap: 8px;
  width: 96px;
}

.pipeline-meter strong {
  color: var(--color-text);
  font-size: 20px;
  line-height: 1;
}

.pipeline-meter span {
  display: block;
  height: 8px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-panel);
  overflow: hidden;
}

.pipeline-meter i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-accent);
  transition: width 0.3s ease;
}

.pipeline-hero__status strong {
  display: block;
  color: var(--color-text);
  font-size: 22px;
  line-height: 1;
}

.pipeline-hero__status span {
  color: var(--color-subtle);
  font-size: 12px;
}

.pipeline-stages {
  display: grid;
  grid-template-columns: repeat(5, minmax(150px, 1fr));
  gap: 10px;
}

.pipeline-stage {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-height: 144px;
  padding: 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-card);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: border-color var(--transition-fast), background var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast);
}

.pipeline-stage:hover {
  transform: translateY(-1px);
  border-color: var(--color-border-strong);
  box-shadow: var(--shadow-sm);
}

.pipeline-stage--active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.pipeline-stage--done .pipeline-stage__icon {
  color: #ffffff;
  border-color: var(--color-success);
  background: var(--color-success);
}

.pipeline-stage--running .pipeline-stage__icon {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.pipeline-stage--skipped {
  border-style: dashed;
}

.pipeline-stage__icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-muted);
  background: var(--color-surface);
}

.pipeline-stage__body {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.pipeline-stage__head {
  display: grid;
  gap: 8px;
}

.pipeline-stage__head strong {
  color: var(--color-text);
  font-size: 13px;
  line-height: 1.35;
}

.pipeline-stage__desc {
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.55;
}

.pipeline-stage__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--color-subtle);
  font-size: 11px;
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

.stage-panel--split {
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  align-items: start;
}

.loading-placeholder,
.strategy-summary,
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

.strategy-summary {
  display: grid;
  gap: 14px;
  padding: 16px;
  position: sticky;
  top: 0;
}

.strategy-summary__header,
.image-gate__main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.strategy-summary__header svg,
.image-gate__icon {
  color: var(--color-accent);
}

.strategy-summary h3,
.image-gate h3,
.executor-board h3,
.quality-strip h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 15px;
  font-weight: 700;
}

.strategy-summary p,
.image-gate p,
.executor-board p,
.quality-strip p {
  margin: 5px 0 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.6;
}

.strategy-stack {
  display: grid;
  gap: 8px;
}

.strategy-item {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
}

.strategy-item span {
  color: var(--color-subtle);
  font-size: 11px;
}

.strategy-item strong {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.strategy-item button {
  min-height: 26px;
  padding: 0 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-muted);
  background: var(--color-surface);
  font-size: 11px;
  cursor: pointer;
}

.strategy-item button:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.strategy-item button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.strategy-stream {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-muted);
  background: var(--color-surface);
  font-size: 12px;
  line-height: 1.6;
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
  display: grid;
  place-items: center;
  width: 88px;
  height: 50px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-panel);
  color: var(--color-subtle);
}

.image-page-item__preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
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

.image-page-item__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 104px;
}

.stage-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pause-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--color-accent);
  border-radius: 8px;
  background: var(--color-accent-soft);
}

.pause-notice--pending {
  border-color: var(--color-border-strong);
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
  grid-template-columns: minmax(0, 1fr) 180px;
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

.executor-preview__side {
  display: grid;
  align-content: start;
  gap: 8px;
}

.executor-step-card {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.executor-step-card span {
  color: var(--color-subtle);
  font-size: 11px;
}

.executor-step-card strong {
  color: var(--color-text);
  font-size: 13px;
}

.executor-thumbs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 8px;
}

.executor-thumb {
  position: relative;
  display: block;
  min-height: 70px;
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

.executor-thumb--pending {
  display: grid;
  place-items: center;
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

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1180px) {
  .pipeline-stages {
    grid-template-columns: repeat(2, minmax(220px, 1fr));
  }

  .stage-panel--split {
    grid-template-columns: 1fr;
  }

  .strategy-summary {
    position: static;
  }
}

@media (max-width: 920px) {
  .workspace-content-wrapper {
    grid-template-columns: 1fr;
  }

  .workspace-content-right {
    display: none;
  }

  .workspace-step-header,
  .workspace-status-bar,
  .pipeline-hero,
  .image-gate,
  .executor-board__header,
  .quality-strip {
    align-items: stretch;
    flex-direction: column;
  }

  .workspace-step-header__actions,
  .workspace-status-bar__right {
    flex-wrap: wrap;
  }

  .pipeline-hero__status {
    min-width: 0;
    padding-left: 0;
    padding-top: 14px;
    border-left: none;
    border-top: 1px solid var(--color-border);
  }

  .executor-preview {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .workspace-content-main {
    padding: 10px;
  }

  .pipeline-stages {
    grid-template-columns: 1fr;
  }

  .pipeline-hero h1 {
    font-size: 20px;
  }

  .strategy-item,
  .image-page-item {
    grid-template-columns: 1fr;
  }
}
</style>
