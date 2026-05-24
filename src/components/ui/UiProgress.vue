<script setup lang="ts">
withDefaults(
  defineProps<{
    value: number;
    max?: number;
    size?: 'sm' | 'md';
    showLabel?: boolean;
    tone?: 'accent' | 'success' | 'info';
  }>(),
  {
    max: 100,
    size: 'md',
    showLabel: false,
    tone: 'accent'
  }
);
</script>

<template>
  <div class="ui-progress">
    <div
      class="ui-progress__track"
      :class="`ui-progress__track--${size}`"
    >
      <div
        class="ui-progress__bar"
        :class="`ui-progress__bar--${tone}`"
        :style="{ width: `${Math.min((value / max) * 100, 100)}%` }"
      />
    </div>
    <span v-if="showLabel" class="ui-progress__label">{{ Math.round((value / max) * 100) }}%</span>
  </div>
</template>

<style scoped>
.ui-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ui-progress__track {
  flex: 1;
  overflow: hidden;
  border-radius: 999px;
  background: var(--color-panel);
}

.ui-progress__track--sm {
  height: 4px;
}

.ui-progress__track--md {
  height: 6px;
}

.ui-progress__bar {
  height: 100%;
  border-radius: inherit;
  transition: width 0.3s ease;
}

.ui-progress__bar--accent {
  background: var(--color-accent);
}

.ui-progress__bar--success {
  background: var(--color-success);
}

.ui-progress__bar--info {
  background: var(--color-info);
}

.ui-progress__label {
  font-size: 11px;
  color: var(--color-subtle);
  font-variant-numeric: tabular-nums;
  min-width: 32px;
  text-align: right;
}
</style>
