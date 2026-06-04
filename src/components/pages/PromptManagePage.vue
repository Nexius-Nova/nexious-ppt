<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { Plus, Search, Edit3, Trash2, Copy, FileText, Tag, Eye } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiEmpty from '@/components/ui/UiEmpty.vue';
import UiField from '@/components/ui/UiField.vue';
import { useToastStore } from '@/stores/toastStore';
import { promptApi, type Prompt } from '@/services/api';

const toastStore = useToastStore();

const prompts = ref<Prompt[]>([]);
const loading = ref(false);
const searchQuery = ref('');
const showModal = ref(false);
const showPreviewModal = ref(false);
const previewPrompt = ref<Prompt | null>(null);
const editingPrompt = ref<Prompt | null>(null);
const formData = ref({
  title: '',
  scene: '',
  content: ''
});

const filteredPrompts = computed(() => {
  if (!searchQuery.value) return prompts.value;
  const query = searchQuery.value.toLowerCase();
  return prompts.value.filter(p => 
    p.title.toLowerCase().includes(query) ||
    (p.scene && p.scene.toLowerCase().includes(query)) ||
    p.content.toLowerCase().includes(query)
  );
});

async function fetchPrompts() {
  loading.value = true;
  try {
    const response = await promptApi.getAll();
    if (response.success && response.data) {
      prompts.value = response.data;
    }
  } catch (error) {
    console.error('Failed to fetch prompts:', error);
  } finally {
    loading.value = false;
  }
}

function openCreateModal() {
  editingPrompt.value = null;
  formData.value = { title: '', scene: '', content: '' };
  showModal.value = true;
}

function openEditModal(prompt: Prompt) {
  editingPrompt.value = prompt;
  formData.value = {
    title: prompt.title,
    scene: prompt.scene || '',
    content: prompt.content
  };
  showModal.value = true;
}

function openPreviewModal(prompt: Prompt) {
  previewPrompt.value = prompt;
  showPreviewModal.value = true;
}

async function savePrompt() {
  if (!formData.value.title.trim() || !formData.value.content.trim()) {
    toastStore.warning('请填写完整信息', '标题和内容不能为空');
    return;
  }

  loading.value = true;
  try {
    if (editingPrompt.value) {
      const response = await promptApi.update(editingPrompt.value.id, {
        title: formData.value.title,
        scene: formData.value.scene,
        content: formData.value.content
      });
      if (response.success) {
        toastStore.success('保存成功', '提示词已更新');
        await fetchPrompts();
      }
    } else {
      const response = await promptApi.create({
        title: formData.value.title,
        scene: formData.value.scene,
        content: formData.value.content
      });
      if (response.success) {
        toastStore.success('创建成功', '新提示词已添加');
        await fetchPrompts();
      }
    }
    showModal.value = false;
  } catch (error) {
    toastStore.error('操作失败', error instanceof Error ? error.message : '未知错误');
  } finally {
    loading.value = false;
  }
}

async function deletePrompt(prompt: Prompt) {
  if (!confirm(`确定要删除提示词「${prompt.title}」吗？`)) return;
  
  try {
    const response = await promptApi.delete(prompt.id);
    if (response.success) {
      toastStore.success('删除成功', '提示词已删除');
      await fetchPrompts();
    }
  } catch (error) {
    toastStore.error('删除失败', error instanceof Error ? error.message : '未知错误');
  }
}

function copyPrompt(prompt: Prompt) {
  navigator.clipboard.writeText(prompt.content);
  toastStore.success('复制成功', '提示词已复制到剪贴板');
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

onMounted(() => {
  fetchPrompts();
});
</script>

<template>
  <div class="prompt-page">
    <div class="page-header">
      <div class="page-header__info">
        <h2>提示词管理</h2>
        <p>管理和自定义您的 PPT 生成提示词</p>
      </div>
      <UiButton @click="openCreateModal">
        <Plus :size="14" />
        新建提示词
      </UiButton>
    </div>

    <div class="search-bar">
      <UiInput
        v-model="searchQuery"
        placeholder="搜索提示词..."
        :prefix-icon="Search"
      />
    </div>

    <div v-if="loading && prompts.length === 0" class="loading-state">
      加载中...
    </div>

    <div v-else-if="filteredPrompts.length === 0" class="empty-state">
      <UiEmpty
        :title="searchQuery ? '未找到匹配提示词' : '还没有提示词'"
        :description="searchQuery ? '尝试其他搜索词' : '点击上方按钮创建您的第一个提示词'"
      />
    </div>

    <div v-else class="prompt-grid">
      <div
        v-for="prompt in filteredPrompts"
        :key="prompt.id"
        class="prompt-card"
      >
        <div class="prompt-card__header">
          <div class="prompt-card__icon">
            <FileText :size="18" />
          </div>
          <div class="prompt-card__actions">
            <button class="action-btn" title="预览" @click="openPreviewModal(prompt)">
              <Eye :size="14" />
            </button>
            <button class="action-btn" title="复制内容" @click="copyPrompt(prompt)">
              <Copy :size="14" />
            </button>
            <button class="action-btn" title="编辑" @click="openEditModal(prompt)">
              <Edit3 :size="14" />
            </button>
            <button class="action-btn action-btn--danger" title="删除" @click="deletePrompt(prompt)">
              <Trash2 :size="14" />
            </button>
          </div>
        </div>

        <div class="prompt-card__body">
          <h3 class="prompt-card__title">{{ prompt.title }}</h3>
          <div v-if="prompt.scene" class="prompt-card__scene">
            <Tag :size="12" />
            <span>{{ prompt.scene }}</span>
          </div>
          <p class="prompt-card__content">{{ prompt.content }}</p>
        </div>

        <div class="prompt-card__footer">
          <span class="prompt-card__date">更新于 {{ formatDate(prompt.updated_at) }}</span>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
        <div class="modal modal--lg">
          <div class="modal__header">
            <h3>{{ editingPrompt ? '编辑提示词' : '新建提示词' }}</h3>
            <button class="modal__close" @click="showModal = false">×</button>
          </div>
          <div class="modal__body">
            <div class="form-grid">
              <UiField label="标题" required>
                <UiInput
                  v-model="formData.title"
                  placeholder="例如：战略汇报提示词"
                />
              </UiField>

              <UiField label="适用场景">
                <UiInput
                  v-model="formData.scene"
                  placeholder="例如：年度规划 / 经营复盘"
                />
              </UiField>
            </div>

            <UiField label="提示词内容" required>
              <textarea
                v-model="formData.content"
                class="content-textarea"
                placeholder="输入提示词内容..."
                rows="6"
              ></textarea>
            </UiField>
          </div>
          <div class="modal__footer">
            <UiButton variant="secondary" @click="showModal = false">取消</UiButton>
            <UiButton :disabled="loading" @click="savePrompt">
              {{ editingPrompt ? '保存' : '创建' }}
            </UiButton>
          </div>
        </div>
      </div>

      <div v-if="showPreviewModal" class="modal-overlay" @click.self="showPreviewModal = false">
        <div class="modal modal--lg">
          <div class="modal__header">
            <h3>提示词预览</h3>
            <button class="modal__close" @click="showPreviewModal = false">×</button>
          </div>
          <div class="modal__body">
            <div class="preview-section">
              <div class="preview-label">标题</div>
              <div class="preview-value preview-value--title">{{ previewPrompt?.title }}</div>
            </div>
            <div class="preview-section">
              <div class="preview-label">适用场景</div>
              <div class="preview-value">
                <Tag :size="14" />
                <span>{{ previewPrompt?.scene || '未设置' }}</span>
              </div>
            </div>
            <div class="preview-section">
              <div class="preview-label">提示词内容</div>
              <div class="preview-content">{{ previewPrompt?.content }}</div>
            </div>
          </div>
          <div class="modal__footer">
            <UiButton variant="secondary" @click="showPreviewModal = false">关闭</UiButton>
            <UiButton @click="copyPrompt(previewPrompt!); showPreviewModal = false">
              <Copy :size="14" />
              复制内容
            </UiButton>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.prompt-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
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
  letter-spacing: 0;
}

.page-header__info p {
  margin: 6px 0 0;
  font-size: 14px;
  color: var(--color-subtle);
  line-height: 1.6;
}

.search-bar {
  max-width: 420px;
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

.prompt-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}

.prompt-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  padding: 14px;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast);
}

.prompt-card:hover {
  border-color: var(--color-border-strong);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}

.prompt-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}

.prompt-card__icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: var(--color-panel);
  color: var(--color-accent);
}

.prompt-card__actions {
  display: flex;
  gap: 4px;
  opacity: 1;
  transition: opacity var(--transition-fast);
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

.action-btn--danger:hover {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.prompt-card__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prompt-card__title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text);
  letter-spacing: 0;
}

.prompt-card__scene {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-muted);
}

.prompt-card__content {
  margin: 0;
  font-size: 13px;
  color: var(--color-subtle);
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.prompt-card__footer {
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
  margin-top: 12px;
}

.prompt-card__date {
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
  padding: 20px;
  background: rgba(15, 23, 42, 0.42);
}

.modal {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 500px;
  max-height: calc(100vh - 40px);
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
}

.modal--lg {
  max-width: min(680px, calc(100vw - 40px));
}

.modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
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
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  font-size: 20px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.modal__close:hover {
  border-color: var(--color-border);
  background: var(--color-panel);
  color: var(--color-text);
}

.modal__body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.content-textarea {
  width: 100%;
  min-height: 220px;
  max-height: min(46vh, 420px);
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  color: var(--color-text);
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
  overflow: auto;
  font-family: inherit;
  transition: border-color var(--transition-fast), background var(--transition-fast);
}

.content-textarea:focus {
  outline: none;
  border-color: var(--color-accent);
}

.modal__footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex: 0 0 auto;
  padding: 16px 20px;
  border-top: 1px solid var(--color-border);
}

.preview-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preview-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.preview-value {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--color-text);
}

.preview-value--title {
  font-size: 18px;
  font-weight: 600;
}

.preview-content {
  max-height: min(52vh, 520px);
  overflow: auto;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  font-size: 14px;
  color: var(--color-text);
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 720px) {
  .prompt-page {
    padding: 16px;
  }

  .page-header {
    flex-direction: column;
    align-items: stretch;
  }

  .search-bar {
    max-width: none;
  }

  .prompt-grid {
    grid-template-columns: 1fr;
  }

  .modal-overlay {
    align-items: stretch;
    padding: 12px;
  }

  .modal,
  .modal--lg {
    max-width: none;
    max-height: calc(100vh - 24px);
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .modal__header,
  .modal__body,
  .modal__footer {
    padding-left: 16px;
    padding-right: 16px;
  }
}
</style>
