import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { QueueJobSnapshot } from '@/services/api';

export const useQueueStore = defineStore('agentQueue', () => {
  const runningProjectJobs = ref<Record<string, {
    projectId: string;
    queueJobId: string;
    dbJobId: number | null;
    status: QueueJobSnapshot['status'];
    phase: string;
    progress: number;
    updatedAt: number;
  }>>({});

  return {
    runningProjectJobs,
  };
});
