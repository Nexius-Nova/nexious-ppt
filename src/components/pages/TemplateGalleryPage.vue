<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { Search, Check, LayoutTemplate, Palette, Layers, Star, Eye, FileText, Image, Plus, Edit3, Trash2 } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiSelect from '@/components/ui/UiSelect.vue';
import UiField from '@/components/ui/UiField.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiEmpty from '@/components/ui/UiEmpty.vue';
import { useToastStore } from '@/stores/toastStore';
import { useAgentStore } from '@/stores/agentStore';
import { templateApi, type Template } from '@/services/api';

const toastStore = useToastStore();
const agentStore = useAgentStore();

const templates = ref<Template[]>([]);
const loading = ref(false);
const searchQuery = ref('');
const selectedCategory = ref<string | null>(null);
const appliedTemplate = ref<number | null>(null);
const showPreviewModal = ref(false);
const previewTemplate = ref<Template | null>(null);

const categories = computed(() => {
  const cats = new Set(templates.value.map(t => t.category).filter(Boolean));
  return ['全部', ...Array.from(cats)] as string[];
});

const filteredTemplates = computed(() => {
  let result = templates.value;
  
  if (selectedCategory.value && selectedCategory.value !== '全部') {
    result = result.filter(t => t.category === selectedCategory.value);
  }
  
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    result = result.filter(t => 
      t.name.toLowerCase().includes(query) ||
      (t.description && t.description.toLowerCase().includes(query)) ||
      (t.category && t.category.toLowerCase().includes(query))
    );
  }
  
  return result;
});

async function fetchTemplates() {
  loading.value = true;
  try {
    const response = await templateApi.getAll();
    if (response.success && response.data) {
      templates.value = response.data;
    }
  } catch (error) {
    console.error('Failed to fetch templates:', error);
  } finally {
    loading.value = false;
  }
}

function selectCategory(category: string) {
  selectedCategory.value = category;
}

function applyTemplate(template: Template) {
  appliedTemplate.value = template.id;
  agentStore.applyGalleryTemplate(template);
  toastStore.success('模版已应用', `已应用「${template.name}」模版`);
}

function openPreviewModal(template: Template) {
  previewTemplate.value = template;
  showPreviewModal.value = true;
}

const templateFeatures = computed(() => {
  if (!previewTemplate.value) return [];
  return [
    { icon: FileText, label: '页数', value: `${previewTemplate.value.slide_count} 页` },
    { icon: Layers, label: '分类', value: previewTemplate.value.category || '未分类' },
    { icon: Palette, label: '主题色', value: previewTemplate.value.accent }
  ];
});

onMounted(() => {
  fetchTemplates();
});

// ---- Template Editor ----
const showEditor = ref(false);
const editingTemplate = ref<Template | null>(null);
const saving = ref(false);
const editorForm = ref({
  name: '',
  category: '',
  description: '',
  slide_count: 10,
  accent: '#ef2d2d',
  is_public: false
});

function openCreateModal() {
  editingTemplate.value = null;
  editorForm.value = { name: '', category: '', description: '', slide_count: 10, accent: '#ef2d2d', is_public: false };
  showEditor.value = true;
}

function openEditModal(template: Template) {
  editingTemplate.value = template;
  editorForm.value = {
    name: template.name,
    category: template.category || '',
    description: template.description || '',
    slide_count: template.slide_count,
    accent: template.accent || '#ef2d2d',
    is_public: template.is_public || false
  };
  showEditor.value = true;
}

async function saveTemplate() {
  if (!editorForm.value.name.trim()) {
    toastStore.warning('请输入模版名称');
    return;
  }
  saving.value = true;
  try {
    if (editingTemplate.value) {
      const res = await templateApi.update(editingTemplate.value.id, editorForm.value);
      if (res.success) toastStore.success('模版已更新');
    } else {
      const res = await templateApi.create(editorForm.value);
      if (res.success) toastStore.success('模版已创建');
    }
    showEditor.value = false;
    await fetchTemplates();
  } catch (e: any) {
    toastStore.error('保存失败', e.message);
  } finally {
    saving.value = false;
  }
}

async function deleteTemplate(template: Template) {
  if (!confirm(`确定要删除模版「${template.name}」吗？`)) return;
  try {
    const res = await templateApi.delete(template.id);
    if (res.success) {
      toastStore.success('模版已删除');
      await fetchTemplates();
    }
  } catch (e: any) {
    toastStore.error('删除失败', e.message);
  }
}
</script>

<template>
  <div class="template-page">
    <div class="page-header">
      <div class="page-header__info">
        <h2>模版广场</h2>
        <p>选择适合您的 PPT 模版，快速开始创作</p>
      </div>
      <UiButton @click="openCreateModal">
        <Plus :size="14" />
        创建模版
      </UiButton>
    </div>

    <div class="filters">
      <div class="search-bar">
        <UiInput
          v-model="searchQuery"
          placeholder="搜索模版..."
          :prefix-icon="Search"
        />
      </div>
      <div class="category-tabs">
        <button
          v-for="category in categories"
          :key="category"
          class="category-tab"
          :class="{ 'category-tab--active': selectedCategory === category || (category === '全部' && !selectedCategory) }"
          @click="selectCategory(category)"
        >
          {{ category }}
        </button>
      </div>
    </div>

    <div v-if="loading && templates.length === 0" class="loading-state">
      加载中...
    </div>

    <div v-else-if="filteredTemplates.length === 0" class="empty-state">
      <UiEmpty
        :title="searchQuery ? '未找到匹配模版' : '暂无模版'"
        :description="searchQuery ? '尝试其他搜索词或分类' : '请稍后再来'"
      />
    </div>

    <div v-else class="template-grid">
      <div
        v-for="template in filteredTemplates"
        :key="template.id"
        class="template-card"
        :class="{ 'template-card--applied': appliedTemplate === template.id }"
      >
        <div class="template-card__preview" :style="{ background: template.accent || '#334155' }">
          <div class="template-card__preview-content">
            <div class="preview-slide"></div>
            <div class="preview-slide"></div>
            <div class="preview-slide preview-slide--small"></div>
          </div>
          <div v-if="appliedTemplate === template.id" class="template-card__applied-badge">
            <Check :size="12" />
            已应用
          </div>
        </div>

        <div class="template-card__body">
          <div class="template-card__header">
            <h3 class="template-card__name">{{ template.name }}</h3>
            <UiBadge tone="neutral" size="sm">{{ template.category || '未分类' }}</UiBadge>
          </div>
          
          <p class="template-card__description">{{ template.description }}</p>
          
          <div class="template-card__meta">
            <span class="meta-item">
              <Layers :size="12" />
              {{ template.slide_count }} 页
            </span>
          </div>
        </div>

        <div class="template-card__footer">
          <UiButton
            variant="secondary"
            size="sm"
            @click="openPreviewModal(template)"
          >
            <Eye :size="14" />
            查看
          </UiButton>
          <UiButton
            :variant="appliedTemplate === template.id ? 'secondary' : 'primary'"
            size="sm"
            @click="applyTemplate(template)"
          >
            <Check v-if="appliedTemplate === template.id" :size="14" />
            {{ appliedTemplate === template.id ? '已应用' : '应用' }}
          </UiButton>
          <button class="action-btn" title="编辑" @click="openEditModal(template)">
            <Edit3 :size="14" />
          </button>
          <button class="action-btn action-btn--danger" title="删除" @click="deleteTemplate(template)">
            <Trash2 :size="14" />
          </button>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="showPreviewModal" class="modal-overlay" @click.self="showPreviewModal = false">
        <div class="modal modal--lg">
          <div class="modal__header">
            <h3>模版详情</h3>
            <button class="modal__close" @click="showPreviewModal = false">×</button>
          </div>
          <div class="modal__body">
            <div class="preview-header" :style="{ background: previewTemplate?.accent || '#334155' }">
              <div class="preview-header__content">
                <h2>{{ previewTemplate?.name }}</h2>
                <UiBadge tone="neutral">{{ previewTemplate?.category || '未分类' }}</UiBadge>
              </div>
            </div>

            <div class="preview-info">
              <div class="preview-description">
                <h4>模版描述</h4>
                <p>{{ previewTemplate?.description }}</p>
              </div>

              <div class="preview-features">
                <div
                  v-for="feature in templateFeatures"
                  :key="feature.label"
                  class="feature-item"
                >
                  <div class="feature-item__icon">
                    <component :is="feature.icon" :size="16" />
                  </div>
                  <div class="feature-item__content">
                    <span class="feature-item__label">{{ feature.label }}</span>
                    <span class="feature-item__value">{{ feature.value }}</span>
                  </div>
                </div>
              </div>

              <div class="preview-slides">
                <h4>页面预览</h4>
                <div class="slide-previews">
                  <div
                    v-for="i in Math.min(previewTemplate?.slide_count || 0, 6)"
                    :key="i"
                    class="slide-preview"
                    :style="{ borderColor: previewTemplate?.accent || '#334155' }"
                  >
                    <span class="slide-number">{{ i }}</span>
                  </div>
                  <div v-if="(previewTemplate?.slide_count || 0) > 6" class="slide-more">
                    +{{ (previewTemplate?.slide_count || 0) - 6 }}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="modal__footer">
            <UiButton variant="secondary" @click="showPreviewModal = false">关闭</UiButton>
            <UiButton @click="applyTemplate(previewTemplate!); showPreviewModal = false">
              <Check :size="14" />
              应用模版
            </UiButton>
          </div>
        </div>
      </div>

      <!-- Editor Modal -->
      <div v-if="showEditor" class="modal-overlay" @click.self="showEditor = false">
        <div class="modal modal--lg">
          <div class="modal__header">
            <h3>{{ editingTemplate ? '编辑模版' : '创建模版' }}</h3>
            <button class="modal__close" @click="showEditor = false">×</button>
          </div>
          <div class="modal__body">
            <div class="editor-grid">
              <UiField label="模版名称" required>
                <UiInput v-model="editorForm.name" placeholder="例如：极简商务" />
              </UiField>
              <UiField label="分类">
                <UiInput v-model="editorForm.category" placeholder="例如：商务、教育、创意" />
              </UiField>
            </div>
            <UiField label="描述">
              <textarea v-model="editorForm.description" class="editor-textarea" placeholder="描述模版的适用场景..." rows="2"></textarea>
            </UiField>
            <div class="editor-grid">
              <UiField label="页数">
                <input v-model.number="editorForm.slide_count" type="number" min="3" max="30" class="editor-number" />
              </UiField>
              <UiField label="主题色">
                <div class="color-picker-row">
                  <input v-model="editorForm.accent" type="color" class="color-picker" />
                  <span class="color-value">{{ editorForm.accent }}</span>
                </div>
              </UiField>
            </div>
            <label class="editor-checkbox">
              <input v-model="editorForm.is_public" type="checkbox" />
              <span>公开模版（对其他用户可见）</span>
            </label>
          </div>
          <div class="modal__footer">
            <UiButton variant="secondary" @click="showEditor = false">取消</UiButton>
            <UiButton :disabled="saving || !editorForm.name.trim()" @click="saveTemplate">
              {{ editingTemplate ? '保存' : '创建' }}
            </UiButton>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.template-page {
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

.filters {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.search-bar {
  max-width: 400px;
}

.category-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.category-tab {
  padding: 6px 14px;
  border: 1px solid var(--color-border);
  border-radius: 20px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.category-tab:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.category-tab--active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  color: var(--color-accent);
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

.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.template-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
  overflow: hidden;
  transition: all var(--transition-fast);
}

.template-card:hover {
  border-color: var(--color-border-strong);
  box-shadow: var(--shadow-sm);
}

.template-card--applied {
  border-color: var(--color-accent);
}

.template-card__preview {
  position: relative;
  height: 140px;
  padding: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.template-card__preview-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 160px;
}

.preview-slide {
  height: 20px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.3);
}

.preview-slide--small {
  width: 60%;
  height: 12px;
}

.template-card__applied-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.95);
  color: var(--color-success);
  font-size: 11px;
  font-weight: 600;
}

.template-card__body {
  flex: 1;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.template-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.template-card__name {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

.template-card__description {
  margin: 0;
  font-size: 13px;
  color: var(--color-subtle);
  line-height: 1.5;
}

.template-card__meta {
  display: flex;
  gap: 12px;
  margin-top: 4px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color-muted);
}

.template-card__footer {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--color-border);
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
  max-width: 500px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
}

.modal--lg {
  max-width: 600px;
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
  padding: 0;
}

.modal__footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 16px 20px;
  border-top: 1px solid var(--color-border);
}

.preview-header {
  padding: 24px 20px;
  color: white;
}

.preview-header__content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.preview-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.preview-info {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.preview-description h4 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.preview-description p {
  margin: 0;
  font-size: 14px;
  color: var(--color-text);
  line-height: 1.6;
}

.preview-features {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
}

.feature-item__icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-accent);
}

.feature-item__content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.feature-item__label {
  font-size: 11px;
  color: var(--color-muted);
}

.feature-item__value {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.preview-slides h4 {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.slide-previews {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.slide-preview {
  display: grid;
  place-items: center;
  width: 48px;
  height: 36px;
  border: 2px solid;
  border-radius: 4px;
  background: var(--color-panel);
}

.slide-number {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
}

.slide-more {
  display: grid;
  place-items: center;
  width: 48px;
  height: 36px;
  border-radius: 4px;
  background: var(--color-panel);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-muted);
}

/* Template editor styles */
.editor-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.editor-textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  color: var(--color-text);
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  outline: none;
  transition: border-color var(--transition-fast);
}

.editor-textarea:focus {
  border-color: var(--color-accent);
}

.editor-number {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  color: var(--color-text);
  font-size: 13px;
  outline: none;
  transition: border-color var(--transition-fast);
}

.editor-number:focus {
  border-color: var(--color-accent);
}

.color-picker-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.color-picker {
  width: 36px;
  height: 36px;
  padding: 2px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  cursor: pointer;
}

.color-value {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-muted);
}

.editor-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-muted);
  cursor: pointer;
}

.action-btn {
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
  flex-shrink: 0;
}

.action-btn:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.action-btn--danger:hover {
  border-color: var(--color-danger);
  color: var(--color-danger);
}
</style>
