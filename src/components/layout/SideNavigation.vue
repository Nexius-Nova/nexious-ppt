<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ChevronLeft, ChevronRight, FileText, MessageSquare, Zap, Cpu, LayoutGrid, Settings2 } from 'lucide-vue-next';

const route = useRoute();
const router = useRouter();

defineProps<{
  collapsed?: boolean;
}>();

defineEmits<{
  toggleCollapse: [];
}>();

const menuItems = [
  { label: '我的 PPT', icon: FileText, route: '/my-ppt', step: 'my-ppt', group: '功能模块' },
  { label: '提示词管理', icon: MessageSquare, route: '/prompts', step: 'prompts', group: '功能模块' },
  { label: 'Skill 管理', icon: Zap, route: '/skills', step: 'skills', group: '功能模块' },
  { label: '模型管理', icon: Cpu, route: '/models', step: 'models', group: '功能模块' },
  { label: '模版广场', icon: LayoutGrid, route: '/templates', step: 'templates', group: '功能模块' },
  { label: '运行配置', icon: Settings2, route: '/config', step: 'config', group: '功能模块' }
];

const groupedItems = computed(() => {
  const groups: Record<string, typeof menuItems> = {};
  menuItems.forEach((item) => {
    if (!groups[item.group]) groups[item.group] = [];
    groups[item.group].push(item);
  });
  return groups;
});

function isActive(itemStep: string): boolean {
  const currentPath = route.path;
  const currentItem = menuItems.find(item => item.route === currentPath);
  if (currentItem) {
    return currentItem.step === itemStep;
  }
  if (currentPath === '/') {
    return itemStep === 'my-ppt';
  }
  return false;
}

function navigateTo(route: string) {
  router.push(route);
}
</script>

<template>
  <nav class="side-nav" :class="{ 'side-nav--collapsed': collapsed }" aria-label="主导航">
    <div class="side-nav__brand">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="6" fill="#ef2d2d" />
        <path d="M7 12L9.5 9.5L12 12L14.5 9.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M7 15L9.5 12.5L12 15L14.5 12.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.6" />
      </svg>
      <span>NEXIOUS PPT</span>
      <button class="side-nav__collapse" :title="collapsed ? '展开左侧菜单' : '收缩左侧菜单'" @click="$emit('toggleCollapse')">
        <component :is="collapsed ? ChevronRight : ChevronLeft" :size="14" />
      </button>
    </div>

    <section v-for="(items, groupName) in groupedItems" :key="groupName" class="side-nav__group">
      <p class="side-nav__group-label">{{ groupName }}</p>
      <button
        v-for="item in items"
        :key="item.step"
        class="side-nav__item"
        :class="{ 'side-nav__item--active': isActive(item.step) }"
        :title="collapsed ? item.label : undefined"
        @click="navigateTo(item.route)"
      >
        <component :is="item.icon" :size="16" />
        <span>{{ item.label }}</span>
      </button>
    </section>
  </nav>
</template>

<style scoped>
.side-nav {
  position: relative;
  grid-area: sidebar;
  display: flex;
  flex-direction: column;
  height: 100%;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
  overflow-y: auto;
  transition: width var(--transition-fast);
}

.side-nav__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text);
}

.side-nav__collapse {
  display: grid;
  place-items: center;
  margin-left: auto;
  width: 26px;
  height: 26px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.side-nav__collapse:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.side-nav__group {
  padding: 12px 8px;
  border-bottom: 1px solid var(--color-border);
}

.side-nav__group:last-of-type {
  border-bottom: none;
}

.side-nav__group-label {
  margin: 0 8px 8px;
  color: var(--color-subtle);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.side-nav__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 36px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  padding: 0 10px;
  text-align: left;
  font-size: 13px;
  font-weight: 500;
  transition: all var(--transition-fast);
  margin-bottom: 2px;
  cursor: pointer;
}

.side-nav__item:last-child {
  margin-bottom: 0;
}

.side-nav__item:hover {
  background: var(--color-panel);
  color: var(--color-text);
}

.side-nav__item--active {
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-weight: 600;
}

.side-nav--collapsed {
  overflow-x: hidden;
}

.side-nav--collapsed .side-nav__brand {
  justify-content: center;
  padding: 14px 8px 48px;
}

.side-nav--collapsed .side-nav__brand span,
.side-nav--collapsed .side-nav__group-label,
.side-nav--collapsed .side-nav__item span {
  display: none;
}

.side-nav--collapsed .side-nav__collapse {
  position: absolute;
  right: 8px;
  bottom: 10px;
  margin-left: 0;
}

.side-nav--collapsed .side-nav__group {
  padding: 12px 8px;
}

.side-nav--collapsed .side-nav__item {
  justify-content: center;
  padding: 0;
}
</style>
