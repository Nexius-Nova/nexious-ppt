<script setup lang="ts">
import { Circle, LogOut, UserCircle } from 'lucide-vue-next';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import UiBadge from '@/components/ui/UiBadge.vue';
import NotificationCenter from '@/components/common/NotificationCenter.vue';
import ThemeSwitcher from '@/components/common/ThemeSwitcher.vue';
import PrivateImage from '@/components/common/PrivateImage.vue';
import { useAuthStore } from '@/stores/authStore';
import { useToastStore } from '@/stores/toastStore';

const router = useRouter();
const authStore = useAuthStore();
const toastStore = useToastStore();

const showUserMenu = ref(false);
const displayName = computed(() => authStore.user?.name || authStore.user?.email || '个人中心');
const userInitial = computed(() => displayName.value.trim().slice(0, 1).toUpperCase() || 'U');
const avatarSrc = computed(() => authStore.user?.avatar || '');

function openProfile() {
  showUserMenu.value = false;
  void router.push('/profile');
}

function logout() {
  showUserMenu.value = false;
  authStore.logout();
  toastStore.info('已退出登录');
  void router.replace('/login');
}
</script>

<template>
  <header class="workspace-header">
    <div class="workspace-header__title">
      <h1>AI PPT Agent</h1>
      <p>自动生成专业 PPT 演示文稿</p>
    </div>
    <div class="workspace-header__status">
      <UiBadge tone="success"><Circle :size="6" fill="currentColor" /> 系统就绪</UiBadge>
      
      <ThemeSwitcher />

      <div class="workspace-header__user">
        <button
          class="workspace-header__user-btn"
          type="button"
          title="个人中心"
          @click="showUserMenu = !showUserMenu"
        >
          <span class="workspace-header__avatar">
            <PrivateImage v-if="avatarSrc" :src="avatarSrc" :alt="displayName" />
            <span v-else>{{ userInitial }}</span>
          </span>
          <span class="workspace-header__user-name">{{ displayName }}</span>
        </button>
        <Transition name="dropdown">
          <div v-if="showUserMenu" class="user-menu">
            <button type="button" @click="openProfile">
              <UserCircle :size="15" />
              个人中心
            </button>
            <button type="button" @click="logout">
              <LogOut :size="15" />
              退出登录
            </button>
          </div>
        </Transition>
      </div>

      <NotificationCenter />
    </div>
  </header>
</template>

<style scoped>
.workspace-header {
  grid-area: header;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  height: 56px;
  padding: 0 20px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.workspace-header__title h1 {
  margin: 0;
  color: var(--color-text);
  font-size: 16px;
  line-height: 1;
  letter-spacing: -0.02em;
  font-weight: 700;
}

.workspace-header__title p {
  margin: 3px 0 0;
  color: var(--color-subtle);
  font-size: 12px;
}

.workspace-header__status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.workspace-header__user {
  position: relative;
}

.workspace-header__user-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px 0 4px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-text);
  transition: all var(--transition-fast);
}

.workspace-header__user-btn:hover {
  border-color: var(--color-border-strong);
  background: var(--color-panel);
}

.workspace-header__avatar {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-size: 11px;
  font-weight: 800;
}

.workspace-header__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.workspace-header__user-name {
  max-width: 128px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
}

.user-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 1000;
  min-width: 136px;
  padding: 6px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
}

.user-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 34px;
  padding: 0 9px;
  border-radius: 6px;
  color: var(--color-muted);
  font-size: 13px;
  text-align: left;
}

.user-menu button:hover {
  background: var(--color-panel);
  color: var(--color-text);
}

/* Dropdown animation */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.15s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

@media (max-width: 760px) {
  .workspace-header {
    height: auto;
    min-height: 56px;
    flex-wrap: wrap;
    gap: 10px;
    padding: 10px 12px;
  }

  .workspace-header__title {
    min-width: 0;
    flex: 1 1 180px;
  }

  .workspace-header__title p {
    display: none;
  }

  .workspace-header__status {
    flex: 1 1 auto;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .workspace-header__status > :deep(.ui-badge) {
    display: none;
  }
}

@media (max-width: 520px) {
  .workspace-header__user-name {
    display: none;
  }

  .workspace-header__user-btn {
    padding-right: 4px;
  }
}

</style>
