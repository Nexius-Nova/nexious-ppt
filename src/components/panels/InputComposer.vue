<script setup lang="ts">
import { computed, ref } from 'vue';
import { CheckCircle2, Circle, FileCheck2, FileText, Image as ImageIcon, LayoutTemplate, Layers, Loader2, PackageCheck, Palette, PenLine, Play, Plus, SendHorizontal, Settings2, SlidersHorizontal, Sparkles, Wand2, X, XCircle } from 'lucide-vue-next';
import UiCard from '@/components/ui/UiCard.vue';
import UiField from '@/components/ui/UiField.vue';
import UiSelect from '@/components/ui/UiSelect.vue';
import UiTextarea from '@/components/ui/UiTextarea.vue';
import UiButton from '@/components/ui/UiButton.vue';
import PrivateSvg from '@/components/common/PrivateSvg.vue';
import TemplatePreviewDeck from '@/components/common/TemplatePreviewDeck.vue';
import { INPUT_SKILL_CATEGORIES, normalizeInputSkillCategory } from '@/constants/inputSkillCategories';
import type { AgentParameters, ConfigOptionGroups, ConfigOptionKey, DeckInput, ImageModelConfig, InputProcessStep, PromptDefinition, PptTemplate, SkillDefinition, TemplateAsset, TemplateAssetSettings, TextModelConfig, UploadedFileContent } from '@/types/agent';

type TemplatePreviewSlide = NonNullable<TemplateAssetSettings['previewSlides']>[number];
type ComposerModule = 'prompt' | 'template' | 'skills' | 'config';

const props = defineProps<{
  modelValue: DeckInput;
  parameters: AgentParameters;
  configOptions: ConfigOptionGroups;
  templates: PptTemplate[];
  selectedTemplate: TemplateAsset | null;
  prompts: PromptDefinition[];
  selectedPromptId: string;
  textModels: TextModelConfig[];
  imageModels: ImageModelConfig[];
  selectedTextModelId: string | null;
  selectedImageModelId: string | null;
  skills: SkillDefinition[];
  inputProcessSteps: InputProcessStep[];
  uploadedFileContents: UploadedFileContent[];
  resourcesSyncing?: boolean;
  lastResourceSyncedAt?: number;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: DeckInput];
  'update:parameters': [value: AgentParameters];
  'select-template': [templateId: string];
  'clear-template': [];
  'select-prompt': [promptId: string];
  'select-text-model': [modelId: string | null];
  'select-image-model': [modelId: string | null];
  'toggle-skill': [skillId: string];
  attach: [files: FileList | null];
  'remove-file': [fileName: string];
  'open-resource': [module: ComposerModule];
  run: [];
}>();

const fileTypeIcons: Record<string, any> = {
  image: ImageIcon,
  default: FileText
};

const fileStatusByName = computed(() => new Map(props.uploadedFileContents.map((file) => [file.name, file])));

const previewingTemplateSlide = ref<{ slide: TemplatePreviewSlide; index: number } | null>(null);
const activeModule = ref<ComposerModule | null>(null);

const parameterGroups: Array<{ key: ConfigOptionKey; label: string; icon: any }> = [
  { key: 'slideCount', label: '页数', icon: Layers },
  { key: 'summaryLength', label: '摘要', icon: SlidersHorizontal },
  { key: 'tone', label: '语言', icon: PenLine },
  { key: 'imageStyle', label: '图像', icon: Palette },
  { key: 'skillIntensity', label: '增强', icon: Sparkles },
  { key: 'animationEnabled', label: '动画', icon: Play },
  { key: 'animationEffect', label: '效果', icon: Wand2 }
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
  { label: '不使用参考模板', value: '', description: '由 AI 根据资料内容自主设计' },
  ...templateOptions.value
]);

const selectedTemplateId = computed(() => props.selectedTemplate?.id || '');

const selectedPrompt = computed(() => props.prompts.find((prompt) => prompt.id === props.selectedPromptId) || null);
const contentCharCount = computed(() => props.modelValue.content.trim().length);
const activeParameterCount = computed(() =>
  parameterGroups.filter((group) => String(parameterValue(group.key)) !== autoOptionByKey[group.key].value).length
);
const selectedModelCount = computed(() => [props.selectedTextModelId, props.selectedImageModelId].filter(Boolean).length);
const activeConfigCount = computed(() => activeParameterCount.value + selectedModelCount.value);
const selectedSkillCount = computed(() => props.skills.filter((skill) => skill.enabled).length);
const hasContent = computed(() => Boolean(props.modelValue.content.trim()));
const fileCount = computed(() => props.modelValue.files.length);
const contentPreview = computed(() =>
  hasContent.value ? compactText(props.modelValue.content, 120) : '等待输入资料、目标或会议纪要'
);
const completedInputStepCount = computed(() =>
  props.inputProcessSteps.filter((step) => ['done', 'skipped'].includes(step.status)).length
);
const readinessScore = computed(() => {
  const steps = props.inputProcessSteps;
  if (steps.some((step) => step.status !== 'idle')) {
    const total = steps.length * 100;
    const current = steps.reduce((sum, step) => sum + (step.status === 'skipped' ? 100 : step.progress), 0);
    return Math.min(100, Math.round((current / total) * 100));
  }
  const score = [hasContent.value || fileCount.value > 0, true, Boolean(selectedPrompt.value || props.selectedTemplate || activeConfigCount.value > 0)].filter(Boolean).length;
  return Math.round((score / 3) * 100);
});
const workflowSummary = computed(() => {
  if (!hasContent.value && !fileCount.value) return '先在底部输入资料、需求或上传文件，我会在这里逐步处理。';
  if (props.inputProcessSteps.some((step) => step.status === 'running')) return '输入阶段正在执行，请稍等。';
  if (props.inputProcessSteps.some((step) => step.status === 'failed')) return '有步骤执行失败，修复后可重新开始。';
  if (props.inputProcessSteps.every((step) => ['done', 'skipped'].includes(step.status))) return '输入阶段已处理完成，接下来可以生成大纲。';
  return '已根据当前资料规划处理路径，点击发送后会从上到下执行。';
});

const activeModuleTitle = computed(() => {
  if (activeModule.value === 'prompt') return '提示词';
  if (activeModule.value === 'template') return '参考模板';
  if (activeModule.value === 'skills') return 'Skill';
  return '配置参数';
});

const activeModuleSubtitle = computed(() => {
  if (activeModule.value === 'prompt') return '选择本次生成的表达策略';
  if (activeModule.value === 'template') return '选择 PPT 的视觉参考';
  if (activeModule.value === 'skills') return '选择本次输入阶段要调用的能力';
  return '调整页数、摘要、语言、图像和导出动画';
});

const resourceSyncText = computed(() => {
  if (props.resourcesSyncing) return '正在同步资源';
  if (!props.lastResourceSyncedAt) return '资源待同步';
  return `已同步 ${new Date(props.lastResourceSyncedAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  })}`;
});

const activeResourceText = computed(() => {
  const items = [
    selectedPrompt.value ? `提示词：${selectedPrompt.value.title}` : '',
    props.selectedTemplate ? `模板：${props.selectedTemplate.name}` : '',
    selectedSkillCount.value ? `Skill：${selectedSkillCount.value}` : '',
    activeConfigCount.value ? `配置：${activeConfigCount.value}` : ''
  ].filter(Boolean);
  return items.length ? items.join(' · ') : '使用默认配置';
});

const skillGroups = computed(() =>
  INPUT_SKILL_CATEGORIES.map((category) => ({
    category,
    skills: props.skills
      .filter((skill) => normalizeInputSkillCategory(skill.category) === category)
      .sort((a, b) => a.order - b.order)
  }))
);

const promptOptions = computed(() => [
  { label: '不使用提示词', value: '', description: '仅使用资料内容生成' },
  ...props.prompts.map((prompt) => ({
    label: prompt.title,
    value: prompt.id,
    description: compactText(prompt.content || prompt.scene || '暂无提示词内容', 42),
    previewImageUrl: prompt.previewUrl
  }))
]);

const defaultTextModel = computed(() => props.textModels.find((model) => model.isDefault) || props.textModels[0] || null);
const defaultImageModel = computed(() => props.imageModels.find((model) => model.isDefault) || props.imageModels[0] || null);
const availableTextModels = computed(() => props.textModels.filter((model) => model.enabled && model.hasKey !== false));
const availableImageModels = computed(() => props.imageModels.filter((model) => model.enabled && model.hasKey !== false));

const textModelOptions = computed(() => [
  {
    label: defaultTextModel.value ? `使用默认：${defaultTextModel.value.name}` : '使用默认文本模型',
    value: '',
    description: defaultTextModel.value ? `${defaultTextModel.value.provider} / ${defaultTextModel.value.model}` : '由模型管理页当前默认配置决定'
  },
  ...availableTextModels.value.map((model) => ({
    label: model.name,
    value: model.id,
    description: `${model.provider} / ${model.model}${model.isDefault ? ' · 默认' : ''}`
  }))
]);

const imageModelOptions = computed(() => [
  {
    label: defaultImageModel.value ? `使用默认：${defaultImageModel.value.name}` : '使用默认图片模型',
    value: '',
    description: defaultImageModel.value ? `${defaultImageModel.value.provider} / ${defaultImageModel.value.model}` : '由模型管理页当前默认配置决定'
  },
  ...availableImageModels.value.map((model) => ({
    label: model.name,
    value: model.id,
    description: `${model.provider} / ${model.model}${model.isDefault ? ' · 默认' : ''}`
  }))
]);

const autoOptionByKey: Record<ConfigOptionKey, { label: string; value: string; description?: string }> = {
  slideCount: { label: 'AI 自动', value: '0', description: '由内容量决定页数' },
  summaryLength: { label: 'AI 自动', value: 'auto', description: '由内容密度决定详略' },
  tone: { label: 'AI 自动', value: 'auto', description: '由场景决定表达风格' },
  imageStyle: { label: 'AI 自动', value: 'auto', description: '由页面内容决定图像方向' },
  skillIntensity: { label: 'AI 自动', value: '0', description: '由 AI 判断是否增强' },
  animationEnabled: { label: 'AI 自动', value: 'auto', description: '输入提到动画时自动启用 PPTX 动画' },
  animationEffect: { label: 'AI 自动', value: 'auto', description: '启用动画后自动选择适合页面元素的入场效果' }
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

function fileInfo(fileName: string) {
  return fileStatusByName.value.get(fileName);
}

function fileStatusClass(fileName: string) {
  const status = fileInfo(fileName)?.status || 'partial';
  return `input-composer__file-tag--${status}`;
}

function fileStatusLabel(fileName: string) {
  const file = fileInfo(fileName);
  if (!file) return '等待解析';
  if (file.status === 'parsed') return file.kind === 'image' ? '已识别' : '已解析';
  if (file.status === 'failed') return '解析失败';
  return '部分解析';
}

function fileStatusTitle(fileName: string) {
  const file = fileInfo(fileName);
  if (!file) return '文件正在等待解析';
  return [file.summary, ...(file.warnings || [])].filter(Boolean).join('\n') || fileStatusLabel(fileName);
}

function updateParameter(key: ConfigOptionKey, value: string) {
  const numericKeys: ConfigOptionKey[] = ['slideCount', 'skillIntensity'];
  emit('update:parameters', {
    ...props.parameters,
    [key]: numericKeys.includes(key) ? Number(value) : value
  });
}

function parameterValue(key: ConfigOptionKey) {
  return props.parameters[key] ?? autoOptionByKey[key].value;
}

function isParameterActive(key: ConfigOptionKey, value: string) {
  return String(parameterValue(key)) === value;
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

function handleTextModelSelect(modelId: string) {
  emit('select-text-model', modelId || null);
}

function handleImageModelSelect(modelId: string) {
  emit('select-image-model', modelId || null);
}

function toggleModule(module: ComposerModule) {
  activeModule.value = activeModule.value === module ? null : module;
}

function compactText(value: string, maxLength = 88) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function inputStepIcon(step: InputProcessStep) {
  if (step.status === 'running') return Loader2;
  if (step.status === 'done') return CheckCircle2;
  if (step.status === 'failed') return XCircle;
  if (step.id === 'file-parse') return FileCheck2;
  if (step.id === 'topic') return Sparkles;
  if (step.id === 'constraints') return Settings2;
  if (step.id === 'ready') return SendHorizontal;
  return Circle;
}

function inputStepStateLabel(step: InputProcessStep) {
  if (step.status === 'running') return '处理中';
  if (step.status === 'done') return '已完成';
  if (step.status === 'skipped') return '已跳过';
  if (step.status === 'failed') return '失败';
  return '待处理';
}

function hasStepResult(step: InputProcessStep) {
  return Boolean(step.logs || step.output || step.processedText);
}

function resultPreview(value?: string, maxLength = 420) {
  if (!value) return '';
  return compactText(value.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n'), maxLength);
}

function canUseSkill(skill: SkillDefinition) {
  if (skill.runtime === 'prompt-only' || skill.type === 'prompt-only') return true;
  return skill.installStatus === 'ready' && skill.testStatus === 'passed';
}

function skillRuntimeLabel(skill: SkillDefinition) {
  if (skill.runtime === 'python') return 'Python';
  if (skill.runtime === 'node') return 'Node.js';
  return '提示词';
}

function skillStatusLabel(skill: SkillDefinition) {
  if (skill.testStatus === 'testing') return '测试中';
  if (skill.testStatus === 'failed') return '测试失败';
  if (skill.runtime !== 'prompt-only' && skill.type !== 'prompt-only' && skill.testStatus !== 'passed') return '待测试';
  if (skill.installStatus === 'ready') return '依赖就绪';
  if (skill.installStatus === 'installing' || skill.installStatus === 'pending') return '初始化中';
  if (skill.installStatus === 'failed') return '初始化失败';
  return '无需依赖';
}

function handleSkillToggle(skill: SkillDefinition) {
  if (!canUseSkill(skill)) return;
  emit('toggle-skill', skill.id);
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
  <UiCard class="agent-input-card" :padded="false">
    <div class="input-composer">
      <section class="agent-thread" aria-label="PPT 输入对话">
        <header class="agent-thread__hero">
          <span class="agent-thread__bot">
            <Sparkles :size="18" />
          </span>
          <div>
            <span>AI PPT Agent</span>
            <h2>把资料发给我，我来生成 PPT</h2>
            <p>{{ workflowSummary }}</p>
          </div>
          <strong>{{ readinessScore }}%</strong>
        </header>

        <section class="input-brief" aria-label="当前输入状态">
          <div class="input-brief__main">
            <strong>{{ fileCount ? `${fileCount} 个附件` : hasContent ? '已输入需求' : '等待输入' }}</strong>
            <span>{{ contentPreview }}</span>
          </div>
          <div class="input-brief__meta">
            <span :class="{ 'input-brief__sync--loading': resourcesSyncing }">
              <Loader2 v-if="resourcesSyncing" :size="13" class="spin" />
              <CheckCircle2 v-else :size="13" />
              {{ resourceSyncText }}
            </span>
            <span>{{ activeResourceText }}</span>
          </div>
        </section>

        <section class="input-flow-card" aria-label="输入阶段执行轨迹">
          <header class="input-flow__intro">
            <div>
              <span>执行轨迹</span>
              <h3>输入阶段处理流</h3>
            </div>
            <strong>{{ completedInputStepCount }}/{{ inputProcessSteps.length }} · {{ readinessScore }}%</strong>
          </header>

          <ol class="input-flow__steps">
            <li
              v-for="(step, index) in inputProcessSteps"
              :key="step.id"
              class="input-flow-step"
              :class="`input-flow-step--${step.status}`"
            >
              <span class="input-flow-step__rail" aria-hidden="true" />
              <span class="input-flow-step__icon">
                <component
                  :is="inputStepIcon(step)"
                  :size="16"
                  :class="{ spin: step.status === 'running' }"
                />
              </span>
              <div class="input-flow-step__body">
                <div class="input-flow-step__head">
                  <strong>{{ index + 1 }}. {{ step.title }}</strong>
                  <span>{{ inputStepStateLabel(step) }} · {{ step.progress }}%</span>
                </div>
                <p>{{ step.detail || step.description }}</p>
                <div v-if="step.skillName || step.error" class="input-flow-step__meta">
                  <span v-if="step.skillName">Skill：{{ step.skillName }}</span>
                  <span v-if="step.error">原因：{{ resultPreview(step.error, 180) }}</span>
                </div>
                <div v-if="hasStepResult(step)" class="input-flow-step__result">
                  <p v-if="step.processedText" class="input-flow-step__processed">
                    {{ resultPreview(step.processedText, step.id === 'ready' ? 1200 : 420) }}
                  </p>
                  <details v-if="step.logs || step.output" class="input-flow-step__details">
                    <summary>查看执行过程和返回内容</summary>
                    <div v-if="step.logs" class="input-flow-step__log">
                      <strong>过程日志</strong>
                      <pre>{{ resultPreview(step.logs, 700) }}</pre>
                    </div>
                    <div v-if="step.output" class="input-flow-step__log">
                      <strong>返回内容</strong>
                      <pre>{{ resultPreview(step.output, 700) }}</pre>
                    </div>
                  </details>
                </div>
                <div v-if="step.status === 'running'" class="input-flow-step__bar" aria-hidden="true">
                  <span :style="{ width: `${step.progress}%` }" />
                </div>
              </div>
            </li>
          </ol>
        </section>
      </section>

      <div class="input-composer__dock">
        <Transition name="module-panel">
          <section v-if="activeModule" class="composer-module-panel">
            <header class="composer-module-panel__header">
              <div>
                <strong>
                  {{ activeModuleTitle }}
                </strong>
                <span>
                  {{ activeModuleSubtitle }}
                </span>
              </div>
              <button type="button" class="composer-module-panel__close" title="收起" @click="activeModule = null">
                <X :size="16" />
              </button>
            </header>

            <div v-if="activeModule === 'prompt'" class="prompt-selector">
              <UiField class="prompt-selector__field" label="提示词">
                <UiSelect
                  :model-value="selectedPromptId"
                  :options="promptOptions"
                  placeholder="选择本次生成使用的提示词"
                  @update:model-value="handlePromptSelect"
                />
              </UiField>
              <div v-if="selectedPrompt" class="prompt-selector__preview">
                <div class="prompt-selector__preview-copy">
                  <strong>{{ selectedPrompt.title }}</strong>
                  <span>{{ compactText(selectedPrompt.content || selectedPrompt.scene || '当前提示词将参与本次生成') }}</span>
                </div>
              </div>
              <p v-else class="prompt-selector__hint">可为空；选择后会和资料内容一起发送给 AI。</p>
              <div v-if="!prompts.length" class="resource-empty">
                <span>暂无提示词，可先到提示词管理中创建。</span>
                <UiButton size="sm" variant="secondary" @click="$emit('open-resource', 'prompt')">去添加</UiButton>
              </div>
            </div>

            <div v-else-if="activeModule === 'template'" class="template-selector">
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
              <div v-if="!templateOptions.length" class="resource-empty">
                <span>暂无模板，可导入 PPT 或创建模板方案。</span>
                <UiButton size="sm" variant="secondary" @click="$emit('open-resource', 'template')">去添加</UiButton>
              </div>
            </div>

            <div v-else-if="activeModule === 'skills'" class="skill-picker" aria-label="本次使用的 Skill">
              <p class="skill-picker__summary">
                本次已选择 {{ selectedSkillCount }} 个 Skill。网页搜索类 Skill 放在“资料收集”中执行，文件类 Skill 会在上传文件后参与解析。
              </p>
              <div v-if="skills.length" class="skill-picker__groups">
                <section
                  v-for="group in skillGroups"
                  :key="group.category"
                  class="skill-picker-group"
                >
                  <header class="skill-picker-group__header">
                    <span>{{ group.category }}</span>
                    <small>{{ group.skills.length }} 个</small>
                  </header>
                  <div v-if="group.skills.length" class="skill-picker-group__list">
                    <button
                      v-for="skill in group.skills"
                      :key="skill.id"
                      type="button"
                      class="skill-option"
                      :class="{
                        'skill-option--selected': skill.enabled,
                        'skill-option--disabled': !canUseSkill(skill)
                      }"
                      :disabled="!canUseSkill(skill)"
                      @click="handleSkillToggle(skill)"
                    >
                      <span class="skill-option__check">
                        <CheckCircle2 v-if="skill.enabled" :size="16" />
                        <Circle v-else :size="16" />
                      </span>
                      <span class="skill-option__content">
                        <strong>{{ skill.name }}</strong>
                        <span>{{ compactText(skill.description || skill.instruction || '暂无说明', 72) }}</span>
                      </span>
                      <span class="skill-option__meta">
                        <small>{{ skillRuntimeLabel(skill) }}</small>
                        <small>{{ skillStatusLabel(skill) }}</small>
                      </span>
                    </button>
                  </div>
                  <p v-else class="skill-picker-group__empty">暂无此类 Skill</p>
                </section>
              </div>
              <div v-else class="resource-empty">
                <span>Skill 管理中还没有可选择的 Skill。</span>
                <UiButton size="sm" variant="secondary" @click="$emit('open-resource', 'skills')">去添加</UiButton>
              </div>
            </div>

            <div v-else class="parameter-panel" aria-label="PPT 生成参数">
              <div v-if="!textModels.length || !imageModels.length" class="resource-empty resource-empty--models">
                <span>文本模型和图片模型需要至少各配置一个，生成流程才完整。</span>
                <UiButton size="sm" variant="secondary" @click="$emit('open-resource', 'config')">去配置模型</UiButton>
              </div>
              <section class="parameter-models" aria-label="当前 PPT 使用的模型">
                <UiField label="文本模型" hint="仅影响当前 PPT；留空时使用模型管理页的默认文本模型">
                  <UiSelect
                    :model-value="selectedTextModelId || ''"
                    :options="textModelOptions"
                    placeholder="使用默认文本模型"
                    @update:model-value="handleTextModelSelect"
                  />
                </UiField>
                <UiField label="图片模型" hint="仅影响当前 PPT；留空时使用模型管理页的默认图片模型">
                  <UiSelect
                    :model-value="selectedImageModelId || ''"
                    :options="imageModelOptions"
                    placeholder="使用默认图片模型"
                    @update:model-value="handleImageModelSelect"
                  />
                </UiField>
              </section>

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
          </section>
        </Transition>

        <section class="doubao-composer" aria-label="PPT 资料输入">
          <div class="doubao-composer__box">
            <UiTextarea
              class="doubao-composer__textarea"
              :model-value="modelValue.content"
              :rows="2"
              placeholder="发消息... 粘贴资料、需求、会议纪要或结构草稿。需要指定主题时可直接写：主题：智能硬件品牌年度增长计划"
              @update:model-value="$emit('update:modelValue', { ...modelValue, content: $event })"
            />

            <div v-if="modelValue.files.length" class="input-composer__files">
              <span
                v-for="file in modelValue.files"
                :key="file"
                class="input-composer__file-tag"
                :class="fileStatusClass(file)"
                :title="fileStatusTitle(file)"
              >
                <component :is="getFileIcon(file)" :size="12" />
                <span class="input-composer__file-name">{{ file }}</span>
                <small>{{ fileStatusLabel(file) }}</small>
                <button type="button" title="删除文件" @click="$emit('remove-file', file)">
                  <X :size="12" />
                </button>
              </span>
            </div>

            <footer class="doubao-composer__toolbar">
              <div class="doubao-composer__tools">
                <label class="doubao-composer__icon-button" title="上传资料">
                  <Plus :size="22" />
                  <input
                    type="file"
                    multiple
                    accept=".txt,.md,.markdown,.csv,.json,.log,.html,.htm,.xml,.doc,.docx,.xls,.xlsx,.xlsm,.ppt,.pptx,.pdf,image/*"
                    @change="handleFileChange"
                  />
                </label>
                <span class="doubao-composer__divider" aria-hidden="true" />
                <button
                  type="button"
                  class="doubao-composer__module"
                  :class="{ 'doubao-composer__module--active': activeModule === 'prompt' || selectedPrompt }"
                  @click="toggleModule('prompt')"
                >
                  <Sparkles :size="18" />
                  <span>提示词</span>
                  <small v-if="selectedPrompt">已选</small>
                </button>
                <button
                  type="button"
                  class="doubao-composer__module"
                  :class="{ 'doubao-composer__module--active': activeModule === 'template' || selectedTemplate }"
                  @click="toggleModule('template')"
                >
                  <LayoutTemplate :size="18" />
                  <span>参考模板</span>
                  <small v-if="selectedTemplate">已选</small>
                </button>
                <button
                  type="button"
                  class="doubao-composer__module"
                  :class="{ 'doubao-composer__module--active': activeModule === 'skills' || selectedSkillCount > 0 }"
                  @click="toggleModule('skills')"
                >
                  <PackageCheck :size="18" />
                  <span>Skill</span>
                  <small v-if="selectedSkillCount > 0">{{ selectedSkillCount }}</small>
                </button>
                <button
                  type="button"
                  class="doubao-composer__module"
                  :class="{ 'doubao-composer__module--active': activeModule === 'config' || activeConfigCount > 0 }"
                  @click="toggleModule('config')"
                >
                  <Settings2 :size="18" />
                  <span>配置参数</span>
                  <small v-if="activeConfigCount > 0">{{ activeConfigCount }}</small>
                </button>
              </div>

              <div class="doubao-composer__actions">
                <span class="doubao-composer__counter">{{ contentCharCount }} 字</span>
                <button
                  type="button"
                  class="doubao-composer__send"
                  title="开始生成 PPT"
                  @click="handleRun"
                >
                  <SendHorizontal :size="19" />
                </button>
              </div>
            </footer>
          </div>
        </section>
      </div>
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
            <PrivateSvg
              v-if="previewingTemplateSlide.slide.svg"
              class="template-preview-modal__canvas"
              :svg="previewingTemplateSlide.slide.svg"
            />
            <div v-else class="template-preview-modal__fallback">
              <strong>{{ previewingTemplateSlide.slide.title }}</strong>
              <p>{{ previewingTemplateSlide.slide.description || '暂无 SVG 预览' }}</p>
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
  grid-template-rows: minmax(260px, 1fr) auto;
  min-height: calc(100vh - 260px);
  background: var(--color-card);
}

.agent-thread {
  display: grid;
  align-content: start;
  gap: 12px;
  justify-self: center;
  width: min(820px, 100%);
  min-height: 0;
  padding: 28px 22px 210px;
}

.agent-thread__hero {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 4px 0 2px;
  background: transparent;
}

.agent-thread__bot {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border: 1px solid var(--color-border);
  background: var(--color-panel);
  color: var(--color-accent);
}

.agent-thread__bot {
  width: 34px;
  height: 34px;
  border-radius: 8px;
}

.agent-thread__hero div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.agent-thread__hero span {
  color: var(--color-accent);
  font-size: 12px;
  font-weight: 800;
}

.agent-thread__hero h2 {
  margin: 0;
  color: var(--color-text);
  font-size: 20px;
  font-weight: 850;
  letter-spacing: 0;
}

.agent-thread__hero p {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.5;
}

.agent-thread__hero > strong {
  color: var(--color-text);
  font-size: 18px;
  line-height: 1;
}

.input-brief,
.input-flow-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.input-brief {
  display: grid;
  gap: 10px;
  padding: 12px;
}

.input-brief__main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.input-brief__main strong {
  color: var(--color-text);
  font-size: 14px;
  font-weight: 850;
}

.input-brief__main span {
  overflow: hidden;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.input-brief__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.input-brief__meta span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 3px 8px;
  color: var(--color-muted);
  background: var(--color-panel);
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.input-brief__sync--loading {
  color: var(--color-accent-strong) !important;
  background: var(--color-accent-soft) !important;
}

.input-flow-card {
  display: grid;
  overflow: hidden;
}

.input-flow__intro {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 12px;
  min-width: 0;
  border-bottom: 1px solid var(--color-border);
  padding: 12px;
}

.input-flow__intro div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.input-flow__intro span {
  color: var(--color-accent);
  font-size: 12px;
  font-weight: 800;
}

.input-flow__intro h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 15px;
  font-weight: 850;
  letter-spacing: 0;
}

.input-flow__intro strong {
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 800;
  line-height: 1.2;
  white-space: nowrap;
}

.input-flow__steps {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 12px;
  list-style: none;
}

.input-flow-step {
  position: relative;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 12px;
  min-width: 0;
  padding: 0 0 16px;
}

.input-flow-step:last-child {
  padding-bottom: 0;
}

.input-flow-step__rail {
  position: absolute;
  left: 16px;
  top: 34px;
  bottom: 0;
  width: 1px;
  background: var(--color-border);
}

.input-flow-step:last-child .input-flow-step__rail {
  display: none;
}

.input-flow-step__icon {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  align-self: start;
  width: 34px;
  height: 34px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-muted);
}

.input-flow-step--running .input-flow-step__icon {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.input-flow-step--done .input-flow-step__icon {
  border-color: color-mix(in srgb, var(--color-success) 42%, var(--color-border));
  color: var(--color-success);
  background: var(--color-success-soft);
}

.input-flow-step--failed .input-flow-step__icon {
  border-color: color-mix(in srgb, var(--color-danger) 42%, var(--color-border));
  color: var(--color-danger);
  background: var(--color-danger-soft);
}

.input-flow-step--skipped .input-flow-step__icon {
  background: var(--color-panel);
  color: var(--color-subtle);
}

.input-flow-step__body {
  display: grid;
  gap: 6px;
  min-width: 0;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 14px;
}

.input-flow-step:last-child .input-flow-step__body {
  border-bottom: 0;
  padding-bottom: 0;
}

.input-flow-step__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.input-flow-step__head strong {
  color: var(--color-text);
  font-size: 13px;
  font-weight: 800;
}

.input-flow-step__head span {
  overflow: hidden;
  color: var(--color-accent-strong);
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.input-flow-step--failed .input-flow-step__head span {
  color: var(--color-danger);
}

.input-flow-step--skipped .input-flow-step__head span {
  color: var(--color-subtle);
}

.input-flow-step p {
  min-width: 0;
  margin: 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.55;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.input-flow-step__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.input-flow-step__meta span {
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 3px 8px;
  color: var(--color-muted);
  background: var(--color-panel);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.input-flow-step__result {
  display: grid;
  gap: 7px;
  min-width: 0;
  border-left: 2px solid var(--color-accent);
  padding-left: 10px;
}

.input-flow-step__processed {
  color: var(--color-text);
  white-space: pre-line;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.input-flow-step__details {
  max-width: 100%;
  min-width: 0;
}

.input-flow-step__details summary {
  width: fit-content;
  color: var(--color-accent-strong);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.input-flow-step__log {
  display: grid;
  gap: 5px;
  margin-top: 8px;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 8px;
  background: var(--color-panel);
}

.input-flow-step__log strong {
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 800;
}

.input-flow-step__log pre {
  overflow: auto;
  max-height: 180px;
  margin: 0;
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-all;
}

.input-flow-step__bar {
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--color-border);
}

.input-flow-step__bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-accent);
  transition: width 0.2s ease;
}

.input-composer__dock {
  position: sticky;
  bottom: 0;
  z-index: 30;
  display: grid;
  gap: 8px;
  justify-self: center;
  width: min(820px, 100%);
  padding: 10px 22px 14px;
  border-top: 1px solid var(--color-border);
  background: var(--color-card);
}

.doubao-composer {
  display: grid;
}

.doubao-composer__box {
  display: grid;
  gap: 8px;
  border: 1px solid var(--color-border-strong);
  border-radius: 14px;
  padding: 10px 12px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.doubao-composer__box:focus-within {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-accent-soft);
}

.doubao-composer__textarea {
  min-height: 52px;
  max-height: 132px;
  resize: vertical;
  border: 0;
  border-radius: 8px;
  padding: 2px 6px;
  background: transparent;
  color: var(--color-text);
  font-size: 14px;
  line-height: 1.55;
  box-shadow: none;
}

.doubao-composer__textarea:focus {
  border-color: transparent;
  box-shadow: none;
}

.doubao-composer__toolbar,
.doubao-composer__tools,
.doubao-composer__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.doubao-composer__toolbar {
  justify-content: space-between;
}

.doubao-composer__tools {
  flex: 1 1 auto;
  flex-wrap: wrap;
}

.doubao-composer__actions {
  flex: 0 0 auto;
}

.doubao-composer__icon-button,
.doubao-composer__module,
.doubao-composer__send,
.composer-module-panel__close {
  border: 0;
  outline: none;
  color: var(--color-text);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast), transform var(--transition-fast);
}

.doubao-composer__icon-button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: transparent;
}

.doubao-composer__icon-button:hover {
  background: var(--color-panel);
}

.doubao-composer__icon-button input {
  display: none;
}

.doubao-composer__divider {
  width: 1px;
  height: 18px;
  background: var(--color-border);
}

.doubao-composer__module {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  max-width: 100%;
  border-radius: 7px;
  padding: 0 7px;
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.doubao-composer__module:hover,
.doubao-composer__module--active {
  background: var(--color-accent-soft);
  color: var(--color-accent-strong);
}

.doubao-composer__module small {
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  border-radius: 999px;
  padding: 0 5px;
  background: var(--color-panel);
  color: var(--color-accent-strong);
  font-size: 11px;
  font-weight: 700;
}

.doubao-composer__counter {
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.doubao-composer__send {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--color-accent);
  color: var(--color-inverse);
}

.doubao-composer__send:hover {
  background: var(--color-accent-hover);
  transform: translateY(-1px);
}

.composer-module-panel {
  display: grid;
  gap: 10px;
  max-height: min(42vh, 460px);
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  padding: 12px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.composer-module-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.composer-module-panel__header div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.composer-module-panel__header strong {
  color: var(--color-text);
  font-size: 14px;
  font-weight: 800;
}

.composer-module-panel__header span {
  color: var(--color-muted);
  font-size: 12px;
}

.composer-module-panel__close {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--color-panel);
}

.composer-module-panel__close:hover {
  background: var(--color-accent-soft);
  color: var(--color-accent-strong);
}

.module-panel-enter-active,
.module-panel-leave-active {
  transition: opacity var(--transition-fast), transform var(--transition-fast);
}

.module-panel-enter-from,
.module-panel-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.template-selector {
  display: grid;
  gap: 6px;
}

.prompt-selector,
.skill-picker {
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

.template-selector__hint,
.prompt-selector__hint {
  margin: 0;
  line-height: 1.4;
}

.resource-empty {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  border: 1px dashed var(--color-border-strong);
  border-radius: 8px;
  padding: 10px;
  background: var(--color-panel);
}

.resource-empty span {
  min-width: 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.45;
}

.resource-empty--models {
  margin-bottom: 2px;
}

.skill-picker {
  gap: 10px;
}

.skill-picker__summary,
.skill-selector__hint,
.skill-picker-group__empty {
  margin: 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.5;
}

.skill-picker__groups {
  display: grid;
  gap: 12px;
}

.skill-picker-group {
  display: grid;
  gap: 8px;
}

.skill-picker-group__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 6px;
}

.skill-picker-group__header span {
  color: var(--color-text);
  font-size: 13px;
  font-weight: 800;
}

.skill-picker-group__header small {
  color: var(--color-subtle);
  font-size: 11px;
  font-weight: 700;
}

.skill-picker-group__list {
  display: grid;
  gap: 6px;
}

.skill-option {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  width: 100%;
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 9px 10px;
  background: var(--color-card);
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
}

.skill-option:hover {
  border-color: var(--color-border-strong);
  background: var(--color-panel);
}

.skill-option--selected {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.skill-option--disabled {
  opacity: 0.62;
  cursor: not-allowed;
}

.skill-option__check {
  display: grid;
  place-items: center;
  color: var(--color-muted);
}

.skill-option--selected .skill-option__check {
  color: var(--color-accent);
}

.skill-option__content {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.skill-option__content strong,
.skill-option__content span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-option__content strong {
  color: var(--color-text);
  font-size: 13px;
  font-weight: 800;
}

.skill-option__content span {
  color: var(--color-muted);
  font-size: 12px;
}

.skill-option__meta {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.skill-option__meta small {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 2px 7px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 700;
}

.parameter-panel {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.parameter-models {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 12px;
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
  max-width: min(100%, 360px);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 3px 10px;
  color: var(--color-muted);
  font-size: 11px;
  background: var(--color-panel);
}

.input-composer__file-tag--parsed {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  color: var(--color-accent-strong);
}

.input-composer__file-tag--partial {
  border-color: var(--color-warning);
  background: var(--color-warning-soft);
  color: var(--color-warning);
}

.input-composer__file-tag--failed {
  border-color: var(--color-danger);
  background: var(--color-danger-soft);
  color: var(--color-danger);
}

.input-composer__file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.input-composer__file-tag small {
  flex: 0 0 auto;
  font-size: 10px;
  font-weight: 800;
}

.input-composer__file-tag button {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 999px;
  color: var(--color-muted);
  background: transparent;
  cursor: pointer;
}

.input-composer__file-tag button:hover {
  color: var(--color-danger);
  background: var(--color-danger-soft);
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
  .input-composer {
    grid-template-rows: auto auto;
    min-height: auto;
  }

  .agent-thread {
    padding: 16px 12px 240px;
  }

  .agent-thread__hero {
    grid-template-columns: minmax(0, 1fr);
  }

  .agent-thread__bot {
    display: none;
  }

  .agent-thread__hero > strong {
    justify-self: start;
  }

  .input-flow-step__head {
    align-items: flex-start;
    flex-direction: column;
  }

  .input-brief__main span {
    white-space: normal;
  }

  .input-composer__dock {
    bottom: 0;
    width: 100%;
    padding: 10px 12px 12px;
  }

  .doubao-composer__box {
    border-radius: 12px;
    padding: 10px;
  }

  .doubao-composer__textarea {
    min-height: 60px;
    max-height: 136px;
    font-size: 14px;
  }

  .doubao-composer__toolbar {
    align-items: center;
    flex-direction: row;
    gap: 8px;
  }

  .doubao-composer__tools {
    flex-wrap: nowrap;
    gap: 8px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .doubao-composer__actions {
    flex: 0 0 auto;
    justify-content: space-between;
  }

  .doubao-composer__module {
    flex: 0 0 auto;
    justify-content: center;
  }

  .composer-module-panel__header {
    align-items: flex-start;
  }

  .parameter-group {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .parameter-models {
    grid-template-columns: 1fr;
  }

  .resource-empty {
    align-items: stretch;
    flex-direction: column;
  }

  .skill-option {
    grid-template-columns: 22px minmax(0, 1fr);
  }

  .skill-option__meta {
    grid-column: 2;
    justify-content: flex-start;
  }

  .template-preview-modal {
    padding: 12px;
  }

  .template-preview-modal__body {
    padding: 10px;
  }
}
</style>
