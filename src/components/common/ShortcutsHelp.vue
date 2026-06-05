<script setup lang="ts">
import { computed } from 'vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiButton from '@/components/ui/UiButton.vue';

const props = defineProps<{
  show: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

interface ShortcutGroup {
  label: string;
  items: Array<{ keys: string; desc: string }>;
}

const groups = computed<ShortcutGroup[]>(() => [
  {
    label: '通用',
    items: [
      { keys: '⌘K / Ctrl+K', desc: '打开全局搜索' },
      { keys: 'Esc', desc: '关闭弹窗 / 取消编辑' },
      { keys: '?', desc: '显示此帮助' }
    ]
  },
  {
    label: '工作区',
    items: [
      { keys: '⌘Enter / Ctrl+Enter', desc: '运行当前步骤' },
      { keys: '⌘S / Ctrl+S', desc: '保存工作流' }
    ]
  },
  {
    label: '编辑',
    items: [
      { keys: 'Enter', desc: '添加新要点（编辑 bullet 时）' },
      { keys: 'Backspace', desc: '删除空白要点' },
      { keys: '拖拽', desc: '调整幻灯片 / 要点顺序' }
    ]
  }
]);

const platformKeys = computed(() =>
  navigator.platform.includes('Mac') ? 'mac' : 'win'
);

function keyLabel(keys: string): string {
  if (platformKeys.value === 'mac') {
    return keys.replace(/⌘/g, '').trim();
  }
  return keys.replace(/⌘K \/ /g, '').replace(/⌘Enter \/ /g, '').replace(/⌘S \/ /g, '');
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="shortcuts-overlay" @click.self="$emit('close')">
      <div class="shortcuts-modal">
        <div class="shortcuts-modal__header">
          <h3>快捷键参考</h3>
          <button class="shortcuts-modal__close" @click="$emit('close')">×</button>
        </div>
        <div class="shortcuts-modal__body">
          <div v-for="group in groups" :key="group.label" class="shortcut-group">
            <div class="shortcut-group__label">{{ group.label }}</div>
            <div v-for="item in group.items" :key="item.keys" class="shortcut-row">
              <kbd class="shortcut-key">{{ keyLabel(item.keys) }}</kbd>
              <span class="shortcut-desc">{{ item.desc }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.shortcuts-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--color-overlay);
  backdrop-filter: blur(4px);
}

.shortcuts-modal {
  width: 100%;
  max-width: 460px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
}

.shortcuts-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
}

.shortcuts-modal__header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
}

.shortcuts-modal__close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  font-size: 20px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.shortcuts-modal__close:hover {
  background: var(--color-panel);
  color: var(--color-text);
}

.shortcuts-modal__body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.shortcut-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.shortcut-group__label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-subtle);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.shortcut-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
}

.shortcut-key {
  display: inline-block;
  min-width: 100px;
  padding: 4px 10px;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  background: var(--color-panel);
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  text-align: center;
  white-space: nowrap;
}

.shortcut-desc {
  font-size: 13px;
  color: var(--color-muted);
}

@media (max-width: 520px) {
  .shortcuts-overlay {
    align-items: stretch;
    padding: 12px;
  }

  .shortcuts-modal {
    align-self: center;
    max-width: none;
  }

  .shortcut-row {
    align-items: stretch;
    flex-direction: column;
    gap: 6px;
  }

  .shortcut-key {
    min-width: 0;
    width: 100%;
  }
}
</style>
