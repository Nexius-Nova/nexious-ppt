<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { History, RotateCcw, Trash2, Clock, X, AlertTriangle } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import UiButton from '@/components/ui/UiButton.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiEmpty from '@/components/ui/UiEmpty.vue';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import type { VersionSnapshot } from '@/types/agent';

const store = useAgentStore();
const toastStore = useToastStore();
const { activePpt } = storeToRefs(store);

const versions = ref<VersionSnapshot[]>([]);
const isOpen = ref(false);
const confirmRestoreId = ref<string | null>(null);

onMounted(() => {
  loadVersions();
});

function loadVersions() {
  if (!activePpt.value) return;
  versions.value = store.getVersions(activePpt.value.id);
}

function toggle() {
  isOpen.value = !isOpen.value;
  if (isOpen.value) loadVersions();
}

function formatTime(ts: number) {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function doRestore(versionId: string) {
  if (!activePpt.value) return;
  const success = store.restoreVersion(activePpt.value.id, versionId);
  if (success) {
    toastStore.success('已回滚', '大纲和参数已恢复到所选版本');
    confirmRestoreId.value = null;
    loadVersions();
  } else {
    toastStore.error('回滚失败', '未找到该版本');
  }
}

function doDelete(versionId: string) {
  if (!activePpt.value) return;
  store.deleteVersion(activePpt.value.id, versionId);
  loadVersions();
  toastStore.info('已删除版本');
}

function hasProject(): boolean {
  return !!activePpt.value;
}
</script>

<template>
  <div class="version-history">
    <button class="version-toggle" :class="{ 'version-toggle--open': isOpen }" @click="toggle" :disabled="!hasProject()" title="版本历史">
      <History :size="14" />
      <span>版本历史</span>
      <UiBadge v-if="versions.length" tone="neutral" size="sm">{{ versions.length }}</UiBadge>
    </button>

    <Transition name="slide-fade">
      <div v-if="isOpen" class="version-panel">
        <div class="version-panel__header">
          <Clock :size="14" />
          <span>版本历史</span>
          <button class="version-close" @click="isOpen = false">
            <X :size="14" />
          </button>
        </div>

        <div class="version-list">
          <div
            v-for="version in versions"
            :key="version.id"
            class="version-item"
          >
            <div class="version-item__dot" />
            <div class="version-item__content">
              <div class="version-item__label">{{ version.label }}</div>
              <div class="version-item__meta">
                {{ formatTime(version.timestamp) }} · {{ version.slideCount }} 页
              </div>
            </div>
            <div class="version-item__actions">
              <button
                v-if="confirmRestoreId !== version.id"
                class="version-action-btn"
                title="回滚到此版本"
                @click="confirmRestoreId = version.id"
              >
                <RotateCcw :size="12" />
              </button>
              <button
                class="version-action-btn version-action-btn--danger"
                title="删除版本"
                @click="doDelete(version.id)"
              >
                <Trash2 :size="12" />
              </button>
            </div>

            <!-- Confirm restore -->
            <Transition name="slide-fade">
              <div v-if="confirmRestoreId === version.id" class="version-confirm">
                <AlertTriangle :size="12" />
                <span>确认回滚到此版本？当前编辑内容将丢失。</span>
                <div class="version-confirm__actions">
                  <UiButton size="sm" variant="danger" @click="doRestore(version.id)">确认</UiButton>
                  <UiButton size="sm" variant="ghost" @click="confirmRestoreId = null">取消</UiButton>
                </div>
              </div>
            </Transition>
          </div>

          <div v-if="versions.length === 0" class="version-empty">
            <UiEmpty
              title="暂无版本"
              description="编辑大纲后会自动生成版本快照"
            />
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.version-history {
  position: relative;
}

.version-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.version-toggle:hover:not(:disabled) {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.version-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.version-toggle--open {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.version-panel {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 100;
  width: 340px;
  max-height: 400px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.version-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.version-close {
  margin-left: auto;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
}

.version-close:hover {
  background: var(--color-panel);
  color: var(--color-text);
}

.version-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.version-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  padding-left: 28px;
  transition: background var(--transition-fast);
}

.version-item:hover {
  background: var(--color-panel);
}

.version-item__dot {
  position: absolute;
  left: 14px;
  top: 16px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-accent);
}

.version-item::before {
  content: '';
  position: absolute;
  left: 16px;
  top: 24px;
  bottom: 0;
  width: 2px;
  background: var(--color-border);
}

.version-item:last-child::before {
  display: none;
}

.version-item__content {
  flex: 1;
  min-width: 0;
}

.version-item__label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
}

.version-item__meta {
  font-size: 11px;
  color: var(--color-subtle);
  margin-top: 2px;
}

.version-item__actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.version-item:hover .version-item__actions {
  opacity: 1;
}

.version-action-btn {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.version-action-btn:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.version-action-btn--danger:hover {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.version-confirm {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: var(--color-warning-soft);
  font-size: 12px;
  color: var(--color-text);
  z-index: 5;
}

.version-confirm__actions {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.version-empty {
  padding: 8px;
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.15s ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
