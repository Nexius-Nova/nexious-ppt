<script setup lang="ts">
defineProps<{
  label: string;
  hint?: string;
  required?: boolean;
}>();
</script>

<template>
  <label class="ui-field">
    <span class="ui-field__label">
      {{ label }}
      <em v-if="required" class="ui-field__required">*</em>
    </span>
    <slot />
    <span v-if="hint" class="ui-field__hint">{{ hint }}</span>
  </label>
</template>

<style scoped>
.ui-field {
  display: grid;
  gap: 8px;
}

.ui-field__label {
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
}

.ui-field__required {
  color: var(--color-accent);
  font-style: normal;
}

.ui-field__hint {
  color: var(--color-subtle);
  font-size: 11px;
}
</style>
