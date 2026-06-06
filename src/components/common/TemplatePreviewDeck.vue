<script setup lang="ts">
import { computed } from 'vue';
import PrivateSvg from '@/components/common/PrivateSvg.vue';
import type { TemplateAssetSettings } from '@/types/agent';

type PreviewSlide = NonNullable<TemplateAssetSettings['previewSlides']>[number];

const props = withDefaults(defineProps<{
  slides?: PreviewSlide[];
  accent?: string;
  variant?: 'dropdown' | 'panel';
  interactive?: boolean;
}>(), {
  slides: () => [],
  accent: '#334155',
  variant: 'dropdown',
  interactive: false
});

const emit = defineEmits<{
  preview: [slide: PreviewSlide, index: number];
}>();

const visibleSlides = computed(() => props.slides.slice(0, 3));

</script>

<template>
  <div
    v-if="visibleSlides.length"
    class="template-preview-deck"
    :class="[
      `template-preview-deck--${variant}`,
      { 'template-preview-deck--interactive': interactive }
    ]"
    :style="{ '--accent': accent || '#334155' }"
    :aria-hidden="interactive ? undefined : 'true'"
  >
    <span class="template-preview-deck__stack">
      <span
        v-for="(slide, index) in visibleSlides"
        :key="`${slide.title}-${slide.layout}-${index}`"
        class="template-preview-deck__slide"
        :class="[
          `template-preview-deck__slide--${slide.layout}`,
          { 'template-preview-deck__slide--svg': slide.svg }
        ]"
        role="button"
        :tabindex="interactive ? 0 : -1"
        :aria-label="interactive ? `预览 ${slide.title}` : undefined"
        @click="interactive && emit('preview', slide, index)"
        @keydown.enter.prevent="interactive && emit('preview', slide, index)"
        @keydown.space.prevent="interactive && emit('preview', slide, index)"
      >
        <PrivateSvg
          v-if="slide.svg"
          class="template-preview-deck__svg"
          :svg="slide.svg"
        />
        <template v-else>
          <span class="template-preview-deck__index">{{ index + 1 }}</span>
          <strong>{{ slide.title }}</strong>
          <span></span>
          <span></span>
        </template>
      </span>
    </span>
  </div>
</template>

<style scoped>
.template-preview-deck {
  --preview-width: 142px;
  --preview-height: 86px;
  --stack-width: 118px;
  --stack-height: 68px;
  --slide-width: 86px;
  --slide-gap-x: 16px;
  --slide-gap-y: 9px;
  --slide-padding: 7px;
  --title-size: 9px;
  --cover-title-size: 10px;
  --line-height: 4px;
  --media-width: 22px;
  --media-height: 19px;

  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--preview-width);
  height: var(--preview-height);
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 10%, var(--color-panel));
}

.template-preview-deck--panel {
  --preview-width: 100%;
  --preview-height: auto;
  --slide-padding: 12px;
  --title-size: 12px;
  --cover-title-size: 14px;
  --line-height: 5px;
  --media-width: 34px;
  --media-height: 30px;

  align-items: stretch;
  justify-content: flex-start;
  min-height: 154px;
  padding: 12px;
}

.template-preview-deck--panel .template-preview-deck__stack {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  width: 100%;
  height: auto;
}

.template-preview-deck--panel .template-preview-deck__slide {
  position: relative;
  inset: auto;
  width: 100%;
  min-width: 0;
  box-shadow: none;
}

.template-preview-deck--panel .template-preview-deck__slide:nth-child(1),
.template-preview-deck--panel .template-preview-deck__slide:nth-child(2),
.template-preview-deck--panel .template-preview-deck__slide:nth-child(3) {
  left: auto;
  top: auto;
}

.template-preview-deck--panel .template-preview-deck__slide--svg {
  border-color: color-mix(in srgb, var(--accent) 28%, var(--color-border));
}

.template-preview-deck--interactive .template-preview-deck__slide {
  cursor: zoom-in;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast);
}

.template-preview-deck--interactive .template-preview-deck__slide:hover,
.template-preview-deck--interactive .template-preview-deck__slide:focus-visible {
  transform: translateY(-1px);
  border-color: var(--accent);
  box-shadow: var(--shadow-sm);
  outline: none;
}

@media (max-width: 680px) {
  .template-preview-deck--panel .template-preview-deck__stack {
    grid-template-columns: 1fr;
  }

  .template-preview-deck--panel .template-preview-deck__slide:nth-child(n + 2) {
    display: none;
  }
}

.template-preview-deck__stack {
  position: relative;
  display: block;
  width: var(--stack-width);
  height: var(--stack-height);
}

.template-preview-deck__slide {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: var(--slide-width);
  aspect-ratio: 16 / 9;
  padding: var(--slide-padding);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--color-border));
  border-radius: 5px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.template-preview-deck__slide--svg {
  padding: 0;
}

.template-preview-deck__svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--color-surface);
}

.template-preview-deck__svg :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}

.template-preview-deck__slide:nth-child(1) {
  left: 0;
  top: 0;
  z-index: 3;
}

.template-preview-deck__slide:nth-child(2) {
  left: var(--slide-gap-x);
  top: var(--slide-gap-y);
  z-index: 2;
}

.template-preview-deck__slide:nth-child(3) {
  left: calc(var(--slide-gap-x) * 2);
  top: calc(var(--slide-gap-y) * 2);
  z-index: 1;
}

.template-preview-deck__index {
  position: absolute;
  right: 5px;
  bottom: 4px;
  color: var(--color-muted);
  font-size: 8px;
  font-weight: 700;
}

.template-preview-deck__slide strong {
  width: 76%;
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--title-size);
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-preview-deck__slide > span:not(.template-preview-deck__index):not(.template-preview-deck__svg) {
  display: block;
  height: var(--line-height);
  border-radius: 2px;
  background: var(--color-border);
}

.template-preview-deck__slide > span:nth-of-type(2) {
  width: 82%;
}

.template-preview-deck__slide > span:nth-of-type(3) {
  width: 52%;
}

.template-preview-deck__slide--cover strong,
.template-preview-deck__slide--ending strong {
  margin-top: 12%;
  color: var(--accent);
  font-size: var(--cover-title-size);
}

.template-preview-deck__slide--content-image::after,
.template-preview-deck__slide--content-chart::after {
  content: '';
  position: absolute;
  right: var(--slide-padding);
  top: 36%;
  width: var(--media-width);
  height: var(--media-height);
  border-radius: 3px;
  background: color-mix(in srgb, var(--accent) 24%, var(--color-border));
}
</style>
