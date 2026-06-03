<script setup lang="ts">
import { computed, ref } from 'vue';
import { Save, RotateCcw } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
import { useToastStore } from '@/stores/toastStore';
import { useAgentStore } from '@/stores/agentStore';
import type { AgentParameters } from '@/types/agent';

const toastStore = useToastStore();
const store = useAgentStore();

const loading = ref(false);

const paramDefs = [
  {
    key: 'summaryLength' as const,
    label: '摘要长度',
    description: '控制大纲提炼的详略程度。',
    type: 'select' as const,
    options: [
      { value: 'brief', label: '简洁' },
      { value: 'balanced', label: '均衡' },
      { value: 'detailed', label: '详细' }
    ]
  },
  {
    key: 'tone' as const,
    label: '语言风格',
    description: '控制正文、标题和讲稿的表达口吻。',
    type: 'select' as const,
    options: [
      { value: 'professional', label: '专业汇报' },
      { value: 'storytelling', label: '叙事表达' },
      { value: 'teaching', label: '教学讲解' }
    ]
  },
  {
    key: 'imageStyle' as const,
    label: '图像风格',
    description: '控制需要配图时的生成风格。',
    type: 'select' as const,
    options: [
      { value: 'realistic', label: '写实' },
      { value: 'illustration', label: '插画' },
      { value: 'comic', label: '漫画' },
      { value: 'flat', label: '扁平化' },
      { value: '3d', label: '3D' },
      { value: 'photo', label: '摄影' }
    ]
  }
] as const;

type ConfigKey = typeof paramDefs[number]['key'];
const savedValues = ref<Pick<AgentParameters, ConfigKey>>({
  summaryLength: store.parameters.summaryLength,
  tone: store.parameters.tone,
  imageStyle: store.parameters.imageStyle
});

const hasChanges = computed(() => {
  return paramDefs.some(def => store.parameters[def.key] !== savedValues.value[def.key]);
});

function resetConfig() {
  paramDefs.forEach((def) => {
    (store.parameters as any)[def.key] = savedValues.value[def.key];
  });
  toastStore.info('已重置', '配置已恢复到上次保存的状态');
}

async function saveConfig() {
  loading.value = true;
  try {
    store.syncToProject();
    savedValues.value = {
      summaryLength: store.parameters.summaryLength,
      tone: store.parameters.tone,
      imageStyle: store.parameters.imageStyle
    };
    toastStore.success('保存成功', '运行配置已更新');
  } catch (error) {
    toastStore.error('保存失败', error instanceof Error ? error.message : '未知错误');
  } finally {
    loading.value = false;
  }
}

function getParamValue(key: ConfigKey): string {
  return (store.parameters as any)[key];
}

function setParamValue(key: ConfigKey, value: string) {
  (store.parameters as any)[key] = value;
}
</script>

<template>
  <div class="config-page">
    <div class="page-header">
      <div class="page-header__info">
        <h2>运行配置</h2>
        <p>设置 PPT 输入时使用的语言、摘要和图像偏好。</p>
      </div>
      <div class="page-header__actions">
        <UiButton v-if="hasChanges" variant="secondary" @click="resetConfig">
          <RotateCcw :size="14" />
          重置
        </UiButton>
        <UiButton :disabled="!hasChanges || loading" @click="saveConfig">
          <Save :size="14" />
          保存配置
        </UiButton>
      </div>
    </div>

    <div class="param-list">
      <div
        v-for="def in paramDefs"
        :key="def.key"
        class="param-card"
      >
        <div class="param-card__header">
          <div class="param-card__info">
            <h4>{{ def.label }}</h4>
            <div class="param-card__meta">
              <UiBadge tone="neutral" size="sm">输入参数</UiBadge>
            </div>
          </div>
        </div>

        <div class="param-card__body">
          <p class="param-card__description">{{ def.description }}</p>

          <div class="setting-options" role="group" :aria-label="def.label">
            <button
              v-for="option in def.options"
              :key="option.value"
              type="button"
              class="setting-option"
              :class="{ 'setting-option--active': getParamValue(def.key) === option.value }"
              @click="setParamValue(def.key, option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="config-footer">
      <UiButton :disabled="!hasChanges || loading" @click="saveConfig">
        <Save :size="14" />
        保存配置
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.config-page {
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

.page-header__actions {
  display: flex;
  gap: 8px;
}

.param-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.param-card {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  overflow: hidden;
  transition: all var(--transition-fast);
}

.param-card:hover {
  border-color: var(--color-border-strong);
}

.param-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--color-border);
}

.param-card__info h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

.param-card__meta {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.param-card__body {
  padding: 16px;
}

.param-card__description {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--color-muted);
}

.param-card__value {
  margin-top: 8px;
}

.setting-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.setting-option {
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 13px;
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
}

.setting-option:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.setting-option--active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-weight: 700;
}

.config-footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}
</style>
