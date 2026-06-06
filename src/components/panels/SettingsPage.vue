<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { Check, AlertTriangle, Trash2, Plus, Edit3, X, CheckCircle2, ChevronDown, Zap, Loader2 } from 'lucide-vue-next';
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiField from '@/components/ui/UiField.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiSelect from '@/components/ui/UiSelect.vue';
import UiButton from '@/components/ui/UiButton.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiAlert from '@/components/ui/UiAlert.vue';
import UiDivider from '@/components/ui/UiDivider.vue';
import PageLoadingState from '@/components/common/PageLoadingState.vue';
import { useApiKeyStore } from '@/stores/apiKeyStore';
import { useToastStore } from '@/stores/toastStore';
import { aiApi } from '@/services/api';
import {
  TEXT_MODEL_PROVIDERS,
  IMAGE_MODEL_PROVIDERS,
  TEXT_MODELS,
  IMAGE_MODELS
} from '@/types/agent';

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
const editingTextModelId = ref<string | null>(null);
const editingImageModelId = ref<string | null>(null);

const newTextInput = ref({
  name: '',
  provider: 'openai' as any,
  model: 'gpt-4o',
  apiKey: '',
  baseUrl: ''
});

const newImageInput = ref({
  name: '',
  provider: 'openai' as any,
  model: 'dall-e-3',
  apiKey: '',
  baseUrl: ''
});

const editingTextModel = computed(() => 
  editingTextModelId.value ? textModels.value.find(m => m.id === editingTextModelId.value) : null
);

const editingImageModel = computed(() => 
  editingImageModelId.value ? imageModels.value.find(m => m.id === editingImageModelId.value) : null
);

const showTextModelDropdown = ref(false);
const showImageModelDropdown = ref(false);
const textModelDropdownRef = ref<HTMLElement | null>(null);
const imageModelDropdownRef = ref<HTMLElement | null>(null);

onMounted(() => {
  apiKeyStore.fetchApiKeys();
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});

function handleClickOutside(event: MouseEvent) {
  if (textModelDropdownRef.value && !textModelDropdownRef.value.contains(event.target as Node)) {
    showTextModelDropdown.value = false;
  }
  if (imageModelDropdownRef.value && !imageModelDropdownRef.value.contains(event.target as Node)) {
    showImageModelDropdown.value = false;
  }
}

function startEditingTextModel(id: string) {
  editingTextModelId.value = id;
}

function startEditingImageModel(id: string) {
  editingImageModelId.value = id;
}

function cancelEditing() {
  editingTextModelId.value = null;
  editingImageModelId.value = null;
}

async function handleTextProviderChange(value: string) {
  if (editingTextModelId.value) {
    await apiKeyStore.setTextModelProvider(editingTextModelId.value, value as any);
  } else {
    newTextInput.value.provider = value;
    const models = TEXT_MODELS[value as keyof typeof TEXT_MODELS];
    if (models && models.length > 0) {
      newTextInput.value.model = models[0].value;
    } else {
      newTextInput.value.model = '';
    }
  }
}

async function handleImageProviderChange(value: string) {
  if (editingImageModelId.value) {
    await apiKeyStore.setImageModelProvider(editingImageModelId.value, value as any);
  } else {
    newImageInput.value.provider = value;
    const models = IMAGE_MODELS[value as keyof typeof IMAGE_MODELS];
    if (models && models.length > 0) {
      newImageInput.value.model = models[0].value;
    } else {
      newImageInput.value.model = '';
    }
  }
}

function selectTextModel(model: string) {
  newTextInput.value.model = model;
  showTextModelDropdown.value = false;
}

function selectImageModel(model: string) {
  newImageInput.value.model = model;
  showImageModelDropdown.value = false;
}

async function addNewTextModel() {
  if (!newTextInput.value.apiKey) {
    return;
  }
  
  const result = await apiKeyStore.addTextModel({
    name: newTextInput.value.name,
    provider: newTextInput.value.provider,
    model: newTextInput.value.model,
    apiKey: newTextInput.value.apiKey,
    baseUrl: newTextInput.value.baseUrl
  });
  
  if (result) {
    newTextInput.value = {
      name: '',
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: '',
      baseUrl: ''
    };
  }
}

async function addNewImageModel() {
  if (!newImageInput.value.apiKey) {
    return;
  }
  
  const result = await apiKeyStore.addImageModel({
    name: newImageInput.value.name,
    provider: newImageInput.value.provider,
    model: newImageInput.value.model,
    apiKey: newImageInput.value.apiKey,
    baseUrl: newImageInput.value.baseUrl
  });
  
  if (result) {
    newImageInput.value = {
      name: '',
      provider: 'openai',
      model: 'dall-e-3',
      apiKey: '',
      baseUrl: ''
    };
  }
}

async function deleteTextModel(id: string) {
  await apiKeyStore.deleteTextModel(id);
  if (editingTextModelId.value === id) {
    editingTextModelId.value = null;
  }
}

async function deleteImageModel(id: string) {
  await apiKeyStore.deleteImageModel(id);
  if (editingImageModelId.value === id) {
    editingImageModelId.value = null;
  }
}

async function setActiveTextModel(id: string) {
  await apiKeyStore.setActiveTextModel(id);
}

async function setActiveImageModel(id: string) {
  await apiKeyStore.setActiveImageModel(id);
}

function getProviderLabel(provider: string, type: 'text' | 'image'): string {
  const providers = type === 'text' ? TEXT_MODEL_PROVIDERS : IMAGE_MODEL_PROVIDERS;
  return providers.find(p => p.value === provider)?.label || provider;
}

function getModelLabel(model: string, provider: string, type: 'text' | 'image'): string {
  const models = type === 'text' ? TEXT_MODELS : IMAGE_MODELS;
  const providerModels = models[provider as keyof typeof models] || [];
  return providerModels.find(m => m.value === model)?.label || model;
}

const newTextModelOptions = computed(() => {
  return TEXT_MODELS[newTextInput.value.provider as keyof typeof TEXT_MODELS] || [];
});

const newImageModelOptions = computed(() => {
  return IMAGE_MODELS[newImageInput.value.provider as keyof typeof IMAGE_MODELS] || [];
});

const testingTextModel = ref(false);
const testingImageModel = ref(false);

async function testTextModel() {
  if (!isTextModelConfigured.value) {
    toastStore.warning('未配置文本模型', '请先添加文本模型的 API Key');
    return;
  }
  
  testingTextModel.value = true;
  try {
    const response = await aiApi.testTextModel();
    if (response.success && response.data?.success) {
      toastStore.success('测试成功', response.data.message);
    } else {
      toastStore.error('测试失败', response.data?.message || '未知错误');
    }
  } catch (error) {
    toastStore.error('测试失败', error instanceof Error ? error.message : '未知错误');
  } finally {
    testingTextModel.value = false;
  }
}

async function testImageModel() {
  if (!isImageModelConfigured.value) {
    toastStore.warning('未配置图像模型', '请先添加图像模型的 API Key');
    return;
  }
  
  testingImageModel.value = true;
  try {
    const response = await aiApi.testImageModel();
    if (response.success && response.data?.success) {
      toastStore.success('测试成功', response.data.message);
    } else {
      toastStore.error('测试失败', response.data?.message || '未知错误');
    }
  } catch (error) {
    toastStore.error('测试失败', error instanceof Error ? error.message : '未知错误');
  } finally {
    testingImageModel.value = false;
  }
}
</script>

<template>
  <div class="settings-page">
    <div class="settings-header">
      <h2>设置</h2>
      <p>配置 API Key 和模型参数</p>
    </div>

    <UiAlert v-if="!isFullyConfigured && initialized" tone="warning" title="需要配置 API Key">
      请配置文本模型和图像模型的 API Key，以便正常使用 AI PPT 生成功能。
    </UiAlert>

    <div class="tabs">
      <button 
        class="tab" 
        :class="{ 'tab--active': activeTab === 'text' }"
        @click="activeTab = 'text'"
      >
        文本模型
        <UiBadge v-if="textModels.length > 0" tone="info" size="sm">{{ textModels.length }}</UiBadge>
      </button>
      <button 
        class="tab" 
        :class="{ 'tab--active': activeTab === 'image' }"
        @click="activeTab = 'image'"
      >
        图像模型
        <UiBadge v-if="imageModels.length > 0" tone="info" size="sm">{{ imageModels.length }}</UiBadge>
      </button>
    </div>

    <template v-if="activeTab === 'text'">
      <PageLoadingState v-if="loading" compact title="正在加载文本模型" description="正在同步文本模型配置" />
      
      <div v-else class="model-list">
        <div 
          v-for="model in textModels" 
          :key="model.id" 
          class="model-card"
          :class="{ 
            'model-card--active': model.id === activeTextModel?.id,
            'model-card--editing': editingTextModelId === model.id
          }"
        >
          <template v-if="editingTextModelId === model.id">
            <div class="model-edit-form">
              <div class="model-edit-header">
                <h4>编辑模型</h4>
                <button class="btn-icon" @click="cancelEditing">
                  <X :size="14" />
                </button>
              </div>
              
              <UiField label="名称">
                <UiInput
                  :model-value="model.name"
                  placeholder="模型名称"
                  @update:model-value="apiKeyStore.updateTextModel(model.id, { name: $event })"
                />
              </UiField>

              <UiField label="服务商">
                <UiSelect
                  :model-value="model.provider"
                  :options="TEXT_MODEL_PROVIDERS"
                  @update:model-value="handleTextProviderChange"
                />
              </UiField>

              <UiField label="模型">
                <div ref="textModelDropdownRef" class="model-combobox">
                  <input
                    :value="model.model"
                    type="text"
                    placeholder="选择或输入模型名称"
                    class="model-combobox__input"
                    @input="apiKeyStore.updateTextModel(model.id, { model: ($event.target as HTMLInputElement).value })"
                    @focus="showTextModelDropdown = true"
                  />
                  <button 
                    class="model-combobox__toggle"
                    @click="showTextModelDropdown = !showTextModelDropdown"
                  >
                    <ChevronDown :size="14" :class="{ 'rotated': showTextModelDropdown }" />
                  </button>
                  <Transition name="dropdown">
                    <div v-if="showTextModelDropdown && TEXT_MODELS[model.provider as keyof typeof TEXT_MODELS]?.length" class="model-combobox__dropdown">
                      <button
                        v-for="opt in TEXT_MODELS[model.provider as keyof typeof TEXT_MODELS]"
                        :key="opt.value"
                        type="button"
                        class="model-combobox__option"
                        :class="{ 'model-combobox__option--selected': opt.value === model.model }"
                        @click="apiKeyStore.updateTextModel(model.id, { model: opt.value }); showTextModelDropdown = false"
                      >
                        <span class="model-combobox__option-label">{{ opt.label }}</span>
                        <span v-if="opt.description" class="model-combobox__option-desc">{{ opt.description }}</span>
                      </button>
                    </div>
                  </Transition>
                </div>
              </UiField>

              <UiField label="API Key">
                <div class="api-key-input">
                  <input
                    type="password"
                    placeholder="输入新的 API Key（留空保持不变）"
                    class="api-key-input__field"
                    @change="apiKeyStore.updateTextModel(model.id, { apiKey: ($event.target as HTMLInputElement).value })"
                  />
                </div>
              </UiField>

              <UiField v-if="model.provider === 'custom'" label="Base URL">
                <UiInput
                  :model-value="model.baseUrl"
                  placeholder="https://api.example.com/v1"
                  @update:model-value="apiKeyStore.updateTextModel(model.id, { baseUrl: $event })"
                />
              </UiField>

              <div class="model-edit-actions">
                <UiButton variant="secondary" size="sm" @click="cancelEditing">
                  取消
                </UiButton>
                <UiButton variant="primary" size="sm" @click="cancelEditing">
                  保存
                </UiButton>
              </div>
            </div>
          </template>
          
          <template v-else>
            <div class="model-card-header">
              <div class="model-card-info">
                <h4>{{ model.name }}</h4>
                <div class="model-card-meta">
                  <span class="model-provider">{{ getProviderLabel(model.provider, 'text') }}</span>
                  <span class="model-name">{{ getModelLabel(model.model, model.provider, 'text') }}</span>
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
                <button class="btn-icon" title="编辑" @click="startEditingTextModel(model.id)">
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
          </template>
        </div>
      </div>

      <div v-if="isTextModelConfigured" class="test-section">
        <UiButton 
          variant="secondary" 
          :disabled="testingTextModel"
          @click="testTextModel"
        >
          <Loader2 v-if="testingTextModel" :size="14" class="animate-spin" />
          <Zap v-else :size="14" />
          {{ testingTextModel ? '测试中...' : '测试连接' }}
        </UiButton>
      </div>

      <UiCard title="添加新模型" subtitle="配置新的文本模型">
        <div class="add-form">
          <UiField label="名称">
            <UiInput
              v-model="newTextInput.name"
              placeholder="例如：GPT-4o 主力"
            />
          </UiField>

          <UiField label="服务商">
            <UiSelect
              :model-value="newTextInput.provider"
              :options="TEXT_MODEL_PROVIDERS"
              @update:model-value="handleTextProviderChange"
            />
          </UiField>

          <UiField label="模型">
            <div ref="textModelDropdownRef" class="model-combobox">
              <input
                v-model="newTextInput.model"
                type="text"
                placeholder="选择或输入模型名称"
                class="model-combobox__input"
                @focus="showTextModelDropdown = true"
              />
              <button 
                class="model-combobox__toggle"
                @click="showTextModelDropdown = !showTextModelDropdown"
              >
                <ChevronDown :size="14" :class="{ 'rotated': showTextModelDropdown }" />
              </button>
              <Transition name="dropdown">
                <div v-if="showTextModelDropdown && newTextModelOptions.length > 0" class="model-combobox__dropdown">
                  <button
                    v-for="opt in newTextModelOptions"
                    :key="opt.value"
                    type="button"
                    class="model-combobox__option"
                    :class="{ 'model-combobox__option--selected': opt.value === newTextInput.model }"
                    @click="selectTextModel(opt.value)"
                  >
                    <span class="model-combobox__option-label">{{ opt.label }}</span>
                    <span v-if="opt.description" class="model-combobox__option-desc">{{ opt.description }}</span>
                  </button>
                </div>
              </Transition>
            </div>
          </UiField>

          <UiField label="API Key" required>
            <div class="api-key-input">
              <input
                v-model="newTextInput.apiKey"
                type="password"
                placeholder="sk-..."
                class="api-key-input__field"
              />
            </div>
          </UiField>

          <UiField v-if="newTextInput.provider === 'custom'" label="Base URL">
            <UiInput
              v-model="newTextInput.baseUrl"
              placeholder="https://api.example.com/v1"
            />
          </UiField>

          <UiButton 
            variant="primary" 
            block 
            :disabled="!newTextInput.apiKey || loading"
            @click="addNewTextModel"
          >
            <Plus :size="14" />
            添加文本模型
          </UiButton>
        </div>
      </UiCard>
    </template>

    <template v-if="activeTab === 'image'">
      <PageLoadingState v-if="loading" compact title="正在加载图像模型" description="正在同步图像模型配置" />
      
      <div v-else class="model-list">
        <div 
          v-for="model in imageModels" 
          :key="model.id" 
          class="model-card"
          :class="{ 
            'model-card--active': model.id === activeImageModel?.id,
            'model-card--editing': editingImageModelId === model.id
          }"
        >
          <template v-if="editingImageModelId === model.id">
            <div class="model-edit-form">
              <div class="model-edit-header">
                <h4>编辑模型</h4>
                <button class="btn-icon" @click="cancelEditing">
                  <X :size="14" />
                </button>
              </div>
              
              <UiField label="名称">
                <UiInput
                  :model-value="model.name"
                  placeholder="模型名称"
                  @update:model-value="apiKeyStore.updateImageModel(model.id, { name: $event })"
                />
              </UiField>

              <UiField label="服务商">
                <UiSelect
                  :model-value="model.provider"
                  :options="IMAGE_MODEL_PROVIDERS"
                  @update:model-value="handleImageProviderChange"
                />
              </UiField>

              <UiField label="模型">
                <div ref="imageModelDropdownRef" class="model-combobox">
                  <input
                    :value="model.model"
                    type="text"
                    placeholder="选择或输入模型名称"
                    class="model-combobox__input"
                    @input="apiKeyStore.updateImageModel(model.id, { model: ($event.target as HTMLInputElement).value })"
                    @focus="showImageModelDropdown = true"
                  />
                  <button 
                    class="model-combobox__toggle"
                    @click="showImageModelDropdown = !showImageModelDropdown"
                  >
                    <ChevronDown :size="14" :class="{ 'rotated': showImageModelDropdown }" />
                  </button>
                  <Transition name="dropdown">
                    <div v-if="showImageModelDropdown && IMAGE_MODELS[model.provider as keyof typeof IMAGE_MODELS]?.length" class="model-combobox__dropdown">
                      <button
                        v-for="opt in IMAGE_MODELS[model.provider as keyof typeof IMAGE_MODELS]"
                        :key="opt.value"
                        type="button"
                        class="model-combobox__option"
                        :class="{ 'model-combobox__option--selected': opt.value === model.model }"
                        @click="apiKeyStore.updateImageModel(model.id, { model: opt.value }); showImageModelDropdown = false"
                      >
                        <span class="model-combobox__option-label">{{ opt.label }}</span>
                        <span v-if="opt.description" class="model-combobox__option-desc">{{ opt.description }}</span>
                      </button>
                    </div>
                  </Transition>
                </div>
              </UiField>

              <UiField label="API Key">
                <div class="api-key-input">
                  <input
                    type="password"
                    placeholder="输入新的 API Key（留空保持不变）"
                    class="api-key-input__field"
                    @change="apiKeyStore.updateImageModel(model.id, { apiKey: ($event.target as HTMLInputElement).value })"
                  />
                </div>
              </UiField>

              <UiField v-if="model.provider === 'custom'" label="Base URL">
                <UiInput
                  :model-value="model.baseUrl"
                  placeholder="https://api.example.com/v1"
                  @update:model-value="apiKeyStore.updateImageModel(model.id, { baseUrl: $event })"
                />
              </UiField>

              <div class="model-edit-actions">
                <UiButton variant="secondary" size="sm" @click="cancelEditing">
                  取消
                </UiButton>
                <UiButton variant="primary" size="sm" @click="cancelEditing">
                  保存
                </UiButton>
              </div>
            </div>
          </template>
          
          <template v-else>
            <div class="model-card-header">
              <div class="model-card-info">
                <h4>{{ model.name }}</h4>
                <div class="model-card-meta">
                  <span class="model-provider">{{ getProviderLabel(model.provider, 'image') }}</span>
                  <span class="model-name">{{ getModelLabel(model.model, model.provider, 'image') }}</span>
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
                <button class="btn-icon" title="编辑" @click="startEditingImageModel(model.id)">
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
          </template>
        </div>
      </div>

      <div v-if="isImageModelConfigured" class="test-section">
        <UiButton 
          variant="secondary" 
          :disabled="testingImageModel"
          @click="testImageModel"
        >
          <Loader2 v-if="testingImageModel" :size="14" class="animate-spin" />
          <Zap v-else :size="14" />
          {{ testingImageModel ? '测试中...' : '测试连接' }}
        </UiButton>
      </div>

      <UiCard title="添加新模型" subtitle="配置新的图像模型">
        <div class="add-form">
          <UiField label="名称">
            <UiInput
              v-model="newImageInput.name"
              placeholder="例如：DALL-E 3 主力"
            />
          </UiField>

          <UiField label="服务商">
            <UiSelect
              :model-value="newImageInput.provider"
              :options="IMAGE_MODEL_PROVIDERS"
              @update:model-value="handleImageProviderChange"
            />
          </UiField>

          <UiField label="模型">
            <div ref="imageModelDropdownRef" class="model-combobox">
              <input
                v-model="newImageInput.model"
                type="text"
                placeholder="选择或输入模型名称"
                class="model-combobox__input"
                @focus="showImageModelDropdown = true"
              />
              <button 
                class="model-combobox__toggle"
                @click="showImageModelDropdown = !showImageModelDropdown"
              >
                <ChevronDown :size="14" :class="{ 'rotated': showImageModelDropdown }" />
              </button>
              <Transition name="dropdown">
                <div v-if="showImageModelDropdown && newImageModelOptions.length > 0" class="model-combobox__dropdown">
                  <button
                    v-for="opt in newImageModelOptions"
                    :key="opt.value"
                    type="button"
                    class="model-combobox__option"
                    :class="{ 'model-combobox__option--selected': opt.value === newImageInput.model }"
                    @click="selectImageModel(opt.value)"
                  >
                    <span class="model-combobox__option-label">{{ opt.label }}</span>
                    <span v-if="opt.description" class="model-combobox__option-desc">{{ opt.description }}</span>
                  </button>
                </div>
              </Transition>
            </div>
          </UiField>

          <UiField label="API Key" required>
            <div class="api-key-input">
              <input
                v-model="newImageInput.apiKey"
                type="password"
                placeholder="sk-..."
                class="api-key-input__field"
              />
            </div>
          </UiField>

          <UiField v-if="newImageInput.provider === 'custom'" label="Base URL">
            <UiInput
              v-model="newImageInput.baseUrl"
              placeholder="https://api.example.com/v1"
            />
          </UiField>

          <UiButton 
            variant="primary" 
            block 
            :disabled="!newImageInput.apiKey || loading"
            @click="addNewImageModel"
          >
            <Plus :size="14" />
            添加图像模型
          </UiButton>
        </div>
      </UiCard>
    </template>

    <div class="settings-footer">
      <div class="settings-status">
        <component
          :is="isFullyConfigured ? Check : AlertTriangle"
          :size="14"
          :class="isFullyConfigured ? 'status-icon--success' : 'status-icon--warning'"
        />
        <span>{{ isFullyConfigured ? '所有 API Key 已配置' : '请完成 API Key 配置' }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 600px;
  margin: 0 auto;
}

.settings-header {
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-border);
}

.settings-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text);
}

.settings-header p {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--color-subtle);
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

.model-card--editing {
  padding: 20px;
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

.model-provider {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--color-panel);
  font-weight: 500;
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

.btn-icon:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.btn-icon--danger:hover {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.model-edit-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.model-edit-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.model-edit-header h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

.model-edit-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.add-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.api-key-input {
  position: relative;
}

.api-key-input__field {
  width: 100%;
  padding: 8px 12px;
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

.model-combobox {
  position: relative;
}

.model-combobox__input {
  width: 100%;
  padding: 8px 36px 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  color: var(--color-text);
  font-size: 13px;
  transition: all var(--transition-fast);
}

.model-combobox__input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.model-combobox__toggle {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.model-combobox__toggle .rotated {
  transform: rotate(180deg);
}

.model-combobox__dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 1000;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
}

.model-combobox__option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.model-combobox__option:hover {
  background: var(--color-panel);
}

.model-combobox__option--selected {
  background: var(--color-accent-soft);
}

.model-combobox__option-label {
  font-size: 13px;
  font-weight: 500;
}

.model-combobox__option-desc {
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-subtle);
}

.settings-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}

.settings-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-muted);
}

.status-icon--success {
  color: var(--color-success);
}

.status-icon--warning {
  color: var(--color-warning);
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.15s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.test-section {
  display: flex;
  justify-content: center;
  padding: 12px 0;
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
</style>
