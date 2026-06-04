<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { Circle, LogOut, Monitor, Moon, Palette, Sun, UserCircle } from 'lucide-vue-next';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import UiBadge from '@/components/ui/UiBadge.vue';
import NotificationCenter from '@/components/common/NotificationCenter.vue';
import { resolveAssetUrl } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { useToastStore } from '@/stores/toastStore';

const router = useRouter();
const themeStore = useThemeStore();
const authStore = useAuthStore();
const toastStore = useToastStore();
const { mode, style } = storeToRefs(themeStore);

const showStylePicker = ref(false);
const showUserMenu = ref(false);
const displayName = computed(() => authStore.user?.name || authStore.user?.email || '个人中心');
const userInitial = computed(() => displayName.value.trim().slice(0, 1).toUpperCase() || 'U');
const avatarSrc = computed(() => resolveAssetUrl(authStore.user?.avatar));

const themeStyles = [
  { value: 'default', label: '默认', color: '#ef2d2d' },
  { value: 'claw', label: 'Claw', color: '#ef2d2d' },
  { value: 'knot', label: 'Knot', color: '#8b5cf6' },
  { value: 'dash', label: 'Dash', color: '#06b6d4' }
] as const;

function setMode(newMode: 'light' | 'dark' | 'system') {
  themeStore.setMode(newMode);
}

function setStyle(newStyle: 'default' | 'claw' | 'knot' | 'dash') {
  themeStore.setStyle(newStyle);
  showStylePicker.value = false;
}

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
      
      <!-- Theme Mode Switcher -->
      <div class="workspace-header__modes">
        <button 
          class="workspace-header__mode" 
          :class="{ 'workspace-header__mode--active': mode === 'light' }"
          @click="setMode('light')"
          title="浅色模式"
        >
          <Sun :size="13" />
        </button>
        <button 
          class="workspace-header__mode" 
          :class="{ 'workspace-header__mode--active': mode === 'dark' }"
          @click="setMode('dark')"
          title="深色模式"
        >
          <Moon :size="13" />
        </button>
        <button 
          class="workspace-header__mode" 
          :class="{ 'workspace-header__mode--active': mode === 'system' }"
          @click="setMode('system')"
          title="跟随系统"
        >
          <Monitor :size="13" />
        </button>
      </div>

      <!-- Theme Style Picker -->
      <div class="workspace-header__style-picker">
        <button 
          class="workspace-header__tool workspace-header__style-btn"
          @click="showStylePicker = !showStylePicker"
          title="主题风格"
        >
          <Palette :size="14" />
        </button>
        <Transition name="dropdown">
          <div v-if="showStylePicker" class="style-picker-dropdown">
            <div class="style-picker-header">选择主题风格</div>
            <div class="style-picker-options">
              <button
                v-for="themeStyle in themeStyles"
                :key="themeStyle.value"
                class="style-picker-option"
                :class="{ 'style-picker-option--active': style === themeStyle.value }"
                @click="setStyle(themeStyle.value)"
              >
                <span class="style-picker-color" :style="{ background: themeStyle.color }" />
                <span>{{ themeStyle.label }}</span>
              </button>
            </div>
          </div>
        </Transition>
      </div>

      <div class="workspace-header__user">
        <button
          class="workspace-header__user-btn"
          type="button"
          title="个人中心"
          @click="showUserMenu = !showUserMenu"
        >
          <span class="workspace-header__avatar">
            <img v-if="avatarSrc" :src="avatarSrc" :alt="displayName" />
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

.workspace-header__tool {
  display: grid;
  place-items: center;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-muted);
  transition: all var(--transition-fast);
}

.workspace-header__tool {
  width: 32px;
  height: 32px;
  border-radius: 8px;
}

.workspace-header__tool:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.workspace-header__modes {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 32px;
  padding: 3px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-panel);
}

.workspace-header__mode {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--color-muted);
  display: grid;
  place-items: center;
  transition: all var(--transition-fast);
}

.workspace-header__mode:hover {
  color: var(--color-text);
}

.workspace-header__mode--active {
  background: var(--color-surface);
  color: var(--color-accent);
  box-shadow: var(--shadow-sm);
}

.workspace-header__style-picker {
  position: relative;
}

.workspace-header__style-btn {
  position: relative;
}

.style-picker-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 1000;
  min-width: 160px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.style-picker-header {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-muted);
}

.style-picker-options {
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.style-picker-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.style-picker-option:hover {
  background: var(--color-panel);
}

.style-picker-option--active {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.style-picker-color {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  flex-shrink: 0;
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
</style>
