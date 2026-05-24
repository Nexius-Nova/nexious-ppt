<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { X, CheckCircle2, AlertTriangle, Info, XCircle } from 'lucide-vue-next';
import { useToastStore } from '@/stores/toastStore';

const toastStore = useToastStore();
const { visibleToasts } = storeToRefs(toastStore);

const iconMap = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info
};

const colorMap = {
  success: 'var(--color-success)',
  error: 'var(--color-danger)',
  warning: 'var(--color-warning)',
  info: 'var(--color-info)'
};
</script>

<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div
          v-for="toast in visibleToasts"
          :key="toast.id"
          class="toast"
          :class="`toast--${toast.type}`"
        >
          <div class="toast__icon">
            <component :is="iconMap[toast.type]" :size="18" :style="{ color: colorMap[toast.type] }" />
          </div>
          <div class="toast__content">
            <div class="toast__title">{{ toast.title }}</div>
            <div v-if="toast.message" class="toast__message">{{ toast.message }}</div>
          </div>
          <button class="toast__close" @click="toastStore.removeToast(toast.id)">
            <X :size="14" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 320px;
  max-width: 420px;
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
  pointer-events: auto;
}

.toast--success {
  border-left: 3px solid var(--color-success);
}

.toast--error {
  border-left: 3px solid var(--color-danger);
}

.toast--warning {
  border-left: 3px solid var(--color-warning);
}

.toast--info {
  border-left: 3px solid var(--color-info);
}

.toast__icon {
  flex-shrink: 0;
  padding-top: 2px;
}

.toast__content {
  flex: 1;
  min-width: 0;
}

.toast__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.4;
}

.toast__message {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-muted);
  line-height: 1.5;
}

.toast__close {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.toast__close:hover {
  background: var(--color-panel);
  color: var(--color-text);
}

.toast-enter-active {
  animation: toast-in 0.3s ease;
}

.toast-leave-active {
  animation: toast-out 0.2s ease;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateX(100%);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes toast-out {
  from {
    opacity: 1;
    transform: translateX(0);
  }
  to {
    opacity: 0;
    transform: translateX(100%);
  }
}
</style>
