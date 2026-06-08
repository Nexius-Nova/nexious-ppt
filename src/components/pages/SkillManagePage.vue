<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { CheckCircle2, Eye, FileArchive, FileText, FolderTree, Loader2, RotateCw, Sparkles, Trash2, UploadCloud, XCircle, Zap } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiEmpty from '@/components/ui/UiEmpty.vue';
import UiFeedbackState from '@/components/ui/UiFeedbackState.vue';
import UiSelect from '@/components/ui/UiSelect.vue';
import DeleteConfirmModal from '@/components/common/DeleteConfirmModal.vue';
import PageLoadingState from '@/components/common/PageLoadingState.vue';
import { useToastStore } from '@/stores/toastStore';
import { skillApi, type Skill, type SkillPackagePreview, type SkillPackagePreviewFile, type SkillPackageView } from '@/services/api';
import { INPUT_SKILL_CATEGORIES, normalizeInputSkillCategory } from '@/constants/inputSkillCategories';
import { translateErrorMessage } from '@/utils/errorMessages';

const toastStore = useToastStore();
const emit = defineEmits<{
  changed: [];
}>();

const skills = ref<Skill[]>([]);
const loading = ref(false);
const loadError = ref('');
const uploading = ref(false);
const deleting = ref(false);
const testingSkillIds = ref<Set<number>>(new Set());
const showPackagePreview = ref(false);
const deleteTarget = ref<Skill | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const packageFileName = ref('');
const pendingPackage = ref<{ filename: string; dataBase64: string } | null>(null);
const packagePreview = ref<SkillPackagePreview | null>(null);
const showPackageView = ref(false);
const packageView = ref<SkillPackageView | null>(null);
const packageViewSkill = ref<Skill | null>(null);
const packageViewLoadingId = ref<number | null>(null);
const packageCategory = ref('资料收集');

const readyCount = computed(() =>
  skills.value.filter((skill) => ['ready', 'not_required'].includes(skill.install_status || 'not_required')).length
);
const passedCount = computed(() =>
  skills.value.filter((skill) => skill.test_status === 'passed').length
);
let statusPollTimer: ReturnType<typeof setInterval> | null = null;
const categoryOptions = computed(() =>
  INPUT_SKILL_CATEGORIES.map((category) => ({
    label: category,
    value: category,
    description: categoryDescription(category)
  }))
);

async function fetchSkills() {
  loading.value = true;
  try {
    const response = await skillApi.getAll();
    if (response.success && response.data) {
      loadError.value = '';
      skills.value = response.data.map((skill) => ({
        ...skill,
        category: normalizeInputSkillCategory(skill.category)
      }));
      const activeTestingIds = new Set(
        skills.value
          .filter((skill) => skill.test_status === 'testing' || ['pending', 'installing'].includes(skill.install_status || ''))
          .map((skill) => skill.id)
      );
      testingSkillIds.value = new Set([...testingSkillIds.value].filter((id) => activeTestingIds.has(id)));
      emit('changed');
    } else {
      loadError.value = translateErrorMessage(response.message, '获取 Skill 列表失败');
      toastStore.error('加载失败', loadError.value);
    }
  } catch (error) {
    loadError.value = translateErrorMessage(error, '获取 Skill 列表失败');
    toastStore.error('加载失败', loadError.value);
  } finally {
    loading.value = false;
  }
}

function needsStatusPolling() {
  return skills.value.some((skill) =>
    ['pending', 'installing'].includes(skill.install_status || '') ||
    skill.test_status === 'testing' ||
    testingSkillIds.value.has(skill.id)
  );
}

function startStatusPolling() {
  if (statusPollTimer) return;
  statusPollTimer = setInterval(async () => {
    await fetchSkills();
    if (!needsStatusPolling()) stopStatusPolling();
  }, 2500);
}

function stopStatusPolling() {
  if (!statusPollTimer) return;
  clearInterval(statusPollTimer);
  statusPollTimer = null;
}

function markSkillTesting(id: number) {
  testingSkillIds.value = new Set([...testingSkillIds.value, id]);
  startStatusPolling();
}

function clearSkillTesting(id: number) {
  const next = new Set(testingSkillIds.value);
  next.delete(id);
  testingSkillIds.value = next;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function closePackagePreview() {
  if (uploading.value) return;
  showPackagePreview.value = false;
  packagePreview.value = null;
  pendingPackage.value = null;
  packageCategory.value = '资料收集';
  packageFileName.value = '';
}

function triggerPackageUpload() {
  fileInputRef.value?.click();
}

async function handlePackageSelect(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = '';
  if (!file) return;

  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith('.zip') && !lowerName.endsWith('.skill') && !lowerName.endsWith('.md')) {
    toastStore.warning('格式不支持', '请上传 .zip、.skill 或 .md 文件');
    return;
  }

  uploading.value = true;
  packageFileName.value = file.name;
  try {
    const dataBase64 = await fileToBase64(file);
    const response = await skillApi.previewPackage({ filename: file.name, dataBase64 });
    if (!response.success) {
      throw new Error(response.message || '解析 Skill 包失败');
    }
    if (!response.data) throw new Error('Skill 包解析结果为空');
    pendingPackage.value = { filename: file.name, dataBase64 };
    packagePreview.value = {
      ...response.data,
      category: normalizeInputSkillCategory(response.data.category)
    };
    packageCategory.value = packagePreview.value.category;
    showPackagePreview.value = true;
  } catch (error) {
    toastStore.error('解析失败', error instanceof Error ? error.message : '解析 Skill 包失败');
    pendingPackage.value = null;
    packagePreview.value = null;
    packageFileName.value = '';
  } finally {
    uploading.value = false;
  }
}

async function confirmPackageUpload() {
  if (!pendingPackage.value) return;
  uploading.value = true;
  try {
    const response = await skillApi.uploadPackage({
      ...pendingPackage.value,
      category: normalizeInputSkillCategory(packageCategory.value)
    });
    if (!response.success) {
      throw new Error(response.message || '上传 Skill 包失败');
    }
    toastStore.success('添加成功', '已保存完整 Skill 包，后端会自动适配、初始化依赖并测试可用性');
    showPackagePreview.value = false;
    packagePreview.value = null;
    pendingPackage.value = null;
    packageCategory.value = '资料收集';
    packageFileName.value = '';
    await fetchSkills();
    if (response.data?.id) markSkillTesting(response.data.id);
    emit('changed');
  } catch (error) {
    toastStore.error('上传失败', error instanceof Error ? error.message : '上传 Skill 包失败');
  } finally {
    uploading.value = false;
  }
}

function canViewSkillPackage(skill: Skill) {
  return Boolean(skill.package_path || skill.type === 'package');
}

function closePackageView() {
  if (packageViewLoadingId.value) return;
  showPackageView.value = false;
  packageView.value = null;
  packageViewSkill.value = null;
}

async function viewSkillPackage(skill: Skill) {
  if (!canViewSkillPackage(skill)) return;
  packageViewSkill.value = skill;
  showPackageView.value = true;
  packageViewLoadingId.value = skill.id;
  packageView.value = null;
  try {
    const response = await skillApi.getPackageView(skill.id);
    if (!response.success || !response.data) {
      throw new Error(response.message || '加载 Skill 包失败');
    }
    packageView.value = response.data;
  } catch (error) {
    toastStore.error('加载失败', error instanceof Error ? error.message : '加载 Skill 包失败');
    showPackageView.value = false;
    packageView.value = null;
    packageViewSkill.value = null;
  } finally {
    packageViewLoadingId.value = null;
  }
}

async function reinstallSkill(skill: Skill) {
  const response = await skillApi.reinstall(skill.id);
  if (response.success) {
    toastStore.info('正在初始化和测试', '后端正在自动初始化依赖并用示例输入测试 Skill');
    markSkillTesting(skill.id);
    await fetchSkills();
    emit('changed');
  } else {
    toastStore.error('操作失败', response.message || '重新初始化失败');
  }
}

async function testSkill(skill: Skill) {
  const response = await skillApi.test(skill.id);
  if (response.success) {
    toastStore.info('正在测试 Skill', '系统会使用示例输入验证该 Skill 是否可用');
    markSkillTesting(skill.id);
    await fetchSkills();
    emit('changed');
  } else {
    toastStore.error('测试启动失败', response.message || '请稍后重试');
  }
}

function requestDelete(skill: Skill) {
  deleteTarget.value = skill;
}

async function confirmDelete() {
  if (!deleteTarget.value) return;
  deleting.value = true;
  try {
    const response = await skillApi.delete(deleteTarget.value.id);
    if (!response.success) throw new Error(response.message || '删除 Skill 失败');
    toastStore.success('删除成功', 'Skill 已删除');
    deleteTarget.value = null;
    await fetchSkills();
    emit('changed');
  } catch (error) {
    toastStore.error('删除失败', error instanceof Error ? error.message : '删除 Skill 失败');
  } finally {
    deleting.value = false;
  }
}

function runtimeLabel(skill: Skill) {
  if (skill.runtime === 'python') return 'Python';
  if (skill.runtime === 'node') return 'Node.js';
  return '提示词';
}

function statusLabel(status?: string) {
  if (status === 'ready') return '可用';
  if (status === 'installing' || status === 'pending') return '初始化中';
  if (status === 'failed') return '初始化失败';
  return '无需依赖';
}

function statusTone(status?: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'ready' || status === 'not_required') return 'success';
  if (status === 'installing' || status === 'pending') return 'warning';
  if (status === 'failed') return 'danger';
  return 'neutral';
}

function statusIcon(status?: string) {
  if (status === 'installing' || status === 'pending') return Loader2;
  if (status === 'failed') return XCircle;
  return CheckCircle2;
}

function testStatusLabel(status?: string) {
  if (status === 'testing') return '测试中';
  if (status === 'passed') return '测试通过';
  if (status === 'failed') return '测试失败';
  if (status === 'skipped') return '跳过测试';
  return '未测试';
}

function testStatusTone(status?: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'passed') return 'success';
  if (status === 'testing') return 'warning';
  if (status === 'failed') return 'danger';
  if (status === 'skipped') return 'info';
  return 'neutral';
}

function testStatusIcon(status?: string) {
  if (status === 'testing') return Loader2;
  if (status === 'failed') return XCircle;
  return CheckCircle2;
}

function skillProgress(skill: Skill) {
  if (skill.test_status === 'passed') return 100;
  if (skill.test_status === 'failed') return 100;
  if (skill.test_status === 'testing') return 75;
  if (skill.install_status === 'ready' || skill.install_status === 'not_required') return 45;
  if (skill.install_status === 'installing') return 30;
  if (skill.install_status === 'pending') return 15;
  if (skill.install_status === 'failed') return 100;
  return 8;
}

function skillFlowSteps(skill: Skill) {
  const installLog = skill.install_log || '';
  const packageSkill = Boolean(skill.package_path || skill.type === 'package');
  const needsRuntime = packageSkill || skill.runtime !== 'prompt-only';
  const adapting = ['pending', 'installing'].includes(skill.install_status || '') && /自动适配|等待自动适配/.test(installLog);
  const adaptationDone = /自动适配完成|已生成执行入口|未发现需要生成的新执行入口|无需依赖初始化/.test(installLog) || (!needsRuntime && skill.install_status === 'not_required');
  const installFailed = skill.install_status === 'failed';
  return [
    {
      label: '解析包',
      done: Boolean(skill.package_path || skill.type === 'prompt-only'),
      active: skill.install_status === 'pending',
      failed: false,
    },
    {
      label: '智能适配',
      done: adaptationDone || skill.install_status === 'ready',
      active: adapting,
      failed: installFailed && !adaptationDone,
    },
    {
      label: '初始化依赖',
      done: ['ready', 'not_required'].includes(skill.install_status || ''),
      active: ['pending', 'installing'].includes(skill.install_status || ''),
      failed: installFailed,
    },
    {
      label: '健康测试',
      done: skill.test_status === 'passed',
      active: skill.test_status === 'testing',
      failed: skill.test_status === 'failed',
    },
  ];
}

function previewDependencyLabel(preview: SkillPackagePreview) {
  if (preview.dependencyFile) return preview.dependencyFile;
  if (preview.inferredDependencies?.length) return `自动识别：${preview.inferredDependencies.join('、')}`;
  return '无';
}

function categoryDescription(category: string) {
  if (category === '资料收集') return '包含 Web 搜索、资料补全、信息抓取等能力';
  if (category === '文件解析') return '解析上传文件并提取可用文本或结构';
  if (category === '主题提炼') return '从资料中识别主题、受众和表达目标';
  return '整理提示词、模板和生成配置约束';
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function runtimePreviewLabel(runtime?: string) {
  if (runtime === 'python') return 'Python';
  if (runtime === 'node') return 'Node.js';
  return '提示词';
}

function fileRoleLabel(role: SkillPackagePreviewFile['role']) {
  if (role === 'skill-md') return '说明';
  if (role === 'manifest') return '清单';
  if (role === 'dependency') return '依赖';
  if (role === 'entry') return '入口';
  if (role === 'source') return '源码';
  return '资源';
}

function fileRoleTone(role: SkillPackagePreviewFile['role']): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (role === 'skill-md') return 'success';
  if (role === 'dependency' || role === 'entry') return 'info';
  if (role === 'manifest') return 'warning';
  return 'neutral';
}

onMounted(async () => {
  await fetchSkills();
  if (needsStatusPolling()) startStatusPolling();
});

onBeforeUnmount(stopStatusPolling);
</script>

<template>
  <div class="skill-page">
    <header class="page-header">
      <div class="page-header__info">
        <h2>Skill 管理</h2>
        <p>导入可执行 Skill 包，系统会自动适配输入阶段、初始化依赖并完成可用性测试。</p>
      </div>
      <div class="page-header__actions">
        <UiBadge tone="info">共 {{ skills.length }} 个</UiBadge>
        <UiBadge tone="success">可用 {{ readyCount }} 个</UiBadge>
        <UiBadge tone="success">测试通过 {{ passedCount }} 个</UiBadge>
        <UiButton variant="primary" :loading="uploading" @click="triggerPackageUpload">
          <UploadCloud :size="15" />
          上传 Skill 包
        </UiButton>
        <input
          ref="fileInputRef"
          type="file"
          accept=".zip,.skill,.md"
          class="hidden-input"
          @change="handlePackageSelect"
        />
      </div>
    </header>

    <section class="upload-guide">
      <div class="upload-guide__icon">
        <FileArchive :size="22" />
      </div>
      <div>
        <strong>{{ uploading ? `正在上传 ${packageFileName}` : 'Skill 包导入规范' }}</strong>
        <p>上传 .zip、.skill 或单个 SKILL.md。包内必须包含 SKILL.md；入口脚本和依赖文件可选，系统会在确认后自动适配、安装依赖并测试。</p>
      </div>
    </section>

    <PageLoadingState v-if="loading && skills.length === 0" title="正在加载 Skill" description="正在读取 Skill 包和依赖状态" />

    <UiFeedbackState
      v-else-if="loadError && skills.length === 0"
      tone="error"
      title="Skill 列表加载失败"
      :description="loadError"
      action-label="重试"
      :loading="loading"
      @action="fetchSkills"
    />

    <UiEmpty
      v-else-if="skills.length === 0"
      title="还没有 Skill"
      description="上传一个 Skill 包后，输入阶段会按用户资料和文件自动选择可用 Skill。"
    />

    <div v-else class="skill-list">
      <article v-for="skill in skills" :key="skill.id" class="skill-card">
        <div class="skill-card__main">
          <div class="skill-card__icon">
            <Zap :size="18" />
          </div>
          <div class="skill-card__content">
            <div class="skill-card__title">
              <h3>{{ skill.name }}</h3>
              <UiBadge :tone="statusTone(skill.install_status)" size="sm">
                <component
                  :is="statusIcon(skill.install_status)"
                  :size="12"
                  :class="{ spin: skill.install_status === 'installing' || skill.install_status === 'pending' }"
                />
                {{ statusLabel(skill.install_status) }}
              </UiBadge>
              <UiBadge :tone="testStatusTone(skill.test_status)" size="sm">
                <component
                  :is="testStatusIcon(skill.test_status)"
                  :size="12"
                  :class="{ spin: skill.test_status === 'testing' }"
                />
                {{ testStatusLabel(skill.test_status) }}
              </UiBadge>
            </div>
            <p>{{ skill.description || '暂无说明' }}</p>
            <div class="skill-test-progress" :class="{ 'skill-test-progress--failed': skill.test_status === 'failed', 'skill-test-progress--passed': skill.test_status === 'passed' }">
              <span :style="{ width: `${skillProgress(skill)}%` }" />
            </div>
            <ol class="skill-flow">
              <li
                v-for="item in skillFlowSteps(skill)"
                :key="item.label"
                :class="{
                  'skill-flow__item--done': item.done,
                  'skill-flow__item--active': item.active,
                  'skill-flow__item--failed': item.failed
                }"
              >
                <span />
                <strong>{{ item.label }}</strong>
              </li>
            </ol>
            <dl class="skill-meta">
              <div>
                <dt>运行时</dt>
                <dd>{{ runtimeLabel(skill) }}</dd>
              </div>
              <div>
                <dt>分类</dt>
                <dd>{{ skill.category || '未分类' }}</dd>
              </div>
              <div>
                <dt>入口</dt>
                <dd>{{ skill.entry || '仅提示词' }}</dd>
              </div>
              <div>
                <dt>依赖</dt>
                <dd>{{ skill.dependency_file || '无' }}</dd>
              </div>
            </dl>
            <details v-if="skill.install_log" class="skill-log">
              <summary>查看初始化日志</summary>
              <pre>{{ skill.install_log }}</pre>
            </details>
            <details v-if="skill.test_log" class="skill-log">
              <summary>查看测试日志</summary>
              <pre>{{ skill.test_log }}</pre>
            </details>
          </div>
        </div>
        <div class="skill-card__actions">
          <UiButton v-if="canViewSkillPackage(skill)" size="sm" variant="secondary" :loading="packageViewLoadingId === skill.id" @click="viewSkillPackage(skill)">
            <Eye :size="13" />
            查看包
          </UiButton>
          <UiButton v-if="skill.runtime !== 'prompt-only'" size="sm" variant="secondary" @click="reinstallSkill(skill)">
            <RotateCw :size="13" />
            重试初始化并测试
          </UiButton>
          <UiButton size="sm" variant="secondary" :loading="skill.test_status === 'testing' || testingSkillIds.has(skill.id)" @click="testSkill(skill)">
            <CheckCircle2 :size="13" />
            测试
          </UiButton>
          <UiButton size="sm" variant="danger" @click="requestDelete(skill)">
            <Trash2 :size="13" />
            删除
          </UiButton>
        </div>
      </article>
    </div>

    <Teleport to="body">
      <div v-if="showPackagePreview && packagePreview" class="modal-overlay" @click.self="closePackagePreview">
        <div class="modal package-preview-modal">
          <header class="modal__header">
            <div>
              <h3>确认添加 Skill 包</h3>
              <span>{{ packageFileName }}</span>
            </div>
            <button type="button" class="modal__close" :disabled="uploading" @click="closePackagePreview">×</button>
          </header>

          <div class="modal__body package-preview">
            <section class="package-summary">
              <div>
                <span>Skill 名称</span>
                <strong>{{ packagePreview.name }}</strong>
              </div>
              <div>
                <span>运行时</span>
                <strong>{{ runtimePreviewLabel(packagePreview.runtime) }}</strong>
              </div>
              <div>
                <span>分类</span>
                <UiSelect
                  v-model="packageCategory"
                  :options="categoryOptions"
                  placeholder="选择 Skill 分类"
                />
              </div>
              <div>
                <span>文件</span>
                <strong>{{ packagePreview.fileCount }} 个 · {{ formatFileSize(packagePreview.totalSize) }}</strong>
              </div>
            </section>

            <section class="package-detected">
              <div>
                <span>说明文件</span>
                <strong>{{ packagePreview.skillMdPath }}</strong>
              </div>
              <div>
                <span>入口脚本</span>
                <strong>{{ packagePreview.entry || '无，仅作为提示词 Skill' }}</strong>
              </div>
              <div>
                <span>依赖文件</span>
                <strong>{{ previewDependencyLabel(packagePreview) }}</strong>
              </div>
              <div>
                <span>清单文件</span>
                <strong>{{ packagePreview.skillJsonPath || '无' }}</strong>
              </div>
            </section>

            <section v-if="packagePreview.description || packagePreview.instructionPreview" class="package-copy">
              <strong>{{ packagePreview.description || '已读取 SKILL.md 内容' }}</strong>
              <p>{{ packagePreview.instructionPreview || '暂无说明内容' }}</p>
            </section>

            <section class="package-adapt-hint">
              <Loader2 v-if="uploading" :size="14" class="spin" />
              <Sparkles v-else :size="14" />
              <div>
                <strong>确认后会先智能适配</strong>
                <p>系统会保留 SKILL.md 核心说明，必要时补充执行入口、识别依赖，并在测试失败后自动修复一次再重试。</p>
                <ul v-if="packagePreview.adaptationPlan?.length">
                  <li v-for="item in packagePreview.adaptationPlan" :key="item">{{ item }}</li>
                </ul>
              </div>
            </section>

            <section class="package-tree" aria-label="Skill 包目录结构">
              <header>
                <strong>目录结构</strong>
                <span>确认这些文件会一起保存到 Skill 包目录</span>
              </header>
              <div class="package-tree__list">
                <div v-for="file in packagePreview.files" :key="file.path" class="package-tree__file">
                  <code>{{ file.path }}</code>
                  <span>{{ formatFileSize(file.size) }}</span>
                  <UiBadge :tone="fileRoleTone(file.role)" size="sm">{{ fileRoleLabel(file.role) }}</UiBadge>
                </div>
              </div>
            </section>
          </div>

          <footer class="modal__footer">
            <UiButton variant="secondary" :disabled="uploading" @click="closePackagePreview">取消</UiButton>
            <UiButton variant="primary" :loading="uploading" @click="confirmPackageUpload">确认添加</UiButton>
          </footer>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showPackageView" class="modal-overlay" @click.self="closePackageView">
        <div class="modal package-view-modal">
          <header class="modal__header">
            <div>
              <h3>查看 Skill 包</h3>
              <span>{{ packageViewSkill?.name || 'Skill 包' }}</span>
            </div>
            <button type="button" class="modal__close" :disabled="Boolean(packageViewLoadingId)" @click="closePackageView">×</button>
          </header>

          <div class="modal__body package-view">
            <div v-if="packageViewLoadingId" class="package-view__loading">
              <Loader2 :size="18" class="spin" />
              <span>正在读取 Skill 包</span>
            </div>
            <template v-else-if="packageView">
              <section class="package-view__summary">
                <div>
                  <span>说明文件</span>
                  <strong>{{ packageView.skillMdPath }}</strong>
                </div>
                <div>
                  <span>运行时</span>
                  <strong>{{ runtimePreviewLabel(packageView.runtime) }}</strong>
                </div>
                <div>
                  <span>入口</span>
                  <strong>{{ packageView.entry || '仅提示词' }}</strong>
                </div>
                <div>
                  <span>文件</span>
                  <strong>{{ packageView.fileCount }} 个 · {{ formatFileSize(packageView.totalSize) }}</strong>
                </div>
              </section>

              <section class="package-view__grid">
                <article class="package-view__panel package-view__panel--content">
                  <header>
                    <FileText :size="15" />
                    <strong>SKILL.md</strong>
                    <UiBadge v-if="packageView.skillMdTruncated" tone="warning" size="sm">已截断</UiBadge>
                  </header>
                  <pre>{{ packageView.skillMdContent || 'SKILL.md 为空' }}</pre>
                </article>

                <article class="package-view__panel package-view__panel--tree">
                  <header>
                    <FolderTree :size="15" />
                    <strong>包内文件结构</strong>
                  </header>
                  <div class="package-tree__list">
                    <div v-for="file in packageView.files" :key="file.path" class="package-tree__file">
                      <code>{{ file.path }}</code>
                      <span>{{ formatFileSize(file.size) }}</span>
                      <UiBadge :tone="fileRoleTone(file.role)" size="sm">{{ fileRoleLabel(file.role) }}</UiBadge>
                    </div>
                  </div>
                </article>
              </section>
            </template>
          </div>

          <footer class="modal__footer">
            <UiButton variant="secondary" :disabled="Boolean(packageViewLoadingId)" @click="closePackageView">关闭</UiButton>
          </footer>
        </div>
      </div>
    </Teleport>

    <DeleteConfirmModal
      :open="Boolean(deleteTarget)"
      title="确认删除 Skill"
      :item-name="deleteTarget?.name || ''"
      :message="`确定要删除「${deleteTarget?.name || ''}」吗？对应 Skill 包和运行记录会一并删除。`"
      :loading="deleting"
      @close="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
.skill-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
  width: 100%;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.page-header__info {
  display: grid;
  gap: 5px;
  min-width: min(100%, 360px);
}

.page-header__info h2 {
  margin: 0;
  color: var(--color-text);
  font-size: 24px;
  font-weight: 800;
}

.page-header__info p,
.upload-guide p {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.6;
}

.page-header__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.hidden-input {
  display: none;
}

.upload-guide {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 14px;
  background: var(--color-panel);
}

.upload-guide__icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-accent);
  background: var(--color-surface);
}

.upload-guide strong {
  display: block;
  margin-bottom: 3px;
  color: var(--color-text);
  font-size: 14px;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 54px;
  color: var(--color-muted);
}

.skill-list {
  display: grid;
  gap: 12px;
}

.skill-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  align-items: start;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 14px;
  background: var(--color-surface);
}

.skill-card__main {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 12px;
  min-width: 0;
}

.skill-card__icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.skill-card__content {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.skill-card__title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.skill-card__title h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 15px;
  font-weight: 800;
}

.skill-card__content p {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.55;
}

.skill-test-progress {
  position: relative;
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--color-border);
}

.skill-test-progress span {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: var(--color-warning);
  transition: width var(--transition-normal);
}

.skill-test-progress--passed span {
  background: var(--color-success);
}

.skill-test-progress--failed span {
  background: var(--color-danger);
}

.skill-flow {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.skill-flow__item {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-muted);
  background: var(--color-panel);
  font-size: 11px;
  font-weight: 700;
}

.skill-flow__item span {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--color-border-strong);
}

.skill-flow__item strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-flow__item--done {
  border-color: color-mix(in srgb, var(--color-success) 42%, var(--color-border));
  color: var(--color-success);
  background: var(--color-success-soft);
}

.skill-flow__item--done span {
  background: var(--color-success);
}

.skill-flow__item--active {
  border-color: color-mix(in srgb, var(--color-accent) 42%, var(--color-border));
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.skill-flow__item--active span {
  background: var(--color-accent);
  animation: pulse-dot 1s ease-in-out infinite;
}

.skill-flow__item--failed {
  border-color: color-mix(in srgb, var(--color-danger) 42%, var(--color-border));
  color: var(--color-danger);
  background: var(--color-danger-soft);
}

.skill-flow__item--failed span {
  background: var(--color-danger);
}

.skill-meta {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.skill-meta div {
  display: grid;
  gap: 3px;
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 8px;
  background: var(--color-panel);
}

.skill-meta dt,
.skill-meta dd {
  min-width: 0;
  margin: 0;
}

.skill-meta dt {
  color: var(--color-subtle);
  font-size: 11px;
}

.skill-meta dd {
  overflow: hidden;
  color: var(--color-text);
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-log {
  border-top: 1px solid var(--color-border);
  padding-top: 8px;
}

.skill-log summary {
  color: var(--color-accent);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.skill-log pre {
  max-height: 160px;
  overflow: auto;
  margin: 8px 0 0;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 10px;
  color: var(--color-muted);
  background: var(--color-card);
  font-size: 12px;
  white-space: pre-wrap;
}

.skill-card__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--color-overlay);
}

.modal {
  width: min(620px, 100%);
  max-height: 92vh;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
}

.package-preview-modal {
  width: min(860px, 100%);
}

.package-view-modal {
  width: min(1080px, 100%);
  overflow: hidden;
}

.modal__header,
.modal__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--color-border);
}

.modal__footer {
  justify-content: flex-end;
  border-top: 1px solid var(--color-border);
  border-bottom: 0;
}

.modal__header h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 16px;
  font-weight: 800;
}

.modal__header span {
  display: block;
  margin-top: 4px;
  color: var(--color-muted);
  font-size: 12px;
}

.modal__close {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-muted);
  background: var(--color-surface);
  cursor: pointer;
}

.modal__body {
  display: grid;
  gap: 14px;
  padding: 18px;
}

.package-preview {
  gap: 12px;
}

.package-view {
  display: grid;
  grid-template-columns: minmax(190px, 0.72fr) minmax(0, 1.35fr) minmax(260px, 0.93fr);
  align-items: start;
  gap: 12px;
  overflow: hidden;
}

.package-view__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 260px;
  color: var(--color-muted);
  font-size: 13px;
}

.package-view__summary {
  display: grid;
  grid-template-columns: 1fr;
  align-self: stretch;
  gap: 8px;
  min-width: 0;
  max-height: min(58vh, 560px);
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 8px;
  background: var(--color-surface);
}

.package-view__summary div {
  display: grid;
  gap: 4px;
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 10px;
  background: var(--color-panel);
}

.package-view__summary span {
  color: var(--color-subtle);
  font-size: 11px;
}

.package-view__summary strong {
  overflow: hidden;
  color: var(--color-text);
  font-size: 13px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.package-view__grid {
  display: contents;
}

.package-view__panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
}

.package-view__panel--content {
  height: min(58vh, 560px);
}

.package-view__panel--tree {
  max-height: min(58vh, 560px);
  grid-template-rows: auto auto;
}

.package-view__panel header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 12px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text);
  font-size: 13px;
}

.package-view__panel header svg {
  color: var(--color-accent);
}

.package-view__panel pre {
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: 14px;
  color: var(--color-text);
  background: var(--color-surface);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.package-view__panel--tree .package-tree__list {
  max-height: min(48vh, 480px);
  min-height: 0;
  overflow: auto;
}

.package-summary,
.package-detected {
  display: grid;
  gap: 8px;
}

.package-summary {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.package-detected {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.package-summary div,
.package-detected div,
.package-copy,
.package-tree {
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
}

.package-summary div,
.package-detected div {
  display: grid;
  gap: 4px;
  padding: 10px;
}

.package-summary span,
.package-detected span,
.package-tree header span {
  color: var(--color-subtle);
  font-size: 11px;
}

.package-summary strong,
.package-detected strong {
  overflow: hidden;
  color: var(--color-text);
  font-size: 13px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.package-copy {
  display: grid;
  gap: 6px;
  padding: 12px;
}

.package-copy strong {
  color: var(--color-text);
  font-size: 13px;
}

.package-copy p {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.55;
}

.package-adapt-hint {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  min-width: 0;
  border: 1px solid color-mix(in srgb, var(--color-accent) 36%, var(--color-border));
  border-radius: 8px;
  padding: 12px;
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.package-adapt-hint > div {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.package-adapt-hint strong,
.package-adapt-hint p,
.package-adapt-hint ul {
  margin: 0;
}

.package-adapt-hint strong {
  color: var(--color-text);
  font-size: 13px;
}

.package-adapt-hint p {
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.5;
}

.package-adapt-hint ul {
  display: grid;
  gap: 5px;
  padding-left: 16px;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.45;
}

.package-tree {
  overflow: hidden;
}

.package-tree header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 12px;
  border-bottom: 1px solid var(--color-border);
}

.package-tree header strong {
  color: var(--color-text);
  font-size: 13px;
}

.package-tree__list {
  display: grid;
  max-height: min(34vh, 300px);
  overflow: auto;
}

.package-tree__file {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 10px;
  align-items: center;
  min-width: 0;
  padding: 9px 12px;
  border-bottom: 1px solid var(--color-border);
}

.package-tree__file:last-child {
  border-bottom: 0;
}

.package-tree__file code {
  overflow: hidden;
  color: var(--color-text);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.package-tree__file > span {
  color: var(--color-muted);
  font-size: 11px;
  white-space: nowrap;
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes pulse-dot {
  0%, 100% {
    transform: scale(0.82);
    opacity: 0.65;
  }
  50% {
    transform: scale(1.08);
    opacity: 1;
  }
}

@media (max-width: 860px) {
  .skill-card,
  .skill-card__main {
    grid-template-columns: 1fr;
  }

  .skill-card__actions {
    justify-content: stretch;
  }

  .skill-meta {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .skill-flow {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .package-view {
    grid-template-columns: 1fr;
  }

  .package-view__summary {
    max-height: none;
  }

  .package-view__panel--content {
    height: min(52vh, 460px);
  }
}

@media (max-width: 560px) {
  .skill-page {
    gap: 12px;
    padding: 14px 12px 18px;
  }

  .page-header {
    gap: 10px;
  }

  .page-header__info {
    min-width: 0;
  }

  .page-header__info h2 {
    font-size: 22px;
    line-height: 1.2;
  }

  .page-header__info p,
  .upload-guide p {
    font-size: 12px;
  }

  .page-header__actions,
  .page-header__actions :deep(.ui-button) {
    width: 100%;
  }

  .upload-guide,
  .skill-flow,
  .skill-meta,
  .package-summary,
  .package-detected,
  .package-view__summary {
    grid-template-columns: 1fr;
  }

  .upload-guide,
  .skill-card {
    padding: 12px;
  }

  .skill-card__icon,
  .upload-guide__icon {
    width: 36px;
    height: 36px;
  }

  .skill-card__title h3 {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .loading-state {
    padding: 28px 12px;
  }

  .package-tree header,
  .package-tree__file {
    align-items: flex-start;
    grid-template-columns: 1fr;
  }

  .modal__footer {
    flex-direction: column-reverse;
  }
}
</style>
