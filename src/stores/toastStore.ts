import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration: number;
  createdAt: number;
  read: boolean;
}

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([]);

  const visibleToasts = computed(() => toasts.value.slice(0, 5));
  const allNotifications = computed(() => [...toasts.value].sort((a, b) => b.createdAt - a.createdAt));
  const unreadCount = computed(() => toasts.value.filter(t => !t.read).length);
  const hasUnread = computed(() => unreadCount.value > 0);

  function generateId(): string {
    return `toast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  function addToast(
    type: Toast['type'],
    title: string,
    message?: string,
    duration: number = 5000
  ): Toast {
    const toast: Toast = {
      id: generateId(),
      type,
      title,
      message,
      duration,
      createdAt: Date.now(),
      read: false
    };

    toasts.value = [toast, ...toasts.value].slice(0, 100);

    if (duration > 0) {
      setTimeout(() => {
        removeToast(toast.id);
      }, duration);
    }

    return toast;
  }

  function removeToast(id: string) {
    toasts.value = toasts.value.filter(t => t.id !== id);
  }

  function markAllRead() {
    toasts.value.forEach(t => { t.read = true; });
  }

  function markRead(id: string) {
    const toast = toasts.value.find(t => t.id === id);
    if (toast) {
      toast.read = true;
    }
  }

  function clearAll() {
    toasts.value = [];
  }

  function success(title: string, message?: string) {
    return addToast('success', title, message);
  }

  function error(title: string, message?: string) {
    return addToast('error', title, message, 8000);
  }

  function warning(title: string, message?: string) {
    return addToast('warning', title, message, 6000);
  }

  function info(title: string, message?: string) {
    return addToast('info', title, message);
  }

  return {
    toasts,
    visibleToasts,
    allNotifications,
    unreadCount,
    hasUnread,
    addToast,
    removeToast,
    markAllRead,
    markRead,
    clearAll,
    success,
    error,
    warning,
    info
  };
});
