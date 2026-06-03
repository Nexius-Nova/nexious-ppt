<script setup lang="ts">
import { FileText, Image as ImageIcon, SendHorizontal, Upload } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiField from '@/components/ui/UiField.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiTextarea from '@/components/ui/UiTextarea.vue';
import UiSelect from '@/components/ui/UiSelect.vue';
import ModelSelector from '@/components/common/ModelSelector.vue';
import type { AgentParameters, ConfigOptionGroups, DeckInput } from '@/types/agent';

defineProps<{
  modelValue: DeckInput;
  parameters: AgentParameters;
  configOptions: ConfigOptionGroups;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: DeckInput];
  'update:parameters': [value: AgentParameters];
  attach: [files: FileList | null];
  run: [];
}>();

const fileTypeIcons: Record<string, any> = {
  image: ImageIcon,
  default: FileText
};

function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext || '')) {
    return fileTypeIcons.image;
  }
  return fileTypeIcons.default;
}

function handleRun() {
  emit('run');
}

function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement;
  emit('attach', target.files);
  target.value = '';
}
</script>

<template>
  <UiCard title="PPT 输入" subtitle="整理主题和资料，开始生成 PPT。">
    <template #actions>
      <ModelSelector type="text" />
    </template>

    <div class="input-composer">
      <UiField label="PPT 主题" required>
        <UiInput
          :model-value="modelValue.topic"
          placeholder="例如：智能硬件品牌年度增长计划"
          @update:model-value="$emit('update:modelValue', { ...modelValue, topic: $event })"
        />
      </UiField>

      <UiField label="关键内容 / 资料摘要">
        <UiTextarea
          :model-value="modelValue.content"
          :rows="6"
          placeholder="粘贴背景资料、关键观点、会议纪要或补充说明"
          @update:model-value="$emit('update:modelValue', { ...modelValue, content: $event })"
        />
      </UiField>

      <div class="input-composer__params">
        <UiField label="摘要长度">
          <UiSelect
            :model-value="parameters.summaryLength"
            :options="configOptions.summaryLength"
            @update:model-value="$emit('update:parameters', { ...parameters, summaryLength: $event })"
          />
        </UiField>
        <UiField label="语言风格">
          <UiSelect
            :model-value="parameters.tone"
            :options="configOptions.tone"
            @update:model-value="$emit('update:parameters', { ...parameters, tone: $event })"
          />
        </UiField>
        <UiField label="图像风格">
          <UiSelect
            :model-value="parameters.imageStyle"
            :options="configOptions.imageStyle"
            @update:model-value="$emit('update:parameters', { ...parameters, imageStyle: $event })"
          />
        </UiField>
      </div>

      <label class="input-composer__upload">
        <Upload :size="16" />
        <span>上传 txt / md / pdf / word / 图片</span>
        <input
          type="file"
          multiple
          accept=".txt,.md,.markdown,.csv,.json,.log,.pdf,.doc,.docx,image/*"
          @change="handleFileChange"
        />
      </label>

      <div v-if="modelValue.files.length" class="input-composer__files">
        <span v-for="file in modelValue.files" :key="file" class="input-composer__file-tag">
          <component :is="getFileIcon(file)" :size="12" />
          {{ file }}
        </span>
      </div>

      <UiButton 
        variant="primary" 
        size="lg" 
        block 
        @click="handleRun"
      >
        <SendHorizontal :size="16" />
        开始生成 PPT
      </UiButton>
    </div>
  </UiCard>
</template>

<style scoped>
.input-composer {
  display: grid;
  gap: var(--space-4);
}

.input-composer__upload {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 48px;
  border: 1.5px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
  color: var(--color-muted);
  background: var(--color-surface);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.input-composer__upload:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.input-composer__upload input {
  display: none;
}

.input-composer__files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.input-composer__file-tag {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 5px 12px;
  color: var(--color-muted);
  font-size: 12px;
  background: var(--color-panel);
}

.input-composer__params {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

@media (max-width: 640px) {
  .input-composer__params {
    grid-template-columns: 1fr;
  }
}
</style>
