<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { Search, FileText, MessageSquare, LayoutTemplate, Cpu, ArrowRight } from 'lucide-vue-next';
import { useRouter } from 'vue-router';
import { useAgentStore } from '@/stores/agentStore';
import type { SlideOutline, PromptDefinition, PptTemplate } from '@/types/agent';

interface SearchResults {
  slides: SlideOutline[];
  projects: any[];
  prompts: PromptDefinition[];
  templates: PptTemplate[];
}

const props = defineProps<{
  show: boolean;
}>();

const emit = defineEmits<{
  close: [];
  navigate: [route: string];
}>();

const router = useRouter();
const store = useAgentStore();

const query = ref('');
const inputRef = ref<HTMLInputElement | null>(null);
const selectedIndex = ref(0);
const results = ref<SearchResults>({ slides: [], projects: [], prompts: [], templates: [] });

interface FlatResult {
  type: 'slide' | 'project' | 'prompt' | 'template';
  label: string;
  subtitle: string;
  route?: string;
  data: any;
}

const flatResults = computed<FlatResult[]>(() => {
  const items: FlatResult[] = [];
  for (const slide of results.value.slides) {
    items.push({ type: 'slide', label: slide.title, subtitle: `${slide.bullets.length} 个要点`, route: undefined, data: slide });
  }
  for (const project of results.value.projects) {
    items.push({ type: 'project', label: project.title, subtitle: project.topic || project.description || '', route: `/project/${project.id}/input`, data: project });
  }
  for (const prompt of results.value.prompts) {
    items.push({ type: 'prompt', label: prompt.title, subtitle: prompt.scene, route: undefined, data: prompt });
  }
  for (const template of results.value.templates) {
    items.push({ type: 'template', label: template.name, subtitle: template.description || '', route: undefined, data: template });
  }
  return items;
});

const groupCounts = computed(() => ({
  slides: results.value.slides.length,
  projects: results.value.projects.length,
  prompts: results.value.prompts.length,
  templates: results.value.templates.length
}));

const hasResults = computed(() => flatResults.value.length > 0);

function doSearch() {
  selectedIndex.value = 0;
  results.value = store.globalSearch(query.value) as any;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function onInput(value: string) {
  query.value = value;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(doSearch, 200);
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (selectedIndex.value < flatResults.value.length - 1) {
      selectedIndex.value++;
    }
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (selectedIndex.value > 0) {
      selectedIndex.value--;
    }
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const item = flatResults.value[selectedIndex.value];
    if (item) {
      navigateTo(item);
    }
  }
}

function navigateTo(item: FlatResult) {
  if (item.type === 'slide') {
    store.activeStep = 'outline' as any;
    emit('close');
  } else if (item.type === 'project') {
    store.selectPptProject(item.data.id);
    router.push(`/project/${item.data.id}/input`);
    emit('close');
  } else if (item.type === 'prompt') {
    store.activeStep = 'prompts' as any;
    router.push('/prompts');
    emit('close');
  } else if (item.type === 'template') {
    store.activeStep = 'templates' as any;
    router.push('/templates');
    emit('close');
  }
}

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    slide: '幻灯片',
    project: '项目',
    prompt: '提示词',
    template: '模版'
  };
  return labels[type] || type;
}

function typeIcon(type: string) {
  const icons: Record<string, any> = {
    slide: FileText,
    project: FileText,
    prompt: MessageSquare,
    template: LayoutTemplate
  };
  return icons[type] || Search;
}

watch(() => props.show, (val) => {
  if (val) {
    query.value = '';
    results.value = { slides: [], projects: [], prompts: [], templates: [] };
    selectedIndex.value = 0;
    nextTick(() => {
      inputRef.value?.focus();
    });
  }
});
</script>

<template>
  <Teleport to="body">
    <Transition name="search-fade">
      <div v-if="show" class="search-overlay" @click.self="$emit('close')">
        <div class="search-modal">
          <div class="search-input-wrapper">
            <Search :size="16" class="search-input-icon" />
            <input
              ref="inputRef"
              :value="query"
              class="search-input"
              placeholder="搜索幻灯片、项目、提示词、模版..."
              @input="onInput(($event.target as HTMLInputElement).value)"
              @keydown="onKeyDown"
            />
            <kbd class="search-hint">ESC</kbd>
          </div>

          <div v-if="!query.trim()" class="search-empty-state">
            <div class="search-empty-icon">
              <Search :size="32" />
            </div>
            <p>输入关键词搜索</p>
            <div class="search-tips">
              <span>提示：可搜索幻灯片标题、要点、项目名称、提示词内容等</span>
            </div>
          </div>

          <div v-else-if="!hasResults" class="search-empty-state">
            <p>未找到 "<strong>{{ query }}</strong>" 的相关结果</p>
          </div>

          <div v-else class="search-results">
            <!-- Slides -->
            <div v-if="results.slides.length" class="search-group">
              <div class="search-group-header">幻灯片（{{ results.slides.length }}）</div>
              <button
                v-for="(slide, i) in results.slides"
                :key="slide.id"
                class="search-item"
                :class="{ 'search-item--active': flatResults.findIndex(r => r.type === 'slide' && r.data.id === slide.id) === selectedIndex }"
                @click="navigateTo({ type: 'slide', label: slide.title, subtitle: '', data: slide })"
                @mouseenter="selectedIndex = flatResults.findIndex(r => r.type === 'slide' && r.data.id === slide.id)"
              >
                <FileText :size="14" class="search-item-icon" />
                <div class="search-item-content">
                  <div class="search-item-title">{{ slide.title }}</div>
                  <div class="search-item-subtitle">{{ slide.bullets.length }} 个要点</div>
                </div>
                <ArrowRight :size="14" class="search-item-arrow" />
              </button>
            </div>

            <!-- Projects -->
            <div v-if="results.projects.length" class="search-group">
              <div class="search-group-header">项目（{{ results.projects.length }}）</div>
              <button
                v-for="(project, i) in results.projects"
                :key="project.id"
                class="search-item"
                :class="{ 'search-item--active': flatResults.findIndex(r => r.type === 'project' && r.data.id === project.id) === selectedIndex }"
                @click="navigateTo({ type: 'project', label: project.title, subtitle: '', data: project })"
                @mouseenter="selectedIndex = flatResults.findIndex(r => r.type === 'project' && r.data.id === project.id)"
              >
                <FileText :size="14" class="search-item-icon search-item-icon--project" />
                <div class="search-item-content">
                  <div class="search-item-title">{{ project.title }}</div>
                  <div class="search-item-subtitle">{{ project.topic || '无主题' }}</div>
                </div>
                <ArrowRight :size="14" class="search-item-arrow" />
              </button>
            </div>

            <!-- Prompts -->
            <div v-if="results.prompts.length" class="search-group">
              <div class="search-group-header">提示词（{{ results.prompts.length }}）</div>
              <button
                v-for="(prompt, i) in results.prompts"
                :key="prompt.id"
                class="search-item"
                :class="{ 'search-item--active': flatResults.findIndex(r => r.type === 'prompt' && r.data.id === prompt.id) === selectedIndex }"
                @click="navigateTo({ type: 'prompt', label: prompt.title, subtitle: '', data: prompt })"
                @mouseenter="selectedIndex = flatResults.findIndex(r => r.type === 'prompt' && r.data.id === prompt.id)"
              >
                <MessageSquare :size="14" class="search-item-icon search-item-icon--prompt" />
                <div class="search-item-content">
                  <div class="search-item-title">{{ prompt.title }}</div>
                  <div class="search-item-subtitle">{{ prompt.scene || '通用' }}</div>
                </div>
                <ArrowRight :size="14" class="search-item-arrow" />
              </button>
            </div>

            <!-- Templates -->
            <div v-if="results.templates.length" class="search-group">
              <div class="search-group-header">模版（{{ results.templates.length }}）</div>
              <button
                v-for="(template, i) in results.templates"
                :key="template.id"
                class="search-item"
                :class="{ 'search-item--active': flatResults.findIndex(r => r.type === 'template' && r.data.id === template.id) === selectedIndex }"
                @click="navigateTo({ type: 'template', label: template.name, subtitle: '', data: template })"
                @mouseenter="selectedIndex = flatResults.findIndex(r => r.type === 'template' && r.data.id === template.id)"
              >
                <LayoutTemplate :size="14" class="search-item-icon search-item-icon--template" />
                <div class="search-item-content">
                  <div class="search-item-title">{{ template.name }}</div>
                  <div class="search-item-subtitle">{{ template.description || template.category || '' }}</div>
                </div>
                <ArrowRight :size="14" class="search-item-arrow" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.search-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.search-modal {
  width: 100%;
  max-width: 560px;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-surface);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-border);
}

.search-input-icon {
  flex-shrink: 0;
  color: var(--color-muted);
}

.search-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: 15px;
  font-family: inherit;
  outline: none;
}

.search-input::placeholder {
  color: var(--color-placeholder);
}

.search-hint {
  flex-shrink: 0;
  padding: 2px 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-subtle);
  background: var(--color-panel);
}

.search-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 20px;
  color: var(--color-muted);
  font-size: 14px;
  text-align: center;
}

.search-empty-icon {
  color: var(--color-border-strong);
  margin-bottom: 4px;
}

.search-tips {
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-subtle);
  max-width: 300px;
}

.search-results {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.search-group {
  padding: 4px 0;
}

.search-group-header {
  padding: 8px 18px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-subtle);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.search-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 18px;
  border: none;
  background: transparent;
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.search-item:hover,
.search-item--active {
  background: var(--color-panel);
}

.search-item-icon {
  flex-shrink: 0;
  color: var(--color-accent);
}

.search-item-icon--project {
  color: var(--color-info);
}

.search-item-icon--prompt {
  color: var(--color-warning);
}

.search-item-icon--template {
  color: var(--color-success);
}

.search-item-content {
  flex: 1;
  min-width: 0;
}

.search-item-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-item-subtitle {
  font-size: 12px;
  color: var(--color-subtle);
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-item-arrow {
  flex-shrink: 0;
  color: var(--color-muted);
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.search-item:hover .search-item-arrow,
.search-item--active .search-item-arrow {
  opacity: 1;
}

/* Transition */
.search-fade-enter-active,
.search-fade-leave-active {
  transition: all 0.15s ease;
}

.search-fade-enter-from,
.search-fade-leave-to {
  opacity: 0;
}

.search-fade-enter-from .search-modal,
.search-fade-leave-to .search-modal {
  transform: scale(0.96) translateY(-10px);
}
</style>
