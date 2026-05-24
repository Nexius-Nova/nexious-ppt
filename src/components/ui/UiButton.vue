<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'text';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
    loading?: boolean;
    block?: boolean;
  }>(),
  {
    variant: 'secondary',
    size: 'md',
    disabled: false,
    loading: false,
    block: false
  }
);
</script>

<template>
  <button
    class="ui-button"
    :class="[
      `ui-button--${variant}`,
      `ui-button--${size}`,
      { 'ui-button--block': block, 'ui-button--loading': loading }
    ]"
    :disabled="disabled || loading"
  >
    <span v-if="loading" class="ui-button__spinner" />
    <slot />
  </button>
</template>

<style scoped>
.ui-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  color: var(--color-text);
  background: var(--color-surface);
  font-weight: 500;
  white-space: nowrap;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    transform var(--transition-fast),
    box-shadow var(--transition-fast);
}

.ui-button:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: var(--color-border-strong);
  box-shadow: var(--shadow-sm);
}

.ui-button:active:not(:disabled) {
  transform: translateY(0);
}

.ui-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.ui-button--sm {
  min-height: 32px;
  padding: 0 12px;
  font-size: 12px;
}

.ui-button--md {
  min-height: 40px;
  padding: 0 16px;
  font-size: 14px;
}

.ui-button--lg {
  min-height: 48px;
  padding: 0 20px;
  font-size: 15px;
}

.ui-button--primary {
  border-color: var(--color-accent);
  background: var(--color-accent);
  color: #ffffff;
  font-weight: 600;
}

.ui-button--primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
  border-color: var(--color-accent-hover);
}

.ui-button--secondary {
  background: var(--color-surface);
}

.ui-button--ghost {
  background: transparent;
  border-color: transparent;
}

.ui-button--ghost:hover:not(:disabled) {
  background: var(--color-panel);
}

.ui-button--danger {
  border-color: var(--color-danger);
  background: var(--color-danger-soft);
  color: var(--color-danger);
}

.ui-button--text {
  border-color: transparent;
  background: transparent;
  color: var(--color-accent);
  padding: 0;
  min-height: auto;
}

.ui-button--text:hover:not(:disabled) {
  color: var(--color-accent-hover);
  background: transparent;
  box-shadow: none;
}

.ui-button--block {
  width: 100%;
}

.ui-button__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
