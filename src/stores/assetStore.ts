import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { ExportArtifact, GeneratedImage, SlideOutline } from '@/types/agent';

export const useAssetStore = defineStore('agentAsset', () => {
  const outline = ref<SlideOutline[]>([]);
  const images = ref<GeneratedImage[]>([]);
  const exportArtifacts = ref<ExportArtifact[]>([]);
  const svgPages = ref<Array<{ pageNumber: number; svg: string; speakerNotes: string; visualSummary?: string }>>([]);
  const generatedSlides = ref<Set<string>>(new Set());

  const selectedImages = computed(() => images.value.filter((image) => image.selected));

  return {
    outline,
    images,
    selectedImages,
    exportArtifacts,
    svgPages,
    generatedSlides,
  };
});
