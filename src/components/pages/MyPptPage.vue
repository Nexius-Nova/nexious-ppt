<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Plus, Search, Trash2, FileText, Clock, Calendar, Check, BookmarkCheck, RefreshCw, Pause } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiEmpty from '@/components/ui/UiEmpty.vue';
import UiFeedbackState from '@/components/ui/UiFeedbackState.vue';
import PageLoadingState from '@/components/common/PageLoadingState.vue';
import NexiousLoader from '@/components/common/NexiousLoader.vue';
import PrivateSvg from '@/components/common/PrivateSvg.vue';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import { projectApi, templateApi, type Project, type Template } from '@/services/api';
import { slideNeedsImage } from '@/utils/slideVisuals';
import type { PptProjectState, WorkflowStep } from '@/types/agent';
import { buildTemplatePayloadFromProject } from '@/utils/templateFromProject';
import { translateErrorMessage } from '@/utils/errorMessages';

const router = useRouter();
const agentStore = useAgentStore();
const toastStore = useToastStore();

const projects = ref<Project[]>([]);
const templates = ref<Template[]>([]);
const loading = ref(false);
const loadError = ref('');
const searchQuery = ref('');
const showDeleteModal = ref(false);
const projectToDelete = ref<Project | null>(null);
const showCreateModal = ref(false);
const newProjectTitle = ref('');
const savingTemplateIds = ref<Set<number>>(new Set());
const deletedProjectIds = ref<Set<number>>(new Set());
let projectRefreshTimer: number | null = null;

type ProjectDisplayStatus = 'draft' | 'paused' | 'generating' | 'completed';
type TemplateSaveState = 'unsaved' | 'saved' | 'stale';
type ProjectDisplay = Project & {
  displayStatus: ProjectDisplayStatus;
  displayProgress: number;
  stageLabel: string;
  detailLabel: string;
  previewSvg: string;
  previewPageNumber: number | null;
  imageReady: number;
  imageTotal: number;
  pageReady: number;
  pageTotal: number;
};

function normalizeProjectText(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function getTemplateSettings(template: Template): Record<string, any> {
  if (!template.settings) return {};
  if (typeof template.settings === 'string') {
    try {
      const parsed = JSON.parse(template.settings);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof template.settings === 'object' ? template.settings as Record<string, any> : {};
}

function templateNameForProject(project: Project) {
  return `${project.title || project.topic || '未命名 PPT'} 模板`;
}

function getSavedTemplate(project: Project) {
  const projectId = String(project.id);
  const expectedName = normalizeProjectText(templateNameForProject(project));
  return templates.value.find((template) => {
    const settings = getTemplateSettings(template);
    const sourceProjectId = settings.sourceProjectId ? String(settings.sourceProjectId) : '';
    if (sourceProjectId && sourceProjectId === projectId) return true;

    return normalizeProjectText(template.name) === expectedName;
  }) || null;
}

function isTemplateSaved(project: Project) {
  return Boolean(getSavedTemplate(project));
}

function getTemplateSaveState(project: Project): TemplateSaveState {
  const template = getSavedTemplate(project);
  if (!template) return 'unsaved';

  const projectUpdatedAt = new Date(project.updated_at).getTime();
  const templateUpdatedAt = new Date(template.updated_at).getTime();
  if (Number.isFinite(projectUpdatedAt) && Number.isFinite(templateUpdatedAt) && projectUpdatedAt > templateUpdatedAt + 1000) {
    return 'stale';
  }

  return 'saved';
}

function getTemplateActionTitle(project: Project) {
  const state = getTemplateSaveState(project);
  if (state === 'saved') return '查看模板广场中的模板';
  if (state === 'stale') return '当前 PPT 已更新，可同步更新模板';
  return '保存为模板';
}

function getTemplateActionLabel(project: Project) {
  const state = getTemplateSaveState(project);
  if (state === 'saved') return '已存模板';
  if (state === 'stale') return '更新模板';
  return '存为模板';
}

function isProjectTitleDuplicated(title: string) {
  const normalizedTitle = normalizeProjectText(title);
  if (!normalizedTitle) return false;
  return uniqueProjects.value.some((project) => normalizeProjectText(project.title) === normalizedTitle);
}

function isSameProjectIdentity(left: Project, right: Project) {
  const leftTitle = normalizeProjectText(left.title);
  const rightTitle = normalizeProjectText(right.title);
  if (!leftTitle || leftTitle !== rightTitle) return false;

  const leftTopic = normalizeProjectText(left.topic);
  const rightTopic = normalizeProjectText(right.topic);
  return leftTopic === rightTopic || !leftTopic || !rightTopic;
}

const uniqueProjects = computed(() => {
  const items: Project[] = [];

  for (const project of projects.value) {
    const existingIndex = items.findIndex((item) => isSameProjectIdentity(item, project));
    const existing = existingIndex >= 0 ? items[existingIndex] : null;
    if (!existing || new Date(project.updated_at).getTime() > new Date(existing.updated_at).getTime()) {
      if (existingIndex >= 0) {
        items[existingIndex] = project;
      } else {
        items.push(project);
      }
    }
  }

  return items;
});

function parseProjectState(project: Project): PptProjectState | null {
  if (!project.state) return null;
  if (typeof project.state === 'string') {
    try {
      return JSON.parse(project.state) as PptProjectState;
    } catch {
      return null;
    }
  }
  return project.state as PptProjectState;
}

function getStepProgress(steps: WorkflowStep[] | undefined, id: string) {
  const step = steps?.find((item) => item.id === id);
  if (!step) return 0;
  if (step.status === 'done') return 100;
  return Math.max(0, Math.min(100, Math.round(step.progress || 0)));
}

function hasInputContent(state: PptProjectState | null, project: Project) {
  return Boolean(
    state?.input?.topic?.trim() ||
    state?.input?.content?.trim() ||
    state?.input?.files?.length ||
    project.topic?.trim() ||
    project.content?.trim()
  );
}

function getSlidesForProgress(state: PptProjectState | null) {
  return state?.designSpec?.outline?.length ? state.designSpec.outline : state?.outline || [];
}

function countReadyImages(state: PptProjectState | null) {
  return (state?.images || []).filter((image) => image.selected && !image.error && Boolean(image.url)).length;
}

function getProjectPreviewPage(state: PptProjectState | null) {
  const pages = (state?.svgPages || [])
    .filter((page) => page.svg?.trim())
    .sort((left, right) => (left.pageNumber || 0) - (right.pageNumber || 0));

  return pages[0] || null;
}

function deriveProjectDisplay(project: Project): ProjectDisplay {
  const state = parseProjectState(project);
  const slides = getSlidesForProgress(state);
  const previewPage = getProjectPreviewPage(state);
  const imageTotal = slides.filter((slide: any) => slideNeedsImage(slide)).length;
  const imageReady = countReadyImages(state);
  const pageTotal = state?.designSpec?.outline?.length || state?.outline?.length || state?.parameters?.slideCount || 0;
  const pageReady = state?.svgPages?.filter((page) => page.svg?.trim()).length || 0;
  const inputProgress = hasInputContent(state, project) ? 100 : getStepProgress(state?.steps, 'input');
  const outlineProgress = state?.designSpec || (state?.outline?.length || 0) > 0
    ? 100
    : getStepProgress(state?.steps, 'outline');
  const imageProgress = imageTotal === 0
    ? (outlineProgress === 100 ? 100 : getStepProgress(state?.steps, 'images'))
    : Math.max(getStepProgress(state?.steps, 'images'), Math.round((imageReady / imageTotal) * 100));
  const layoutProgress = pageTotal > 0
    ? Math.max(getStepProgress(state?.steps, 'layout'), Math.round((pageReady / pageTotal) * 100))
    : getStepProgress(state?.steps, 'layout');
  const previewProgress = (state?.exportArtifacts?.length || 0) > 0
    ? 100
    : getStepProgress(state?.steps, 'preview');
  const progress = Math.round((inputProgress + outlineProgress + imageProgress + layoutProgress + previewProgress) / 5);
  const isPausedProject = Boolean(state?.paused);
  const hasRunningStep = !isPausedProject && Boolean(state?.workflowActive || state?.steps?.some((step) => step.status === 'running'));
  const isComplete = previewProgress === 100 || (pageTotal > 0 && pageReady >= pageTotal && layoutProgress === 100);

  let displayStatus: ProjectDisplayStatus = project.status;
  if (isPausedProject) {
    displayStatus = 'paused';
  } else if (hasRunningStep) {
    displayStatus = 'generating';
  } else if (isComplete) {
    displayStatus = 'completed';
  } else if (progress > 0 && project.status !== 'completed') {
    displayStatus = progress >= 100 ? 'completed' : 'draft';
  }

  let stageLabel = '等待输入';
  if (isPausedProject) stageLabel = '已暂停，可继续';
  else if (isComplete) stageLabel = '已可导出';
  else if (pageReady > 0) stageLabel = `页面 ${pageReady}/${pageTotal || pageReady}`;
  else if (imageTotal > 0) stageLabel = `图片 ${imageReady}/${imageTotal}`;
  else if (state?.designSpec || (state?.outline?.length || 0) > 0) stageLabel = `大纲 ${state?.outline?.length || state?.designSpec?.outline?.length || 0} 页`;
  else if (hasInputContent(state, project)) stageLabel = '内容已就绪';

  const detailParts = [
    pageTotal ? `${pageReady}/${pageTotal} 页` : '',
    imageTotal ? `${imageReady}/${imageTotal} 图` : '',
  ].filter(Boolean);

  return {
    ...project,
    displayStatus,
    displayProgress: Math.max(0, Math.min(100, progress)),
    stageLabel,
    detailLabel: detailParts.length ? detailParts.join(' · ') : '尚未生成页面',
    previewSvg: previewPage?.svg || '',
    previewPageNumber: previewPage?.pageNumber || null,
    imageReady,
    imageTotal,
    pageReady,
    pageTotal,
  };
}

const projectDisplays = computed<ProjectDisplay[]>(() => uniqueProjects.value.map(deriveProjectDisplay));

const filteredProjects = computed(() => {
  if (!searchQuery.value) return projectDisplays.value;
  const query = searchQuery.value.toLowerCase();
  return projectDisplays.value.filter(p =>
    p.title.toLowerCase().includes(query) ||
    p.topic?.toLowerCase().includes(query)
  );
});

const stats = computed(() => ({
  total: projectDisplays.value.length,
  draft: projectDisplays.value.filter(p => p.displayStatus === 'draft').length,
  paused: projectDisplays.value.filter(p => p.displayStatus === 'paused').length,
  generating: projectDisplays.value.filter(p => p.displayStatus === 'generating').length,
  completed: projectDisplays.value.filter(p => p.displayStatus === 'completed').length
}));

const hasLiveProjects = computed(() => projectDisplays.value.some((project) => project.displayStatus === 'generating'));

async function fetchProjects(options: { silent?: boolean } = {}) {
  if (!options.silent) loading.value = true;
  try {
    const response = await projectApi.getAll();
    if (response.success && response.data) {
      loadError.value = '';
      projects.value = response.data.filter((project) => !deletedProjectIds.value.has(project.id));
    } else {
      loadError.value = translateErrorMessage(response.message, '加载项目失败，请稍后重试');
      toastStore.error('加载项目失败', loadError.value);
    }
  } catch (error) {
    loadError.value = translateErrorMessage(error, '加载项目失败，请稍后重试');
    toastStore.error('加载项目失败', loadError.value);
  } finally {
    if (!options.silent) loading.value = false;
  }
}

async function fetchTemplates() {
  const response = await templateApi.getAll();
  if (response.success && response.data) {
    templates.value = response.data;
  } else {
    toastStore.error('加载模板状态失败', response.message || '无法判断项目是否已保存为模板');
  }
}

async function createProject() {
  if (!newProjectTitle.value.trim()) {
    toastStore.warning('请输入项目名称', '项目名称不能为空');
    return;
  }
  const title = newProjectTitle.value.trim();
  if (isProjectTitleDuplicated(title)) {
    toastStore.error('项目名称重复', `「${title}」已存在，请换一个名称`);
    return;
  }

  loading.value = true;
  try {
    const response = await projectApi.create({
      title,
      status: 'draft'
    });

    if (response.success && response.data) {
      toastStore.success('创建成功', `「${title}」已创建`);
      showCreateModal.value = false;
      newProjectTitle.value = '';
      await fetchProjects();
    } else {
      toastStore.error('创建失败', response.message || '未知错误');
    }
  } catch (error) {
    toastStore.error('创建失败', error instanceof Error ? error.message : '未知错误');
  } finally {
    loading.value = false;
  }
}

async function deleteProject(project: Project) {
  projectToDelete.value = project;
  showDeleteModal.value = true;
}

async function confirmDelete() {
  if (!projectToDelete.value) return;

  loading.value = true;
  try {
    const response = await projectApi.delete(projectToDelete.value.id);
    if (response.success) {
      const deletedId = projectToDelete.value.id;
      deletedProjectIds.value = new Set([...deletedProjectIds.value, deletedId]);
      projects.value = projects.value.filter((project) => project.id !== deletedId);
      toastStore.success('删除成功', '项目已删除');
      showDeleteModal.value = false;
      projectToDelete.value = null;
      await fetchProjects();
    } else {
      toastStore.error('删除失败', response.message || '未知错误');
    }
  } catch (error) {
    toastStore.error('删除失败', error instanceof Error ? error.message : '未知错误');
  } finally {
    loading.value = false;
  }
}

function openProject(project: Project) {
  agentStore.selectPptProject(String(project.id));
  router.push(`/project/${project.id}/input`);
}

function openSavedTemplate(project: Project) {
  const template = getSavedTemplate(project);
  if (!template) return;

  toastStore.info('已定位模板广场', template.name);
  router.push({
    path: '/templates',
    query: { templateId: String(template.id) }
  });
}

async function saveProjectAsTemplate(project: Project) {
  if (savingTemplateIds.value.has(project.id)) return;
  const savedTemplate = getSavedTemplate(project);
  const saveState = getTemplateSaveState(project);
  if (savedTemplate && saveState === 'saved') {
    openSavedTemplate(project);
    return;
  }

  savingTemplateIds.value = new Set([...savingTemplateIds.value, project.id]);
  toastStore.info(saveState === 'stale' ? '正在更新模板' : '正在保存模板', `正在将「${project.title}」同步到模板广场`);
  try {
    const state = parseProjectState(project);
    const payload = buildTemplatePayloadFromProject(
      { ...project, state },
      {
        name: savedTemplate?.name || templateNameForProject(project),
        category: savedTemplate?.category || undefined,
        isPublic: savedTemplate ? Boolean(savedTemplate.is_public) : undefined
      }
    );
    const response = savedTemplate
      ? await templateApi.update(savedTemplate.id, payload)
      : await templateApi.create(payload);

    if (response.success && response.data) {
      templates.value = savedTemplate
        ? templates.value.map((template) => template.id === savedTemplate.id ? response.data! : template)
        : [response.data, ...templates.value];
      toastStore.success(savedTemplate ? '模板已更新' : '已添加到模板广场', payload.name);
      await fetchTemplates();
      await agentStore.fetchTemplates();
    } else {
      if (response.status === 409 || response.code === 'TEMPLATE_NAME_DUPLICATED') {
        await fetchTemplates();
        await agentStore.fetchTemplates();
        if (isTemplateSaved(project)) {
          toastStore.info('模板已存在', '已同步保存状态，可从模板广场查看');
        } else {
          toastStore.error('模板名称重复', response.message || '请换一个模板名称');
        }
      } else {
        toastStore.error('保存模板失败', response.message || '请稍后重试');
      }
    }
  } catch (error) {
    toastStore.error('保存模板失败', error instanceof Error ? error.message : '未知错误');
  } finally {
    const next = new Set(savingTemplateIds.value);
    next.delete(project.id);
    savingTemplateIds.value = next;
  }
}

function getStatusBadge(tone: ProjectDisplayStatus) {
  const map = {
    draft: { label: '草稿', tone: 'neutral' as const },
    paused: { label: '已暂停', tone: 'warning' as const },
    generating: { label: '生成中', tone: 'warning' as const },
    completed: { label: '已完成', tone: 'success' as const }
  };
  return map[tone];
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

onMounted(() => {
  void Promise.all([fetchProjects(), fetchTemplates()]);
  projectRefreshTimer = window.setInterval(() => {
    if (hasLiveProjects.value) {
      void fetchProjects({ silent: true });
    }
  }, 1500);
});

onBeforeUnmount(() => {
  if (projectRefreshTimer !== null) {
    window.clearInterval(projectRefreshTimer);
  }
});
</script>

<template>
  <div class="my-ppt-page">
    <div class="stats-grid">
      <div class="stat-card stat-card--total">
        <div class="stat-card__icon">
          <FileText :size="20" />
        </div>
        <div class="stat-card__content">
          <span class="stat-card__value">{{ stats.total }}</span>
          <span class="stat-card__label">全部项目</span>
        </div>
      </div>
      <div class="stat-card stat-card--draft">
        <div class="stat-card__icon">
          <Clock :size="20" />
        </div>
        <div class="stat-card__content">
          <span class="stat-card__value">{{ stats.draft }}</span>
          <span class="stat-card__label">草稿</span>
        </div>
      </div>
      <div class="stat-card stat-card--generating">
        <div class="stat-card__icon">
          <NexiousLoader size="sm" inverse />
        </div>
        <div class="stat-card__content">
          <span class="stat-card__value">{{ stats.generating }}</span>
          <span class="stat-card__label">生成中</span>
        </div>
      </div>
      <div class="stat-card stat-card--paused">
        <div class="stat-card__icon">
          <Pause :size="20" />
        </div>
        <div class="stat-card__content">
          <span class="stat-card__value">{{ stats.paused }}</span>
          <span class="stat-card__label">已暂停</span>
        </div>
      </div>
      <div class="stat-card stat-card--completed">
        <div class="stat-card__icon">
          <Check :size="20" />
        </div>
        <div class="stat-card__content">
          <span class="stat-card__value">{{ stats.completed }}</span>
          <span class="stat-card__label">已完成</span>
        </div>
      </div>
    </div>

    <div class="search-bar">
      <UiInput
        v-model="searchQuery"
        placeholder="搜索我的PPT项目..."
        :prefix-icon="Search"
      />
      <UiButton @click="showCreateModal = true">
        <Plus :size="14" />
        新建 PPT 项目
      </UiButton>
    </div>

    <PageLoadingState v-if="loading && projects.length === 0" title="正在加载项目" description="正在同步我的 PPT 列表" />

    <UiFeedbackState
      v-else-if="loadError && projects.length === 0"
      tone="error"
      title="项目列表加载失败"
      :description="loadError"
      action-label="重试"
      :loading="loading"
      @action="fetchProjects"
    />

    <div v-else-if="filteredProjects.length === 0 && !loading" class="empty-state">
      <UiEmpty
        :title="searchQuery ? '未找到匹配项目' : '还没有项目'"
        :description="searchQuery ? '尝试其他搜索词' : '创建您的第一个 PPT 项目'"
      >
        <div v-if="!searchQuery" class="empty-actions">
          <UiButton @click="showCreateModal = true">
            <Plus :size="14" />
            新建 PPT 项目
          </UiButton>
        </div>
      </UiEmpty>
    </div>

    <div v-else class="project-grid">
      <div
        v-for="project in filteredProjects"
        :key="project.id"
        class="project-card"
        :class="{ 'project-card--template-saved': isTemplateSaved(project) }"
        @click="openProject(project)"
      >
        <div class="project-card__header">
          <div class="project-card__icon">
            <FileText :size="20" />
          </div>
          <div class="project-card__actions">
            <button
              class="action-btn action-btn--template"
              :class="{
                'action-btn--template-saved': getTemplateSaveState(project) === 'saved',
                'action-btn--template-stale': getTemplateSaveState(project) === 'stale'
              }"
              :title="getTemplateActionTitle(project)"
              :disabled="savingTemplateIds.has(project.id)"
              @click.stop="saveProjectAsTemplate(project)"
            >
              <RefreshCw v-if="getTemplateSaveState(project) === 'stale'" :size="14" />
              <BookmarkCheck v-else-if="isTemplateSaved(project)" :size="14" />
              <FileText v-else :size="14" />
              <span>{{ savingTemplateIds.has(project.id) ? '保存中' : getTemplateActionLabel(project) }}</span>
            </button>
            <button class="action-btn action-btn--danger" title="删除" @click.stop="deleteProject(project)">
              <Trash2 :size="14" />
            </button>
          </div>
        </div>

        <div v-if="project.previewSvg" class="project-card__preview">
          <PrivateSvg v-if="project.previewSvg" class="project-card__preview-canvas" :svg="project.previewSvg" />
          <div v-else class="project-card__preview-empty">
            <FileText :size="18" />
            <span>暂无预览</span>
          </div>
          <span v-if="project.previewPageNumber" class="project-card__preview-page">P{{ project.previewPageNumber }}</span>
        </div>

        <div class="project-card__body">
          <h3 class="project-card__title">{{ project.title }}</h3>
          <p v-if="project.topic" class="project-card__topic">{{ project.topic }}</p>
          <div class="project-card__progress">
            <div class="project-card__progress-head">
              <span>{{ project.stageLabel }}</span>
              <strong>{{ project.displayProgress }}%</strong>
            </div>
            <div class="project-card__progress-track">
              <span :style="{ width: `${project.displayProgress}%` }" />
            </div>
            <p>{{ project.detailLabel }}</p>
          </div>
        </div>

        <div class="project-card__footer">
          <UiBadge
            :tone="getStatusBadge(project.displayStatus).tone"
            size="sm"
          >
            {{ getStatusBadge(project.displayStatus).label }}
          </UiBadge>
          <div class="project-card__date">
            <Calendar :size="12" />
            <span>{{ formatDate(project.updated_at) }}</span>
          </div>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
        <div class="modal">
          <div class="modal__header">
            <h3>新建 PPT 项目</h3>
            <button class="modal__close" @click="showCreateModal = false">×</button>
          </div>
          <div class="modal__body">
            <UiInput
              v-model="newProjectTitle"
              placeholder="输入项目名称"
              @keyup.enter="createProject"
            />
            <p v-if="isProjectTitleDuplicated(newProjectTitle)" class="field-hint field-hint--error">
              项目名称已存在，请换一个名称。
            </p>
          </div>
          <div class="modal__footer">
            <UiButton variant="secondary" @click="showCreateModal = false">取消</UiButton>
            <UiButton :disabled="loading || !newProjectTitle.trim()" @click="createProject">
              创建
            </UiButton>
          </div>
        </div>
      </div>

      <div v-if="showDeleteModal" class="modal-overlay" @click.self="showDeleteModal = false">
        <div class="modal">
          <div class="modal__header">
            <h3>确认删除</h3>
            <button class="modal__close" @click="showDeleteModal = false">×</button>
          </div>
          <div class="modal__body">
            <p>确定要删除项目「{{ projectToDelete?.title }}」吗？此操作不可撤销。</p>
          </div>
          <div class="modal__footer">
            <UiButton variant="secondary" @click="showDeleteModal = false">取消</UiButton>
            <UiButton variant="danger" :disabled="loading" @click="confirmDelete">
              删除
            </UiButton>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.my-ppt-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px;
  width: 100%;
  margin: 0 auto;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
  transition: all var(--transition-fast);
}

.stat-card:hover {
  border-color: var(--color-border-strong);
  box-shadow: var(--shadow-sm);
}

.stat-card__icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  flex-shrink: 0;
}

.stat-card--total .stat-card__icon {
  background: var(--color-info);
  color: var(--color-inverse);
}

.stat-card--draft .stat-card__icon {
  background: var(--color-muted);
  color: var(--color-inverse);
}

.stat-card--generating .stat-card__icon {
  background: var(--color-warning);
  color: var(--color-inverse);
}

.stat-card--paused .stat-card__icon {
  background: var(--color-danger);
  color: var(--color-inverse);
}

.stat-card--completed .stat-card__icon {
  background: var(--color-success);
  color: var(--color-inverse);
}

.stat-card__content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-card__value {
  font-size: 28px;
  font-weight: 700;
  color: var(--color-text);
  font-family: var(--font-mono);
  line-height: 1;
}

.stat-card__label {
  font-size: 13px;
  color: var(--color-muted);
}

.search-bar {
  display: grid;
  grid-template-columns: minmax(260px, 400px) max-content;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.search-bar :deep(.ui-button) {
  white-space: nowrap;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px;
  color: var(--color-muted);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px;
}

.empty-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.project-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
  padding: 14px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.project-card:hover {
  border-color: var(--color-accent);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}

.project-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 10px;
}

.project-card__icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.project-card__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.project-card:hover .project-card__actions,
.project-card__actions:focus-within,
.project-card--template-saved .project-card__actions {
  opacity: 1;
}

.project-card__preview {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 16 / 9;
  width: 100%;
  margin-bottom: 12px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
}

.project-card__preview--ready {
  background: var(--color-surface);
}

.project-card__preview-canvas {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.project-card__preview-canvas :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
}

.project-card__preview-empty {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-subtle);
  font-size: 12px;
}

.project-card__preview-page {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 3px 7px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-surface) 88%, transparent);
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 28px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-panel);
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.action-btn span {
  display: inline-block;
}

.action-btn:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.action-btn--template {
  color: var(--color-accent);
}

.action-btn--template-saved {
  border-color: var(--color-success);
  background: var(--color-success-soft);
  color: var(--color-success);
}

.action-btn--template-stale {
  border-color: var(--color-warning);
  background: var(--color-warning-soft);
  color: var(--color-warning);
}

.action-btn--template-saved:disabled {
  opacity: 0.95;
}

.action-btn--template:hover:not(:disabled) {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.action-btn--danger:hover {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.project-card__body {
  flex: 1;
  margin-bottom: 10px;
}

.project-card__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.4;
}

.project-card__topic {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--color-muted);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.project-card__progress {
  display: grid;
  gap: 6px;
  margin-top: 12px;
}

.project-card__progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--color-muted);
  font-size: 12px;
}

.project-card__progress-head strong {
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 12px;
}

.project-card__progress-track {
  width: 100%;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--color-panel);
}

.project-card__progress-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-accent);
  transition: width var(--transition-fast);
}

.project-card__progress p {
  margin: 0;
  color: var(--color-subtle);
  font-size: 11px;
}

.project-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
  border-top: 1px solid var(--color-border);
}

.project-card__date {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color-subtle);
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-overlay);
  backdrop-filter: blur(4px);
}

.modal {
  width: 100%;
  max-width: 400px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
}

.modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
}

.modal__header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
}

.modal__close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  font-size: 20px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.modal__close:hover {
  background: var(--color-panel);
  color: var(--color-text);
}

.modal__body {
  padding: 20px;
}

.modal__body p {
  margin: 0;
  font-size: 14px;
  color: var(--color-text);
  line-height: 1.6;
}

.field-hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
}

.field-hint--error {
  color: var(--color-danger);
}

.modal__footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 16px 20px;
  border-top: 1px solid var(--color-border);
}

@media (max-width: 920px) {
  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .my-ppt-page {
    gap: 12px;
    padding: 14px 12px 18px;
  }

  .page-header {
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .page-header__info h2 {
    font-size: 22px;
    line-height: 1.15;
  }

  .page-header__info p {
    margin-top: 4px;
    font-size: 13px;
  }

  .page-header :deep(.ui-button) {
    flex: 0 0 auto;
    min-height: 38px;
    padding-inline: 12px;
  }

  .stats-grid {
    display: flex;
    grid-template-columns: none;
    gap: 10px;
    margin: 0 -12px;
    padding: 0 12px 4px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    scroll-snap-type: x mandatory;
  }

  .stats-grid::-webkit-scrollbar {
    display: none;
  }

  .stat-card {
    flex: 0 0 148px;
    min-height: 72px;
    padding: 12px;
    gap: 10px;
    border-radius: 10px;
    scroll-snap-align: start;
  }

  .stat-card__icon {
    width: 38px;
    height: 38px;
    border-radius: 10px;
  }

  .stat-card__value {
    font-size: 22px;
  }

  .stat-card__label {
    font-size: 12px;
  }

  .project-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .search-bar {
    grid-template-columns: 1fr;
  }

  .search-bar :deep(.ui-button) {
    width: 100%;
    justify-content: center;
  }

  .loading-state,
  .empty-state {
    padding: 24px 12px;
  }

  .project-card {
    min-width: 0;
    padding: 12px;
    border-radius: 10px;
  }

  .project-card__header {
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .project-card__icon {
    width: 36px;
    height: 36px;
    border-radius: 9px;
  }

  .project-card__actions {
    flex: 1;
    justify-content: flex-end;
    gap: 6px;
    min-width: 0;
    opacity: 1;
  }

  .action-btn {
    width: 32px;
    height: 32px;
    min-width: 32px;
    padding: 0;
    border-radius: 8px;
  }

  .action-btn span {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .project-card__preview {
    margin-bottom: 10px;
    border-radius: 7px;
  }

  .project-card__body {
    margin-bottom: 8px;
  }

  .project-card__title {
    font-size: 15px;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .project-card__topic {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.45;
    -webkit-line-clamp: 2;
  }

  .project-card__progress {
    gap: 5px;
    margin-top: 10px;
  }

  .project-card__footer {
    gap: 10px;
    padding-top: 8px;
    min-width: 0;
  }

  .project-card__date {
    min-width: 0;
    font-size: 11px;
  }

  .modal-overlay {
    align-items: stretch;
    padding: 12px;
  }

  .modal {
    max-width: none;
    max-height: calc(100dvh - 24px);
    overflow: auto;
  }

  .modal__footer {
    flex-direction: column-reverse;
  }
}

@media (max-width: 380px) {
  .stat-card {
    flex-basis: 132px;
  }

  .page-header__info h2 {
    font-size: 20px;
  }

  .page-header :deep(.ui-button) {
    min-height: 36px;
    padding-inline: 10px;
    font-size: 12px;
  }
}
</style>
