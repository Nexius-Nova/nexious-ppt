<script setup lang="ts">
import { computed, toRef } from 'vue';
import { usePrivateSvg } from '@/composables/usePrivateAssetUrl';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    svg?: string | null;
  }>(),
  {
    svg: ''
  }
);

const privateSvg = usePrivateSvg(toRef(props, 'svg'));
const resolvedSvg = computed(() => privateSvg.svg.value);
const isLoading = computed(() => privateSvg.loading.value);
const loadError = computed(() => privateSvg.error.value);
</script>

<template>
  <div v-bind="$attrs" class="private-svg">
    <div v-if="isLoading" class="private-svg__state">预览加载中...</div>
    <div v-else-if="loadError || !resolvedSvg" class="private-svg__state private-svg__state--error">
      预览加载失败
    </div>
    <div v-else class="private-svg__content" v-html="resolvedSvg" />
  </div>
</template>

<style scoped>
.private-svg {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  min-height: inherit;
  overflow: hidden;
}

.private-svg__content {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}

.private-svg__content :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}

.private-svg__state {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 12px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 12px;
}

.private-svg__state--error {
  color: var(--color-danger);
}
</style>
