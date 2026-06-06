<script setup lang="ts">
import { computed, toRef, useAttrs, type StyleValue } from 'vue';
import { usePrivateAssetUrl } from '@/composables/usePrivateAssetUrl';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    src?: string | null;
  }>(),
  {
    src: ''
  }
);

const attrs = useAttrs();
const asset = usePrivateAssetUrl(toRef(props, 'src'));

const passthroughAttrs = computed(() => {
  const { style, ...rest } = attrs;
  void style;
  return rest;
});

const backgroundStyle = computed<StyleValue>(() => [
  attrs.style as StyleValue,
  asset.url.value ? { backgroundImage: `url(${JSON.stringify(asset.url.value)})` } : {}
]);
</script>

<template>
  <div v-bind="passthroughAttrs" :style="backgroundStyle">
    <slot :loading="asset.loading.value" :error="asset.error.value" />
  </div>
</template>
