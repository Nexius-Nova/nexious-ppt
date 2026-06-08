<script setup lang="ts">
import { storeToRefs } from 'pinia';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Cpu,
  Edit3,
  Eye,
  EyeOff,
  Image,
  Key,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  X,
  Zap
} from 'lucide-vue-next';
import { computed, ref, onMounted } from 'vue';
import UiAlert from '@/components/ui/UiAlert.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiButton from '@/components/ui/UiButton.vue';
import UiFeedbackState from '@/components/ui/UiFeedbackState.vue';
import UiField from '@/components/ui/UiField.vue';
import UiInput from '@/components/ui/UiInput.vue';
import DeleteConfirmModal from '@/components/common/DeleteConfirmModal.vue';
import PageLoadingState from '@/components/common/PageLoadingState.vue';
import { useApiKeyStore } from '@/stores/apiKeyStore';
import { useToastStore } from '@/stores/toastStore';
import { aiApi } from '@/services/api';
import type { ImageModelConfig, TextModelConfig } from '@/types/agent';

type ModelType = 'text' | 'image';
type ManagedModel = TextModelConfig | ImageModelConfig;

const apiKeyStore = useApiKeyStore();
const toastStore = useToastStore();
const emit = defineEmits<{
  changed: [];
}>();
const {
  textModels,
  imageModels,
  activeTextModel,
  activeImageModel,
  isFullyConfigured,
  loading,
  initialized,
  loadError
} = storeToRefs(apiKeyStore);

const activeTab = ref<ModelType>('text');
const showModal = ref(false);
const showDeleteModal = ref(false);
const editingModel = ref<(ManagedModel & { type: ModelType }) | null>(null);
const modelToDelete = ref<(ManagedModel & { type: ModelType }) | null>(null);
const formData = ref({
  name: '',
  model: '',
  apiKey: '',
  baseUrl: '',
  type: 'text' as ModelType
});
const showApiKey = ref(false);
const testingModel = ref<string | null>(null);

const currentModels = computed<ManagedModel[]>(() => activeTab.value === 'text' ? textModels.value : imageModels.value);
const currentActiveModel = computed<ManagedModel | undefined>(() => activeTab.value === 'text' ? activeTextModel.value : activeImageModel.value);
const modelHealthItems = computed(() => [
  {
    id: 'text',
    label: '文本模型',
    value: textModels.value.length,
    ready: textModels.value.some((model) => model.hasKey),
    icon: Cpu
  },
  {
    id: 'image',
    label: '图片模型',
    value: imageModels.value.length,
    ready: imageModels.value.some((model) => model.hasKey),
    icon: Image
  },
  {
    id: 'default',
    label: '默认连接',
    value: [activeTextModel.value, activeImageModel.value].filter(Boolean).length,
    ready: Boolean(activeTextModel.value && activeImageModel.value),
    icon: CheckCircle2
  }
]);

onMounted(() => {
  apiKeyStore.fetchApiKeys();
});

function openCreateModal(type: ModelType) {
  editingModel.value = null;
  formData.value = {
    name: '',
    model: '',
    apiKey: '',
    baseUrl: '',
    type
  };
  showModal.value = true;
}

function openEditModal(model: ManagedModel, type: ModelType) {
  editingModel.value = { ...model, type };
  formData.value = {
    name: model.name,
    model: model.model,
    apiKey: '',
    baseUrl: model.baseUrl || '',
    type
  };
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
  editingModel.value = null;
  showApiKey.value = false;
}

async function saveModel() {
  if (!formData.value.name.trim()) {
    toastStore.warning('请填写名称', '名称不能为空');
    return;
  }

  if (!formData.value.model.trim()) {
    toastStore.warning('请填写模型名称', '模型名称不能为空');
    return;
  }

  if (!editingModel.value && !formData.value.apiKey) {
    toastStore.warning('请填写 API Key', 'API Key 不能为空');
    return;
  }

  const modelData = {
    name: formData.value.name,
    provider: 'custom' as const,
    model: formData.value.model,
    apiKey: formData.value.apiKey || undefined,
    baseUrl: formData.value.baseUrl || undefined
  };

  if (editingModel.value) {
    if (formData.value.type === 'text') {
      await apiKeyStore.updateTextModel(editingModel.value.id, modelData);
    } else {
      await apiKeyStore.updateImageModel(editingModel.value.id, modelData);
    }
    toastStore.success('保存成功', '模型配置已更新');
  } else {
    if (formData.value.type === 'text') {
      await apiKeyStore.addTextModel(modelData);
    } else {
      await apiKeyStore.addImageModel(modelData);
    }
    toastStore.success('添加成功', '新模型已添加');
  }

  closeModal();
  emit('changed');
}

function deleteModel(model: ManagedModel) {
  modelToDelete.value = { ...model, type: activeTab.value };
  showDeleteModal.value = true;
}

function closeDeleteModal() {
  if (loading.value) return;
  showDeleteModal.value = false;
  modelToDelete.value = null;
}

async function confirmDeleteModel() {
  if (!modelToDelete.value) return;

  const target = modelToDelete.value;
  if (target.type === 'text') {
    await apiKeyStore.deleteTextModel(target.id);
  } else {
    await apiKeyStore.deleteImageModel(target.id);
  }

  showDeleteModal.value = false;
  modelToDelete.value = null;
  emit('changed');
}

async function setActiveModel(model: ManagedModel) {
  if (activeTab.value === 'text') {
    await apiKeyStore.setActiveTextModel(model.id);
  } else {
    await apiKeyStore.setActiveImageModel(model.id);
  }
  emit('changed');
}

async function testModel(model: ManagedModel, type: ModelType) {
  testingModel.value = model.id;
  try {
    if (type === 'text') {
      const originalActive = activeTextModel.value?.id;
      await apiKeyStore.setActiveTextModel(model.id);
      const response = await aiApi.testTextModel();
      if (originalActive) await apiKeyStore.setActiveTextModel(originalActive);
      response.success
        ? toastStore.success('测试成功', response.message || '连接成功')
        : toastStore.error('测试失败', response.message || '未知错误');
    } else {
      const originalActive = activeImageModel.value?.id;
      await apiKeyStore.setActiveImageModel(model.id);
      const response = await aiApi.testImageModel();
      if (originalActive) await apiKeyStore.setActiveImageModel(originalActive);
      response.success
        ? toastStore.success('测试成功', response.message || '连接成功')
        : toastStore.error('测试失败', response.message || '未知错误');
    }
  } catch (error) {
    toastStore.error('测试失败', error instanceof Error ? error.message : '未知错误');
  } finally {
    testingModel.value = null;
  }
}

function formatDate(timestamp: number) {
  if (!timestamp) return '暂无记录';
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getProviderLabel(model: ManagedModel) {
  return model.provider === 'custom' ? '自定义' : String(model.provider || '未知');
}
</script>

<template>
  <div class="model-page">
    <section class="model-hero">
      <div class="model-hero__copy">
        <span class="model-hero__eyebrow">模型管理</span>
        <h2>管理 PPT 生成所需的模型连接</h2>
        <p>文本模型负责理解和生成内容，图像模型负责页面配图。这里只管理连接，不参与工作流风格选择。</p>
      </div>
      <div class="model-health">
        <div
          v-for="item in modelHealthItems"
          :key="item.id"
          class="model-health__item"
          :class="{ 'model-health__item--ready': item.ready }"
        >
          <component :is="item.icon" :size="15" />
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </div>
      </div>
      <div class="model-hero__status" :class="{ 'model-hero__status--ready': isFullyConfigured }">
        <component :is="isFullyConfigured ? ShieldCheck : AlertTriangle" :size="20" />
        <div>
          <strong>{{ isFullyConfigured ? '可正常生成' : '需要补齐配置' }}</strong>
          <span>{{ isFullyConfigured ? '文本和图像模型均已配置' : '至少配置一个文本模型和一个图像模型' }}</span>
        </div>
      </div>
    </section>

    <UiAlert v-if="!isFullyConfigured && initialized" tone="warning" title="模型配置未完成">
      请至少配置一个文本模型和一个图像模型，避免生成 PPT 时中断。
    </UiAlert>

    <section class="model-workbench">
      <main class="model-list-panel">
        <div class="model-list-panel__header">
          <div>
            <h3>{{ activeTab === 'text' ? '文本模型列表' : '图像模型列表' }}</h3>
            <p>选择默认连接，或测试、编辑已有模型。</p>
          </div>
          <div class="model-list-panel__tools">
            <div class="model-tabs" aria-label="模型类型">
              <button
                type="button"
                :class="{ 'model-tabs__item--active': activeTab === 'text' }"
                @click="activeTab = 'text'"
              >
                <Cpu :size="14" />
                文本
                <span>{{ textModels.length }}</span>
              </button>
              <button
                type="button"
                :class="{ 'model-tabs__item--active': activeTab === 'image' }"
                @click="activeTab = 'image'"
              >
                <Image :size="14" />
                图像
                <span>{{ imageModels.length }}</span>
              </button>
            </div>
            <UiButton variant="secondary" size="sm" @click="openCreateModal(activeTab)">
              <Plus :size="13" />
              添加
            </UiButton>
          </div>
        </div>

        <PageLoadingState v-if="loading" compact title="正在加载模型配置" description="正在同步文本和图像模型连接" />

        <UiFeedbackState
          v-else-if="loadError && textModels.length === 0 && imageModels.length === 0"
          tone="error"
          title="模型配置加载失败"
          :description="loadError"
          action-label="重试"
          :loading="loading"
          @action="apiKeyStore.fetchApiKeys"
        />

        <div v-else-if="currentModels.length === 0" class="empty-models">
          <component :is="activeTab === 'text' ? Cpu : Image" :size="28" />
          <strong>还没有{{ activeTab === 'text' ? '文本' : '图像' }}模型</strong>
          <span>添加一个模型后即可用于 PPT 生成。</span>
          <UiButton variant="primary" size="sm" @click="openCreateModal(activeTab)">
            <Plus :size="13" />
            添加模型
          </UiButton>
        </div>

        <div v-else class="model-list">
          <article
            v-for="model in currentModels"
            :key="model.id"
            class="model-card"
          >
            <div class="model-card__main">
              <div class="model-card__mark">
                <component :is="activeTab === 'text' ? Cpu : Image" :size="18" />
              </div>
              <div class="model-card__content">
                <div class="model-card__title-row">
                  <h4>{{ model.name }}</h4>
                  <UiBadge v-if="model.id === currentActiveModel?.id" tone="accent" size="sm">当前使用</UiBadge>
                </div>
                <div class="model-card__meta">
                  <code>{{ model.model }}</code>
                  <span>{{ getProviderLabel(model) }}</span>
                  <span>{{ model.baseUrl || '默认地址' }}</span>
                </div>
              </div>
            </div>

            <div class="model-card__state">
              <UiBadge :tone="model.hasKey ? 'success' : 'warning'" size="sm">
                {{ model.hasKey ? '密钥已保存' : '缺少密钥' }}
              </UiBadge>
              <span>更新于 {{ formatDate(model.updatedAt) }}</span>
            </div>

            <div class="model-card__actions">
              <button
                v-if="model.id !== currentActiveModel?.id"
                class="icon-button"
                title="设为当前使用"
                @click="setActiveModel(model)"
              >
                <CheckCircle2 :size="14" />
              </button>
              <button
                class="icon-button icon-button--test"
                title="测试连接"
                :disabled="testingModel === model.id"
                @click="testModel(model, activeTab)"
              >
                <Loader2 v-if="testingModel === model.id" :size="14" class="animate-spin" />
                <Zap v-else :size="14" />
              </button>
              <button class="icon-button" title="编辑" @click="openEditModal(model, activeTab)">
                <Edit3 :size="14" />
              </button>
              <button
                v-if="currentModels.length > 1"
                class="icon-button icon-button--danger"
                title="删除"
                @click="deleteModel(model)"
              >
                <Trash2 :size="14" />
              </button>
            </div>
          </article>
        </div>
      </main>
    </section>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
        <div class="modal">
          <div class="modal__header">
            <div>
              <h3>{{ editingModel ? '编辑模型' : `添加${formData.type === 'text' ? '文本' : '图像'}模型` }}</h3>
              <p>{{ formData.type === 'text' ? '用于大纲、页面和文案生成' : '用于生成页面配图' }}</p>
            </div>
            <button class="modal__close" @click="closeModal">
              <X :size="16" />
            </button>
          </div>

          <div class="modal__body">
            <UiField label="名称" required>
              <UiInput v-model="formData.name" placeholder="例如：GPT-4o 主力" />
            </UiField>

            <UiField label="模型名称" required>
              <UiInput v-model="formData.model" placeholder="例如：gpt-4o、dall-e-3" />
            </UiField>

            <UiField :label="editingModel ? 'API Key（留空保持不变）' : 'API Key'" :required="!editingModel">
              <div class="api-key-input">
                <Key :size="14" class="api-key-input__icon" />
                <input
                  v-model="formData.apiKey"
                  :type="showApiKey ? 'text' : 'password'"
                  :placeholder="editingModel ? '留空保持不变' : 'sk-...'"
                  class="api-key-input__field"
                />
                <button type="button" class="api-key-input__toggle" @click="showApiKey = !showApiKey">
                  <Eye v-if="!showApiKey" :size="14" />
                  <EyeOff v-else :size="14" />
                </button>
              </div>
            </UiField>

            <UiField label="Base URL">
              <UiInput v-model="formData.baseUrl" placeholder="https://api.example.com/v1" />
            </UiField>
          </div>

          <div class="modal__footer">
            <UiButton variant="secondary" @click="closeModal">取消</UiButton>
            <UiButton @click="saveModel">
              <Check :size="14" />
              {{ editingModel ? '保存' : '添加' }}
            </UiButton>
          </div>
        </div>
      </div>
    </Teleport>

    <DeleteConfirmModal
      :open="showDeleteModal"
      :item-name="modelToDelete?.name || ''"
      :loading="loading"
      @close="closeDeleteModal"
      @confirm="confirmDeleteModel"
    />
  </div>
</template>

<style scoped>
.model-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
  padding: 20px;
  margin: 0 auto;
}

.model-hero {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(260px, 380px) minmax(220px, 300px);
  gap: 12px;
  align-items: center;
  padding: 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.model-hero__copy {
  min-width: 0;
}

.model-hero__eyebrow {
  display: block;
  margin-bottom: 5px;
  color: var(--color-accent);
  font-size: 12px;
  font-weight: 700;
}

.model-hero h2 {
  margin: 0;
  color: var(--color-text);
  font-size: 18px;
  line-height: 1.3;
}

.model-hero p {
  max-width: 660px;
  margin: 6px 0 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.55;
}

.model-health {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  min-width: 0;
}

.model-health__item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 42px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 8px;
  color: var(--color-warning);
  background: var(--color-panel);
}

.model-health__item--ready {
  color: var(--color-success);
}

.model-health__item span {
  overflow: hidden;
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-health__item strong {
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 13px;
}

.model-hero__status {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: 52px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-warning);
  background: var(--color-warning-soft);
}

.model-hero__status--ready {
  color: var(--color-success);
  background: var(--color-success-soft);
}

.model-hero__status strong,
.model-hero__status span {
  display: block;
}

.model-hero__status strong {
  color: var(--color-text);
  font-size: 13px;
}

.model-hero__status span {
  margin-top: 3px;
  color: var(--color-muted);
  font-size: 12px;
}

.model-workbench {
  display: block;
}

.model-list-panel {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  min-width: 0;
  padding: 16px;
  background: var(--color-surface);
}

.model-list-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.model-list-panel h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 15px;
}

.model-list-panel p {
  margin: 5px 0 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.6;
}

.model-list-panel__tools {
  display: flex;
  align-items: center;
  gap: 10px;
}

.model-tabs {
  display: inline-flex;
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
}

.model-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  color: var(--color-muted);
  background: transparent;
  font-size: 12px;
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.model-tabs button:hover {
  color: var(--color-text);
  background: var(--color-surface);
}

.model-tabs__item--active {
  color: var(--color-text) !important;
  background: var(--color-surface) !important;
  box-shadow: var(--shadow-sm);
}

.model-tabs span {
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 999px;
  color: var(--color-subtle);
  background: var(--color-card);
  font-family: var(--font-mono);
  font-size: 11px;
  text-align: center;
}

.loading-state,
.empty-models {
  display: grid;
  place-items: center;
  gap: 10px;
  min-height: 220px;
  color: var(--color-muted);
  font-size: 13px;
}

.empty-models {
  border: 1px dashed var(--color-border-strong);
  border-radius: 8px;
  background: var(--color-panel);
  text-align: center;
}

.empty-models strong {
  color: var(--color-text);
  font-size: 15px;
}

.empty-models span {
  color: var(--color-muted);
  font-size: 12px;
}

.model-list {
  display: grid;
  gap: 10px;
}

.model-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 12px;
  align-items: center;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-card);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast);
}

.model-card:hover {
  border-color: var(--color-border-strong);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}

.model-card__main {
  display: flex;
  gap: 12px;
  min-width: 0;
  align-items: flex-start;
}

.model-card__mark {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-accent);
  background: var(--color-panel);
}

.model-card__content,
.model-card__title-row,
.model-card__meta {
  min-width: 0;
}

.model-card__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-card h4 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: 14px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  color: var(--color-muted);
  font-size: 12px;
}

.model-card__meta code,
.model-card__meta span {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-card__meta code {
  padding: 2px 6px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text);
  background: var(--color-panel);
  font-family: var(--font-mono);
  font-size: 11px;
}

.model-card__state {
  display: grid;
  justify-items: end;
  gap: 6px;
  min-width: 110px;
  color: var(--color-subtle);
  font-size: 11px;
}

.model-card__actions {
  display: flex;
  gap: 4px;
}

.icon-button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-muted);
  background: var(--color-surface);
  cursor: pointer;
  transition: border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
}

.icon-button:hover:not(:disabled) {
  border-color: var(--color-border-strong);
  color: var(--color-text);
  background: var(--color-panel);
}

.icon-button--test:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.icon-button--danger:hover:not(:disabled) {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
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
  backdrop-filter: blur(4px);
}

.modal {
  width: min(100%, 500px);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
}

.modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
}

.modal__header h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 16px;
}

.modal__header p {
  margin: 4px 0 0;
  color: var(--color-muted);
  font-size: 12px;
}

.modal__close {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--color-muted);
  background: transparent;
  cursor: pointer;
}

.modal__close:hover {
  border-color: var(--color-border);
  color: var(--color-text);
  background: var(--color-panel);
}

.modal__body {
  display: grid;
  gap: 16px;
  padding: 20px;
}

.modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px;
  border-top: 1px solid var(--color-border);
}

.api-key-input {
  position: relative;
  display: flex;
  align-items: center;
}

.api-key-input__icon {
  position: absolute;
  left: 12px;
  color: var(--color-muted);
}

.api-key-input__field {
  width: 100%;
  padding: 9px 44px 9px 36px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-text);
  background: var(--color-panel);
  font-size: 13px;
  transition: border-color var(--transition-fast), background var(--transition-fast);
}

.api-key-input__field:focus {
  outline: none;
  border-color: var(--color-accent);
  background: var(--color-surface);
}

.api-key-input__toggle {
  position: absolute;
  right: 8px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  color: var(--color-muted);
  background: transparent;
  cursor: pointer;
}

.api-key-input__toggle:hover {
  color: var(--color-text);
  background: var(--color-surface);
}

@media (max-width: 980px) {
  .model-hero {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .model-page {
    gap: 12px;
    padding: 14px 12px 18px;
  }

  .model-list-panel__header,
  .model-list-panel__tools,
  .model-card,
  .model-card__state {
    align-items: stretch;
  }

  .model-list-panel__header,
  .model-list-panel__tools {
    flex-direction: column;
  }

  .model-tabs,
  .model-list-panel__tools :deep(.ui-button) {
    width: 100%;
  }

  .model-tabs button {
    flex: 1;
    justify-content: center;
  }

  .model-card {
    grid-template-columns: 1fr;
    gap: 10px;
    padding: 12px;
  }

  .model-card__main {
    gap: 10px;
  }

  .model-card__mark {
    width: 36px;
    height: 36px;
  }

  .model-card__title-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }

  .model-card__meta code,
  .model-card__meta span {
    max-width: 100%;
  }

  .model-card__state {
    justify-items: start;
    min-width: 0;
  }

  .model-card__actions {
    justify-content: flex-end;
  }

  .loading-state,
  .empty-models {
    min-height: 180px;
    padding: 24px 12px;
  }

  .modal {
    max-height: calc(100svh - 24px);
    overflow: auto;
  }

  .modal__header,
  .modal__body,
  .modal__footer {
    padding-left: 16px;
    padding-right: 16px;
  }

  .modal__footer {
    flex-direction: column-reverse;
  }

  .modal__footer :deep(.ui-button) {
    width: 100%;
  }

  .model-card {
    grid-template-columns: 1fr;
  }

  .model-card__state {
    justify-items: start;
  }

  .model-card__actions {
    justify-content: flex-start;
  }
}
</style>
