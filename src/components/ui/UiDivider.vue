<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string;
    spacing?: 'sm' | 'md' | 'lg';
  }>(),
  {
    spacing: 'md'
  }
);
</script>

<template>
  <div class="ui-divider" :class="`ui-divider--${spacing}`">
    <span v-if="label" class="ui-divider__label">{{ label }}</span>
  </div>
</template>

<style scoped>
.ui-divider {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ui-divider::before,
.ui-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--color-border);
}

.ui-divider__label {
  font-size: 11px;
  font-weight: 500;
  color: var(--color-subtle);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.ui-divider--sm {
  margin: var(--space-2) 0;
}

.ui-divider--md {
  margin: var(--space-4) 0;
}

.ui-divider--lg {
  margin: var(--space-6) 0;
}
</style>
