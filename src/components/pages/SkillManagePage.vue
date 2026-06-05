<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { CheckCircle2, Edit3, FileArchive, Loader2, RotateCw, Trash2, UploadCloud, XCircle, Zap } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiEmpty from '@/components/ui/UiEmpty.vue';
import UiField from '@/components/ui/UiField.vue';
import UiSelect from '@/components/ui/UiSelect.vue';
import UiTextarea from '@/components/ui/UiTextarea.vue';
import DeleteConfirmModal from '@/components/common/DeleteConfirmModal.vue';
import { useToastStore } from '@/stores/toastStore';
import { skillApi, type Skill, type SkillPackagePreview, type SkillPackagePreviewFile } from '@/services/api';
import { INPUT_SKILL_CATEGORIES, normalizeInputSkillCategory } from '@/constants/inputSkillCategories';

const toastStore = useToastStore();
const emit = defineEmits<{
  changed: [];
}>();

const skills = ref<Skill[]>([]);
const loading = ref(false);
const saving = ref(false);
const uploading = ref(false);
const deleting = ref(false);
const showModal = ref(false);
const showPackagePreview = ref(false);
const editingSkill = ref<Skill | null>(null);
const deleteTarget = ref<Skill | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const packageFileName = ref('');
const pendingPackage = ref<{ filename: string; dataBase64: string } | null>(null);
const packagePreview = ref<SkillPackagePreview | null>(null);
const formData = ref({
  name: '',
  description: '',
  instruction: '',
  icon: 'Zap',
  category: '资料收集',
  parameters: {} as Record<string, any>
});

const readyCount = computed(() =>
  skills.value.filter((skill) => ['ready', 'not_required'].includes(skill.install_status || 'not_required')).length
);
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
      skills.value = response.data.map((skill) => ({
        ...skill,
        category: normalizeInputSkillCategory(skill.category)
      }));
    } else {
      toastStore.error('加载失败', response.message || '获取 Skill 列表失败');
    }
  } catch (error) {
    toastStore.error('加载失败', error instanceof Error ? error.message : '获取 Skill 列表失败');
  } finally {
    loading.value = false;
  }
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

function openCreateModal() {
  editingSkill.value = null;
  packageFileName.value = '';
  formData.value = {
    name: '',
    description: '',
    instruction: '',
    icon: 'Zap',
    category: '资料收集',
    parameters: {},
  };
  showModal.value = true;
}

function openEditModal(skill: Skill) {
  editingSkill.value = skill;
  packageFileName.value = '';
  formData.value = {
    name: skill.name,
    description: skill.description || '',
    instruction: String(skill.parameters?.instruction || ''),
    icon: skill.icon || 'Zap',
    category: normalizeInputSkillCategory(skill.category),
    parameters: skill.parameters || {},
  };
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
  editingSkill.value = null;
  packageFileName.value = '';
}

function closePackagePreview() {
  if (uploading.value) return;
  showPackagePreview.value = false;
  packagePreview.value = null;
  pendingPackage.value = null;
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
    const response = await skillApi.uploadPackage(pendingPackage.value);
    if (!response.success) {
      throw new Error(response.message || '上传 Skill 包失败');
    }
    toastStore.success('添加成功', '已保存完整 Skill 包，后端会自动初始化依赖环境');
    showPackagePreview.value = false;
    packagePreview.value = null;
    pendingPackage.value = null;
    packageFileName.value = '';
    await fetchSkills();
    emit('changed');
  } catch (error) {
    toastStore.error('上传失败', error instanceof Error ? error.message : '上传 Skill 包失败');
  } finally {
    uploading.value = false;
  }
}

async function saveSkill() {
  if (!formData.value.name.trim()) {
    toastStore.warning('请填写名称', 'Skill 名称不能为空');
    return;
  }

  saving.value = true;
  try {
    const payload = {
      name: formData.value.name.trim(),
      description: formData.value.description.trim(),
      icon: formData.value.icon,
      category: normalizeInputSkillCategory(formData.value.category),
      parameters: {
        ...formData.value.parameters,
        instruction: formData.value.instruction.trim(),
      },
      is_enabled: true,
    };

    const response = editingSkill.value
      ? await skillApi.update(editingSkill.value.id, payload)
      : await skillApi.create(payload);

    if (!response.success) throw new Error(response.message || '保存 Skill 失败');
    toastStore.success('保存成功', editingSkill.value ? 'Skill 已更新' : '已创建提示词型 Skill');
    closeModal();
    await fetchSkills();
    emit('changed');
  } catch (error) {
    toastStore.error('保存失败', error instanceof Error ? error.message : '保存 Skill 失败');
  } finally {
    saving.value = false;
  }
}

async function reinstallSkill(skill: Skill) {
  const response = await skillApi.reinstall(skill.id);
  if (response.success) {
    toastStore.info('正在初始化', '后端正在自动初始化 Skill 运行环境');
    await fetchSkills();
    emit('changed');
  } else {
    toastStore.error('操作失败', response.message || '重新初始化失败');
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

onMounted(fetchSkills);
</script>

<template>
  <div class="skill-page">
    <header class="page-header">
      <div class="page-header__info">
        <h2>Skill 管理</h2>
        <p>上传 Skill 包后，系统会自动识别说明、入口脚本和依赖文件，并初始化运行环境。</p>
      </div>
      <div class="page-header__actions">
        <UiBadge tone="info">共 {{ skills.length }} 个</UiBadge>
        <UiBadge tone="success">可用 {{ readyCount }} 个</UiBadge>
        <UiButton variant="secondary" @click="openCreateModal">
          <Edit3 :size="14" />
          新建提示词 Skill
        </UiButton>
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
        <strong>{{ uploading ? `正在上传 ${packageFileName}` : 'Skill 包规范' }}</strong>
        <p>包内只需要包含 SKILL.md；skill.json、requirements.txt、package.json、run.py、index.js 等文件都是可选识别项。依赖由后端自动初始化，用户只需要上传 Skill 包。</p>
      </div>
    </section>

    <div v-if="loading && skills.length === 0" class="loading-state">
      <Loader2 :size="18" class="spin" />
      正在加载 Skill...
    </div>

    <UiEmpty
      v-else-if="skills.length === 0"
      title="还没有 Skill"
      description="上传一个 Skill 包，或先创建一个纯提示词型 Skill。"
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
            </div>
            <p>{{ skill.description || '暂无说明' }}</p>
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
          </div>
        </div>
        <div class="skill-card__actions">
          <UiButton v-if="skill.runtime !== 'prompt-only'" size="sm" variant="secondary" @click="reinstallSkill(skill)">
            <RotateCw :size="13" />
            重试初始化
          </UiButton>
          <UiButton size="sm" variant="ghost" @click="openEditModal(skill)">
            <Edit3 :size="13" />
            编辑
          </UiButton>
          <UiButton size="sm" variant="danger" @click="requestDelete(skill)">
            <Trash2 :size="13" />
            删除
          </UiButton>
        </div>
      </article>
    </div>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
        <div class="modal">
          <header class="modal__header">
            <h3>{{ editingSkill ? '编辑 Skill' : '新建提示词 Skill' }}</h3>
            <button type="button" class="modal__close" @click="closeModal">×</button>
          </header>
          <div class="modal__body">
            <UiField label="Skill 名称" required>
              <UiInput v-model="formData.name" placeholder="例如：资料摘要、Web 搜索、文件解析" />
            </UiField>
            <UiField label="分类">
              <UiSelect
                v-model="formData.category"
                :options="categoryOptions"
                placeholder="选择输入阶段分类"
              />
            </UiField>
            <UiField label="说明">
              <UiInput v-model="formData.description" placeholder="描述这个 Skill 适合在什么场景使用" />
            </UiField>
            <UiField label="提示词 / 使用说明" required>
              <UiTextarea
                v-model="formData.instruction"
                :rows="9"
                placeholder="写清楚 Skill 的用途、触发条件、输入输出要求。纯提示词 Skill 不需要额外依赖。"
              />
            </UiField>
          </div>
          <footer class="modal__footer">
            <UiButton variant="secondary" :disabled="saving" @click="closeModal">取消</UiButton>
            <UiButton variant="primary" :loading="saving" @click="saveSkill">保存</UiButton>
          </footer>
        </div>
      </div>
    </Teleport>

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
                <strong>{{ packagePreview.category }}</strong>
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
}

@media (max-width: 560px) {
  .skill-page {
    padding: 14px;
  }

  .page-header__actions,
  .page-header__actions :deep(.ui-button) {
    width: 100%;
  }

  .upload-guide,
  .skill-meta,
  .package-summary,
  .package-detected {
    grid-template-columns: 1fr;
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
