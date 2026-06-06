<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import PrivateSvg from '@/components/common/PrivateSvg.vue';
import { renderSvgToPng } from '@/services/svgRenderer';

const props = defineProps<{
  pages: Array<{ pageNumber: number; svg: string; speakerNotes: string }>;
  activeIndex: number;
}>();

const emit = defineEmits<{
  'update:activeIndex': [value: number];
}>();

const scale = ref(1);
const showNotes = ref(false);
const renderedPngs = ref<Map<number, string>>(new Map());
const renderingPages = ref<Set<number>>(new Set());

const currentNotes = computed(() => {
  if (props.pages.length === 0) return '';
  const idx = Math.min(props.activeIndex, props.pages.length - 1);
  return props.pages[idx]?.speakerNotes || '';
});

const currentSvg = computed(() => {
  if (props.pages.length === 0) return '';
  const idx = Math.min(props.activeIndex, props.pages.length - 1);
  return props.pages[idx]?.svg || '';
});

async function renderPageToPng(index: number) {
  const page = props.pages[index];
  if (!page?.svg || renderedPngs.value.has(index) || renderingPages.value.has(index)) return;

  renderingPages.value = new Set([...renderingPages.value, index]);

  try {
    const blob = await renderSvgToPng(page.svg, 1280, 720);
    const url = URL.createObjectURL(blob);

    const newMap = new Map(renderedPngs.value);
    newMap.set(index, url);
    renderedPngs.value = newMap;
  } catch {
    const newMap = new Map(renderedPngs.value);
    newMap.set(index, '');
    renderedPngs.value = newMap;
  } finally {
    const newSet = new Set(renderingPages.value);
    newSet.delete(index);
    renderingPages.value = newSet;
  }
}

watch(() => props.pages, () => {
  for (const url of renderedPngs.value.values()) {
    if (url) URL.revokeObjectURL(url);
  }
  renderedPngs.value = new Map();
  renderingPages.value = new Set();

  if (props.pages.length > 0) {
    renderPageToPng(props.activeIndex);
  }
}, { immediate: true });

watch(() => props.activeIndex, (newIdx) => {
  if (!renderedPngs.value.has(newIdx)) {
    renderPageToPng(newIdx);
  }
});

function selectPage(index: number) {
  emit('update:activeIndex', index);
}

function zoomIn() {
  scale.value = Math.min(2, scale.value + 0.1);
}

function zoomOut() {
  scale.value = Math.max(0.3, scale.value - 0.1);
}

</script>

<template>
  <div class="svg-deck-preview">
    <div class="svg-deck-preview__main" v-if="pages.length > 0">
      <div class="svg-deck-preview__toolbar">
        <span class="svg-deck-preview__page-info">{{ activeIndex + 1 }} / {{ pages.length }}</span>
        <div class="svg-deck-preview__zoom">
          <button class="svg-deck-preview__btn" @click="zoomOut" title="缩小">−</button>
          <span class="svg-deck-preview__zoom-value">{{ Math.round(scale * 100) }}%</span>
          <button class="svg-deck-preview__btn" @click="zoomIn" title="放大">+</button>
        </div>
        <button class="svg-deck-preview__btn" @click="showNotes = !showNotes" :class="{ 'svg-deck-preview__btn--active': showNotes }" title="演讲备注">📝</button>
      </div>
      <div class="svg-deck-preview__viewport">
        <div class="svg-deck-preview__canvas" :style="{ transform: `scale(${scale})` }">
          <PrivateSvg
            class="svg-deck-preview__slide"
            :svg="currentSvg"
          />
        </div>
      </div>
      <div v-if="showNotes && currentNotes" class="svg-deck-preview__notes">
        <strong>演讲备注</strong>
        <p>{{ currentNotes }}</p>
      </div>
    </div>
    <div v-else class="svg-deck-preview__empty">
      <p>暂无预览内容，请先生成 PPT</p>
    </div>
    <div class="svg-deck-preview__thumbnails" v-if="pages.length > 1">
      <div
        v-for="(page, index) in pages"
        :key="index"
        class="svg-deck-preview__thumb"
        :class="{ 'svg-deck-preview__thumb--active': index === activeIndex }"
        @click="selectPage(index)"
      >
        <img
          v-if="renderedPngs.get(index)"
          :src="renderedPngs.get(index)"
          class="svg-deck-preview__thumb-img"
          alt=""
        />
        <PrivateSvg v-else class="svg-deck-preview__thumb-svg" :svg="page.svg" />
        <span class="svg-deck-preview__thumb-num">{{ page.pageNumber }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.svg-deck-preview {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 12px;
}

.svg-deck-preview__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.svg-deck-preview__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-panel);
  border-radius: 8px 8px 0 0;
}

.svg-deck-preview__page-info {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}

.svg-deck-preview__zoom {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.svg-deck-preview__zoom-value {
  font-size: 11px;
  color: var(--color-muted);
  min-width: 36px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.svg-deck-preview__btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 14px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.svg-deck-preview__btn:hover {
  border-color: var(--color-border-strong);
  background: var(--color-panel);
}

.svg-deck-preview__btn--active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.svg-deck-preview__spin {
  animation: spin 1s linear infinite;
}

.svg-deck-preview__viewport {
  flex: 1;
  overflow: auto;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 420px;
  padding: 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-top: none;
  border-radius: 0 0 8px 8px;
}

.svg-deck-preview__canvas {
  width: min(100%, 1120px);
  aspect-ratio: 16 / 9;
  transform-origin: top center;
  transition: transform var(--transition-fast);
}

.svg-deck-preview__slide {
  width: 100%;
  height: 100%;
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
}

.svg-deck-preview__slide :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}

.svg-deck-preview__slide--loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--color-panel);
  color: var(--color-muted);
  font-size: 14px;
}

.svg-deck-preview__slide-img {
  width: 100%;
  height: 100%;
  border-radius: 4px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
  object-fit: cover;
  display: block;
}

.svg-deck-preview__notes {
  margin-top: 8px;
  padding: 10px 14px;
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 13px;
  color: var(--color-muted);
  max-height: 120px;
  overflow-y: auto;
}

.svg-deck-preview__notes strong {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--color-text);
}

.svg-deck-preview__notes p {
  margin: 0;
  line-height: 1.6;
}

.svg-deck-preview__empty {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--color-subtle);
  font-size: 14px;
}

.svg-deck-preview__thumbnails {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 4px 0;
}

.svg-deck-preview__thumb {
  flex-shrink: 0;
  width: 96px;
  height: 54px;
  border: 2px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  position: relative;
  transition: border-color var(--transition-fast);
}

.svg-deck-preview__thumb:hover {
  border-color: var(--color-border-strong);
}

.svg-deck-preview__thumb--active {
  border-color: var(--color-accent);
}

.svg-deck-preview__thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.svg-deck-preview__thumb-svg {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.svg-deck-preview__thumb-svg :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}

.svg-deck-preview__thumb-num {
  position: absolute;
  bottom: 2px;
  right: 4px;
  font-size: 9px;
  font-weight: 700;
  color: var(--color-text);
  background: var(--color-surface);
  padding: 1px 4px;
  border-radius: 3px;
  font-variant-numeric: tabular-nums;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
