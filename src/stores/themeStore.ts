import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemeStyle = 'default' | 'claw' | 'knot' | 'dash' | 'forest' | 'slate' | 'paper' | 'amber';

export const THEME_STYLES: Array<{
  value: ThemeStyle;
  label: string;
  description: string;
  color: string;
}> = [
  { value: 'default', label: 'Classic', description: 'Balanced workspace theme', color: '#ef2d2d' },
  { value: 'claw', label: 'Claw', description: 'Sharp red command surface', color: '#d71920' },
  { value: 'knot', label: 'Knot', description: 'Structured blue-violet focus', color: '#4f46e5' },
  { value: 'dash', label: 'Dash', description: 'Clear cyan operations mode', color: '#0891b2' },
  { value: 'forest', label: 'Forest', description: 'Calm editorial green system', color: '#16834a' },
  { value: 'slate', label: 'Slate', description: 'Dense graphite control room', color: '#475569' },
  { value: 'paper', label: 'Paper', description: 'Warm document-first reading', color: '#9a6a1f' },
  { value: 'amber', label: 'Amber', description: 'High-contrast planning desk', color: '#b45309' }
];

const STORAGE_KEY = 'nexious-ppt-theme';

interface ThemeConfig {
  mode: ThemeMode;
  style: ThemeStyle;
}

function loadFromStorage(): ThemeConfig {
  if (typeof localStorage === 'undefined') {
    return { mode: 'light', style: 'default' };
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<ThemeConfig>;
      const modes: ThemeMode[] = ['light', 'dark', 'system'];
      const styles = THEME_STYLES.map((item) => item.value);
      return {
        mode: parsed.mode && modes.includes(parsed.mode) ? parsed.mode : 'light',
        style: parsed.style && styles.includes(parsed.style) ? parsed.style : 'default'
      };
    }
  } catch {
    console.warn('Failed to load theme from storage');
  }
  return { mode: 'light', style: 'default' };
}

function saveToStorage(config: ThemeConfig) {
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    console.warn('Failed to save theme to storage');
  }
}

function applyTheme(mode: ThemeMode, style: ThemeStyle) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolvedMode = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
  
  root.setAttribute('data-theme', resolvedMode);
  root.setAttribute('data-theme-mode', mode);
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
    toggleMode,
    themeStyles: THEME_STYLES
  };
});
