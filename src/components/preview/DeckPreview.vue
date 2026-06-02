<script setup lang="ts">
import { computed, ref } from 'vue';
import { Download, Maximize2, FileText } from 'lucide-vue-next';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiEmpty from '@/components/ui/UiEmpty.vue';
import SlidePreviewModal from './SlidePreviewModal.vue';
import PresentationMode from './PresentationMode.vue';
import { getTemplateColors, accentToTemplateColors } from '@/composables/templateColors';
import type { AgentParameters, ExportArtifact, GeneratedImage, SlideOutline } from '@/types/agent';

const props = defineProps<{
  outline: SlideOutline[];
  selectedImages: GeneratedImage[];
  parameters: AgentParameters;
  artifacts: ExportArtifact[];
  showExportActions?: boolean;
}>();

defineEmits<{
  export: [format: 'pptx' | 'pdf'];
}>();

const colors = computed(() => getTemplateColors(props.parameters.template));

function getTemplateAccent(template: string): string {
  return getTemplateColors(template).accent;
}

const imageBySlide = computed(() => {
  const map = new Map<string, GeneratedImage>();
  for (const image of props.selectedImages) {
    map.set(image.slideId, image);
  }
  return map;
});

// ---- Preview modal state ----
const previewIndex = ref(0);
const showPreview = ref(false);
const showPresentation = ref(false);
const presentationStartIndex = ref(0);

function openPreview(index: number) {
  previewIndex.value = index;
  showPreview.value = true;
}

function openPresentation(index: number) {
  presentationStartIndex.value = index;
  showPresentation.value = true;
}

function getTemplateLabel(template: string) {
  const map: Record<string, string> = { business: '商务', creative: '创意', education: '教育' };
  return map[template] || template;
}

function getLayoutLabel(layout?: string): string {
  const map: Record<string, string> = {
    'text-only': '纯文字', 'text-image': '左文右图', 'image-text': '左图右文',
    'full-image': '全幅', 'title-center': '居中标题', 'two-column': '双栏'
  };
  return map[layout || 'text-only'] || layout || '纯文字';
}
</script>

<template>
  <div>
    <UiCard title="PPT 预览" subtitle="点击幻灯片放大查看，支持全屏演示">
      <div v-if="outline.length" class="deck-preview">
        <!-- Thumbnail strip -->
        <div class="thumbnail-strip">
          <button
            v-for="(slide, i) in outline"
            :key="slide.id"
            class="thumbnail-item"
            :class="{ 'thumbnail-item--active': previewIndex === i && (showPreview || showPresentation) }"
            @click="openPreview(i)"
            :title="slide.title"
          >
            <span class="thumbnail-num">{{ i + 1 }}</span>
            <span class="thumbnail-title">{{ slide.title }}</span>
          </button>
        </div>

        <!-- Main slide cards -->
        <div class="slide-list">
          <article
            v-for="(slide, index) in outline"
            :key="slide.id"
            class="preview-slide-card"
            @click="openPreview(index)"
          >
            <div
              class="preview-slide-canvas"
              :class="`preview-slide-canvas--${slide.layout || 'text-only'}`"
              :style="{ background: colors.bg }"
            >
              <!-- text-only / text-image / image-text: show content block -->
              <div v-if="(slide.layout || 'text-only') !== 'full-image'" class="preview-content" :class="(slide.layout || 'text-only') === 'image-text' ? 'preview-content--right' : ''">
                <div class="preview-meta">
                  <UiBadge tone="accent" size="sm">Slide {{ index + 1 }}</UiBadge>
                  <span class="preview-layout-tag">{{ getLayoutLabel(slide.layout) }}</span>
                </div>
                <h3 :style="{ color: colors.text }">{{ slide.title }}</h3>
                <ul :style="{ color: colors.muted }">
                  <li v-for="bullet in slide.bullets.slice(0, (slide.layout || 'text-only') === 'text-only' ? 4 : 3)" :key="bullet">{{ bullet }}</li>
                  <li v-if="slide.bullets.length > ((slide.layout || 'text-only') === 'text-only' ? 4 : 3)" class="preview-more">+{{ slide.bullets.length - ((slide.layout || 'text-only') === 'text-only' ? 4 : 3) }} 更多</li>
                </ul>
              </div>
              <!-- Full-image: title overlay -->
              <div v-else class="preview-content preview-content--overlay">
                <h3 :style="{ color: colors.text, textShadow: '0 2px 8px rgba(0,0,0,0.6)' }">{{ slide.title }}</h3>
              </div>
              <!-- Image area -->
              <div
                v-if="(slide.layout || 'text-only') !== 'text-only' && imageBySlide.get(slide.id)?.url"
                class="preview-visual"
                :class="{
                  'preview-visual--right': (slide.layout || 'text-only') === 'text-image',
                  'preview-visual--left': (slide.layout || 'text-only') === 'image-text',
                  'preview-visual--full': (slide.layout || 'text-only') === 'full-image'
                }"
                :style="{
                  backgroundImage: `url(${imageBySlide.get(slide.id)?.url})`,
                  backgroundColor: colors.panel
                }"
              />
              <!-- Placeholder when layout expects image but none exists -->
              <div
                v-if="(slide.layout || 'text-only') !== 'text-only' && (slide.layout || 'text-only') !== 'text-only' && !imageBySlide.get(slide.id)?.url"
                class="preview-visual preview-visual--placeholder"
                :class="{
                  'preview-visual--right': (slide.layout || 'text-only') === 'text-image',
                  'preview-visual--left': (slide.layout || 'text-only') === 'image-text',
                  'preview-visual--full': (slide.layout || 'text-only') === 'full-image'
                }"
              >
                <span class="preview-visual__hint">{{ (slide.layout || 'text-only') === 'full-image' ? '点击生成图片' : '图片占位' }}</span>
              </div>
              <div class="preview-accent-strip" :style="{ background: colors.accent }" />
              <div class="preview-overlay-icon">
                <Maximize2 :size="16" />
              </div>
            </div>

            <p v-if="slide.speakerNotes" class="preview-notes">
              <FileText :size="11" />
              {{ slide.speakerNotes.slice(0, 80) }}{{ slide.speakerNotes.length > 80 ? '...' : '' }}
            </p>
          </article>
        </div>
      </div>

      <UiEmpty
        v-else
        title="暂无预览"
        description="生成工作流后这里会出现 PPT 页面"
      />

      <footer v-if="outline.length" class="deck-preview-footer">
        <UiButton variant="secondary" size="sm" @click="openPresentation(0)">
          <Maximize2 :size="13" />
          全屏演示
        </UiButton>
        <template v-if="showExportActions !== false">
          <UiButton variant="primary" size="sm" @click="$emit('export', 'pptx')">
            <Download :size="13" />
            导出 PPTX
          </UiButton>
          <UiButton size="sm" @click="$emit('export', 'pdf')">
            <Download :size="13" />
            导出 PDF
          </UiButton>
        </template>
        <div v-if="artifacts.length" class="artifact-tags">
          <span v-for="artifact in artifacts" :key="artifact.format" class="artifact-tag">
            {{ artifact.status === 'ready' ? '✓' : '⟳' }} {{ artifact.name }}
          </span>
        </div>
      </footer>
    </UiCard>

    <!-- Preview Modal -->
    <SlidePreviewModal
      :show="showPreview"
      :slide="outline[previewIndex] || null"
      :index="previewIndex"
      :total="outline.length"
      :image="imageBySlide.get(outline[previewIndex]?.id || '') || null"
      :parameters="parameters"
      @close="showPreview = false"
      @prev="previewIndex > 0 && previewIndex--"
      @next="previewIndex < outline.length - 1 && previewIndex++"
      @present="showPreview = false; openPresentation(previewIndex)"
    />

    <!-- Presentation Mode -->
    <PresentationMode
      :show="showPresentation"
      :outline="outline"
      :image-map="imageBySlide"
      :parameters="parameters"
      :start-index="presentationStartIndex"
      @close="showPresentation = false"
    />
  </div>
</template>

<style scoped>
.deck-preview {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ---- Thumbnail strip ---- */
.thumbnail-strip {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 4px 0 8px;
  scrollbar-width: thin;
}

.thumbnail-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  width: 72px;
  padding: 8px 4px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.thumbnail-item:hover {
  border-color: var(--color-border-strong);
  background: var(--color-panel);
}

.thumbnail-item--active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.thumbnail-num {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--color-accent);
}

.thumbnail-title {
  font-size: 9px;
  color: var(--color-muted);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 64px;
}

/* ---- Slide list ---- */
.slide-list {
  display: grid;
  gap: 12px;
  max-height: 480px;
  overflow-y: auto;
  padding-right: 4px;
}

.preview-slide-card {
  cursor: pointer;
  transition: transform var(--transition-fast);
}

.preview-slide-card:hover {
  transform: scale(1.01);
}

.preview-slide-canvas {
  display: flex;
  gap: 20px;
  aspect-ratio: 16 / 9;
  border: 1px solid #2A333D;
  border-radius: 12px;
  padding: 20px 24px;
  position: relative;
  overflow: hidden;
  transition: box-shadow 0.2s ease;
}

.preview-accent-strip {
  position: absolute;
  top: 0;
  left: 0;
  width: 4px;
  height: 100%;
  opacity: 0.6;
}

.preview-slide-card:hover .preview-slide-canvas {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
}

.preview-overlay-icon {
  position: absolute;
  top: 10px;
  right: 10px;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.4);
  color: rgba(255, 255, 255, 0.6);
  opacity: 0;
  transition: opacity 0.2s ease;
}

.preview-slide-card:hover .preview-overlay-icon {
  opacity: 1;
}

.preview-content {
  flex: 1.2;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  z-index: 1;
}

.preview-content--right {
  order: 1;
}

.preview-content--overlay {
  position: absolute;
  bottom: 20px;
  left: 24px;
  right: 24px;
  z-index: 2;
  flex: none;
}

.preview-layout-tag {
  font-size: 10px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  color: var(--color-muted);
}

.preview-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-template {
  font-size: 10px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  color: var(--color-muted);
}

.preview-content h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.02em;
}

.preview-content ul {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
  line-height: 1.6;
  list-style: disc;
}

.preview-more {
  list-style: none;
  color: var(--color-subtle);
  font-style: italic;
  margin-left: -16px;
}

.preview-visual {
  flex: 0.7;
  min-width: 0;
  border-radius: 8px;
  background-size: cover;
  background-position: center;
  z-index: 1;
}

.preview-visual--right {
  order: 2;
}

.preview-visual--left {
  order: 0;
}

.preview-visual--full {
  position: absolute;
  inset: 0;
  flex: none;
  border-radius: 12px;
  z-index: 0;
}

.preview-visual--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--color-border);
  background: var(--color-panel) !important;
}

.preview-visual__hint {
  font-size: 11px;
  color: var(--color-muted);
}

/* Layout canvas variants */
.preview-slide-canvas--text-only .preview-content {
  flex: 1;
  max-width: 100%;
}

.preview-slide-canvas--full-image {
  position: relative;
}

.preview-slide-canvas--full-image .preview-accent-strip {
  z-index: 3;
}

.preview-slide-canvas--title-center {
  justify-content: center;
  text-align: center;
}

.preview-slide-canvas--title-center .preview-content h3 {
  font-size: 24px;
}

.preview-slide-canvas--two-column .preview-content ul {
  columns: 2;
  column-gap: 20px;
}

.preview-notes {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0 0;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(59, 130, 246, 0.06);
  color: #8899AA;
  font-size: 11px;
  line-height: 1.4;
}

/* ---- Footer ---- */
.deck-preview-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}

.artifact-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
}

.artifact-tag {
  font-size: 10px;
  color: var(--color-success);
  background: var(--color-success-soft);
  padding: 3px 8px;
  border-radius: 4px;
  font-family: var(--font-mono);
}
</style>
