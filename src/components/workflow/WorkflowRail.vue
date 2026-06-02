<script setup lang="ts">
import { Check, Circle, FileText, Image, Loader2, Paintbrush, ShieldCheck, Wand2 } from 'lucide-vue-next';
import type { WorkflowStep, WorkflowStepId } from '@/types/agent';

const props = defineProps<{
  steps: WorkflowStep[];
  activeStep: WorkflowStepId;
}>();

defineEmits<{
  select: [stepId: WorkflowStepId];
}>();

const stageMeta: Record<string, { title: string; shortTitle: string; icon: any }> = {
  input: { title: '资料', shortTitle: '资料', icon: FileText },
  outline: { title: '大纲', shortTitle: '大纲', icon: Wand2 },
  images: { title: '图片', shortTitle: '图片', icon: Image },
  layout: { title: '页面', shortTitle: '页面', icon: Paintbrush },
  preview: { title: '导出', shortTitle: '导出', icon: ShieldCheck }
};

function visibleSteps() {
  return props.steps.filter(step => Boolean(stageMeta[step.id]));
}

function getStepIcon(step: WorkflowStep) {
  if (step.status === 'done') return Check;
  if (step.status === 'running') return Loader2;
  return stageMeta[step.id]?.icon || Circle;
}

function statusText(status: WorkflowStep['status']) {
  if (status === 'done') return '完成';
  if (status === 'running') return '进行中';
  return '等待';
}
</script>

<template>
  <div class="workflow-rail" aria-label="PPT 生成流程">
    <button
      v-for="(step, index) in visibleSteps()"
      :key="step.id"
      class="workflow-step"
      :class="{
        'workflow-step--active': step.id === activeStep,
        'workflow-step--done': step.status === 'done',
        'workflow-step--running': step.status === 'running'
      }"
      @click="$emit('select', step.id)"
    >
      <span class="workflow-step__index">{{ index + 1 }}</span>
      <span class="workflow-step__icon">
        <component :is="getStepIcon(step)" :size="13" :class="{ 'workflow-step__spin': step.status === 'running' }" />
      </span>
      <span class="workflow-step__text">
        <strong>{{ stageMeta[step.id]?.title || step.title }}</strong>
        <span>{{ statusText(step.status) }}<template v-if="step.status === 'running'"> {{ step.progress }}%</template></span>
      </span>
      <span v-if="index < visibleSteps().length - 1" class="workflow-step__connector" :class="{ 'workflow-step__connector--done': step.status === 'done' }" />
      <span v-if="step.status === 'running'" class="workflow-step__progress">
        <span :style="{ width: `${step.progress}%` }" />
      </span>
    </button>
  </div>
</template>

<style scoped>
.workflow-rail {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 0;
}

.workflow-step {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 150px;
  padding: 7px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-card);
  cursor: pointer;
  white-space: nowrap;
  transition: border-color var(--transition-fast), background var(--transition-fast), transform var(--transition-fast);
}

.workflow-step:hover {
  transform: translateY(-1px);
  border-color: var(--color-border-strong);
}

.workflow-step--active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.workflow-step--done {
  border-color: color-mix(in srgb, var(--color-success) 45%, var(--color-border));
}

.workflow-step__index {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  color: var(--color-subtle);
  background: var(--color-panel);
  font-size: 10px;
  font-weight: 800;
}

.workflow-step__icon {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-muted);
  background: var(--color-surface);
}

.workflow-step--running .workflow-step__icon {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.workflow-step--done .workflow-step__icon {
  color: #ffffff;
  border-color: var(--color-success);
  background: var(--color-success);
}

.workflow-step__text {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.workflow-step__text strong {
  color: var(--color-text);
  font-size: 12px;
  font-weight: 700;
}

.workflow-step__text span {
  color: var(--color-subtle);
  font-size: 10px;
}

.workflow-step__connector {
  position: absolute;
  right: -9px;
  z-index: 1;
  width: 10px;
  height: 2px;
  background: var(--color-border);
}

.workflow-step__connector--done {
  background: var(--color-success);
}

.workflow-step__progress {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 3px;
  height: 2px;
  border-radius: 999px;
  background: var(--color-border);
  overflow: hidden;
}

.workflow-step__progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-accent);
  transition: width 0.3s ease;
}

.workflow-step__spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 760px) {
  .workflow-step {
    min-width: 128px;
  }
}
</style>
