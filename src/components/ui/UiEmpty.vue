<script setup lang="ts">
import { Box } from 'lucide-vue-next';

withDefaults(
  defineProps<{
    title?: string;
    description?: string;
  }>(),
  {
    title: '暂无数据',
    description: '开始操作后，相关内容将显示在这里'
  }
);
</script>

<template>
  <div class="ui-empty">
    <div class="ui-empty__icon">
      <Box :size="28" />
    </div>
    <h3 class="ui-empty__title">{{ title }}</h3>
    <p class="ui-empty__desc">{{ description }}</p>
    <slot />
  </div>
</template>

<style scoped>
.ui-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 24px;
  text-align: center;
}

.ui-empty__icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: var(--color-panel);
  color: var(--color-subtle);
}

.ui-empty__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

.ui-empty__desc {
  font-size: 13px;
  color: var(--color-subtle);
  max-width: 280px;
  line-height: 1.5;
}
</style>
