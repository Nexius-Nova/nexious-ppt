export type WorkflowPhase = 'input' | 'outline' | 'images' | 'layout' | 'preview' | 'export';
export type WorkflowRunStatus = 'idle' | 'queued' | 'running' | 'paused' | 'failed' | 'completed' | 'retrying';
export type WorkflowStepStatus = 'idle' | 'running' | 'done';

export interface WorkflowRuntimeSnapshot {
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  phase: string;
  progress: number;
  result?: any;
}

export interface WorkflowTransitionSnapshot {
  phase: WorkflowPhase;
  runStatus: WorkflowRunStatus;
  active: boolean;
  paused: boolean;
  terminal: boolean;
  lastActiveStep: WorkflowPhase;
  waitingForImageRetry: boolean;
}

const PHASE_ALIASES: Record<string, WorkflowPhase> = {
  queued: 'outline',
  starting: 'outline',
  strategist: 'outline',
  outline: 'outline',
  images: 'images',
  image: 'images',
  layout: 'layout',
  pages: 'layout',
  page: 'layout',
  executor: 'layout',
  preview: 'preview',
  completed: 'preview',
  exporting: 'export',
  export: 'export',
};

export function normalizeWorkflowPhase(value: unknown): WorkflowPhase {
  const phase = String(value || '').trim().toLowerCase();
  return PHASE_ALIASES[phase] || 'outline';
}

export function deriveWorkflowTransition(job: WorkflowRuntimeSnapshot): WorkflowTransitionSnapshot {
  const phase = normalizeWorkflowPhase(job.phase);
  const terminal = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
  const failedImages = job.status === 'failed' && phase === 'images';

  return {
    phase,
    runStatus: job.status === 'cancelled'
      ? 'paused'
      : job.status === 'completed'
        ? 'completed'
        : job.status === 'failed'
          ? 'failed'
          : job.status === 'queued'
            ? 'queued'
            : 'running',
    active: !terminal,
    paused: job.status === 'cancelled',
    terminal,
    lastActiveStep: job.status === 'completed' ? 'preview' : phase,
    waitingForImageRetry: failedImages,
  };
}

export function workflowStepStatus(
  stepId: string,
  job: WorkflowRuntimeSnapshot,
  result: any = job.result || {}
): WorkflowStepStatus {
  const transition = deriveWorkflowTransition(job);
  if (job.status === 'failed' || job.status === 'cancelled') return 'idle';
  if (job.status === 'completed') return 'done';

  if (stepId === 'input') return 'done';
  if (stepId === 'outline') {
    if (transition.phase === 'outline') return 'running';
    return result?.spec || Array.isArray(result?.outline) && result.outline.length > 0 ? 'done' : 'idle';
  }
  if (stepId === 'images') {
    if (transition.phase === 'images') return 'running';
    if (transition.phase === 'layout' || transition.phase === 'preview' || transition.phase === 'export') return 'done';
    return 'idle';
  }
  if (stepId === 'layout') {
    if (transition.phase === 'layout') return 'running';
    if (transition.phase === 'preview' || transition.phase === 'export') return 'done';
    return 'idle';
  }
  if (stepId === 'preview') {
    if (transition.phase === 'export') return 'running';
    return transition.phase === 'preview' ? 'done' : 'idle';
  }
  return 'idle';
}

export function workflowStepProgress(step: any, job: WorkflowRuntimeSnapshot, result: any = job.result || {}) {
  const transition = deriveWorkflowTransition(job);
  const currentProgress = Math.max(0, Math.min(100, Number(job.progress) || 0));
  if (job.status === 'completed') return 100;
  if (job.status === 'cancelled') return Math.max(0, Math.min(99, Number(step?.progress) || 0));
  if (step?.id === 'input') return 100;
  if (step?.id === 'outline') {
    if (transition.phase === 'outline') return Math.min(99, currentProgress);
    return result?.spec || Array.isArray(result?.outline) && result.outline.length > 0 ? 100 : Number(step?.progress) || 0;
  }
  if (step?.id === 'images') {
    if (transition.phase === 'images') return Math.min(99, currentProgress);
    if (transition.phase === 'layout' || transition.phase === 'preview' || transition.phase === 'export') return 100;
  }
  if (step?.id === 'layout') {
    if (transition.phase === 'layout') return Math.min(99, currentProgress);
    if (transition.phase === 'preview' || transition.phase === 'export') return 100;
  }
  if (step?.id === 'preview') return transition.phase === 'preview' ? 100 : Number(step?.progress) || 0;
  return Number(step?.progress) || 0;
}
