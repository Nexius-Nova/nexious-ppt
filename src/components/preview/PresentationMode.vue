<script setup lang="ts">
import { onMounted, onUnmounted, watch, ref } from 'vue';
import { X, ChevronLeft, ChevronRight } from 'lucide-vue-next';
import PrivateBackground from '@/components/common/PrivateBackground.vue';
import { getTemplateColors } from '@/composables/templateColors';
import type { SlideOutline, GeneratedImage, AgentParameters } from '@/types/agent';

const props = defineProps<{
  show: boolean;
  outline: SlideOutline[];
  imageMap: Map<string, GeneratedImage>;
  parameters: AgentParameters;
  startIndex?: number;
}>();

const emit = defineEmits<{
  close: [];
}>();

const currentIndex = ref(props.startIndex || 0);
const currentSlide = ref<SlideOutline | null>(props.outline[currentIndex.value] || null);

function getColor() {
  return getTemplateColors(props.parameters.template);
}

watch(currentIndex, (idx) => {
  currentSlide.value = props.outline[idx] || null;
});

watch(() => props.startIndex, (idx) => {
  if (idx !== undefined) currentIndex.value = idx;
});

function prev() {
  if (currentIndex.value > 0) currentIndex.value--;
}

function next() {
  if (currentIndex.value < props.outline.length - 1) currentIndex.value++;
}

function isEditingElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
}

function onKeyDown(event: KeyboardEvent) {
  if (!props.show || isEditingElement(event.target)) return;
  if (event.key === 'Escape') emit('close');
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === ' ') {
    event.preventDefault();
    next();
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    prev();
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
});

function currentImage(): GeneratedImage | null {
  const slide = currentSlide.value;
  if (!slide) return null;
  return props.imageMap.get(slide.id) || null;
}
</script>

<template>
  <Teleport to="body">
    <Transition name="present-fade">
      <div v-if="show" class="present-overlay">
        <div class="present-bar present-bar--top">
          <span class="present-slide-count">{{ currentIndex + 1 }} / {{ outline.length }}</span>
          <button class="present-close" @click="$emit('close')">
            <X :size="20" />
          </button>
        </div>

        <div class="present-canvas" :class="`present-canvas--${currentSlide?.layout || 'text-only'}`" :style="{ background: getColor().bg }">
          <div class="present-accent-strip" :style="{ background: getColor().accent }" />
          <!-- text-only / text-image / image-text: structured content -->
          <div v-if="(currentSlide?.layout || 'text-only') !== 'full-image'" class="present-content" :class="{ 'present-content--right': (currentSlide?.layout || 'text-only') === 'image-text' }">
            <div class="present-slide-label" :style="{ color: getColor().accent }">
              SLIDE {{ String(currentIndex + 1).padStart(2, '0') }}
            </div>
            <h1 v-if="currentSlide" :style="{ color: getColor().text }">{{ currentSlide.title }}</h1>
            <ul v-if="currentSlide" :style="{ color: getColor().muted }">
              <li v-for="(bullet, i) in currentSlide?.bullets" :key="i">{{ bullet }}</li>
            </ul>
          </div>
          <!-- full-image: title overlay -->
          <div v-else class="present-content present-content--overlay">
            <h1 v-if="currentSlide" :style="{ color: getColor().text, textShadow: '0 2px 12px rgba(0,0,0,0.5)' }">{{ currentSlide.title }}</h1>
          </div>
          <!-- Image -->
          <PrivateBackground
            v-if="(currentSlide?.layout || 'text-only') !== 'text-only' && currentImage()?.url"
            class="present-image"
            :src="currentImage()?.url"
            :class="{
              'present-image--right': (currentSlide?.layout || 'text-only') === 'text-image',
              'present-image--left': (currentSlide?.layout || 'text-only') === 'image-text',
              'present-image--full': (currentSlide?.layout || 'text-only') === 'full-image'
            }"
          />
          <div
            v-if="(currentSlide?.layout || 'text-only') !== 'text-only' && !currentImage()?.url"
            class="present-image present-image--placeholder"
            :class="{
              'present-image--right': (currentSlide?.layout || 'text-only') === 'text-image',
              'present-image--left': (currentSlide?.layout || 'text-only') === 'image-text',
              'present-image--full': (currentSlide?.layout || 'text-only') === 'full-image'
            }"
          >
            <span class="present-image__hint">暂无图片</span>
          </div>
        </div>

        <div class="present-bar present-bar--bottom">
          <button class="present-nav" :disabled="currentIndex === 0" @click="prev">
            <ChevronLeft :size="22" />
          </button>
          <div class="present-dots">
            <span
              v-for="(_, i) in outline"
              :key="i"
              class="present-dot"
              :class="{ 'present-dot--active': i === currentIndex }"
              @click="currentIndex = i"
            />
          </div>
          <button class="present-nav" :disabled="currentIndex >= outline.length - 1" @click="next">
            <ChevronRight :size="22" />
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.present-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  background: #000;
}

.present-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 24px;
  background: rgba(255, 255, 255, 0.03);
  z-index: 10;
}

.present-bar--top {
  justify-content: space-between;
}

.present-bar--bottom {
  gap: 16px;
}

.present-slide-count {
  color: #888;
  font-family: var(--font-mono);
  font-size: 13px;
}

.present-close {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  background: transparent;
  color: #aaa;
  cursor: pointer;
  transition: all 0.15s ease;
}

.present-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.present-canvas {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 48px;
  padding: 40px 60px;
  position: relative;
}

.present-canvas--text-only {
  justify-content: center;
}

.present-canvas--text-image,
.present-canvas--image-text {
  flex-direction: row;
}

.present-canvas--full-image {
  padding: 0;
}

.present-accent-strip {
  position: absolute;
  top: 0;
  left: 0;
  width: 5px;
  height: 100%;
  opacity: 0.5;
  z-index: 3;
}

.present-content {
  max-width: 600px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  z-index: 1;
}

.present-content--right {
  order: 1;
}

.present-content--overlay {
  position: absolute;
  bottom: 60px;
  left: 60px;
  right: 60px;
  max-width: none;
  z-index: 2;
}

.present-slide-label {
  font-family: 'Cascadia Code', monospace;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 2px;
}

.present-content h1 {
  margin: 0;
  font-size: 36px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.02em;
}

.present-content ul {
  margin: 0;
  padding-left: 22px;
  font-size: 18px;
  line-height: 1.8;
}

.present-image {
  width: 320px;
  aspect-ratio: 4 / 3;
  background-size: cover;
  background-position: center;
  border-radius: 12px;
  flex-shrink: 0;
  z-index: 1;
}

.present-image--right {
  order: 2;
}

.present-image--left {
  order: 0;
}

.present-image--full {
  position: absolute;
  inset: 0;
  width: 100%;
  aspect-ratio: auto;
  border-radius: 0;
}

.present-image--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.02);
}

.present-image__hint {
  font-size: 14px;
  color: rgba(255,255,255,0.2);
}

.present-nav {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  color: #aaa;
  cursor: pointer;
  transition: all 0.15s ease;
}

.present-nav:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.present-nav:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.present-dots {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  max-width: 60%;
  padding: 4px 0;
}

.present-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  cursor: pointer;
  transition: all 0.15s ease;
}

.present-dot:hover {
  background: rgba(255, 255, 255, 0.4);
}

.present-dot--active {
  background: var(--color-accent);
  width: 24px;
  border-radius: 4px;
}

.present-fade-enter-active,
.present-fade-leave-active {
  transition: opacity 0.2s ease;
}

.present-fade-enter-from,
.present-fade-leave-to {
  opacity: 0;
}
</style>
