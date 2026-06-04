<script setup lang="ts">
import { computed } from 'vue';
import { FileText, Image as ImageIcon, Layers, Palette, PenLine, SendHorizontal, SlidersHorizontal, Sparkles, Upload, X } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiField from '@/components/ui/UiField.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiSelect from '@/components/ui/UiSelect.vue';
import UiTextarea from '@/components/ui/UiTextarea.vue';
import type { AgentParameters, ConfigOptionGroups, ConfigOptionKey, DeckInput, PromptDefinition, PptTemplate, TemplateAsset } from '@/types/agent';

const props = defineProps<{
  modelValue: DeckInput;
  parameters: AgentParameters;
  configOptions: ConfigOptionGroups;
  templates: PptTemplate[];
  selectedTemplate: TemplateAsset | null;
  prompts: PromptDefinition[];
  selectedPromptId: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: DeckInput];
  'update:parameters': [value: AgentParameters];
  'select-template': [templateId: string];
  'clear-template': [];
  'select-prompt': [promptId: string];
  attach: [files: FileList | null];
  run: [];
}>();

const fileTypeIcons: Record<string, any> = {
  image: ImageIcon,
  default: FileText
};

const parameterGroups: Array<{ key: ConfigOptionKey; label: string; icon: any }> = [
  { key: 'slideCount', label: '页数', icon: Layers },
  { key: 'summaryLength', label: '摘要', icon: SlidersHorizontal },
  { key: 'tone', label: '语言', icon: PenLine },
  { key: 'imageStyle', label: '图像', icon: Palette },
  { key: 'skillIntensity', label: '增强', icon: Sparkles }
];

const templateOptions = computed(() =>
  props.templates.map((template) => ({
    label: template.name,
    value: template.id,
    description: template.category || template.description || '通用模板'
  }))
);

const selectedTemplateId = computed(() => props.selectedTemplate?.id || '');

const selectedPrompt = computed(() => props.prompts.find((prompt) => prompt.id === props.selectedPromptId) || null);

const promptOptions = computed(() => [
  { label: '不使用提示词', value: '', description: '仅使用主题和资料内容生成' },
  ...props.prompts.map((prompt) => ({
    label: prompt.title,
    value: prompt.id,
    description: compactText(prompt.content || prompt.scene || '暂无提示词内容', 42)
  }))
]);

const autoOptionByKey: Record<ConfigOptionKey, { label: string; value: string; description?: string }> = {
  slideCount: { label: 'AI 自动', value: '0', description: '由内容量决定页数' },
  summaryLength: { label: 'AI 自动', value: 'auto', description: '由内容密度决定详略' },
  tone: { label: 'AI 自动', value: 'auto', description: '由场景决定表达风格' },
  imageStyle: { label: 'AI 自动', value: 'auto', description: '由页面内容决定图像方向' },
  skillIntensity: { label: 'AI 自动', value: '0', description: '由 AI 判断是否增强' }
};

function getParameterOptions(key: ConfigOptionKey): Array<{ label: string; value: string; description?: string }> {
  const configured = props.configOptions[key] || [];
  const autoOption = autoOptionByKey[key];
  return [
    autoOption,
    ...configured.filter((option) => option.value !== autoOption.value)
  ];
}

function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext || '')) {
    return fileTypeIcons.image;
  }
  return fileTypeIcons.default;
}

function updateParameter(key: ConfigOptionKey, value: string) {
  const numericKeys: ConfigOptionKey[] = ['slideCount', 'skillIntensity'];
  emit('update:parameters', {
    ...props.parameters,
    [key]: numericKeys.includes(key) ? Number(value) : value
  });
}

function isParameterActive(key: ConfigOptionKey, value: string) {
  return String(props.parameters[key]) === value;
}

function handleTemplateSelect(templateId: string) {
  if (!templateId) return;
  emit('select-template', templateId);
}

function handlePromptSelect(promptId: string) {
  emit('select-prompt', promptId);
}

function compactText(value: string, maxLength = 88) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
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
  <UiCard title="PPT 输入" subtitle="填写主题、补充资料，并选择本次生成的参数。">
    <div class="input-composer">
      <UiField label="PPT 主题" required>
        <UiInput
          :model-value="modelValue.topic"
          placeholder="例如：智能硬件品牌年度增长计划"
          @update:model-value="$emit('update:modelValue', { ...modelValue, topic: $event })"
        />
      </UiField>

      <UiField label="资料内容">
        <UiTextarea
          :model-value="modelValue.content"
          placeholder="粘贴背景资料、关键观点、会议纪要或补充说明"
          @update:model-value="$emit('update:modelValue', { ...modelValue, content: $event })"
        />
      </UiField>

      <div class="prompt-selector">
        <UiField class="prompt-selector__field" label="提示词">
          <UiSelect
            :model-value="selectedPromptId"
            :options="promptOptions"
            placeholder="选择本次生成使用的提示词"
            @update:model-value="handlePromptSelect"
          />
        </UiField>
        <div v-if="selectedPrompt" class="prompt-selector__preview">
          <strong>{{ selectedPrompt.title }}</strong>
          <span>{{ compactText(selectedPrompt.content) }}</span>
        </div>
        <p v-else class="prompt-selector__hint">可为空；选择后会和资料内容一起发送给 AI。</p>
      </div>

      <div class="template-selector">
        <UiField class="template-selector__field" label="模板方案">
          <UiSelect
            :model-value="selectedTemplateId"
            :options="templateOptions"
            :disabled="templateOptions.length === 0"
            placeholder="选择本 PPT 使用的模板"
            @update:model-value="handleTemplateSelect"
          />
        </UiField>
        <div v-if="selectedTemplate" class="template-selector__active">
          <div class="template-selector__summary">
            <span class="template-selector__dot" :style="{ background: selectedTemplate.accent || '#334155' }"></span>
            <div>
              <strong>{{ selectedTemplate.name }}</strong>
              <p>{{ selectedTemplate.category || selectedTemplate.description || '当前 PPT 将按此模板生成' }}</p>
            </div>
          </div>
          <button type="button" class="template-selector__clear" title="清除模板方案" @click="$emit('clear-template')">
            <X :size="14" />
          </button>
        </div>
        <p v-else class="template-selector__hint">
          {{ templateOptions.length ? '未选择时由 AI 自主设计。' : '模板广场暂无模板。' }}
        </p>
      </div>

      <div class="parameter-panel" aria-label="PPT 生成参数">
        <section
          v-for="group in parameterGroups"
          :key="group.key"
          class="parameter-group"
        >
          <header class="parameter-group__header">
            <component :is="group.icon" :size="15" />
            <span>{{ group.label }}</span>
          </header>
          <div class="parameter-options">
            <button
              v-for="option in getParameterOptions(group.key)"
              :key="option.value"
              type="button"
              class="parameter-option"
              :class="{ 'parameter-option--active': isParameterActive(group.key, option.value) }"
              :title="option.description"
              @click="updateParameter(group.key, option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </section>
      </div>

      <label class="input-composer__upload">
        <Upload :size="16" />
        <span>上传 txt / md / docx / 图片</span>
        <input
          type="file"
          multiple
          accept=".txt,.md,.markdown,.csv,.json,.log,.docx,image/*"
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

.template-selector {
  display: grid;
  gap: 6px;
}

.template-selector__field,
.prompt-selector__field {
  gap: 6px;
}

.prompt-selector {
  display: grid;
  gap: 6px;
}

.template-selector__active,
.prompt-selector__preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 6px 8px;
  background: var(--color-panel);
}

.prompt-selector__preview {
  align-items: flex-start;
  flex-direction: column;
  gap: 3px;
}

.template-selector__summary {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.template-selector__summary strong,
.template-selector__summary p,
.prompt-selector__preview strong,
.prompt-selector__preview span {
  display: block;
  overflow: hidden;
  margin: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-selector__summary strong,
.prompt-selector__preview strong {
  color: var(--color-text);
  font-size: 12px;
  font-weight: 700;
}

.template-selector__summary p,
.template-selector__hint,
.prompt-selector__preview span,
.prompt-selector__hint {
  color: var(--color-muted);
  font-size: 12px;
}

.template-selector__dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.12);
}

.template-selector__clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-card);
  color: var(--color-muted);
  cursor: pointer;
  transition: border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
}

.template-selector__clear:hover {
  border-color: var(--color-danger);
  background: var(--color-danger-soft);
  color: var(--color-danger);
}

.template-selector__hint,
.prompt-selector__hint {
  margin: 0;
  line-height: 1.4;
}

.parameter-panel {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.parameter-group {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.parameter-group__header {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 700;
}

.parameter-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.parameter-option {
  min-height: 32px;
  max-width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0 11px;
  background: var(--color-card);
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
}

.parameter-option:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.parameter-option--active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  color: var(--color-accent-strong);
}

.input-composer__upload {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 48px;
  border: 1.5px dashed var(--color-border-strong);
  border-radius: 8px;
  color: var(--color-muted);
  background: var(--color-surface);
  font-size: 13px;
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
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
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 5px 12px;
  color: var(--color-muted);
  font-size: 12px;
  background: var(--color-panel);
}

@media (max-width: 720px) {
  .parameter-group {
    grid-template-columns: 1fr;
    gap: 6px;
  }
}
</style>
