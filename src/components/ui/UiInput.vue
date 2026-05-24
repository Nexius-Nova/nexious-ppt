<script setup lang="ts">
defineProps<{
  modelValue: string | number;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}>();

defineEmits<{
  'update:modelValue': [value: string];
}>();
</script>

<template>
  <input
    class="ui-input"
    :type="type ?? 'text'"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>

<style scoped>
.ui-input {
  width: 100%;
  min-height: 40px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  outline: none;
  background: var(--color-surface);
  color: var(--color-text);
  padding: 0 14px;
  font-size: 14px;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.ui-input::placeholder {
  color: var(--color-placeholder);
}

.ui-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.ui-input:disabled {
  background: var(--color-panel);
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
