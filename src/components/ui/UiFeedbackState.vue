<script setup lang="ts">
import { AlertTriangle, CircleOff, Info, RotateCw, ShieldAlert } from 'lucide-vue-next';
import UiButton from './UiButton.vue';

const props = withDefaults(
  defineProps<{
    tone?: 'empty' | 'error' | 'warning' | 'info' | 'forbidden';
    title?: string;
    description?: string;
    actionLabel?: string;
    loading?: boolean;
  }>(),
  {
    tone: 'empty',
    title: '暂无内容',
    description: '',
    actionLabel: '',
    loading: false
  }
);

defineEmits<{
  action: [];
}>();

const iconMap = {
  empty: CircleOff,
  error: AlertTriangle,
  warning: AlertTriangle,
  info: Info,
  forbidden: ShieldAlert
};
</script>

<template>
  <section class="ui-feedback" :class="`ui-feedback--${props.tone}`" role="status" aria-live="polite">
    <div class="ui-feedback__icon">
      <component :is="iconMap[props.tone]" :size="24" />
    </div>
    <div class="ui-feedback__copy">
      <h3>{{ props.title }}</h3>
      <p v-if="props.description">{{ props.description }}</p>
    </div>
    <slot />
    <UiButton v-if="props.actionLabel" variant="secondary" size="sm" :loading="props.loading" @click="$emit('action')">
      <RotateCw v-if="!props.loading" :size="14" />
      {{ props.actionLabel }}
    </UiButton>
  </section>
</template>

<style scoped>
.ui-feedback {
  display: grid;
  justify-items: center;
  gap: 12px;
  width: 100%;
  min-height: 168px;
  padding: 32px 24px;
  text-align: center;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-panel);
  color: var(--color-text);
}

.ui-feedback__icon {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-muted);
}

.ui-feedback__copy {
  display: grid;
  gap: 6px;
  max-width: 420px;
}

.ui-feedback__copy h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--color-text);
}

.ui-feedback__copy p {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.55;
}

.ui-feedback--error .ui-feedback__icon {
  color: var(--color-danger);
  background: var(--color-danger-soft);
}

.ui-feedback--warning .ui-feedback__icon {
  color: var(--color-warning);
  background: var(--color-warning-soft);
}

.ui-feedback--info .ui-feedback__icon {
  color: var(--color-info);
  background: var(--color-info-soft);
}

.ui-feedback--forbidden .ui-feedback__icon {
  color: var(--color-warning);
  background: var(--color-warning-soft);
}

@media (max-width: 520px) {
  .ui-feedback {
    min-height: 144px;
    padding: 26px 18px;
  }
}
</style>
