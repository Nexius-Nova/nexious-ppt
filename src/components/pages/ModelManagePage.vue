<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { Check, AlertTriangle, Trash2, Plus, Edit3, X, CheckCircle2, Zap, Loader2, Cpu, Image, Key, Eye, EyeOff } from 'lucide-vue-next';
import { ref, onMounted } from 'vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiField from '@/components/ui/UiField.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiButton from '@/components/ui/UiButton.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiAlert from '@/components/ui/UiAlert.vue';
import { useApiKeyStore } from '@/stores/apiKeyStore';
import { useToastStore } from '@/stores/toastStore';
import { aiApi } from '@/services/api';

const apiKeyStore = useApiKeyStore();
const toastStore = useToastStore();
const {
  textModels,
  imageModels,
  activeTextModel,
  activeImageModel,
  isTextModelConfigured,
  isImageModelConfigured,
  isFullyConfigured,
  loading,
  initialized
} = storeToRefs(apiKeyStore);

const activeTab = ref<'text' | 'image'>('text');

const showModal = ref(false);
const editingModel = ref<any>(null);
const formData = ref({
  name: '',
  model: '',
  apiKey: '',
  baseUrl: '',
  type: 'text' as 'text' | 'image'
});

const showApiKey = ref(false);

onMounted(() => {
  apiKeyStore.fetchApiKeys();
});

function openCreateModal(type: 'text' | 'image') {
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

function openEditModal(model: any, type: 'text' | 'image') {
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
}

async function deleteTextModel(id: string) {
  await apiKeyStore.deleteTextModel(id);
}

async function deleteImageModel(id: string) {
  await apiKeyStore.deleteImageModel(id);
}

async function setActiveTextModel(id: string) {
  await apiKeyStore.setActiveTextModel(id);
}

async function setActiveImageModel(id: string) {
  await apiKeyStore.setActiveImageModel(id);
}

const testingModel = ref<string | null>(null);

async function testModel(model: any, type: 'text' | 'image') {
  testingModel.value = model.id;
  try {
    if (type === 'text') {
      const originalActive = activeTextModel.value?.id;
      await apiKeyStore.setActiveTextModel(model.id);
      const response = await aiApi.testTextModel();
      if (originalActive) {
        await apiKeyStore.setActiveTextModel(originalActive);
      }
      if (response.success) {
        toastStore.success('测试成功', response.message || '连接成功');
      } else {
        toastStore.error('测试失败', response.message || '未知错误');
      }
    } else {
      const originalActive = activeImageModel.value?.id;
      await apiKeyStore.setActiveImageModel(model.id);
      const response = await aiApi.testImageModel();
      if (originalActive) {
        await apiKeyStore.setActiveImageModel(originalActive);
      }
      if (response.success) {
        toastStore.success('测试成功', response.message || '连接成功');
      } else {
        toastStore.error('测试失败', response.message || '未知错误');
      }
    }
  } catch (error) {
    toastStore.error('测试失败', error instanceof Error ? error.message : '未知错误');
  } finally {
    testingModel.value = null;
  }
}
</script>

<template>
  <div class="model-page">
    <div class="page-header">
      <div class="page-header__info">
        <h2>模型管理</h2>
        <p>配置和管理 AI 文本模型与图像模型</p>
      </div>
      <div class="page-header__status">
        <component
          :is="isFullyConfigured ? Check : AlertTriangle"
          :size="16"
          :class="isFullyConfigured ? 'status-icon--success' : 'status-icon--warning'"
        />
        <span>{{ isFullyConfigured ? '已配置完成' : '需要配置' }}</span>
      </div>
    </div>

    <UiAlert v-if="!isFullyConfigured && initialized" tone="warning" title="需要配置模型">
      请配置文本模型和图像模型，以便正常使用 AI PPT 生成功能。
    </UiAlert>

    <div class="tabs">
      <button 
        class="tab" 
        :class="{ 'tab--active': activeTab === 'text' }"
        @click="activeTab = 'text'"
      >
        <Cpu :size="16" />
        文本模型
        <UiBadge v-if="textModels.length > 0" tone="info" size="sm">{{ textModels.length }}</UiBadge>
      </button>
      <button 
        class="tab" 
        :class="{ 'tab--active': activeTab === 'image' }"
        @click="activeTab = 'image'"
      >
        <Image :size="16" />
        图像模型
        <UiBadge v-if="imageModels.length > 0" tone="info" size="sm">{{ imageModels.length }}</UiBadge>
      </button>
    </div>

    <template v-if="activeTab === 'text'">
      <div v-if="loading" class="loading-state">
        加载中...
      </div>
      
      <div v-else class="model-list">
        <div 
          v-for="model in textModels" 
          :key="model.id" 
          class="model-card"
          :class="{ 'model-card--active': model.id === activeTextModel?.id }"
        >
          <div class="model-card-header">
            <div class="model-card-info">
              <h4>{{ model.name }}</h4>
              <div class="model-card-meta">
                <span class="model-name">{{ model.model }}</span>
              </div>
            </div>
            <div class="model-card-actions">
              <button 
                v-if="model.id !== activeTextModel?.id" 
                class="btn-icon" 
                title="设为当前使用"
                @click="setActiveTextModel(model.id)"
              >
                <CheckCircle2 :size="14" />
              </button>
              <button 
                class="btn-icon btn-icon--test" 
                title="测试连接"
                :disabled="testingModel === model.id"
                @click="testModel(model, 'text')"
              >
                <Loader2 v-if="testingModel === model.id" :size="14" class="animate-spin" />
                <Zap v-else :size="14" />
              </button>
              <button class="btn-icon" title="编辑" @click="openEditModal(model, 'text')">
                <Edit3 :size="14" />
              </button>
              <button 
                v-if="textModels.length > 1" 
                class="btn-icon btn-icon--danger" 
                title="删除"
                @click="deleteTextModel(model.id)"
              >
                <Trash2 :size="14" />
              </button>
            </div>
          </div>
          <div class="model-card-status">
            <UiBadge :tone="model.hasKey ? 'success' : 'warning'" size="sm">
              {{ model.hasKey ? '已配置' : '未配置' }}
            </UiBadge>
          </div>
        </div>
      </div>

      <UiButton class="add-btn" @click="openCreateModal('text')">
        <Plus :size="14" />
        添加文本模型
      </UiButton>
    </template>

    <template v-if="activeTab === 'image'">
      <div v-if="loading" class="loading-state">
        加载中...
      </div>
      
      <div v-else class="model-list">
        <div 
          v-for="model in imageModels" 
          :key="model.id" 
          class="model-card"
          :class="{ 'model-card--active': model.id === activeImageModel?.id }"
        >
          <div class="model-card-header">
            <div class="model-card-info">
              <h4>{{ model.name }}</h4>
              <div class="model-card-meta">
                <span class="model-name">{{ model.model }}</span>
              </div>
            </div>
            <div class="model-card-actions">
              <button 
                v-if="model.id !== activeImageModel?.id" 
                class="btn-icon" 
                title="设为当前使用"
                @click="setActiveImageModel(model.id)"
              >
                <CheckCircle2 :size="14" />
              </button>
              <button 
                class="btn-icon btn-icon--test" 
                title="测试连接"
                :disabled="testingModel === model.id"
                @click="testModel(model, 'image')"
              >
                <Loader2 v-if="testingModel === model.id" :size="14" class="animate-spin" />
                <Zap v-else :size="14" />
              </button>
              <button class="btn-icon" title="编辑" @click="openEditModal(model, 'image')">
                <Edit3 :size="14" />
              </button>
              <button 
                v-if="imageModels.length > 1" 
                class="btn-icon btn-icon--danger" 
                title="删除"
                @click="deleteImageModel(model.id)"
              >
                <Trash2 :size="14" />
              </button>
            </div>
          </div>
          <div class="model-card-status">
            <UiBadge :tone="model.hasKey ? 'success' : 'warning'" size="sm">
              {{ model.hasKey ? '已配置' : '未配置' }}
            </UiBadge>
          </div>
        </div>
      </div>

      <UiButton class="add-btn" @click="openCreateModal('image')">
        <Plus :size="14" />
        添加图像模型
      </UiButton>
    </template>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
        <div class="modal">
          <div class="modal__header">
            <h3>{{ editingModel ? '编辑模型' : `添加${formData.type === 'text' ? '文本' : '图像'}模型` }}</h3>
            <button class="modal__close" @click="closeModal">×</button>
          </div>
          <div class="modal__body">
            <UiField label="名称" required>
              <UiInput
                v-model="formData.name"
                placeholder="例如：GPT-4o 主力"
              />
            </UiField>

            <UiField label="模型名称" required>
              <UiInput
                v-model="formData.model"
                placeholder="例如：gpt-4o、dall-e-3"
              />
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
                <button 
                  class="api-key-input__toggle"
                  @click="showApiKey = !showApiKey"
                >
                  <Eye v-if="!showApiKey" :size="14" />
                  <EyeOff v-else :size="14" />
                </button>
              </div>
            </UiField>

            <UiField label="Base URL">
              <UiInput
                v-model="formData.baseUrl"
                placeholder="https://api.example.com/v1"
              />
            </UiField>
          </div>
          <div class="modal__footer">
            <UiButton variant="secondary" @click="closeModal">取消</UiButton>
            <UiButton @click="saveModel">
              {{ editingModel ? '保存' : '添加' }}
            </UiButton>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.model-page {
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

.page-header__status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--color-panel);
  font-size: 13px;
  color: var(--color-muted);
}

.status-icon--success {
  color: var(--color-success);
}

.status-icon--warning {
  color: var(--color-warning);
}

.tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-panel);
}

.tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-muted);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.tab:hover {
  color: var(--color-text);
  background: var(--color-surface);
}

.tab--active {
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-sm);
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: var(--color-muted);
  font-size: 14px;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.model-card {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  padding: 16px;
  transition: all var(--transition-fast);
}

.model-card:hover {
  border-color: var(--color-border-strong);
}

.model-card--active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.model-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.model-card-info h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

.model-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-muted);
}

.model-name {
  color: var(--color-subtle);
}

.model-card-actions {
  display: flex;
  gap: 4px;
}

.model-card-status {
  margin-top: 12px;
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

.btn-icon:hover:not(:disabled) {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.btn-icon--danger:hover:not(:disabled) {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.btn-icon--test:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.btn-icon:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.add-btn {
  align-self: flex-start;
}

.animate-spin {
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
  max-width: 480px;
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
  padding: 8px 72px 8px 36px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  color: var(--color-text);
  font-size: 13px;
  transition: all var(--transition-fast);
}

.api-key-input__field:focus {
  outline: none;
  border-color: var(--color-accent);
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
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.api-key-input__toggle:hover {
  color: var(--color-text);
}
</style>
