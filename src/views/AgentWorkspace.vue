<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { Brain, ChevronLeft, ChevronRight, Eye, Play, RefreshCw, Save } from 'lucide-vue-next';
import AppShell from '@/components/layout/AppShell.vue';
import SideNavigation from '@/components/layout/SideNavigation.vue';
import WorkspaceHeader from '@/components/layout/WorkspaceHeader.vue';
import ActivityLog from '@/components/panels/ActivityLog.vue';
import ImageWorkbench from '@/components/panels/ImageWorkbench.vue';
import InputComposer from '@/components/panels/InputComposer.vue';
import OutlineEditor from '@/components/panels/OutlineEditor.vue';
import ParameterPanel from '@/components/panels/ParameterPanel.vue';
import DeckPreview from '@/components/preview/DeckPreview.vue';
import WorkflowRail from '@/components/workflow/WorkflowRail.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiProgress from '@/components/ui/UiProgress.vue';
import MyPptPage from '@/components/pages/MyPptPage.vue';
import PromptManagePage from '@/components/pages/PromptManagePage.vue';
import SkillManagePage from '@/components/pages/SkillManagePage.vue';
import ModelManagePage from '@/components/pages/ModelManagePage.vue';
import TemplateGalleryPage from '@/components/pages/TemplateGalleryPage.vue';
import RunConfigPage from '@/components/pages/RunConfigPage.vue';
import ExportPanel from '@/components/panels/ExportPanel.vue';
import GlobalSearch from '@/components/common/GlobalSearch.vue';
import ShortcutsHelp from '@/components/common/ShortcutsHelp.vue';
import AiChatPanel from '@/components/panels/AiChatPanel.vue';
import VersionHistory from '@/components/common/VersionHistory.vue';
import { useAgentStore } from '@/stores/agentStore';
import { useShortcuts } from '@/composables/useShortcuts';

const route = useRoute();
const router = useRouter();
const store = useAgentStore();

const {
  activityLog,
  activePpt,
  exportArtifacts,
  generatedSlides,
  images,
  input,
  isRunning,
  outline,
  parameters,
  pptProjects,
  prompts,
  selectedImages,
  skills,
  steps,
  streamingText,
  templates,
  currentGeneratingSlide,
  isDataLoaded
} = storeToRefs(store);

const showRightPanel = ref(true);
const rightPanelTab = ref<'config' | 'logs' | 'skills'>('config');

// Export state
const exportProgress = ref(0);
const isExporting = ref(false);
const exportHistory = ref<Array<{ id: string; filename: string; format: 'pptx' | 'pdf'; status: 'ready' | 'queued' | 'exporting'; createdAt: number }>>([]);

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

  // Simulate progress
  const progressInterval = setInterval(() => {
    exportProgress.value = Math.min(90, exportProgress.value + Math.random() * 15);
  }, 300);

  try {
    await store.exportCurrentDeck(format);
    exportProgress.value = 100;
    clearInterval(progressInterval);

    const item = exportHistory.value.find(h => h.id === exportId);
    if (item) item.status = 'ready';
  } catch {
    clearInterval(progressInterval);
    const item = exportHistory.value.find(h => h.id === exportId);
    if (item) item.status = 'queued';
  } finally {
    setTimeout(() => { isExporting.value = false; }, 500);
  }
}

// Global search & shortcuts state
const showGlobalSearch = ref(false);
const showShortcutsHelp = ref(false);

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
    description: '运行当前步骤',
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
  set: (value) => { store.activeStep = value as any; }
});

const stepTitles: Record<string, string> = {
  'my-ppt': '我的 PPT',
  'prompts': '提示词管理',
  'skills': 'Skill 管理',
  'models': '模型管理',
  'templates': '模版广场',
  'config': '运行配置',
  input: '输入',
  outline: '文本分析',
  images: '图像生成',
  layout: '排版 & Skill',
  preview: '预览 & 导出'
};

const currentStepTitle = computed(() => stepTitles[activeStep.value] || '工作区');
const currentProgress = computed(() => steps.value.find((step) => step.id === activeStep.value)?.progress || 0);

const isPageView = computed(() => {
  return ['my-ppt', 'prompts', 'skills', 'models', 'templates', 'config'].includes(activeStep.value);
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
    store.activeStep = 'input' as any;
  } else {
    const step = routeToStep[path] || 'my-ppt';
    store.activeStep = step as any;
  }
}

watch(() => route.path, syncStepWithRoute, { immediate: true });

onMounted(async () => {
  syncStepWithRoute();
  await store.initializeData();
});

function handleNavigate(step: string) {
  const pageSteps = ['my-ppt', 'prompts', 'skills', 'models', 'templates', 'config'];
  if (pageSteps.includes(step)) {
    const stepToRoute: Record<string, string> = {
      'my-ppt': '/my-ppt',
      'prompts': '/prompts',
      'skills': '/skills',
      'models': '/models',
      'templates': '/templates',
      'config': '/config'
    };
    const routePath = stepToRoute[step];
    if (routePath) {
      router.push(routePath);
    }
  } else {
    store.activeStep = step as any;
  }
}

async function runFromCurrentStep() {
  switch (activeStep.value) {
    case 'outline':
      await store.runOutline();
      break;
    case 'images':
      await store.runImages();
      break;
    case 'layout':
      await store.runLayout();
      break;
    default:
      await store.runFullWorkflow();
  }
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
              <p>{{ activePpt?.title || '尚未选择 PPT 项目' }}</p>
            </div>
            <UiProgress v-if="currentProgress > 0 && currentProgress < 100" :value="currentProgress" size="sm" show-label />
          </div>
          <div class="workspace-step-header__actions">
            <VersionHistory />
            <UiButton variant="ghost" @click="store.saveWorkflow">
              <Save :size="14" />
              保存
            </UiButton>
            <UiButton variant="secondary" @click="runFromCurrentStep">
              <Play :size="14" />
              运行当前步骤
            </UiButton>
            <UiButton variant="primary" @click="store.runFullWorkflow">
              <RefreshCw :size="14" />
              完整运行
            </UiButton>
            <button class="workspace-step-header__toggle" @click="showRightPanel = !showRightPanel">
              <component :is="showRightPanel ? ChevronRight : ChevronLeft" :size="16" />
            </button>
          </div>
        </section>

        <div class="workspace-content-wrapper">
          <section class="workspace-content-main">
            <div v-show="activeStep === 'input'" class="workspace-panel">
              <div v-if="!isDataLoaded" class="loading-placeholder">
                加载中...
              </div>
              <InputComposer
                v-else
                v-model="input"
                :prompts="prompts"
                :skills="skills"
                @attach="store.attachFiles"
                @run="store.runFullWorkflow"
                @apply-prompt="store.applyPrompt"
                @toggle-skill="store.toggleSkill"
              />
            </div>

            <div v-show="activeStep === 'outline'" class="workspace-panel">
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
                @reorder="store.reorderOutline"
                @batch-delete="(ids: string[]) => { store.saveHistory(); store.outline = store.outline.filter(s => !ids.includes(s.id)) }"
                @add-sample="store.addSampleOutline"
                @run="store.runOutline"
              />
            </div>

            <div v-show="activeStep === 'images'" class="workspace-panel">
              <ImageWorkbench
                :images="images"
                :is-running="isRunning && activeStep === 'images'"
                :current-generating-slide="currentGeneratingSlide"
                :generated-count="generatedSlides.size"
                :total-count="outline.length"
                @run="store.runImages"
                @select="store.selectImage"
              />
            </div>

            <div v-show="activeStep === 'layout'" class="workspace-panel">
              <div class="layout-workspace">
                <!-- Template Selection -->
                <UiCard title="PPT 排版" subtitle="选择模版、配置每页版式，然后应用排版">
                  <div class="layout-grid">
                    <div v-for="t in templates" :key="t.id" class="layout-template-card"
                      :class="{ 'layout-template-card--active': (activePpt?.templateId || templates[0]?.id) === t.id }"
                      @click="store.applyGalleryTemplate(t)"
                      :title="`应用「${t.name}」模版`">
                      <div class="layout-template-preview" :style="{ background: (t.accent || '#ef2d2d') + '20', borderColor: t.accent || '#ef2d2d' }">
                        <div class="layout-template-bar" :style="{ background: t.accent || '#ef2d2d' }" />
                        <div class="layout-template-bar" :style="{ background: (t.accent || '#ef2d2d') + '60' }" />
                        <div class="layout-template-bar layout-template-bar--short" :style="{ background: (t.accent || '#ef2d2d') + '40' }" />
                      </div>
                      <div class="layout-template-info">
                        <strong>{{ t.name }}</strong>
                        <UiBadge tone="neutral" size="sm">{{ t.category }}</UiBadge>
                      </div>
                    </div>
                    <button class="layout-template-card layout-template-card--add" @click="handleNavigate('templates')" title="前往模版广场管理">
                      <div class="layout-template-add-icon">+</div>
                      <span>管理模版</span>
                    </button>
                  </div>

                  <div class="layout-params">
                    <div class="layout-param">
                      <span class="layout-param__label">模版风格</span>
                      <div class="layout-style-chips">
                        <button v-for="style in [{ v: 'business', l: '商务' }, { v: 'creative', l: '创意' }, { v: 'education', l: '教育' }]"
                          :key="style.v"
                          class="style-chip"
                          :class="{ 'style-chip--active': parameters.template === style.v }"
                          @click="parameters.template = style.v as any">
                          {{ style.l }}
                        </button>
                      </div>
                    </div>
                    <div class="layout-param">
                      <span class="layout-param__label">图像风格</span>
                      <div class="layout-style-chips">
                        <button v-for="imgStyle in [{ v: 'flat', l: '扁平' }, { v: 'realistic', l: '写实' }, { v: 'illustration', l: '插画' }, { v: '3d', l: '3D' }]"
                          :key="imgStyle.v"
                          class="style-chip"
                          :class="{ 'style-chip--active': parameters.imageStyle === imgStyle.v }"
                          @click="parameters.imageStyle = imgStyle.v as any">
                          {{ imgStyle.l }}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div class="layout-enabled-skills">
                    <span class="layout-param__label">已启用 Skill（{{ skills.filter(s => s.enabled).length }}）</span>
                    <div class="layout-skill-chips">
                      <span v-for="skill in skills.filter(s => s.enabled)" :key="skill.id" class="skill-chip">
                        {{ skill.name }}
                      </span>
                      <span v-if="skills.filter(s => s.enabled).length === 0" class="no-skills-hint">暂无启用 Skill，前往 Skill 管理页配置</span>
                    </div>
                  </div>

                  <div class="layout-actions">
                    <UiButton variant="primary" :disabled="isRunning || outline.length === 0" @click="store.runLayout">
                      <Play :size="14" />
                      应用排版 & Skill
                    </UiButton>
                    <UiButton variant="ghost" @click="store.activeStep = 'preview' as any">
                      <Eye :size="14" />
                      预览效果
                    </UiButton>
                  </div>
                </UiCard>

                <!-- Slide layout list -->
                <UiCard title="页面版式 ({{ outline.length }} 页)" subtitle="每页可单独切换版式">
                  <div class="layout-slide-list">
                    <div v-for="(slide, i) in outline" :key="slide.id" class="layout-slide-item">
                      <div class="layout-slide-num">{{ i + 1 }}</div>
                      <div class="layout-slide-info">
                        <span class="layout-slide-title">{{ slide.title }}</span>
                      </div>
                      <div class="layout-slide-layouts">
                        <button v-for="layout in [{id:'text-only' as const,label:'T',desc:'纯文字'},{id:'text-image' as const,label:'T+I',desc:'左文右图'},{id:'image-text' as const,label:'I+T',desc:'左图右文'},{id:'full-image' as const,label:'IMG',desc:'全幅图片'}]"
                          :key="layout.id"
                          class="layout-opt-btn"
                          :class="{ 'layout-opt-btn--active': (slide.layout || 'text-only') === layout.id }"
                          @click="store.setSlideLayout(slide.id, layout.id)"
                          :title="layout.desc">
                          {{ layout.label }}
                        </button>
                      </div>
                    </div>
                  </div>
                </UiCard>
              </div>
            </div>

            <div v-show="activeStep === 'preview'" class="workspace-panel">
              <DeckPreview
                :artifacts="exportArtifacts"
                :outline="outline"
                :parameters="parameters"
                :selected-images="selectedImages"
                @export="store.exportCurrentDeck"
              />
            </div>

          </section>

          <aside v-show="showRightPanel" class="workspace-content-right">
            <div class="right-panel-tabs">
              <button
                v-for="tab in [{ key: 'config', label: '配置' }, { key: 'logs', label: '日志' }, { key: 'skills', label: 'Skill' }]"
                :key="tab.key"
                class="right-panel-tab"
                :class="{ 'right-panel-tab--active': rightPanelTab === tab.key }"
                @click="rightPanelTab = tab.key as any"
              >
                {{ tab.label }}
              </button>
            </div>
            <div class="right-panel-content">
              <ParameterPanel
                v-show="rightPanelTab === 'config'"
                v-model="parameters"
                :templates="templates"
                @select-template="(templateId) => { const t = templates.find(t => t.id === templateId); if (t) store.applyGalleryTemplate(t); }"
              />
              <ActivityLog v-show="rightPanelTab === 'logs'" :logs="activityLog" />
              <div v-show="rightPanelTab === 'skills'" class="skill-viewer">
                <div v-if="skills.length === 0" class="skill-viewer__empty">暂无 Skill，前往 Skill 管理页添加</div>
                <div v-for="skill in skills" :key="skill.id" class="skill-viewer__item" :class="{ 'skill-viewer__item--enabled': skill.enabled }">
                  <div class="skill-viewer__header">
                    <strong>{{ skill.name }}</strong>
                    <button
                      class="skill-toggle-btn"
                      :class="{ 'skill-toggle-btn--on': skill.enabled }"
                      @click="store.toggleSkill(skill.id)"
                      :title="skill.enabled ? '点击停用' : '点击启用'"
                    >
                      <span class="skill-toggle-knob" />
                    </button>
                  </div>
                  <p>{{ skill.description }}</p>
                  <div v-if="Object.keys(skill.params).length" class="skill-viewer__params">
                    <span v-for="(value, key) in skill.params" :key="key" class="skill-viewer__param">{{ key }}: {{ value }}</span>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>

        <footer class="workspace-status-bar">
          <div class="workspace-status-bar__left">
            <WorkflowRail :steps="steps" :active-step="activeStep" @select="(stepId) => { store.activeStep = stepId as any; }" />
          </div>
          <div class="workspace-status-bar__right">
            <span class="status-item">
              <Brain :size="12" />
              AI 模型就绪
            </span>
            <span class="status-item">{{ outline.length }} 页幻灯片</span>
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
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
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
  grid-template-columns: 1fr 320px;
  min-height: 0;
  overflow: hidden;
}

.workspace-content-main {
  padding: 16px;
  overflow-y: auto;
  min-width: 0;
}

.workspace-panel {
  max-width: 980px;
  margin: 0 auto;
}

.workspace-content-right {
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--color-border);
  background: var(--color-surface);
  overflow: hidden;
}

.right-panel-tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border);
  padding: 0 8px;
}

.right-panel-tab {
  flex: 1;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 500;
  text-align: center;
  border-bottom: 2px solid transparent;
  transition: all var(--transition-fast);
}

.right-panel-tab:hover {
  color: var(--color-text);
}

.right-panel-tab--active {
  color: var(--color-accent);
  border-bottom-color: var(--color-accent);
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
  min-height: 48px;
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
}

/* ---- Layout workspace ---- */
.layout-workspace {
  display: grid;
  gap: 16px;
}

.layout-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}

.layout-template-card {
  padding: 12px;
  border: 1.5px solid var(--color-border);
  border-radius: 10px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.layout-template-card:hover {
  border-color: var(--color-border-strong);
}

.layout-template-card--active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.layout-template-card--add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-style: dashed;
  color: var(--color-muted);
  font-size: 12px;
  cursor: pointer;
  background: var(--color-panel);
}

.layout-template-card--add:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.layout-template-add-icon {
  font-size: 24px;
  font-weight: 300;
  line-height: 1;
}

.layout-template-preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid;
  margin-bottom: 8px;
  min-height: 60px;
  justify-content: center;
}

.layout-template-bar {
  height: 6px;
  border-radius: 3px;
  width: 80%;
}

.layout-template-bar--short {
  width: 50%;
}

.layout-template-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.layout-template-info strong {
  font-size: 12px;
  color: var(--color-text);
}

.layout-params {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
}

.layout-param {
  display: flex;
  align-items: center;
  gap: 12px;
}

.layout-param__label {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text);
  min-width: 72px;
}

.layout-style-chips {
  display: flex;
  gap: 4px;
}

.style-chip {
  padding: 4px 12px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.style-chip:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.style-chip--active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.layout-enabled-skills {
  padding: 10px 0;
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.layout-skill-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.skill-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-size: 11px;
  font-weight: 500;
}

.no-skills-hint {
  font-size: 12px;
  color: var(--color-subtle);
  font-style: italic;
}

.layout-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

/* Slide-level layout options */
.layout-slide-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 300px;
  overflow-y: auto;
}

.layout-slide-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  transition: border-color var(--transition-fast);
}

.layout-slide-item:hover {
  border-color: var(--color-border-strong);
}

.layout-slide-num {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}

.layout-slide-info {
  flex: 1;
  min-width: 0;
}

.layout-slide-title {
  font-size: 13px;
  color: var(--color-text);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layout-slide-layouts {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.layout-opt-btn {
  padding: 3px 8px;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 10px;
  font-family: var(--font-mono);
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.layout-opt-btn:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.layout-opt-btn--active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.export-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.export-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  text-align: left;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.export-option:hover {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.export-option__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.export-option__info strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.export-option__info span {
  font-size: 11px;
  color: var(--color-subtle);
}

.export-artifacts {
  border-top: 1px solid var(--color-border);
  padding-top: 16px;
}

.export-artifacts h4 {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.export-artifact {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--color-muted);
}

@media (max-width: 1100px) {
  .workspace-content-wrapper {
    grid-template-columns: 1fr;
  }

  .workspace-content-right {
    display: none;
  }
}

.loading-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  color: var(--color-muted);
  font-size: 14px;
}

.skill-viewer {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.skill-viewer__empty {
  padding: 24px;
  text-align: center;
  color: var(--color-muted);
  font-size: 13px;
}

.skill-viewer__item {
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
}

.skill-viewer__item--enabled {
  border-color: var(--color-accent-soft);
  background: var(--color-accent-soft);
}

.skill-viewer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.skill-viewer__header strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.skill-viewer__item p {
  margin: 0;
  font-size: 12px;
  color: var(--color-subtle);
  line-height: 1.5;
}

.skill-viewer__params {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.skill-viewer__param {
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 10px;
  font-family: var(--font-mono);
}

.skill-toggle-btn {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  border: 1.5px solid var(--color-border);
  background: var(--color-surface);
  cursor: pointer;
  position: relative;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.skill-toggle-btn--on {
  background: var(--color-accent);
  border-color: var(--color-accent);
}

.skill-toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: white;
  transition: transform 0.2s ease;
}

.skill-toggle-btn--on .skill-toggle-knob {
  transform: translateX(16px);
}

.layout-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
</style>
