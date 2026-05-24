<script setup lang="ts">
defineProps<{
  modelValue: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}>();

defineEmits<{
  'update:modelValue': [value: string];
}>();
</script>

<template>
  <textarea
    class="ui-textarea"
    :value="modelValue"
    :rows="rows ?? 8"
    :placeholder="placeholder"
    :disabled="disabled"
    @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
</template>

<style scoped>
.ui-textarea {
  width: 100%;
  resize: vertical;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  outline: none;
  background: var(--color-surface);
  color: var(--color-text);
  padding: 12px 14px;
  font-size: 14px;
  line-height: 1.6;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.ui-textarea::placeholder {
  color: var(--color-placeholder);
}

.ui-textarea:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.ui-textarea:disabled {
  background: var(--color-panel);
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
