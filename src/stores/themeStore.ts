import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemeStyle = 'default' | 'claw' | 'knot' | 'dash';

const STORAGE_KEY = 'nexious-ppt-theme';

interface ThemeConfig {
  mode: ThemeMode;
  style: ThemeStyle;
}

function loadFromStorage(): ThemeConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    console.warn('Failed to load theme from storage');
  }
  return { mode: 'light', style: 'default' };
}

function saveToStorage(config: ThemeConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    console.warn('Failed to save theme to storage');
  }
}

function applyTheme(mode: ThemeMode, style: ThemeStyle) {
  const root = document.documentElement;
  
  // Apply mode
  if (mode === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', mode);
  }
  
  // Apply style
  root.setAttribute('data-style', style);
}

export const useThemeStore = defineStore('theme', () => {
  const initialConfig = loadFromStorage();
  const mode = ref<ThemeMode>(initialConfig.mode);
  const style = ref<ThemeStyle>(initialConfig.style);

  // Apply theme on init
  applyTheme(mode.value, style.value);

  // Watch for changes
  watch([mode, style], ([newMode, newStyle]) => {
    applyTheme(newMode, newStyle);
    saveToStorage({ mode: newMode, style: newStyle });
  });

  // Listen for system theme changes
  if (typeof window !== 'undefined') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (mode.value === 'system') {
        applyTheme('system', style.value);
      }
    });
  }

  function setMode(newMode: ThemeMode) {
    mode.value = newMode;
  }

  function setStyle(newStyle: ThemeStyle) {
    style.value = newStyle;
  }

  function toggleMode() {
    const modes: ThemeMode[] = ['light', 'dark', 'system'];
    const currentIndex = modes.indexOf(mode.value);
    mode.value = modes[(currentIndex + 1) % modes.length];
  }

  return {
    mode,
    style,
    setMode,
    setStyle,
    toggleMode
  };
});
