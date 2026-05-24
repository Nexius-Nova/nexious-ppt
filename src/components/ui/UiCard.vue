<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    subtitle?: string;
    padded?: boolean;
    hoverable?: boolean;
  }>(),
  {
    padded: true,
    hoverable: false
  }
);
</script>

<template>
  <section
    class="ui-card"
    :class="{
      'ui-card--padded': padded,
      'ui-card--hoverable': hoverable
    }"
  >
    <header v-if="title || subtitle || $slots.actions" class="ui-card__header">
      <div>
        <h2 v-if="title" class="ui-card__title">{{ title }}</h2>
        <p v-if="subtitle" class="ui-card__subtitle">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="ui-card__actions">
        <slot name="actions" />
      </div>
    </header>
    <slot />
  </section>
</template>

<style scoped>
.ui-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-card);
  transition: box-shadow var(--transition-fast), border-color var(--transition-fast);
}

.ui-card--padded {
  padding: var(--space-5);
}

.ui-card--hoverable:hover {
  border-color: var(--color-border-strong);
  box-shadow: var(--shadow-card);
}

.ui-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}

.ui-card__title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text);
  letter-spacing: 0;
}

.ui-card__subtitle {
  margin: 6px 0 0;
  color: var(--color-subtle);
  font-size: 12px;
  line-height: 1.5;
}

.ui-card__actions {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-2);
}
</style>
