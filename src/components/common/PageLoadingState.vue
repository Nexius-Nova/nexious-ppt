<script setup lang="ts">
import NexiousLoader from '@/components/common/NexiousLoader.vue';

withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    compact?: boolean;
  }>(),
  {
    title: '正在加载',
    description: '',
    compact: false
  }
);
</script>

<template>
  <div class="page-loading-state" :class="{ 'page-loading-state--compact': compact }" role="status" aria-live="polite">
    <span class="page-loading-state__icon">
      <NexiousLoader :size="compact ? 'sm' : 'lg'" />
    </span>
    <span class="page-loading-state__copy">
      <strong>{{ title }}</strong>
      <small v-if="description">{{ description }}</small>
    </span>
  </div>
</template>

<style scoped>
.page-loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  width: 100%;
  min-height: 160px;
  padding: 32px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-panel);
  color: var(--color-text);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-surface) 55%, transparent);
}

.page-loading-state--compact {
  min-height: 72px;
  padding: 18px;
  border-radius: var(--radius-md);
  gap: 12px;
}

.page-loading-state__icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 64px;
  height: 64px;
  border: 1px solid color-mix(in srgb, var(--color-accent) 24%, var(--color-border));
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  color: var(--color-accent);
  box-shadow: var(--shadow-sm);
}

.page-loading-state--compact .page-loading-state__icon {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-md);
}

.page-loading-state__copy {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.page-loading-state__copy strong {
  color: var(--color-text);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.35;
}

.page-loading-state__copy small {
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.45;
}

@media (max-width: 520px) {
  .page-loading-state {
    align-items: flex-start;
    justify-content: flex-start;
    min-height: 128px;
    padding: 24px;
  }

  .page-loading-state--compact {
    align-items: center;
    min-height: 68px;
    padding: 16px;
  }
}
</style>
