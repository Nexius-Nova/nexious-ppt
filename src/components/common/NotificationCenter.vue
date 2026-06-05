<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { Bell, CheckCheck, Trash2, X, CheckCircle2, AlertTriangle, Info, XCircle, Clock } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { useToastStore } from '@/stores/toastStore';

const toastStore = useToastStore();
const { allNotifications, unreadCount, hasUnread } = storeToRefs(toastStore);

const isOpen = ref(false);
const panelRef = ref<HTMLDivElement | null>(null);

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

function toggle() {
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    toastStore.markAllRead();
  }
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

function handleClickOutside(event: MouseEvent) {
  if (panelRef.value && !panelRef.value.contains(event.target as Node)) {
    isOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<template>
  <div ref="panelRef" class="notification-bell">
    <button class="bell-btn" :class="{ 'bell-btn--active': isOpen }" @click="toggle" title="通知">
      <Bell :size="14" />
      <span v-if="hasUnread" class="bell-badge">{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
    </button>

    <Transition name="dropdown">
      <div v-if="isOpen" class="notification-panel">
        <div class="notification-header">
          <span class="notification-title">通知</span>
          <div class="notification-actions">
            <button
              v-if="allNotifications.length"
              class="notif-action-btn"
              title="全部标记已读"
              @click="toastStore.markAllRead()"
            >
              <CheckCheck :size="13" />
            </button>
            <button
              v-if="allNotifications.length"
              class="notif-action-btn"
              title="清空所有通知"
              @click="toastStore.clearAll()"
            >
              <Trash2 :size="13" />
            </button>
          </div>
        </div>

        <div class="notification-list">
          <div
            v-for="notif in allNotifications"
            :key="notif.id"
            class="notification-item"
            :class="{ 'notification-item--unread': !notif.read }"
            @click="toastStore.markRead(notif.id)"
          >
            <div class="notif-icon" :style="{ color: colorMap[notif.type] }">
              <component :is="iconMap[notif.type]" :size="14" />
            </div>
            <div class="notif-content">
              <div class="notif-title">{{ notif.title }}</div>
              <div v-if="notif.message" class="notif-msg">{{ notif.message }}</div>
            </div>
            <div class="notif-time">{{ formatTime(notif.createdAt) }}</div>
          </div>

          <div v-if="allNotifications.length === 0" class="notification-empty">
            <Clock :size="20" />
            <span>暂无通知</span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.notification-bell {
  position: relative;
}

.bell-btn {
  position: relative;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.bell-btn:hover,
.bell-btn--active {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.bell-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--color-accent);
  color: var(--color-inverse);
  font-size: 9px;
  font-weight: 700;
  display: grid;
  place-items: center;
  line-height: 1;
}

.notification-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 1000;
  width: 340px;
  max-height: 400px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
  overflow: hidden;
}

.notification-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border);
}

.notification-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.notification-actions {
  display: flex;
  gap: 4px;
}

.notif-action-btn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.notif-action-btn:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.notification-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.notification-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.notification-item:hover {
  background: var(--color-panel);
}

.notification-item--unread {
  background: var(--color-accent-soft);
}

.notif-icon {
  flex-shrink: 0;
  margin-top: 1px;
}

.notif-content {
  flex: 1;
  min-width: 0;
}

.notif-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
  line-height: 1.4;
}

.notif-msg {
  margin-top: 2px;
  font-size: 12px;
  color: var(--color-subtle);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notif-time {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-subtle);
  white-space: nowrap;
}

.notification-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px;
  color: var(--color-muted);
  font-size: 13px;
}

/* Dropdown animation */
.dropdown-enter-active {
  transition: all 0.15s ease-out;
}

.dropdown-leave-active {
  transition: all 0.1s ease-in;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (max-width: 520px) {
  .notification-panel {
    position: fixed;
    top: 64px;
    right: 12px;
    left: 12px;
    width: auto;
    max-height: min(420px, calc(100dvh - 88px));
  }
}
</style>
