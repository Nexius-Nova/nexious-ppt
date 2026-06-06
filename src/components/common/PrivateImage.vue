<script setup lang="ts">
import { computed, toRef } from 'vue';
import { usePrivateAssetUrl } from '@/composables/usePrivateAssetUrl';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    src?: string | null;
    alt?: string;
  }>(),
  {
    src: '',
    alt: ''
  }
);

const asset = usePrivateAssetUrl(toRef(props, 'src'));
const resolvedSrc = computed(() => asset.url.value);
</script>

<template>
  <img v-if="resolvedSrc" v-bind="$attrs" :src="resolvedSrc" :alt="alt" />
</template>
