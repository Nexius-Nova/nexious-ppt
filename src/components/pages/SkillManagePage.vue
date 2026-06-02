<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Plus, Trash2, Edit3, Zap, Upload, FileText, Loader2 } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiEmpty from '@/components/ui/UiEmpty.vue';
import UiField from '@/components/ui/UiField.vue';
import UiTextarea from '@/components/ui/UiTextarea.vue';
import { useToastStore } from '@/stores/toastStore';
import { skillApi, type Skill } from '@/services/api';

const toastStore = useToastStore();

const skills = ref<Skill[]>([]);
const loading = ref(false);
const showModal = ref(false);
const editingSkill = ref<Skill | null>(null);
const formData = ref({
  name: '',
  description: '',
  instruction: '',
  icon: 'Zap',
  category: '其他',
  parameters: {} as Record<string, any>
});
const uploadFile = ref<File | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const parsingFile = ref(false);

async function fetchSkills() {
  loading.value = true;
  try {
    const response = await skillApi.getAll();
    if (response.success && response.data) {
      skills.value = response.data;
    }
  } catch (error) {
    console.error('Failed to fetch skills:', error);
  } finally {
    loading.value = false;
  }
}

function openCreateModal() {
  editingSkill.value = null;
  formData.value = {
    name: '',
    description: '',
    instruction: '',
    icon: 'Zap',
    category: '其他',
    parameters: {},
  };
  uploadFile.value = null;
  showModal.value = true;
}

function openEditModal(skill: Skill) {
  editingSkill.value = skill;
  formData.value = {
    name: skill.name,
    description: skill.description || '',
    instruction: skill.parameters?.instruction || '',
    icon: skill.icon || 'Zap',
    category: skill.category || '其他',
    parameters: skill.parameters || {},
  };
  uploadFile.value = null;
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
  editingSkill.value = null;
  uploadFile.value = null;
}

function parseSkillMd(content: string) {
  const result = {
    name: '',
    description: '',
    instruction: content
  };

  const lines = content.split('\n');
  let inYaml = false;
  let yamlContent: string[] = [];
  let contentStartIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '---') {
      if (!inYaml) {
        inYaml = true;
      } else {
        inYaml = false;
        contentStartIndex = i + 1;
        break;
      }
    } else if (inYaml) {
      yamlContent.push(lines[i]);
    }
  }

  for (const line of yamlContent) {
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch) {
      result.name = nameMatch[1].trim();
    }
    const descMatch = line.match(/^description:\s*(.+)$/);
    if (descMatch) {
      result.description = descMatch[1].trim();
    }
  }

  if (contentStartIndex > 0) {
    result.instruction = lines.slice(contentStartIndex).join('\n').trim();
  }

  return result;
}

async function extractSkillMdFromZip(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const JSZip = await import('jszip');
        const zip = await JSZip.default.loadAsync(e.target?.result as ArrayBuffer);
        
        const skillMdFile = zip.file('SKILL.md') || zip.file('skill.md');
        if (skillMdFile) {
          const content = await skillMdFile.async('string');
          resolve(content);
        } else {
          resolve(null);
        }
      } catch (error) {
        console.error('Failed to parse zip:', error);
        resolve(null);
      }
    };
    reader.onerror = () => resolve(null);
    reader.readAsArrayBuffer(file);
  });
}

async function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    const file = target.files[0];
    uploadFile.value = file;
    
    parsingFile.value = true;
    try {
      let content: string | null = null;
      
      if (file.name.endsWith('.md')) {
        content = await file.text();
      } else if (file.name.endsWith('.zip') || file.name.endsWith('.skill')) {
        content = await extractSkillMdFromZip(file);
      }
      
      if (content) {
        const parsed = parseSkillMd(content);
        if (parsed.name) {
          formData.value.name = parsed.name;
        }
        if (parsed.description) {
          formData.value.description = parsed.description;
        }
        if (parsed.instruction) {
          formData.value.instruction = parsed.instruction;
        }
        toastStore.success('解析成功', '已自动填充表单内容');
      } else {
        toastStore.warning('未找到 SKILL.md', '请确保文件包含 SKILL.md');
      }
    } catch (error) {
      toastStore.error('解析失败', error instanceof Error ? error.message : '未知错误');
    } finally {
      parsingFile.value = false;
    }
  }
}

function triggerFileUpload() {
  fileInputRef.value?.click();
}

async function saveSkill() {
  if (!formData.value.name.trim()) {
    toastStore.warning('请填写技能名称', '名称不能为空');
    return;
  }

  loading.value = true;
  try {
    const dataToSave = {
      ...formData.value,
      parameters: {
        ...formData.value.parameters,
        instruction: formData.value.instruction
      }
    };

    if (editingSkill.value) {
      const response = await skillApi.update(editingSkill.value.id, dataToSave);
      if (response.success) {
        toastStore.success('保存成功', '技能已更新');
        await fetchSkills();
      }
    } else {
      const response = await skillApi.create(dataToSave);
      if (response.success) {
        toastStore.success('创建成功', '新技能已添加');
        await fetchSkills();
      }
    }
    closeModal();
  } catch (error) {
    toastStore.error('操作失败', error instanceof Error ? error.message : '未知错误');
  } finally {
    loading.value = false;
  }
}

async function deleteSkill(skill: Skill) {
  if (!confirm(`确定要删除技能「${skill.name}」吗？`)) return;

  try {
    const response = await skillApi.delete(skill.id);
    if (response.success) {
      toastStore.success('删除成功', '技能已删除');
      await fetchSkills();
    }
  } catch (error) {
    toastStore.error('删除失败', error instanceof Error ? error.message : '未知错误');
  }
}

onMounted(() => {
  fetchSkills();
});
</script>

<template>
  <div class="skill-page">
    <div class="page-header">
      <div class="page-header__info">
        <h2>Skill 管理</h2>
        <p>管理和配置 PPT 生成的扩展技能</p>
      </div>
      <div class="page-header__stats">
        <UiBadge tone="info">共 {{ skills.length }} 个</UiBadge>
      </div>
      <UiButton @click="openCreateModal">
        <Plus :size="14" />
        新建 Skill
      </UiButton>
    </div>

    <div v-if="loading && skills.length === 0" class="loading-state">
      加载中...
    </div>

    <div v-else-if="skills.length === 0" class="empty-state">
      <UiEmpty
        title="还没有技能"
        description="点击上方按钮创建您的第一个技能"
      />
    </div>

    <div v-else class="skill-list">
      <div
        v-for="skill in skills"
        :key="skill.id"
        class="skill-card"
      >
        <div class="skill-card__header">
          <div class="skill-card__icon">
            <Zap :size="20" />
          </div>
          <div class="skill-card__info">
            <h4>{{ skill.name }}</h4>
            <p v-if="skill.description">{{ skill.description }}</p>
          </div>
          <div class="skill-card__actions">
            <button class="btn-icon" title="编辑" @click="openEditModal(skill)">
              <Edit3 :size="14" />
            </button>
            <button class="btn-icon btn-icon--danger" title="删除" @click="deleteSkill(skill)">
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
        <div class="skill-card__footer">
          <span v-if="skill.category" class="skill-category">{{ skill.category }}</span>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
        <div class="modal">
          <div class="modal__header">
            <h3>{{ editingSkill ? '编辑 Skill' : '创建技能' }}</h3>
            <button class="modal__close" @click="closeModal">×</button>
          </div>
          <div class="modal__body">
            <!-- 文件上传区域 -->
            <div class="upload-section">
              <input
                ref="fileInputRef"
                type="file"
                accept=".zip,.md"
                class="hidden-input"
                @change="handleFileSelect"
              />
              <div
                class="upload-area"
                :class="{ 
                  'upload-area--has-file': uploadFile,
                  'upload-area--parsing': parsingFile 
                }"
                @click="triggerFileUpload"
              >
                <div class="upload-content">
                  <Loader2 v-if="parsingFile" :size="32" class="upload-icon upload-icon--spin" />
                  <FileText v-else :size="32" class="upload-icon" />
                  <div class="upload-text">
                    <span class="upload-title">
                      {{ parsingFile ? '正在解析...' : '上传进行智能解析' }}
                    </span>
                    <span class="upload-desc">
                      {{ parsingFile 
                        ? '正在读取 SKILL.md 文件内容...' 
                        : 'zip 或 .md 文件，根目录包含 SKILL.md。SKILL.md 通过 YAML 格式定义技能名称与描述。' 
                      }}
                    </span>
                  </div>
                  <div v-if="uploadFile && !parsingFile" class="upload-file-name">
                    <Upload :size="14" />
                    {{ uploadFile.name }}
                  </div>
                </div>
              </div>
            </div>

            <UiField label="技能名称" required>
              <div class="field-with-count">
                <UiInput
                  v-model="formData.name"
                  placeholder="为该技能起一个简短、易识别的名称（例如 codemap）"
                  maxlength="50"
                />
                <span class="char-count" :class="{ 'char-count--warn': formData.name.length > 40 }">{{ formData.name.length }}/50</span>
              </div>
            </UiField>

            <UiField label="描述" required>
              <UiInput
                v-model="formData.description"
                placeholder="该技能应该在何时使用？例如：当用户询问项目结构或文件关系时"
              />
            </UiField>

            <UiField label="指令" required>
              <UiTextarea
                v-model="formData.instruction"
                placeholder="定义该技能激活时模型应如何行为。例如：
# codemap
## Commands
## When to Use
## Output Interpretation
## Examples"
                :rows="10"
              />
            </UiField>
          </div>
          <div class="modal__footer">
            <UiButton variant="secondary" @click="closeModal">取消</UiButton>
            <UiButton :disabled="loading" @click="saveSkill">
              {{ editingSkill ? '保存' : '确认' }}
            </UiButton>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.skill-page {
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
  flex-wrap: wrap;
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

.page-header__stats {
  display: flex;
  gap: 8px;
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

.skill-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.skill-card {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  padding: 16px;
  transition: all var(--transition-fast);
}

.skill-card:hover {
  border-color: var(--color-border-strong);
}

.skill-card__header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.skill-card__icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  flex-shrink: 0;
}

.skill-card__info {
  flex: 1;
  min-width: 0;
}

.skill-card__info h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

.skill-card__info p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--color-muted);
}

.skill-card__actions {
  display: flex;
  gap: 4px;
}

.btn-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-icon:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.btn-icon--danger:hover {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.skill-card__footer {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
}

.skill-category {
  font-size: 12px;
  color: var(--color-muted);
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
  max-width: 560px;
  max-height: 90vh;
  overflow-y: auto;
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
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.modal__footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 16px 20px;
  border-top: 1px solid var(--color-border);
}

/* 上传区域样式 */
.upload-section {
  width: 100%;
}

.hidden-input {
  display: none;
}

.upload-area {
  width: 100%;
  min-height: 120px;
  border: 2px dashed var(--color-border);
  border-radius: 10px;
  background: var(--color-panel);
  cursor: pointer;
  transition: all var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
}

.upload-area:hover {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.upload-area--has-file {
  border-color: var(--color-success);
  background: var(--color-success-soft, rgba(34, 197, 94, 0.1));
}

.upload-area--parsing {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  cursor: not-allowed;
}

.upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px;
  text-align: center;
}

.upload-icon {
  color: var(--color-muted);
}

.upload-area:hover .upload-icon {
  color: var(--color-accent);
}

.upload-icon--spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.upload-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.upload-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
}

.upload-desc {
  font-size: 12px;
  color: var(--color-muted);
  max-width: 400px;
  line-height: 1.5;
}

.upload-file-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--color-success);
  margin-top: 8px;
  padding: 6px 12px;
  background: var(--color-surface);
  border-radius: 6px;
}

/* Character count */
.field-with-count {
  position: relative;
}

.char-count {
  position: absolute;
  right: 8px;
  bottom: -18px;
  font-size: 11px;
  color: var(--color-subtle);
  font-family: var(--font-mono);
  pointer-events: none;
}

.char-count--warn {
  color: var(--color-warning);
}

.char-count--error {
  color: var(--color-danger);
}
</style>
