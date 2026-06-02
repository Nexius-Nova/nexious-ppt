<script setup lang="ts">
import { computed, ref } from 'vue';
import { Save, RotateCcw } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
import { useToastStore } from '@/stores/toastStore';
import { useAgentStore } from '@/stores/agentStore';

const toastStore = useToastStore();
const store = useAgentStore();

const loading = ref(false);

const paramDefs = [
  {
    key: 'template' as const,
    label: '模板风格',
    description: '选择 PPT 模板的整体风格',
    type: 'select' as const,
    options: [
      { value: 'business', label: '商务' },
      { value: 'creative', label: '创意' },
      { value: 'education', label: '教育' }
    ]
  },
  {
    key: 'skillIntensity' as const,
    label: 'Skill 强度',
    description: '控制 AI 技能对内容的影响程度',
    type: 'number' as const,
    min: 0,
    max: 100
  }
] as const;

const originalValues = computed(() => {
  return paramDefs.map(def => store.parameters[def.key]);
});

const hasChanges = computed(() => {
  return paramDefs.some((def, i) => store.parameters[def.key] !== originalValues.value[i]);
});

function resetConfig() {
  paramDefs.forEach((def, i) => {
    (store.parameters as any)[def.key] = originalValues.value[i];
  });
  toastStore.info('已重置', '配置已恢复到上次保存的状态');
}

async function saveConfig() {
  loading.value = true;
  try {
    store.syncToProject();
    toastStore.success('保存成功', '运行配置已更新');
  } catch (error) {
    toastStore.error('保存失败', error instanceof Error ? error.message : '未知错误');
  } finally {
    loading.value = false;
  }
}

function getParamValue(key: string): string | number {
  return (store.parameters as any)[key];
}

function setParamValue(key: string, value: string | number) {
  (store.parameters as any)[key] = value;
}
</script>

<template>
  <div class="config-page">
    <div class="page-header">
      <div class="page-header__info">
        <h2>运行配置</h2>
        <p>自定义 PPT 生成的各项参数</p>
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
              <UiBadge tone="neutral" size="sm">{{ def.key }}</UiBadge>
              <UiBadge tone="info" size="sm">{{ def.type === 'select' ? '选项' : '数字' }}</UiBadge>
            </div>
          </div>
        </div>

        <div class="param-card__body">
          <p class="param-card__description">{{ def.description }}</p>

          <div class="param-card__value">
            <template v-if="def.type === 'number'">
              <div class="number-input">
                <input
                  :value="getParamValue(def.key)"
                  type="range"
                  :min="def.min"
                  :max="def.max"
                  class="slider"
                  @input="setParamValue(def.key, Number(($event.target as HTMLInputElement).value))"
                />
                <div class="number-value">
                  <span class="value">{{ getParamValue(def.key) }}</span>
                  <span class="range">({{ def.min }} - {{ def.max }})</span>
                </div>
              </div>
            </template>

            <template v-else-if="def.type === 'select'">
              <div class="select-grid">
                <button
                  v-for="opt in def.options"
                  :key="opt.value"
                  class="select-option"
                  :class="{ 'select-option--active': getParamValue(def.key) === opt.value }"
                  @click="setParamValue(def.key, opt.value)"
                >
                  {{ opt.label }}
                </button>
              </div>
            </template>
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

.number-input {
  display: flex;
  align-items: center;
  gap: 16px;
}

.slider {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--color-border);
  appearance: none;
  cursor: pointer;
}

.slider::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-accent);
  cursor: pointer;
  transition: transform var(--transition-fast);
}

.slider::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

.number-value {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 80px;
}

.number-value .value {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text);
  font-family: var(--font-mono);
}

.number-value .range {
  font-size: 12px;
  color: var(--color-muted);
}

.select-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.select-option {
  padding: 8px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.select-option:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.select-option--active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.config-footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}
</style>
