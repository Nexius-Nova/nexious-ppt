<script setup lang="ts">
import UiField from '@/components/ui/UiField.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiSelect from '@/components/ui/UiSelect.vue';
import UiDivider from '@/components/ui/UiDivider.vue';
import type { AgentParameters, PptTemplate } from '@/types/agent';

defineProps<{
  modelValue: AgentParameters;
  templates?: PptTemplate[];
}>();

defineEmits<{
  'update:modelValue': [value: AgentParameters];
  'select-template': [templateId: string];
}>();

const summaryOptions = [
  { label: '简洁', value: 'brief' },
  { label: '均衡', value: 'balanced' },
  { label: '详细', value: 'detailed' }
];

const toneOptions = [
  { label: '专业汇报', value: 'professional' },
  { label: '叙事表达', value: 'storytelling' },
  { label: '教学讲解', value: 'teaching' }
];

const imageOptions = [
  { label: '写实', value: 'realistic' },
  { label: '插画', value: 'illustration' },
  { label: '漫画', value: 'comic' },
  { label: '扁平化', value: 'flat' }
];

const templateStyleOptions = [
  { label: '商务', value: 'business' },
  { label: '创意', value: 'creative' },
  { label: '教育', value: 'education' }
];
</script>

<template>
  <div class="parameter-panel">
    <div class="parameter-panel__header">
      <h3>运行配置</h3>
      <p>参数会影响文本、图像、模板与 Skill 行为</p>
    </div>

    <div class="parameter-panel__form">
      <UiField label="摘要长度">
        <UiSelect
          :model-value="modelValue.summaryLength"
          :options="summaryOptions"
          @update:model-value="$emit('update:modelValue', { ...modelValue, summaryLength: $event as AgentParameters['summaryLength'] })"
        />
      </UiField>

      <UiField label="页数">
        <UiInput
          type="number"
          :model-value="modelValue.slideCount"
          @update:model-value="$emit('update:modelValue', { ...modelValue, slideCount: Number($event) })"
        />
      </UiField>

      <UiField label="语言风格">
        <UiSelect
          :model-value="modelValue.tone"
          :options="toneOptions"
          @update:model-value="$emit('update:modelValue', { ...modelValue, tone: $event as AgentParameters['tone'] })"
        />
      </UiField>

      <UiDivider />

      <UiField label="图像风格">
        <UiSelect
          :model-value="modelValue.imageStyle"
          :options="imageOptions"
          @update:model-value="$emit('update:modelValue', { ...modelValue, imageStyle: $event as AgentParameters['imageStyle'] })"
        />
      </UiField>

      <UiField label="模板风格" hint="控制整体配色与氛围">
        <UiSelect
          :model-value="modelValue.template"
          :options="templateStyleOptions"
          @update:model-value="$emit('update:modelValue', { ...modelValue, template: $event as AgentParameters['template'] })"
        />
      </UiField>

      <UiField v-if="templates && templates.length > 0" label="选择模版" hint="从模版广场选取预设模版">
        <select
          class="pp-template-select"
          @change="$emit('select-template', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">保持当前</option>
          <option
            v-for="t in templates"
            :key="t.id"
            :value="t.id"
          >
            {{ t.name }}（{{ t.category || '未分类' }} · {{ t.slideCount }}页）
          </option>
        </select>
      </UiField>

      <UiDivider />

      <UiField label="Skill 强度" :hint="`${modelValue.skillIntensity}%`">
        <div class="parameter-panel__range-wrapper">
          <input
            class="parameter-panel__range"
            type="range"
            min="0"
            max="100"
            :value="modelValue.skillIntensity"
            @input="$emit('update:modelValue', { ...modelValue, skillIntensity: Number(($event.target as HTMLInputElement).value) })"
          />
          <span class="parameter-panel__range-value">{{ modelValue.skillIntensity }}%</span>
        </div>
      </UiField>
    </div>
  </div>
</template>

<style scoped>
.parameter-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.parameter-panel__header {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border);
}

.parameter-panel__header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text);
}

.parameter-panel__header p {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--color-subtle);
}

.parameter-panel__form {
  display: grid;
  gap: 14px;
}

.parameter-panel__range-wrapper {
  display: flex;
  align-items: center;
  gap: 12px;
}

.parameter-panel__range {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  border-radius: 999px;
  background: #edf0f3;
  outline: none;
}

.parameter-panel__range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-accent);
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  transition: transform var(--transition-fast);
}

.parameter-panel__range::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

.parameter-panel__range::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-accent);
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.parameter-panel__range-value {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-accent);
  font-variant-numeric: tabular-nums;
  min-width: 32px;
  text-align: right;
}

.pp-template-select {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-panel);
  color: var(--color-text);
  font-size: 12px;
  outline: none;
  cursor: pointer;
  transition: border-color var(--transition-fast);
}

.pp-template-select:hover {
  border-color: var(--color-border-strong);
}

.pp-template-select:focus {
  border-color: var(--color-accent);
}
</style>
