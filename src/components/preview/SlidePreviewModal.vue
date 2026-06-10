<script setup lang="ts">
import { ChevronLeft, ChevronRight, X, Maximize2 } from 'lucide-vue-next';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiButton from '@/components/ui/UiButton.vue';
import PrivateBackground from '@/components/common/PrivateBackground.vue';
import { getTemplateColors } from '@/composables/templateColors';
import { layoutNeedsVisual, normalizeSlideLayout } from '@/utils/layoutSemantics';
import type { SlideOutline, GeneratedImage, AgentParameters } from '@/types/agent';

const props = defineProps<{
  show: boolean;
  slide: SlideOutline | null;
  index: number;
  total: number;
  image: GeneratedImage | null;
  parameters: AgentParameters;
}>();

const emit = defineEmits<{
  close: [];
  prev: [];
  next: [];
  present: [];
}>();

function getTemplateColor() {
  return getTemplateColors(props.parameters.template);
}

function currentLayout() {
  return normalizeSlideLayout(props.slide?.layout);
}

function currentNeedsVisual() {
  return layoutNeedsVisual(props.slide?.layout);
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close');
  if (event.key === 'ArrowLeft') emit('prev');
  if (event.key === 'ArrowRight') emit('next');
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="show && slide" class="preview-overlay" @keydown="onKeyDown" tabindex="-1">
        <div class="preview-toolbar">
          <div class="preview-toolbar__info">
            <UiBadge tone="accent" size="sm">{{ index + 1 }} / {{ total }}</UiBadge>
            <span class="preview-toolbar__title">{{ slide.title }}</span>
          </div>
          <div class="preview-toolbar__actions">
            <UiButton size="sm" variant="secondary" @click="$emit('present')">
              <Maximize2 :size="13" />
              演示
            </UiButton>
            <button class="preview-nav-btn" :disabled="index === 0" @click="$emit('prev')">
              <ChevronLeft :size="18" />
            </button>
            <button class="preview-nav-btn" :disabled="index >= total - 1" @click="$emit('next')">
              <ChevronRight :size="18" />
            </button>
            <button class="preview-close-btn" @click="$emit('close')">
              <X :size="18" />
            </button>
          </div>
        </div>

        <div class="preview-canvas-wrapper">
          <div
            class="preview-canvas"
            :class="`preview-canvas--${currentLayout()}`"
            :style="{
              background: getTemplateColor().bg,
              borderColor: getTemplateColor().panel
            }"
          >
            <div class="preview-meta" :style="{ color: getTemplateColor().accent }">
              SLIDE {{ String(index + 1).padStart(2, '0') }}
            </div>
            <!-- Structured content -->
            <div v-if="currentLayout() !== 'visual-focus'" class="preview-text-block">
              <h2 :style="{ color: getTemplateColor().text }">{{ slide.title }}</h2>
              <ul :style="{ color: getTemplateColor().muted }">
                <li v-for="bullet in slide.bullets" :key="bullet">{{ bullet }}</li>
              </ul>
            </div>
            <!-- full-image: title overlay -->
            <h2 v-else class="preview-title-overlay" :style="{ color: getTemplateColor().text }">{{ slide.title }}</h2>
            <!-- Image -->
            <PrivateBackground
              v-if="currentNeedsVisual() && image?.url"
              class="preview-image"
              :src="image.url"
              :class="{
                'preview-image--full': currentLayout() === 'visual-focus'
              }"
            />
            <div
              v-if="currentNeedsVisual() && !image?.url"
              class="preview-image preview-image--placeholder"
              :class="{
                'preview-image--full': currentLayout() === 'visual-focus'
              }"
            >
              <span class="preview-image__hint">暂无图片</span>
            </div>
          </div>
        </div>

        <p v-if="slide.speakerNotes" class="preview-notes">
          {{ slide.speakerNotes }}
        </p>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 9998;
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
  outline: none;
}

.preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: rgba(0, 0, 0, 0.4);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.preview-toolbar__info {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.preview-toolbar__title {
  color: #e0e0e0;
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-toolbar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-nav-btn,
.preview-close-btn {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: #ccc;
  cursor: pointer;
  transition: all 0.15s ease;
}

.preview-nav-btn:hover:not(:disabled),
.preview-close-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.preview-nav-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.preview-canvas-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overflow: auto;
}

.preview-canvas {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 16px;
  width: 100%;
  max-width: 800px;
  aspect-ratio: 16 / 9;
  padding: 40px 48px;
  border: 1px solid;
  border-radius: 16px;
  position: relative;
  overflow: hidden;
}

.preview-canvas--text-only .preview-text-block {
  width: 100%;
}

.preview-canvas--text-image,
.preview-canvas--image-text,
.preview-canvas--mixed-media,
.preview-canvas--media-grid {
  flex-direction: row;
  align-items: center;
  gap: 20px;
}

.preview-canvas--full-image,
.preview-canvas--visual-focus {
  padding: 0;
}

.preview-meta {
  font-family: 'Cascadia Code', monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  z-index: 3;
}

.preview-text-block {
  flex: 1;
  min-width: 0;
  z-index: 1;
}

.preview-text-block--right {
  order: 1;
}

.preview-title-overlay {
  position: absolute;
  bottom: 40px;
  left: 48px;
  right: 48px;
  z-index: 2;
  margin: 0;
  font-size: 32px;
  font-weight: 700;
  text-shadow: 0 2px 12px rgba(0,0,0,0.5);
}

.preview-canvas h2 {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.02em;
}

.preview-canvas ul {
  margin: 0;
  padding-left: 20px;
  font-size: 15px;
  line-height: 1.7;
}

.preview-image {
  flex: 0 0 35%;
  aspect-ratio: 4 / 3;
  background-size: cover;
  background-position: center;
  border-radius: 10px;
  z-index: 1;
}

.preview-image--right {
  order: 2;
  margin-left: 4px;
}

.preview-image--left {
  order: 0;
  margin-right: 4px;
}

.preview-image--full {
  position: absolute;
  inset: 0;
  flex: none;
  width: 100%;
  aspect-ratio: auto;
  border-radius: 16px;
  margin: 0;
}

.preview-image--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.02);
}

.preview-image__hint {
  font-size: 13px;
  color: rgba(255,255,255,0.2);
}

.preview-notes {
  margin: 0;
  padding: 12px 20px;
  background: rgba(0, 0, 0, 0.4);
  color: #aaa;
  font-size: 13px;
  line-height: 1.5;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

/* Transition */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
