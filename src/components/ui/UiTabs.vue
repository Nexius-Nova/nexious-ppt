<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  modelValue: string;
  tabs: Array<{ label: string; value: string; icon?: any }>;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const activeTab = computed(() => props.tabs.find((t) => t.value === props.modelValue));
</script>

<template>
  <div class="ui-tabs">
    <div class="ui-tabs__list">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        class="ui-tabs__tab"
        :class="{ 'ui-tabs__tab--active': tab.value === modelValue }"
        @click="emit('update:modelValue', tab.value)"
      >
        <component :is="tab.icon" v-if="tab.icon" :size="14" />
        <span>{{ tab.label }}</span>
      </button>
    </div>
    <div class="ui-tabs__panel">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.ui-tabs__list {
  display: flex;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-panel);
}

.ui-tabs__tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-muted);
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.ui-tabs__tab:hover {
  color: var(--color-text);
  background: var(--color-surface);
}

.ui-tabs__tab--active {
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-sm);
}

.ui-tabs__panel {
  margin-top: var(--space-4);
}
</style>
