<script setup lang="ts">
import { ref } from 'vue';
import { RefreshCw, GripVertical, Loader2, Plus, Trash2, MessageSquare, CheckSquare, Square, FileText } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiEmpty from '@/components/ui/UiEmpty.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
import type { SlideOutline } from '@/types/agent';
import { generateSuggestion, getSuggestionLabel, parseSuggestionResult, type SuggestionType } from '@/composables/useCopilot';
import { useToastStore } from '@/stores/toastStore';
import { slideNeedsImage } from '@/utils/slideVisuals';

const toastStore = useToastStore();

const props = defineProps<{
  outline: SlideOutline[];
  isRunning?: boolean;
  streamingText?: string;
}>();

const emit = defineEmits<{
  updateTitle: [id: string, title: string];
  updateBullet: [id: string, index: number, text: string];
  addBullet: [id: string];
  deleteBullet: [id: string, index: number];
  reorderBullet: [id: string, fromIndex: number, toIndex: number];
  updateNotes: [id: string, notes: string];
  updateVisualPrompt: [id: string, prompt: string];
  reorder: [fromIndex: number, toIndex: number];
  run: [];
  batchDelete: [ids: string[]];
  addSample: [];
}>();

// ---- Slide drag state ----
const dragIndex = ref<number | null>(null);
const dropIndex = ref<number | null>(null);

// ---- Batch selection ----
const selectedSlides = ref<Set<string>>(new Set());

const allSelected = ref(false);

function toggleSlide(id: string) {
  const next = new Set(selectedSlides.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  selectedSlides.value = next;
  allSelected.value = next.size === props.outline.length;
}

function toggleAllSlides() {
  if (allSelected.value) {
    selectedSlides.value = new Set();
    allSelected.value = false;
  } else {
    selectedSlides.value = new Set(props.outline.map(s => s.id));
    allSelected.value = true;
  }
}

function batchDeleteSlides() {
  if (selectedSlides.value.size === 0) return;
  emit('batchDelete', Array.from(selectedSlides.value));
  selectedSlides.value = new Set();
  allSelected.value = false;
}

function onSlideDragStart(index: number, event: DragEvent) {
  dragIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }
}

function onSlideDragOver(index: number, event: DragEvent) {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dropIndex.value = index;
}

function onSlideDragLeave() {
  dropIndex.value = null;
}

function onSlideDrop(index: number) {
  if (dragIndex.value !== null && dragIndex.value !== index) {
    emit('reorder', dragIndex.value, index);
  }
  dragIndex.value = null;
  dropIndex.value = null;
}

function onSlideDragEnd() {
  dragIndex.value = null;
  dropIndex.value = null;
}

// ---- Bullet editing state ----
const editingNotesId = ref<string | null>(null);

function onBulletKeydown(slide: SlideOutline, index: number, event: KeyboardEvent) {
  const target = event.target as HTMLInputElement;
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    emit('addBullet', slide.id);
    // Focus the new bullet after Vue renders
    requestAnimationFrame(() => {
      const container = document.querySelector(`[data-slide-id="${slide.id}"]`);
      if (container) {
        const inputs = container.querySelectorAll('.bullet-input');
        if (inputs[index + 1]) {
          (inputs[index + 1] as HTMLInputElement).focus();
        }
      }
    });
  } else if (event.key === 'Backspace' && target.value === '' && slide.bullets.length > 1) {
    event.preventDefault();
    emit('deleteBullet', slide.id, index);
    requestAnimationFrame(() => {
      const container = document.querySelector(`[data-slide-id="${slide.id}"]`);
      if (container) {
        const inputs = container.querySelectorAll('.bullet-input');
        const focusIndex = Math.min(index, inputs.length - 1);
        if (inputs[focusIndex]) {
          (inputs[focusIndex] as HTMLInputElement).focus();
        }
      }
    });
  }
}

// ---- Bullet drag state ----
const bulletDragState = ref<{ slideId: string; fromIndex: number } | null>(null);
const bulletDropIndex = ref<{ slideId: string; index: number } | null>(null);

function onBulletDragStart(slideId: string, index: number, event: DragEvent) {
  bulletDragState.value = { slideId, fromIndex: index };
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
}

function onBulletDragOver(slideId: string, index: number, event: DragEvent) {
  if (bulletDragState.value?.slideId !== slideId) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  bulletDropIndex.value = { slideId, index };
}

function onBulletDrop(slideId: string, index: number) {
  if (bulletDragState.value && bulletDragState.value.slideId === slideId && bulletDragState.value.fromIndex !== index) {
    emit('reorderBullet', slideId, bulletDragState.value.fromIndex, index);
  }
  bulletDragState.value = null;
  bulletDropIndex.value = null;
}

function onBulletDragEnd() {
  bulletDragState.value = null;
  bulletDropIndex.value = null;
}

function toggleNotes(slideId: string) {
  editingNotesId.value = editingNotesId.value === slideId ? null : slideId;
}

// ---- AI Copilot state ----
const copilotActive = ref<{ slideId: string; type: SuggestionType } | null>(null);
const copilotResults = ref<Record<string, string>>({});
const copilotLoading = ref<Record<string, boolean>>({});

async function runCopilot(slideId: string, type: SuggestionType) {
  const slide = props.outline.find(s => s.id === slideId);
  if (!slide) return;

  const key = `${slideId}-${type}`;
  copilotActive.value = { slideId, type };
  copilotLoading.value[key] = true;
  copilotResults.value[key] = '';

  try {
    const text = await generateSuggestion(type, slide.title, slide.bullets, (content) => {
      copilotResults.value[key] = content;
    });

    const parsed = parseSuggestionResult(text);
    if (parsed) {
      emit('updateTitle', slideId, parsed.title);
      // Replace bullets
      slide.bullets.forEach((_, i) => {
        if (parsed.bullets[i] !== undefined) {
          emit('updateBullet', slideId, i, parsed.bullets[i]);
        }
      });
      // Add extra bullets if AI generated more
      for (let i = slide.bullets.length; i < parsed.bullets.length; i++) {
        emit('addBullet', slideId);
        // Need to wait for reactivity, then set value
        setTimeout(() => emit('updateBullet', slideId, i, parsed.bullets[i]), 50);
      }
      toastStore.success('建议已应用', getSuggestionLabel(type));
    }
    copilotActive.value = null;
  } catch {
    toastStore.error('生成建议失败', '请检查模型配置');
    copilotActive.value = null;
  } finally {
    copilotLoading.value[key] = false;
  }
}

function getCopilotResult(slideId: string, type: SuggestionType): string {
  return copilotResults.value[`${slideId}-${type}`] || '';
}

function isCopilotLoading(slideId: string, type: SuggestionType): boolean {
  return !!copilotLoading.value[`${slideId}-${type}`];
}

const copilotTypes: SuggestionType[] = ['polish', 'condense', 'expand'];
</script>

<template>
  <UiCard title="大纲" subtitle="调整页面顺序、要点、讲稿和图片需求。修改后会影响后续页面生成。">
    <template #actions>
      <UiButton size="sm" variant="secondary" :disabled="isRunning" @click="$emit('run')">
        <RefreshCw :size="13" :class="{ 'animate-spin': isRunning }" />
        {{ isRunning ? '生成中...' : outline.length ? '重新生成大纲' : '生成大纲' }}
      </UiButton>
    </template>

    <div v-if="isRunning && streamingText" class="streaming-container">
      <div class="streaming-header">
        <Loader2 :size="16" class="animate-spin" />
        <span>正在整理大纲...</span>
      </div>
      <div class="streaming-content">
        <pre class="streaming-text">{{ streamingText }}</pre>
        <span class="streaming-cursor">|</span>
      </div>
    </div>

    <div v-else-if="outline.length" class="outline-editor">
      <!-- Batch toolbar -->
      <Transition name="slide-fade">
        <div v-if="selectedSlides.size > 0" class="batch-bar">
          <span class="batch-bar__info">
            <CheckSquare :size="14" />
            已选 {{ selectedSlides.size }} 页
          </span>
          <div class="batch-bar__actions">
            <UiButton size="sm" variant="danger" @click="batchDeleteSlides">
              <Trash2 :size="12" />
              删除选中
            </UiButton>
            <UiButton size="sm" variant="ghost" @click="selectedSlides = new Set(); allSelected = false">
              取消
            </UiButton>
          </div>
        </div>
      </Transition>

      <article
        v-for="(slide, index) in outline"
        :key="slide.id"
        :data-slide-id="slide.id"
        class="outline-slide"
        :class="{
          'outline-slide--dragging': dragIndex === index,
          'outline-slide--drop-target': dropIndex === index && dragIndex !== index,
          'outline-slide--selected': selectedSlides.has(slide.id)
        }"
        draggable="true"
        @dragstart="onSlideDragStart(index, $event)"
        @dragover="onSlideDragOver(index, $event)"
        @dragleave="onSlideDragLeave"
        @drop="onSlideDrop(index)"
        @dragend="onSlideDragEnd"
      >
        <div class="outline-slide__header">
          <button class="slide-checkbox" @click.stop="toggleSlide(slide.id)">
            <component :is="selectedSlides.has(slide.id) ? CheckSquare : Square" :size="14" />
          </button>
          <div class="outline-slide__index">
            <GripVertical :size="13" class="drag-handle" />
            <span>{{ index + 1 }}</span>
          </div>
          <UiInput
            :model-value="slide.title"
            placeholder="幻灯片标题"
            @update:model-value="$emit('updateTitle', slide.id, $event)"
          />
        </div>

        <div class="outline-slide__content">
          <div class="outline-slide__bullets-wrapper">
            <div
              v-for="(bullet, bIndex) in slide.bullets"
              :key="bIndex"
              class="bullet-row"
              :class="{
                'bullet-row--drag-over': bulletDropIndex?.slideId === slide.id && bulletDropIndex?.index === bIndex
              }"
              draggable="true"
              @dragstart="onBulletDragStart(slide.id, bIndex, $event)"
              @dragover="onBulletDragOver(slide.id, bIndex, $event)"
              @drop="onBulletDrop(slide.id, bIndex)"
              @dragend="onBulletDragEnd"
            >
              <span class="bullet-grip">
                <GripVertical :size="10" />
              </span>
              <input
                class="bullet-input"
                :value="bullet"
                :placeholder="`要点 ${bIndex + 1}`"
                @input="$emit('updateBullet', slide.id, bIndex, ($event.target as HTMLInputElement).value)"
                @keydown="onBulletKeydown(slide, bIndex, $event)"
              />
              <button
                v-if="slide.bullets.length > 1"
                class="bullet-remove"
                title="删除要点"
                @click="$emit('deleteBullet', slide.id, bIndex)"
              >
                <Trash2 :size="11" />
              </button>
            </div>
            <button class="bullet-add" @click="$emit('addBullet', slide.id)">
              <Plus :size="11" />
              <span>添加要点</span>
            </button>
          </div>

          <!-- Speaker notes inline editor -->
          <div class="outline-slide__notes-section">
            <button class="notes-toggle" :class="{ 'notes-toggle--open': editingNotesId === slide.id }" @click="toggleNotes(slide.id)">
              <MessageSquare :size="12" />
              <span>{{ slide.speakerNotes ? '编辑讲稿' : '添加讲稿' }}</span>
              <UiBadge v-if="slide.speakerNotes" tone="info" size="sm">已添加</UiBadge>
            </button>
            <Transition name="slide-fade">
              <textarea
                v-if="editingNotesId === slide.id"
                class="notes-editor"
                :value="slide.speakerNotes"
                placeholder="输入演讲备注/讲稿..."
                rows="3"
                @input="$emit('updateNotes', slide.id, ($event.target as HTMLTextAreaElement).value)"
              />
            </Transition>
          </div>

          <div class="outline-slide__visual-section">
            <div class="visual-row">
              <UiBadge :tone="slideNeedsImage(slide) ? 'success' : 'neutral'" size="sm">
                {{ slideNeedsImage(slide) ? '需要图片' : '无需图片' }}
              </UiBadge>
              <input
                class="visual-input"
                :value="slide.visualPrompt"
                placeholder="图片需求，例如：产品场景图、流程示意图、封面插图"
                @input="$emit('updateVisualPrompt', slide.id, ($event.target as HTMLInputElement).value)"
              />
            </div>
          </div>

          <div v-if="slide.chartHint" class="outline-slide__chart">
            <UiBadge tone="warning" size="sm">图表建议</UiBadge>
            <span>{{ slide.chartHint }}</span>
          </div>

          <!-- AI Copilot -->
          <div class="copilot-section">
            <div class="copilot-triggers">
              <button
                v-for="cType in copilotTypes"
                :key="cType"
                class="copilot-btn"
                :class="{ 'copilot-btn--loading': isCopilotLoading(slide.id, cType) }"
                :disabled="isCopilotLoading(slide.id, cType)"
                @click="runCopilot(slide.id, cType)"
              >
                <Loader2 v-if="isCopilotLoading(slide.id, cType)" :size="10" class="animate-spin" />
                <FileText v-else :size="10" />
                {{ getSuggestionLabel(cType) }}
              </button>
            </div>
            <Transition name="slide-fade">
              <div
                v-if="getCopilotResult(slide.id, copilotTypes[0]) ||
                  getCopilotResult(slide.id, copilotTypes[1]) ||
                  getCopilotResult(slide.id, copilotTypes[2])"
                class="copilot-preview"
              >
                <pre class="copilot-preview__text">{{ getCopilotResult(slide.id, 'polish') || getCopilotResult(slide.id, 'condense') || getCopilotResult(slide.id, 'expand') }}</pre>
              </div>
            </Transition>
          </div>
        </div>
      </article>
    </div>

    <UiEmpty
      v-else
      title="还没有大纲"
      description="运行文本分析生成大纲，或使用示例数据快速开始"
    >
      <div class="empty-actions">
        <UiButton size="sm" :disabled="isRunning" @click="$emit('run')">
          <RefreshCw :size="13" />
          运行文本分析
        </UiButton>
        <UiButton size="sm" variant="secondary" @click="$emit('addSample')">
          <FileText :size="13" />
          使用示例数据
        </UiButton>
      </div>
    </UiEmpty>
  </UiCard>
</template>

<style scoped>
.streaming-container {
  padding: 16px;
  border: 1px solid var(--color-accent-soft);
  border-radius: var(--radius-md);
  background: var(--color-accent-soft);
}

.streaming-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--color-accent);
  font-size: 13px;
  font-weight: 500;
}

.streaming-content {
  position: relative;
  max-height: 300px;
  overflow-y: auto;
  padding: 12px;
  background: var(--color-panel);
  border-radius: 8px;
  border: 1px solid var(--color-border);
}

.streaming-text {
  margin: 0;
  padding: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
}

.streaming-cursor {
  display: inline-block;
  color: var(--color-accent);
  font-weight: bold;
  animation: blink 1s infinite;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.outline-editor {
  display: grid;
  gap: var(--space-3);
}

/* Batch bar */
.batch-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border: 1px solid var(--color-accent);
  border-radius: 8px;
  background: var(--color-accent-soft);
}

.batch-bar__info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-accent);
}

.batch-bar__actions {
  display: flex;
  gap: 6px;
}

/* Slide checkbox */
.slide-checkbox {
  display: grid;
  place-items: center;
  background: transparent;
  border: none;
  color: var(--color-muted);
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  flex-shrink: 0;
  transition: color var(--transition-fast);
}

.slide-checkbox:hover {
  color: var(--color-accent);
}

.empty-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.outline-slide--selected {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.outline-slide {
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-panel);
  transition: border-color var(--transition-fast), opacity var(--transition-fast), box-shadow var(--transition-fast);
}

.outline-slide:hover {
  border-color: var(--color-border-strong);
}

.outline-slide--dragging {
  opacity: 0.4;
}

.outline-slide--drop-target {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-accent-soft);
}

.outline-slide__header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.outline-slide__index {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  color: var(--color-subtle);
  cursor: grab;
}

.outline-slide__index:active {
  cursor: grabbing;
}

.drag-handle {
  opacity: 0.4;
  transition: opacity var(--transition-fast);
}

.outline-slide:hover .drag-handle {
  opacity: 0.8;
}

.outline-slide__index span {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
}

.outline-slide__content {
  padding-left: 36px;
  display: grid;
  gap: 10px;
}

/* ---- Bullets ---- */
.outline-slide__bullets-wrapper {
  display: grid;
  gap: 4px;
}

.bullet-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  border-radius: 6px;
  transition: background var(--transition-fast);
}

.bullet-row:hover {
  background: var(--color-surface);
}

.bullet-row--drag-over {
  background: var(--color-accent-soft);
  outline: 1px dashed var(--color-accent);
}

.bullet-grip {
  display: grid;
  place-items: center;
  opacity: 0;
  color: var(--color-muted);
  cursor: grab;
  flex-shrink: 0;
  transition: opacity var(--transition-fast);
}

.bullet-row:hover .bullet-grip,
.bullet-row:focus-within .bullet-grip {
  opacity: 0.5;
}

.bullet-grip:active {
  cursor: grabbing;
}

.bullet-input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.5;
  font-family: inherit;
  transition: all var(--transition-fast);
  outline: none;
}

.bullet-input:hover {
  background: var(--color-surface);
  border-color: var(--color-border);
}

.bullet-input:focus {
  background: var(--color-surface);
  border-color: var(--color-accent);
  color: var(--color-text);
}

.bullet-input::placeholder {
  color: var(--color-placeholder);
  font-size: 12px;
}

.bullet-remove {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  opacity: 0;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.bullet-row:hover .bullet-remove {
  opacity: 0.5;
}

.bullet-remove:hover {
  opacity: 1 !important;
  background: var(--color-danger-soft);
  color: var(--color-danger);
}

.bullet-add {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--transition-fast);
  margin-top: 2px;
}

.bullet-add:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

/* ---- Notes ---- */
.outline-slide__notes-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.outline-slide__visual-section {
  margin-top: 8px;
}

.visual-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.visual-input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--color-text);
  font-size: 12px;
}

.visual-input::placeholder {
  color: var(--color-subtle);
}

.notes-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all var(--transition-fast);
  width: fit-content;
}

.notes-toggle:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.notes-toggle--open {
  border-color: var(--color-info);
  color: var(--color-info);
}

.notes-editor {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 12px;
  line-height: 1.6;
  font-family: inherit;
  resize: vertical;
  transition: border-color var(--transition-fast);
}

.notes-editor:focus {
  outline: none;
  border-color: var(--color-accent);
}

.notes-editor::placeholder {
  color: var(--color-placeholder);
}

/* ---- Chart hint ---- */
.outline-slide__chart {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--color-muted);
  line-height: 1.5;
  background: var(--color-warning-soft);
}

/* ---- Animations ---- */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.15s ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.animate-spin {
  animation: spin 1s linear infinite;
}

/* ---- Copilot ---- */
.copilot-section {
  margin-top: 4px;
}

.copilot-triggers {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.copilot-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.copilot-btn:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.copilot-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.copilot-btn--loading {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.copilot-preview {
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid var(--color-accent-soft);
  border-radius: 8px;
  background: var(--color-accent-soft);
  max-height: 200px;
  overflow-y: auto;
}

.copilot-preview__text {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
