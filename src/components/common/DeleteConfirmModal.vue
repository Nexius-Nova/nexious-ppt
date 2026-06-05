<script setup lang="ts">
import { X } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';

withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    itemName?: string;
    message?: string;
    loading?: boolean;
    confirmText?: string;
    cancelText?: string;
  }>(),
  {
    title: '确认删除',
    itemName: '',
    message: '',
    loading: false,
    confirmText: '删除',
    cancelText: '取消',
  }
);

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="delete-confirm-overlay" @click.self="emit('close')">
      <div class="delete-confirm-modal" role="dialog" aria-modal="true" :aria-label="title">
        <div class="delete-confirm-modal__header">
          <h3>{{ title }}</h3>
          <button class="delete-confirm-modal__close" type="button" title="关闭" @click="emit('close')">
            <X :size="18" />
          </button>
        </div>
        <div class="delete-confirm-modal__body">
          <p>
            {{ message || `确定要删除「${itemName}」吗？此操作不可撤销。` }}
          </p>
        </div>
        <div class="delete-confirm-modal__footer">
          <UiButton variant="secondary" :disabled="loading" @click="emit('close')">
            {{ cancelText }}
          </UiButton>
          <UiButton variant="danger" :loading="loading" @click="emit('confirm')">
            {{ confirmText }}
          </UiButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.delete-confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--color-overlay);
}

.delete-confirm-modal {
  width: 100%;
  max-width: 400px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
}

.delete-confirm-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
}

.delete-confirm-modal__header h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 16px;
  font-weight: 600;
}

.delete-confirm-modal__close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
}

.delete-confirm-modal__close:hover {
  border-color: var(--color-border);
  background: var(--color-panel);
  color: var(--color-text);
}

.delete-confirm-modal__body {
  padding: 20px;
}

.delete-confirm-modal__body p {
  margin: 0;
  color: var(--color-text);
  font-size: 14px;
  line-height: 1.6;
}

.delete-confirm-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px;
  border-top: 1px solid var(--color-border);
}

@media (max-width: 520px) {
  .delete-confirm-overlay {
    align-items: stretch;
    padding: 12px;
  }

  .delete-confirm-modal {
    align-self: center;
    max-width: none;
  }

  .delete-confirm-modal__footer {
    flex-direction: column-reverse;
  }
}
</style>
