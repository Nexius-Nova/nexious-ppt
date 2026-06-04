<script setup lang="ts">
import { computed, ref } from 'vue';
import { FileText, Image as ImageIcon, Layers, Palette, PenLine, SendHorizontal, SlidersHorizontal, Sparkles, Upload, X } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiField from '@/components/ui/UiField.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiSelect from '@/components/ui/UiSelect.vue';
import UiTextarea from '@/components/ui/UiTextarea.vue';
import TemplatePreviewDeck from '@/components/common/TemplatePreviewDeck.vue';
import type { AgentParameters, ConfigOptionGroups, ConfigOptionKey, DeckInput, PromptDefinition, PptTemplate, TemplateAsset, TemplateAssetSettings } from '@/types/agent';

type TemplatePreviewSlide = NonNullable<TemplateAssetSettings['previewSlides']>[number];

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

const previewingTemplateSlide = ref<{ slide: TemplatePreviewSlide; index: number } | null>(null);
const previewingPromptImage = ref<PromptDefinition | null>(null);

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
    description: template.category || template.description || '通用模板',
    previewSlides: template.settings?.previewSlides || [],
    accent: template.accent
  }))
);

const templateSelectOptions = computed(() => [
  { label: '不使用参考模板', value: '', description: '由 AI 根据主题和资料自主设计' },
  ...templateOptions.value
]);

const selectedTemplateId = computed(() => props.selectedTemplate?.id || '');

const selectedPrompt = computed(() => props.prompts.find((prompt) => prompt.id === props.selectedPromptId) || null);

const promptOptions = computed(() => [
  { label: '不使用提示词', value: '', description: '仅使用主题和资料内容生成' },
  ...props.prompts.map((prompt) => ({
    label: prompt.title,
    value: prompt.id,
    description: compactText(prompt.content || prompt.scene || '暂无提示词内容', 42),
    previewImageUrl: prompt.previewUrl
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
  if (!templateId) {
    emit('clear-template');
    return;
  }
  emit('select-template', templateId);
}

function handlePromptSelect(promptId: string) {
  emit('select-prompt', promptId);
}

function compactText(value: string, maxLength = 88) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function normalizePreviewSvg(svg: string) {
  const baseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
  return svg
    .replace(/(<image\b[^>]*?\s(?:href|xlink:href)=["'])\.?\/generated-images\//gi, `$1${baseUrl}/generated-images/`)
    .replace(/(<image\b[^>]*?\s(?:href|xlink:href)=["'])generated-images\//gi, `$1${baseUrl}/generated-images/`);
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
          <button
            v-if="selectedPrompt.previewUrl"
            type="button"
            class="prompt-selector__image"
            title="预览提示词效果图"
            @click="previewingPromptImage = selectedPrompt"
          >
            <img :src="selectedPrompt.previewUrl" :alt="`${selectedPrompt.title} 效果图`" />
          </button>
          <div v-else class="prompt-selector__image prompt-selector__image--empty" aria-hidden="true">
            <ImageIcon :size="26" />
            <span>暂无效果图</span>
          </div>
          <div class="prompt-selector__preview-copy">
            <strong>{{ selectedPrompt.title }}</strong>
            <span>{{ compactText(selectedPrompt.content || selectedPrompt.scene || '当前提示词将参与本次生成') }}</span>
          </div>
        </div>
        <p v-else class="prompt-selector__hint">可为空；选择后会和资料内容一起发送给 AI。</p>
      </div>

      <div class="template-selector">
        <UiField class="template-selector__field" label="参考模板">
          <UiSelect
            :model-value="selectedTemplateId"
            :options="templateSelectOptions"
            placeholder="选择本 PPT 使用的模板"
            @update:model-value="handleTemplateSelect"
          />
        </UiField>
        <div v-if="selectedTemplate" class="template-selector__preview">
          <TemplatePreviewDeck
            v-if="selectedTemplate.settings.previewSlides?.length"
            :slides="selectedTemplate.settings.previewSlides"
            :accent="selectedTemplate.accent"
            variant="panel"
            interactive
            @preview="(slide, index) => { previewingTemplateSlide = { slide, index }; }"
          />
          <div class="template-selector__preview-copy">
            <strong>{{ selectedTemplate.name }}</strong>
            <span>{{ compactText(selectedTemplate.description || selectedTemplate.category || '当前 PPT 将按此模板生成') }}</span>
          </div>
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

    <Teleport to="body">
      <div
        v-if="previewingTemplateSlide"
        class="template-preview-modal"
        @click.self="previewingTemplateSlide = null"
      >
        <div class="template-preview-modal__panel">
          <header class="template-preview-modal__header">
            <div>
              <h3>{{ previewingTemplateSlide.slide.title }}</h3>
              <span>第 {{ previewingTemplateSlide.slide.pageNumber || previewingTemplateSlide.index + 1 }} 页 · {{ previewingTemplateSlide.slide.layout }}</span>
            </div>
            <button type="button" class="template-preview-modal__close" title="关闭" @click="previewingTemplateSlide = null">
              <X :size="18" />
            </button>
          </header>
          <div class="template-preview-modal__body">
            <div
              v-if="previewingTemplateSlide.slide.svg"
              class="template-preview-modal__canvas"
              v-html="normalizePreviewSvg(previewingTemplateSlide.slide.svg)"
            />
            <div v-else class="template-preview-modal__fallback">
              <strong>{{ previewingTemplateSlide.slide.title }}</strong>
              <p>{{ previewingTemplateSlide.slide.description || '暂无 SVG 预览' }}</p>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="previewingPromptImage"
        class="template-preview-modal"
        @click.self="previewingPromptImage = null"
      >
        <div class="template-preview-modal__panel">
          <header class="template-preview-modal__header">
            <div>
              <h3>{{ previewingPromptImage.title }}</h3>
              <span>{{ previewingPromptImage.scene || '提示词效果图' }}</span>
            </div>
            <button type="button" class="template-preview-modal__close" title="关闭" @click="previewingPromptImage = null">
              <X :size="18" />
            </button>
          </header>
          <div class="template-preview-modal__body">
            <div class="template-preview-modal__image">
              <img :src="previewingPromptImage.previewUrl" :alt="`${previewingPromptImage.title} 效果图`" />
            </div>
          </div>
        </div>
      </div>
    </Teleport>
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

.prompt-selector {
  display: grid;
  gap: 6px;
}

.template-selector__field,
.prompt-selector__field {
  gap: 6px;
}

.template-selector__preview,
.prompt-selector__preview {
  display: grid;
  gap: 10px;
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 10px;
  background: var(--color-panel);
}

.template-selector__preview-copy,
.prompt-selector__preview-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
  width: 100%;
}

.template-selector__preview-copy strong,
.template-selector__preview-copy span,
.prompt-selector__preview-copy strong,
.prompt-selector__preview-copy span {
  display: block;
  overflow: hidden;
  margin: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-selector__preview-copy strong,
.prompt-selector__preview-copy strong {
  color: var(--color-text);
  font-size: 12px;
  font-weight: 700;
}

.template-selector__preview-copy span,
.template-selector__hint,
.prompt-selector__preview-copy span,
.prompt-selector__hint {
  color: var(--color-muted);
  font-size: 12px;
}

.prompt-selector__image {
  display: grid;
  place-items: center;
  width: 100%;
  min-height: 154px;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  cursor: zoom-in;
}

.prompt-selector__image:hover {
  border-color: var(--color-border-strong);
}

.prompt-selector__image--empty {
  gap: 8px;
  color: var(--color-muted);
  font-size: 12px;
  cursor: default;
}

.prompt-selector__image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
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

.template-preview-modal {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(8, 12, 18, 0.72);
}

.template-preview-modal__panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: min(1120px, 94vw);
  max-height: 92vh;
  overflow: hidden;
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
}

.template-preview-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
}

.template-preview-modal__header h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 15px;
  font-weight: 700;
}

.template-preview-modal__header span {
  display: block;
  margin-top: 4px;
  color: var(--color-muted);
  font-size: 12px;
}

.template-preview-modal__close {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
  transition: border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
}

.template-preview-modal__close:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
  background: var(--color-panel);
}

.template-preview-modal__body {
  display: grid;
  place-items: center;
  min-height: 0;
  overflow: auto;
  padding: 18px;
  background: var(--color-panel);
}

.template-preview-modal__canvas,
.template-preview-modal__image,
.template-preview-modal__fallback {
  width: min(100%, 1040px);
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.template-preview-modal__canvas :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}

.template-preview-modal__image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: var(--color-panel);
}

.template-preview-modal__fallback {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--color-muted);
  text-align: center;
}

.template-preview-modal__fallback strong {
  color: var(--color-text);
  font-size: 18px;
}

.template-preview-modal__fallback p {
  margin: 0;
  font-size: 13px;
}

@media (max-width: 720px) {
  .parameter-group {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .template-preview-modal {
    padding: 12px;
  }

  .template-preview-modal__body {
    padding: 10px;
  }
}
</style>
