import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { DesignSpec, SpecLock, WorkflowStep, WorkflowStepId } from '@/types/agent';

export const workflowSteps: WorkflowStep[] = [
  { id: 'input', title: '资料', description: '准备资料和需求', status: 'idle', progress: 0 },
  { id: 'outline', title: '大纲', description: '整理页面结构', status: 'idle', progress: 0 },
  { id: 'images', title: '图片', description: '按需生成图片', status: 'idle', progress: 0 },
  { id: 'layout', title: '页面', description: '生成页面预览', status: 'idle', progress: 0 },
  { id: 'preview', title: '导出', description: '导出 PPTX', status: 'idle', progress: 0 },
];

export const cloneWorkflowSteps = () => workflowSteps.map((step) => ({ ...step }));

export const useWorkflowStore = defineStore('agentWorkflow', () => {
  const activeStep = ref<WorkflowStepId>('input');
  const steps = ref<WorkflowStep[]>(cloneWorkflowSteps());
  const activityLog = ref<string[]>(['系统就绪，等待添加 PPT 项目。']);
  const isRunning = ref(false);
  const isPaused = ref(false);
  const pauseRequested = ref(false);
  const resumeStage = ref<WorkflowStepId | null>(null);
  const executorCursor = ref(0);
  const streamingText = ref('');
  const designSpec = ref<DesignSpec | null>(null);
  const specLock = ref<SpecLock | null>(null);
  const recoveredActiveWorkflow = ref(false);
  const waitingForImageRetry = ref(false);
  const workflowRunToken = ref(0);
  const runningProjectId = ref<string | null>(null);
  const activeGenerationJobId = ref<number | null>(null);
  const activeQueueJobId = ref<string | null>(null);
  const workflowStartedAt = ref<number | null>(null);
  const currentGeneratingSlide = ref<string | null>(null);
  const retryingPageNumbers = ref<Set<number>>(new Set());

  const activeStepMeta = computed(() => steps.value.find((step) => step.id === activeStep.value));

  return {
    activeStep,
    activeStepMeta,
    steps,
    activityLog,
    isRunning,
    isPaused,
    pauseRequested,
    resumeStage,
    executorCursor,
    streamingText,
    designSpec,
    specLock,
    recoveredActiveWorkflow,
    waitingForImageRetry,
    workflowRunToken,
    runningProjectId,
    activeGenerationJobId,
    activeQueueJobId,
    workflowStartedAt,
    currentGeneratingSlide,
    retryingPageNumbers,
  };
});
