<script setup lang="ts">
import { computed } from 'vue';
import { ChevronDown, Bot, Image, Check } from 'lucide-vue-next';
import { ref, onMounted, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useApiKeyStore } from '@/stores/apiKeyStore';
import {
  TEXT_MODEL_PROVIDERS,
  IMAGE_MODEL_PROVIDERS,
  TEXT_MODELS,
  IMAGE_MODELS
} from '@/types/agent';

const props = defineProps<{
  type: 'text' | 'image';
}>();

const apiKeyStore = useApiKeyStore();
const { textModels, imageModels, activeTextModel, activeImageModel } = storeToRefs(apiKeyStore);

const isOpen = ref(false);
const selectorRef = ref<HTMLElement | null>(null);

const models = computed(() => props.type === 'text' ? textModels.value : imageModels.value);
const activeModel = computed(() => props.type === 'text' ? activeTextModel.value : activeImageModel.value);

const providers = computed(() => props.type === 'text' ? TEXT_MODEL_PROVIDERS : IMAGE_MODEL_PROVIDERS);
const modelDefinitions = computed(() => props.type === 'text' ? TEXT_MODELS : IMAGE_MODELS);

function getProviderLabel(provider: string): string {
  if (provider === 'custom') {
    return '自定义';
  }
  return providers.value.find(p => p.value === provider)?.label || provider;
}

function getModelLabel(model: string, provider: string): string {
  if (provider === 'custom') {
    return model;
  }
  const providerModels = modelDefinitions.value[provider as keyof typeof modelDefinitions.value] || [];
  return providerModels.find(m => m.value === model)?.label || model;
}

function toggleDropdown() {
  isOpen.value = !isOpen.value;
}

function selectModel(id: string) {
  if (props.type === 'text') {
    apiKeyStore.setActiveTextModel(id);
  } else {
    apiKeyStore.setActiveImageModel(id);
  }
  isOpen.value = false;
}

function handleClickOutside(event: MouseEvent) {
  if (selectorRef.value && !selectorRef.value.contains(event.target as Node)) {
    isOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<template>
  <div ref="selectorRef" class="model-selector" :class="{ 'model-selector--open': isOpen }">
    <button
      type="button"
      class="model-selector__trigger"
      @click="toggleDropdown"
    >
      <component :is="type === 'text' ? Bot : Image" :size="14" class="model-selector__icon" />
      <span class="model-selector__name">{{ activeModel?.name || '选择模型' }}</span>
      <ChevronDown :size="12" class="model-selector__chevron" :class="{ 'model-selector__chevron--rotated': isOpen }" />
    </button>

    <Transition name="dropdown">
      <div v-show="isOpen" class="model-selector__dropdown">
        <div class="model-selector__header">
          {{ type === 'text' ? '文本模型' : '图像模型' }}
        </div>
        <div class="model-selector__options">
          <button
            v-for="model in models"
            :key="model.id"
            type="button"
            class="model-selector__option"
            :class="{ 'model-selector__option--active': model.id === activeModel?.id }"
            @click="selectModel(model.id)"
          >
            <div class="model-selector__option-content">
              <div class="model-selector__option-name">
                {{ model.name }}
                <span v-if="!model.apiKey" class="model-selector__option-badge">未配置</span>
              </div>
              <div class="model-selector__option-meta">
                {{ getProviderLabel(model.provider) }} · {{ getModelLabel(model.model, model.provider) }}
              </div>
            </div>
            <Check v-if="model.id === activeModel?.id" :size="14" class="model-selector__check" />
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.model-selector {
  position: relative;
}

.model-selector__trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 12px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.model-selector__trigger:hover {
  border-color: var(--color-border-strong);
}

.model-selector--open .model-selector__trigger {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-accent-soft);
}

.model-selector__icon {
  color: var(--color-accent);
}

.model-selector__name {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}

.model-selector__chevron {
  color: var(--color-muted);
  transition: transform var(--transition-fast);
}

.model-selector__chevron--rotated {
  transform: rotate(180deg);
}

.model-selector__dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  min-width: 220px;
  z-index: 1000;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
  overflow: hidden;
}

.model-selector__header {
  padding: 10px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-subtle);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--color-border);
}

.model-selector__options {
  max-height: 240px;
  overflow-y: auto;
  padding: 6px;
}

.model-selector__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.model-selector__option:hover {
  background: var(--color-panel);
}

.model-selector__option--active {
  background: var(--color-accent-soft);
}

.model-selector__option--active:hover {
  background: var(--color-accent-soft);
}

.model-selector__option-content {
  flex: 1;
  min-width: 0;
}

.model-selector__option-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
}

.model-selector__option-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--color-warning-soft);
  color: var(--color-warning);
}

.model-selector__option-meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-subtle);
}

.model-selector__check {
  flex-shrink: 0;
  color: var(--color-accent);
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
</style>
