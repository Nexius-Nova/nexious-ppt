<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
    size?: 'sm' | 'md';
  }>(),
  {
    tone: 'neutral',
    size: 'md'
  }
);
</script>

<template>
  <span class="ui-badge" :class="[`ui-badge--${tone}`, `ui-badge--${size}`]">
    <slot />
  </span>
</template>

<style scoped>
.ui-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}

.ui-badge--sm {
  padding: 2px 8px;
  font-size: 11px;
}

.ui-badge--md {
  padding: 4px 10px;
  font-size: 12px;
}

.ui-badge--neutral {
  color: var(--color-muted);
  background: var(--color-panel);
  border-color: var(--color-border);
}

.ui-badge--accent {
  color: var(--color-accent-strong);
  border-color: color-mix(in srgb, var(--color-accent) 32%, var(--color-border));
  background: var(--color-accent-soft);
}

.ui-badge--success {
  color: var(--color-success);
  border-color: color-mix(in srgb, var(--color-success) 32%, var(--color-border));
  background: var(--color-success-soft);
}

.ui-badge--warning {
  color: var(--color-warning);
  border-color: color-mix(in srgb, var(--color-warning) 32%, var(--color-border));
  background: var(--color-warning-soft);
}

.ui-badge--danger {
  color: var(--color-danger);
  border-color: color-mix(in srgb, var(--color-danger) 32%, var(--color-border));
  background: var(--color-danger-soft);
}

.ui-badge--info {
  color: var(--color-info);
  border-color: color-mix(in srgb, var(--color-info) 26%, var(--color-border));
  background: var(--color-info-soft);
}
</style>
