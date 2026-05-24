<script setup lang="ts">
import { Check, Loader2, Circle } from 'lucide-vue-next';
import UiProgress from '@/components/ui/UiProgress.vue';
import type { WorkflowStep, WorkflowStepId } from '@/types/agent';

defineProps<{
  steps: WorkflowStep[];
  activeStep: WorkflowStepId;
}>();

defineEmits<{
  select: [stepId: WorkflowStepId];
}>();

function getStepIcon(status: WorkflowStep['status']) {
  switch (status) {
    case 'done':
      return Check;
    case 'running':
      return Loader2;
    default:
      return Circle;
  }
}
</script>

<template>
  <div class="workflow-rail">
    <button
      v-for="(step, index) in steps"
      :key="step.id"
      class="workflow-step"
      :class="{
        'workflow-step--active': step.id === activeStep,
        'workflow-step--done': step.status === 'done',
        'workflow-step--running': step.status === 'running'
      }"
      @click="$emit('select', step.id)"
    >
      <span class="workflow-step__icon" :class="`workflow-step__icon--${step.status}`">
        <component :is="getStepIcon(step.status)" :size="10" :class="{ 'workflow-step__spin': step.status === 'running' }" />
      </span>
      <span class="workflow-step__label">{{ step.title }}</span>
      <span v-if="index < steps.length - 1" class="workflow-step__connector" :class="{ 'workflow-step__connector--done': step.status === 'done' }" />
    </button>
  </div>
</template>

<style scoped>
.workflow-rail {
  display: flex;
  align-items: center;
  gap: 0;
  overflow-x: auto;
  padding: 4px 0;
}

.workflow-step {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
  position: relative;
}

.workflow-step:hover {
  background: var(--color-panel);
}

.workflow-step--active {
  background: var(--color-accent-soft);
}

.workflow-step__icon {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  transition: all var(--transition-fast);
}

.workflow-step__icon--idle {
  border: 1.5px solid var(--color-border-strong);
  color: var(--color-subtle);
  background: var(--color-surface);
}

.workflow-step__icon--running {
  border: 1.5px solid var(--color-accent);
  color: var(--color-accent);
  background: var(--color-surface);
}

.workflow-step__icon--done {
  border: 1.5px solid var(--color-success);
  color: white;
  background: var(--color-success);
}

.workflow-step__spin {
  animation: spin 1s linear infinite;
}

.workflow-step__label {
  font-size: 11px;
  font-weight: 500;
  color: var(--color-muted);
}

.workflow-step--active .workflow-step__label {
  color: var(--color-accent);
  font-weight: 600;
}

.workflow-step--done .workflow-step__label {
  color: var(--color-success);
}

.workflow-step__connector {
  position: absolute;
  right: -8px;
  width: 16px;
  height: 2px;
  background: var(--color-border);
}

.workflow-step__connector--done {
  background: var(--color-success);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
