<script setup lang="ts">
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-vue-next';

withDefaults(
  defineProps<{
    tone?: 'info' | 'success' | 'warning' | 'danger';
    title?: string;
  }>(),
  {
    tone: 'info'
  }
);

const iconMap = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle
};
</script>

<template>
  <div class="ui-alert" :class="`ui-alert--${tone}`">
    <component :is="iconMap[tone]" :size="16" />
    <div class="ui-alert__content">
      <strong v-if="title">{{ title }}</strong>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.ui-alert {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.5;
}

.ui-alert__content {
  flex: 1;
  min-width: 0;
}

.ui-alert__content strong {
  display: block;
  margin-bottom: 2px;
  font-weight: 600;
}

.ui-alert--info {
  background: var(--color-info-soft);
  color: var(--color-info);
  border: 1px solid var(--color-border);
}

.ui-alert--success {
  background: var(--color-success-soft);
  color: var(--color-success);
  border: 1px solid var(--color-border);
}

.ui-alert--warning {
  background: var(--color-warning-soft);
  color: var(--color-warning);
  border: 1px solid var(--color-border);
}

.ui-alert--danger {
  background: var(--color-danger-soft);
  color: var(--color-danger);
  border: 1px solid var(--color-border);
}
</style>
