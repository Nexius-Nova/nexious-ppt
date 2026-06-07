import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { PptProject, PptTemplate, TemplateAsset } from '@/types/agent';

export const useProjectStore = defineStore('agentProject', () => {
  const pptProjects = ref<PptProject[]>([]);
  const templates = ref<PptTemplate[]>([]);
  const selectedTemplate = ref<TemplateAsset | null>(null);
  const activePptId = ref<string | null>(null);
  const deletedPptProjectIds = ref<Set<string>>(new Set());
  const isDataLoaded = ref(false);

  const activePpt = computed(() => pptProjects.value.find((project) => project.id === activePptId.value) || null);

  return {
    pptProjects,
    templates,
    selectedTemplate,
    activePptId,
    activePpt,
    deletedPptProjectIds,
    isDataLoaded,
  };
});
