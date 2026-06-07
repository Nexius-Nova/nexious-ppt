<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-vue-next';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useThemeStore, type ThemeMode, type ThemeStyle } from '@/stores/themeStore';

const themeStore = useThemeStore();
const { mode, style } = storeToRefs(themeStore);
const rootRef = ref<HTMLElement | null>(null);
const showPanel = ref(false);

const modes: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '系统', icon: Monitor }
];

function setMode(nextMode: ThemeMode) {
  themeStore.setMode(nextMode);
}

function setStyle(nextStyle: ThemeStyle) {
  themeStore.setStyle(nextStyle);
  showPanel.value = false;
}

function handleClickOutside(event: MouseEvent) {
  if (!showPanel.value) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (!rootRef.value?.contains(target)) {
    showPanel.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<template>
  <div ref="rootRef" class="theme-switcher">
    <div class="theme-switcher__modes" aria-label="主题明暗模式">
      <button
        v-for="item in modes"
        :key="item.value"
        class="theme-switcher__mode"
        :class="{ 'theme-switcher__mode--active': mode === item.value }"
        type="button"
        :title="item.label"
        @click="setMode(item.value)"
      >
        <component :is="item.icon" :size="13" />
      </button>
    </div>

    <button
      class="theme-switcher__trigger"
      type="button"
      title="主题风格"
      @click="showPanel = !showPanel"
    >
      <Palette :size="14" />
    </button>

    <Transition name="theme-switcher-dropdown">
      <section v-if="showPanel" class="theme-switcher__panel" aria-label="主题风格">
        <header>
          <strong>主题风格</strong>
          <span>影响所有页面的背景、卡片、边框、状态与强调色</span>
        </header>

        <div class="theme-switcher__grid">
          <button
            v-for="item in themeStore.themeStyles"
            :key="item.value"
            class="theme-card"
            :class="[`theme-card--${item.value}`, { 'theme-card--active': style === item.value }]"
            type="button"
            @click="setStyle(item.value)"
          >
            <span class="theme-card__preview">
              <i />
              <b />
              <em />
            </span>
            <span class="theme-card__body">
              <strong>{{ item.label }}</strong>
              <small>{{ item.description }}</small>
            </span>
            <Check v-if="style === item.value" class="theme-card__check" :size="14" />
          </button>
        </div>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.theme-switcher {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.theme-switcher__modes {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 32px;
  padding: 3px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-panel);
}

.theme-switcher__mode,
.theme-switcher__trigger {
  display: grid;
  place-items: center;
  color: var(--color-muted);
  cursor: pointer;
  transition: border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast), box-shadow var(--transition-fast);
}

.theme-switcher__mode {
  width: 24px;
  height: 24px;
  border-radius: 999px;
}

.theme-switcher__mode:hover {
  color: var(--color-text);
}

.theme-switcher__mode--active {
  background: var(--color-surface);
  color: var(--color-accent);
  box-shadow: var(--shadow-sm);
}

.theme-switcher__trigger {
  width: 32px;
  height: 32px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.theme-switcher__trigger:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.theme-switcher__panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 1000;
  width: min(420px, calc(100vw - 24px));
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
}

.theme-switcher__panel header {
  display: grid;
  gap: 3px;
  padding: 2px 2px 10px;
  border-bottom: 1px solid var(--color-border);
}

.theme-switcher__panel strong {
  color: var(--color-text);
  font-size: 13px;
}

.theme-switcher__panel span {
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.5;
}

.theme-switcher__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding-top: 10px;
}

.theme-card {
  position: relative;
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
  min-height: 70px;
  padding: 9px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-card);
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast), box-shadow var(--transition-fast);
}

.theme-card:hover,
.theme-card--active {
  border-color: var(--color-accent);
  box-shadow: var(--shadow-sm);
}

.theme-card--active {
  background: var(--color-accent-soft);
}

.theme-card__preview {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--theme-preview-border);
  border-radius: 7px;
  background: var(--theme-preview-bg);
}

.theme-card__preview i,
.theme-card__preview b,
.theme-card__preview em {
  display: block;
  border-radius: 4px;
  font-style: normal;
}

.theme-card__preview i {
  grid-row: span 2;
  background: var(--theme-preview-accent);
}

.theme-card__preview b {
  background: var(--theme-preview-surface);
}

.theme-card__preview em {
  background: var(--theme-preview-muted);
}

.theme-card__body {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.theme-card__body strong,
.theme-card__body small {
  overflow: hidden;
  text-overflow: ellipsis;
}

.theme-card__body strong {
  white-space: nowrap;
}

.theme-card__body small {
  display: -webkit-box;
  color: var(--color-muted);
  font-size: 11px;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.theme-card__check {
  position: absolute;
  top: 8px;
  right: 8px;
  color: var(--color-accent);
}

.theme-card--default,
.theme-card--claw {
  --theme-preview-bg: #f6f6f7;
  --theme-preview-surface: #ffffff;
  --theme-preview-muted: #d2d6dc;
  --theme-preview-border: #e1e3e7;
  --theme-preview-accent: #ef2d2d;
}

.theme-card--knot {
  --theme-preview-bg: #f5f6fb;
  --theme-preview-surface: #ffffff;
  --theme-preview-muted: #cbd5e1;
  --theme-preview-border: #d8deea;
  --theme-preview-accent: #4f46e5;
}

.theme-card--dash {
  --theme-preview-bg: #f1f7f8;
  --theme-preview-surface: #ffffff;
  --theme-preview-muted: #cbdedf;
  --theme-preview-border: #d6e6e7;
  --theme-preview-accent: #0891b2;
}

.theme-card--forest {
  --theme-preview-bg: #f4f7f1;
  --theme-preview-surface: #ffffff;
  --theme-preview-muted: #cfd8c8;
  --theme-preview-border: #dae4d4;
  --theme-preview-accent: #16834a;
}

.theme-card--slate {
  --theme-preview-bg: #111827;
  --theme-preview-surface: #1f2937;
  --theme-preview-muted: #475569;
  --theme-preview-border: #334155;
  --theme-preview-accent: #94a3b8;
}

.theme-card--paper {
  --theme-preview-bg: #f7f3ea;
  --theme-preview-surface: #fffdf8;
  --theme-preview-muted: #ded4c0;
  --theme-preview-border: #e4dac8;
  --theme-preview-accent: #9a6a1f;
}

.theme-card--amber {
  --theme-preview-bg: #f7f4ec;
  --theme-preview-surface: #ffffff;
  --theme-preview-muted: #e2d4b9;
  --theme-preview-border: #e5dccb;
  --theme-preview-accent: #b45309;
}

.theme-switcher-dropdown-enter-active,
.theme-switcher-dropdown-leave-active {
  transition: opacity var(--transition-fast), transform var(--transition-fast);
}

.theme-switcher-dropdown-enter-from,
.theme-switcher-dropdown-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (max-width: 640px) {
  .theme-switcher {
    gap: 6px;
  }

  .theme-switcher__modes {
    height: 30px;
    padding: 2px;
  }

  .theme-switcher__mode {
    width: 24px;
    height: 24px;
  }

  .theme-switcher__trigger {
    width: 30px;
    height: 30px;
    border-radius: 8px;
  }

  .theme-switcher__panel {
    position: fixed;
    top: 56px;
    right: 10px;
    left: 10px;
    width: auto;
    max-height: calc(100svh - 68px);
    overflow-y: auto;
  }

  .theme-switcher__grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 420px) {
  .theme-switcher__modes {
    display: none;
  }
}
</style>
