<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';

interface ShowcaseSlide {
  title: string;
  url: string;
}

interface ShowcaseProject {
  id: string;
  title: string;
  scene: string;
  slides: ShowcaseSlide[];
}

const props = defineProps<{
  projects: ShowcaseProject[];
}>();

const activeProjectIndex = ref(0);
const activeSlideIndex = ref(0);
let timer: ReturnType<typeof window.setInterval> | undefined;

const activeProject = computed(() => props.projects[activeProjectIndex.value] || props.projects[0] || null);
const slides = computed(() => activeProject.value?.slides.slice(0, 4) || []);
const activeSlide = computed(() => slides.value[activeSlideIndex.value] || slides.value[0] || null);

watch(activeProjectIndex, () => {
  activeSlideIndex.value = 0;
});

function nextSlide() {
  if (!slides.value.length) return;
  if (activeSlideIndex.value < slides.value.length - 1) {
    activeSlideIndex.value += 1;
    return;
  }
  activeSlideIndex.value = 0;
  activeProjectIndex.value = props.projects.length ? (activeProjectIndex.value + 1) % props.projects.length : 0;
}

function prevSlide() {
  if (!slides.value.length) return;
  if (activeSlideIndex.value > 0) {
    activeSlideIndex.value -= 1;
    return;
  }
  activeProjectIndex.value = props.projects.length
    ? (activeProjectIndex.value - 1 + props.projects.length) % props.projects.length
    : 0;
  activeSlideIndex.value = Math.max((props.projects[activeProjectIndex.value]?.slides.slice(0, 4).length || 1) - 1, 0);
}

function selectProject(index: number) {
  activeProjectIndex.value = index;
}

function selectSlide(index: number) {
  activeSlideIndex.value = index;
}

onMounted(() => {
  timer = window.setInterval(nextSlide, 5600);
});

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});
</script>

<template>
  <section class="showcase" aria-label="PPT 作品轮播">
    <header class="showcase__header">
      <div>
        <strong>{{ activeProject?.title }}</strong>
        <span>{{ activeProject?.scene }}</span>
      </div>

      <div class="showcase__projects" aria-label="切换作品类型">
        <button
          v-for="(project, index) in projects"
          :key="project.id"
          type="button"
          :class="{ 'is-active': index === activeProjectIndex }"
          @click="selectProject(index)"
        >
          {{ project.title }}
        </button>
      </div>
    </header>

    <figure class="showcase__stage">
      <button class="showcase__arrow showcase__arrow--left" type="button" aria-label="上一页" @click="prevSlide">
        <ChevronLeft :size="19" />
      </button>

      <img
        v-if="activeSlide"
        :key="activeSlide.url"
        :src="activeSlide.url"
        :alt="`${activeProject?.title || 'PPT'} - ${activeSlide.title}`"
        loading="eager"
      />

      <button class="showcase__arrow showcase__arrow--right" type="button" aria-label="下一页" @click="nextSlide">
        <ChevronRight :size="19" />
      </button>
    </figure>

    <footer class="showcase__footer">
      <span>{{ activeSlide?.title }}</span>
      <div class="showcase__pages" aria-label="切换页面">
        <button
          v-for="(slide, index) in slides"
          :key="slide.url"
          type="button"
          :class="{ 'is-active': index === activeSlideIndex }"
          :aria-label="`查看${slide.title}`"
          @click="selectSlide(index)"
        />
      </div>
    </footer>
  </section>
</template>

<style scoped>
.showcase {
  display: grid;
  grid-template-rows: auto auto auto;
  gap: 12px;
  height: auto;
  min-height: 0;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  padding: 12px;
  box-shadow: var(--shadow-card);
}

.showcase__header,
.showcase__stage,
.showcase__footer,
.showcase__projects,
.showcase__pages {
  display: flex;
  align-items: center;
}

.showcase__header,
.showcase__footer {
  justify-content: space-between;
  gap: 14px;
  min-width: 0;
}

.showcase__header strong {
  display: block;
  color: var(--color-text);
  font-size: 15px;
  line-height: 1.2;
}

.showcase__header span,
.showcase__footer span {
  color: var(--color-subtle);
  font-size: 12px;
  font-weight: 700;
}

.showcase__projects {
  gap: 6px;
}

.showcase__projects button {
  min-height: 30px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  padding: 0 10px;
  font-size: 12px;
  font-weight: 700;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    color var(--transition-fast);
}

.showcase__projects button:hover,
.showcase__projects button.is-active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.showcase__stage {
  position: relative;
  justify-content: center;
  gap: 14px;
  min-height: 420px;
  margin: 0;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  padding: 12px 54px;
  overflow: hidden;
}

.showcase__stage img {
  display: block;
  width: min(100%, 1040px);
  max-height: 620px;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  object-fit: contain;
  background: #ffffff;
  box-shadow: var(--shadow-sm);
  animation: revealSlide 720ms cubic-bezier(0.22, 1, 0.36, 1) both;
  transform-origin: center;
}

.showcase__arrow {
  position: absolute;
  top: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  transform: translateY(-50%);
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    color var(--transition-fast);
}

.showcase__arrow:hover {
  border-color: var(--color-border-strong);
  background: var(--color-card);
  color: var(--color-text);
}

.showcase__arrow--left {
  left: 12px;
}

.showcase__arrow--right {
  right: 12px;
}

.showcase__pages {
  gap: 6px;
}

.showcase__pages button {
  width: 22px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--color-border-strong);
  transition: background var(--transition-fast);
}

.showcase__pages button.is-active {
  background: var(--color-accent);
}

@keyframes revealSlide {
  from {
    opacity: 0;
    filter: blur(6px);
    transform: translateY(10px) scale(0.985);
  }

  to {
    opacity: 1;
    filter: blur(0);
    transform: translateY(0);
  }
}

@media (max-width: 860px) {
  .showcase {
    gap: 10px;
  }

  .showcase__header {
    align-items: flex-start;
    flex-direction: column;
  }

  .showcase__projects {
    max-width: 100%;
    overflow: hidden;
  }

  .showcase__stage {
    min-height: 320px;
    padding-right: 44px;
    padding-left: 44px;
  }
}

@media (max-width: 620px) {
  .showcase {
    padding: 10px;
  }

  .showcase__header > div:first-child,
  .showcase__footer span {
    display: none;
  }

  .showcase__stage {
    min-height: 220px;
    padding: 10px 40px;
  }

  .showcase__stage img {
    width: 100%;
    max-height: 100%;
  }

  .showcase__arrow {
    width: 30px;
    height: 30px;
  }
}
</style>
