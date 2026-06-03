<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Plus, Search, Trash2, FileText, Clock, Calendar, Check } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiEmpty from '@/components/ui/UiEmpty.vue';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import { projectApi, templateApi, type Project } from '@/services/api';
import { slideNeedsImage } from '@/utils/slideVisuals';
import type { PptProjectState, WorkflowStep } from '@/types/agent';
import { buildTemplatePayloadFromProject } from '@/utils/templateFromProject';

const router = useRouter();
const agentStore = useAgentStore();
const toastStore = useToastStore();

const projects = ref<Project[]>([]);
const loading = ref(false);
const searchQuery = ref('');
const showDeleteModal = ref(false);
const projectToDelete = ref<Project | null>(null);
const showCreateModal = ref(false);
const newProjectTitle = ref('');
const savingTemplateIds = ref<Set<number>>(new Set());

type ProjectDisplayStatus = 'draft' | 'generating' | 'completed';
type ProjectDisplay = Project & {
  displayStatus: ProjectDisplayStatus;
  displayProgress: number;
  stageLabel: string;
  detailLabel: string;
  imageReady: number;
  imageTotal: number;
  pageReady: number;
  pageTotal: number;
};

function normalizeProjectText(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
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

function deriveProjectDisplay(project: Project): ProjectDisplay {
  const state = parseProjectState(project);
  const slides = getSlidesForProgress(state);
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
  const hasRunningStep = Boolean(state?.workflowActive || state?.steps?.some((step) => step.status === 'running'));
  const isComplete = previewProgress === 100 || (pageTotal > 0 && pageReady >= pageTotal && layoutProgress === 100);

  let displayStatus: ProjectDisplayStatus = project.status;
  if (hasRunningStep) {
    displayStatus = 'generating';
  } else if (isComplete) {
    displayStatus = 'completed';
  } else if (progress > 0 && project.status !== 'completed') {
    displayStatus = progress >= 100 ? 'completed' : 'draft';
  }

  let stageLabel = '等待输入';
  if (isComplete) stageLabel = '已可导出';
  else if (pageReady > 0) stageLabel = `页面 ${pageReady}/${pageTotal || pageReady}`;
  else if (imageTotal > 0) stageLabel = `图片 ${imageReady}/${imageTotal}`;
  else if (state?.designSpec || (state?.outline?.length || 0) > 0) stageLabel = `大纲 ${state?.outline?.length || state?.designSpec?.outline?.length || 0} 页`;
  else if (hasInputContent(state, project)) stageLabel = '资料已就绪';

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
  generating: projectDisplays.value.filter(p => p.displayStatus === 'generating').length,
  completed: projectDisplays.value.filter(p => p.displayStatus === 'completed').length
}));

async function fetchProjects() {
  loading.value = true;
  try {
    const response = await projectApi.getAll();
    if (response.success && response.data) {
      projects.value = response.data;
    }
  } catch (error) {
    console.error('Failed to fetch projects:', error);
  } finally {
    loading.value = false;
  }
}

async function createProject() {
  if (!newProjectTitle.value.trim()) {
    toastStore.warning('请输入项目名称', '项目名称不能为空');
    return;
  }

  loading.value = true;
  try {
    const response = await projectApi.create({
      title: newProjectTitle.value.trim(),
      status: 'draft'
    });

    if (response.success && response.data) {
      toastStore.success('创建成功', '新项目已创建');
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

async function saveProjectAsTemplate(project: Project) {
  if (savingTemplateIds.value.has(project.id)) return;

  savingTemplateIds.value = new Set([...savingTemplateIds.value, project.id]);
  try {
    const state = parseProjectState(project);
    const payload = buildTemplatePayloadFromProject(
      { ...project, state },
      { name: `${project.title || project.topic || '未命名 PPT'} 模板` }
    );
    const response = await templateApi.create(payload);

    if (response.success) {
      toastStore.success('已添加到模板广场', payload.name);
      await agentStore.fetchTemplates();
    } else {
      toastStore.error('保存模板失败', response.message || '请稍后重试');
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
  fetchProjects();
});
</script>

<template>
  <div class="my-ppt-page">
    <div class="page-header">
      <div class="page-header__info">
        <h2>我的 PPT</h2>
        <p>管理您的所有 PPT 项目</p>
      </div>
      <UiButton @click="showCreateModal = true">
        <Plus :size="14" />
        新建项目
      </UiButton>
    </div>

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
          <div class="spinner"></div>
        </div>
        <div class="stat-card__content">
          <span class="stat-card__value">{{ stats.generating }}</span>
          <span class="stat-card__label">生成中</span>
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
        placeholder="搜索项目..."
        :prefix-icon="Search"
      />
    </div>

    <div v-if="loading && projects.length === 0" class="loading-state">
      加载中...
    </div>

    <div v-else-if="filteredProjects.length === 0 && !loading" class="empty-state">
      <UiEmpty
        :title="searchQuery ? '未找到匹配项目' : '还没有项目'"
        :description="searchQuery ? '尝试其他搜索词' : '创建您的第一个 PPT 项目'"
      >
        <div v-if="!searchQuery" class="empty-actions">
          <UiButton @click="showCreateModal = true">
            <Plus :size="14" />
            新建项目
          </UiButton>
        </div>
      </UiEmpty>
    </div>

    <div v-else class="project-grid">
      <div
        v-for="project in filteredProjects"
        :key="project.id"
        class="project-card"
        @click="openProject(project)"
      >
        <div class="project-card__header">
          <div class="project-card__icon">
            <FileText :size="20" />
          </div>
          <div class="project-card__actions">
            <button
              class="action-btn action-btn--template"
              title="保存为模板"
              :disabled="savingTemplateIds.has(project.id)"
              @click.stop="saveProjectAsTemplate(project)"
            >
              <FileText :size="14" />
            </button>
            <button class="action-btn action-btn--danger" title="删除" @click.stop="deleteProject(project)">
              <Trash2 :size="14" />
            </button>
          </div>
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

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.page-header__info h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text);
}

.page-header__info p {
  margin: 4px 0 0;
  font-size: 14px;
  color: var(--color-subtle);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
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
  background: #2563eb;
  color: white;
}

.stat-card--draft .stat-card__icon {
  background: #64748b;
  color: white;
}

.stat-card--generating .stat-card__icon {
  background: #d97706;
  color: white;
}

.stat-card--completed .stat-card__icon {
  background: #059669;
  color: white;
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

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.search-bar {
  max-width: 400px;
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
  gap: 16px;
}

.project-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
  padding: 16px;
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
  margin-bottom: 12px;
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
  gap: 4px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.project-card:hover .project-card__actions {
  opacity: 1;
}

.action-btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-panel);
  color: var(--color-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
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
  margin-bottom: 12px;
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
  gap: 7px;
  margin-top: 14px;
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
  padding-top: 12px;
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
  background: rgba(0, 0, 0, 0.5);
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

.modal__footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 16px 20px;
  border-top: 1px solid var(--color-border);
}
</style>
