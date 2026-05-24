<script setup lang="ts">
import { computed, ref } from 'vue';
import { FileText, Image as ImageIcon, SendHorizontal, Upload, Sparkles, ChevronDown, Check } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiField from '@/components/ui/UiField.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiTextarea from '@/components/ui/UiTextarea.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
import ModelSelector from '@/components/common/ModelSelector.vue';
import type { DeckInput, PromptDefinition, SkillDefinition } from '@/types/agent';

const props = defineProps<{
  modelValue: DeckInput;
  prompts?: PromptDefinition[];
  skills?: SkillDefinition[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: DeckInput];
  attach: [files: FileList | null];
  run: [];
  applyPrompt: [promptId: string];
  toggleSkill: [skillId: string];
}>();

const showPromptDropdown = ref(false);
const showSkillDropdown = ref(false);

const fileTypeIcons: Record<string, any> = {
  image: ImageIcon,
  default: FileText
};

const availablePrompts = computed(() => props.prompts || []);
const availableSkills = computed(() => props.skills || []);
const enabledSkillsCount = computed(() => availableSkills.value.filter(s => s.enabled).length);

function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext || '')) {
    return fileTypeIcons.image;
  }
  return fileTypeIcons.default;
}

function handleApplyPrompt(prompt: PromptDefinition) {
  emit('applyPrompt', prompt.id);
  showPromptDropdown.value = false;
}

function handleToggleSkill(skill: SkillDefinition) {
  emit('toggleSkill', skill.id);
}

function handleRun() {
  emit('run');
}
</script>

<template>
  <UiCard title="PPT 输入" subtitle="整理主题和资料，选择提示词和技能，开始生成 PPT。">
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

      <div class="input-composer__enhancers">
        <div class="enhancer-section">
          <div class="enhancer-header">
            <Sparkles :size="14" />
            <span>提示词模板</span>
            <UiBadge v-if="availablePrompts.length" tone="info" size="sm">{{ availablePrompts.length }}</UiBadge>
          </div>
          <div class="enhancer-dropdown">
            <button 
              class="enhancer-trigger"
              @click="showPromptDropdown = !showPromptDropdown"
            >
              <span>选择提示词模板</span>
              <ChevronDown :size="14" :class="{ 'rotate': showPromptDropdown }" />
            </button>
            <Transition name="dropdown">
              <div v-if="showPromptDropdown" class="enhancer-menu">
                <div v-if="availablePrompts.length === 0" class="enhancer-empty">
                  暂无提示词模板
                </div>
                <button
                  v-for="prompt in availablePrompts"
                  :key="prompt.id"
                  class="enhancer-item"
                  @click="handleApplyPrompt(prompt)"
                >
                  <div class="enhancer-item-content">
                    <div class="enhancer-item-title">{{ prompt.title }}</div>
                    <div class="enhancer-item-scene">{{ prompt.scene }}</div>
                  </div>
                </button>
              </div>
            </Transition>
          </div>
        </div>

        <div class="enhancer-section">
          <div class="enhancer-header">
            <Sparkles :size="14" />
            <span>启用技能</span>
            <UiBadge v-if="enabledSkillsCount > 0" tone="success" size="sm">{{ enabledSkillsCount }}</UiBadge>
          </div>
          <div class="enhancer-dropdown">
            <button 
              class="enhancer-trigger"
              @click="showSkillDropdown = !showSkillDropdown"
            >
              <span>选择要启用的技能</span>
              <ChevronDown :size="14" :class="{ 'rotate': showSkillDropdown }" />
            </button>
            <Transition name="dropdown">
              <div v-if="showSkillDropdown" class="enhancer-menu">
                <div v-if="availableSkills.length === 0" class="enhancer-empty">
                  暂无可用技能
                </div>
                <button
                  v-for="skill in availableSkills"
                  :key="skill.id"
                  class="enhancer-item"
                  :class="{ 'enhancer-item--active': skill.enabled }"
                  @click="handleToggleSkill(skill)"
                >
                  <div class="enhancer-item-content">
                    <div class="enhancer-item-title">
                      {{ skill.name }}
                      <Check v-if="skill.enabled" :size="12" class="check-icon" />
                    </div>
                    <div class="enhancer-item-desc">{{ skill.description }}</div>
                  </div>
                </button>
              </div>
            </Transition>
          </div>
        </div>
      </div>

      <label class="input-composer__upload">
        <Upload :size="16" />
        <span>上传 txt / md / pdf / word / 图片</span>
        <input
          type="file"
          multiple
          accept=".txt,.md,.pdf,.doc,.docx,image/*"
          @change="$emit('attach', ($event.target as HTMLInputElement).files)"
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

.input-composer__enhancers {
  display: grid;
  gap: 12px;
}

.enhancer-section {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.enhancer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--color-panel);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
}

.enhancer-dropdown {
  position: relative;
}

.enhancer-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: none;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.enhancer-trigger:hover {
  background: var(--color-panel);
  color: var(--color-text);
}

.enhancer-trigger .rotate {
  transform: rotate(180deg);
}

.enhancer-menu {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 100;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
  margin-top: 4px;
}

.enhancer-empty {
  padding: 20px;
  text-align: center;
  color: var(--color-muted);
  font-size: 13px;
}

.enhancer-item {
  width: 100%;
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.enhancer-item:hover {
  background: var(--color-panel);
}

.enhancer-item--active {
  background: var(--color-accent-soft);
}

.enhancer-item-content {
  flex: 1;
  min-width: 0;
}

.enhancer-item-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
}

.check-icon {
  color: var(--color-accent);
}

.enhancer-item-scene {
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-subtle);
}

.enhancer-item-desc {
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-subtle);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
