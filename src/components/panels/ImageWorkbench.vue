<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { RefreshCw, Check, Loader2, ImageOff } from 'lucide-vue-next';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiEmpty from '@/components/ui/UiEmpty.vue';
import type { GeneratedImage } from '@/types/agent';

const props = defineProps<{
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

const startTime = ref<number | null>(null);
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

watch(
  () => props.isRunning,
  (val) => {
    if (val && !startTime.value) {
      startTime.value = Date.now();
    } else if (!val) {
      startTime.value = null;
    }
  }
);

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});

const elapsedSeconds = computed(() => {
  if (!startTime.value) return 0;
  return Math.floor((now.value - startTime.value) / 1000);
});

const estimatedRemaining = computed(() => {
  const done = props.generatedCount || 0;
  const total = props.totalCount || 0;
  if (!startTime.value || done === 0 || total === 0) return null;
  const remaining = total - done;
  if (remaining <= 0) return null;
  const secondsPerItem = elapsedSeconds.value / done;
  const estimate = Math.ceil(secondsPerItem * remaining);
  if (estimate < 60) return `${estimate}秒`;
  const min = Math.floor(estimate / 60);
  const sec = estimate % 60;
  return `${min}分${sec}秒`;
});

const skeletonItems = Array.from({ length: 6 });

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
      <UiButton size="sm" variant="secondary" :disabled="isRunning" @click="$emit('run')">
        <RefreshCw :size="13" :class="{ 'animate-spin': isRunning }" />
        {{ isRunning ? '生成中...' : '重新生成' }}
      </UiButton>
    </template>

    <div v-if="isRunning && !images.length" class="skeleton-grid">
      <div v-for="(_, i) in skeletonItems" :key="i" class="skeleton-card">
        <div class="skeleton-card__image"></div>
        <div class="skeleton-card__title"></div>
        <div class="skeleton-card__desc"></div>
      </div>
    </div>

    <div v-if="isRunning" class="generating-status">
      <div class="generating-header">
        <div class="generating-header__left">
          <Loader2 :size="16" class="animate-spin" />
          <span>正在生成图片</span>
          <span v-if="totalCount" class="generating-progress">
            {{ generatedCount || 0 }} / {{ totalCount }}
          </span>
        </div>
        <div v-if="estimatedRemaining" class="generating-header__right">
          预估剩余 {{ estimatedRemaining }}
        </div>
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
        <div v-if="!image.selected && !image.error && !(isRunning && currentGeneratingSlide === image.slideId)" class="image-tile__hint">
          点击选择
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
@keyframes skeleton-pulse {
  0%, 100% {
    background-color: var(--color-panel);
  }
  50% {
    background-color: var(--color-border);
  }
}

@keyframes stripe-move {
  0% {
    background-position: 0 0;
  }
  100% {
    background-position: 40px 0;
  }
}

@keyframes pulse-border {
  0%, 100% {
    border-color: var(--color-accent-soft);
  }
  50% {
    border-color: var(--color-accent);
  }
}

.skeleton-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.skeleton-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius-md);
  border: 1.5px solid var(--color-border);
  background: var(--color-surface);
}

.skeleton-card__image {
  height: 120px;
  border-radius: 10px;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}

.skeleton-card__title {
  height: 12px;
  width: 40%;
  border-radius: 6px;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}

.skeleton-card__desc {
  height: 10px;
  width: 70%;
  border-radius: 5px;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}

.generating-status {
  margin-bottom: var(--space-3);
  padding: 12px;
  border: 1px solid var(--color-accent-soft);
  border-radius: var(--radius-md);
  background: var(--color-accent-soft);
}

.generating-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.generating-header__left {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-accent);
  font-size: 13px;
  font-weight: 500;
}

.generating-header__right {
  font-size: 12px;
  color: var(--color-subtle);
  font-family: var(--font-mono);
}

.generating-progress {
  font-family: var(--font-mono);
  font-size: 12px;
}

.generating-bar {
  height: 6px;
  border-radius: 3px;
  background: var(--color-border);
  overflow: hidden;
}

.generating-bar__fill {
  height: 100%;
  border-radius: 3px;
  background: var(--color-accent);
  transition: width 0.3s ease;
  position: relative;
}

.generating-bar__fill::after {
  content: none;
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
  position: relative;
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
  animation: pulse-border 1.5s ease-in-out infinite;
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

.image-tile__hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  color: white;
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--radius-md);
  opacity: 0;
  transition: opacity var(--transition-fast);
  pointer-events: none;
}

.image-tile:hover:not(:disabled) .image-tile__hint {
  opacity: 1;
}

.image-tile--selected:hover .image-tile__hint,
.image-tile--generating:hover .image-tile__hint {
  opacity: 0;
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
