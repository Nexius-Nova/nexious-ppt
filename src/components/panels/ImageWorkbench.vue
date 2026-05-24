<script setup lang="ts">
import { RefreshCw, Check, Loader2, ImageOff } from 'lucide-vue-next';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiEmpty from '@/components/ui/UiEmpty.vue';
import ModelSelector from '@/components/common/ModelSelector.vue';
import type { GeneratedImage } from '@/types/agent';

defineProps<{
  images: GeneratedImage[];
  isRunning?: boolean;
  currentGeneratingSlide?: string | null;
  generatedCount?: number;
  totalCount?: number;
}>();

defineEmits<{
  run: [];
  select: [id: string];
}>();

function getStyleLabel(style: string) {
  const map: Record<string, string> = {
    realistic: '写实',
    illustration: '插画',
    comic: '漫画',
    flat: '扁平化',
    '3d': '3D',
    photo: '摄影'
  };
  return map[style] || style;
}
</script>

<template>
  <UiCard title="图像生成" subtitle="每页生成候选图，点击选择最佳配图">
    <template #actions>
      <ModelSelector type="image" />
      <UiButton size="sm" variant="secondary" :disabled="isRunning" @click="$emit('run')">
        <RefreshCw :size="13" :class="{ 'animate-spin': isRunning }" />
        {{ isRunning ? '生成中...' : '重新生成' }}
      </UiButton>
    </template>

    <div v-if="isRunning && !images.length" class="generating-empty">
      <div class="generating-empty__icon">
        <Loader2 :size="32" class="animate-spin" />
      </div>
      <div class="generating-empty__text">
        <strong>正在生成图片</strong>
        <p>AI 正在为每页幻灯片生成配图，请稍候...</p>
      </div>
      <div class="generating-bar generating-bar--large">
        <div
          class="generating-bar__fill"
          :style="{ width: totalCount ? `${((generatedCount || 0) / totalCount) * 100}%` : '0%' }"
        ></div>
      </div>
      <span v-if="totalCount" class="generating-progress">
        {{ generatedCount || 0 }} / {{ totalCount }}
      </span>
    </div>

    <div v-if="isRunning" class="generating-status">
      <div class="generating-header">
        <Loader2 :size="16" class="animate-spin" />
        <span>正在生成图片...</span>
        <span v-if="totalCount" class="generating-progress">
          {{ generatedCount || 0 }} / {{ totalCount }}
        </span>
      </div>
      <div class="generating-bar">
        <div
          class="generating-bar__fill"
          :style="{ width: totalCount ? `${((generatedCount || 0) / totalCount) * 100}%` : '0%' }"
        ></div>
      </div>
    </div>

    <div v-if="images.length" class="image-grid">
      <button
        v-for="image in images"
        :key="image.id"
        class="image-tile"
        :class="{
          'image-tile--selected': image.selected,
          'image-tile--error': image.error,
          'image-tile--generating': isRunning && currentGeneratingSlide === image.slideId
        }"
        :disabled="image.error || (isRunning && currentGeneratingSlide === image.slideId)"
        @click="$emit('select', image.id)"
      >
        <div class="image-tile__visual">
          <img
            v-if="image.url && !image.error"
            :src="image.url"
            :alt="image.title"
            class="image-tile__img"
            loading="lazy"
          />
          <div v-else-if="isRunning && currentGeneratingSlide === image.slideId" class="image-tile__loading">
            <Loader2 :size="20" class="animate-spin" />
            <span>生成中...</span>
          </div>
          <div v-else-if="image.error" class="image-tile__error">
            <ImageOff :size="20" />
            <span>生成失败</span>
          </div>
          <div v-else class="image-tile__mock">
            <span class="image-tile__style">{{ getStyleLabel(image.style) }}</span>
            <span class="image-tile__variant">{{ image.id.includes('-1') ? '方案 A' : '方案 B' }}</span>
          </div>
          <div v-if="image.selected && !image.error" class="image-tile__check">
            <Check :size="14" />
          </div>
        </div>
        <div class="image-tile__info">
          <strong>{{ image.title }}</strong>
          <p>{{ image.prompt }}</p>
          <UiBadge
            v-if="!image.error"
            :tone="image.selected ? 'success' : 'neutral'"
            size="sm"
          >
            {{ image.selected ? '已选' : '候选' }}
          </UiBadge>
          <UiBadge v-else tone="danger" size="sm">
            生成失败
          </UiBadge>
        </div>
      </button>
    </div>

    <UiEmpty
      v-else-if="!isRunning"
      title="暂无图像"
      description="运行图像生成后会显示候选卡片"
    />
  </UiCard>
</template>

<style scoped>
.generating-status {
  margin-bottom: var(--space-3);
  padding: 12px;
  border: 1px solid var(--color-accent-soft);
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, var(--color-accent-soft) 0%, transparent 100%);
}

.generating-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 48px 24px;
  border: 2px dashed var(--color-accent-soft);
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--color-accent-soft) 0%, transparent 100%);
  text-align: center;
}

.generating-empty__icon {
  color: var(--color-accent);
}

.generating-empty__text strong {
  display: block;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 4px;
}

.generating-empty__text p {
  margin: 0;
  font-size: 13px;
  color: var(--color-subtle);
}

.generating-bar--large {
  width: 200px;
  height: 6px;
}

.generating-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--color-accent);
  font-size: 13px;
  font-weight: 500;
}

.generating-progress {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 12px;
}

.generating-bar {
  height: 4px;
  border-radius: 2px;
  background: var(--color-border);
  overflow: hidden;
}

.generating-bar__fill {
  height: 100%;
  border-radius: 2px;
  background: var(--color-accent);
  transition: width 0.3s ease;
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.image-tile {
  display: grid;
  gap: 10px;
  width: 100%;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: inherit;
  padding: 12px;
  text-align: left;
  transition: all var(--transition-fast);
  cursor: pointer;
}

.image-tile:hover:not(:disabled) {
  border-color: var(--color-border-strong);
  box-shadow: var(--shadow-sm);
}

.image-tile--selected {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.image-tile--error {
  border-color: var(--color-danger-soft);
  background: var(--color-danger-soft);
  opacity: 0.7;
}

.image-tile--generating {
  border-color: var(--color-accent-soft);
  background: var(--color-accent-soft);
}

.image-tile:disabled {
  cursor: not-allowed;
}

.image-tile__visual {
  position: relative;
  overflow: hidden;
  height: 120px;
  border-radius: 10px;
  background: var(--color-panel);
}

.image-tile__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-tile__mock {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 100%;
  color: var(--color-muted);
}

.image-tile__style {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.image-tile__variant {
  font-size: 11px;
  color: var(--color-subtle);
  font-family: var(--font-mono);
}

.image-tile__loading,
.image-tile__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 100%;
  color: var(--color-muted);
  font-size: 12px;
}

.image-tile__error {
  color: var(--color-danger);
}

.image-tile__check {
  position: absolute;
  top: 8px;
  right: 8px;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--color-accent);
  color: white;
}

.image-tile__info {
  display: grid;
  gap: 6px;
}

.image-tile__info strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.image-tile__info p {
  margin: 0;
  color: var(--color-subtle);
  font-size: 11px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
