<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Download,
  FileCheck2,
  FileText,
  Layers3,
  MonitorPlay,
  PanelTop,
  Sparkles,
  Upload,
  Wand2
} from 'lucide-vue-next';
import GeneratedDeckPreview from '@/components/home/GeneratedDeckPreview.vue';
import UiButton from '@/components/ui/UiButton.vue';
import { useAuthStore } from '@/stores/authStore';

interface ShowcaseProject {
  id: string;
  title: string;
  scene: string;
  slides: Array<{
    title: string;
    url: string;
  }>;
}

const router = useRouter();
const authStore = useAuthStore();

const actionText = computed(() => (authStore.token ? '进入工作台' : '开始使用'));

const showcaseProjects: ShowcaseProject[] = [
  {
    id: 'chess',
    title: '活动策划方案',
    scene: '校园赛事 / 活动申报',
    slides: [
      { title: '活动封面', url: '/home-previews/chess/01.svg' },
      { title: '背景与意义', url: '/home-previews/chess/02.svg' },
      { title: '组织信息', url: '/home-previews/chess/03.svg' },
      { title: '流程安排', url: '/home-previews/chess/04.svg' }
    ]
  },
  {
    id: 'iphone',
    title: '产品发布演示',
    scene: '新品发布 / 商业路演',
    slides: [
      { title: '产品封面', url: '/home-previews/iphone/01.svg' },
      { title: '关键变化', url: '/home-previews/iphone/02.svg' },
      { title: '体验升级', url: '/home-previews/iphone/03.svg' },
      { title: '能力说明', url: '/home-previews/iphone/04.svg' }
    ]
  },
  {
    id: 'film',
    title: '知识科普课件',
    scene: '课程讲解 / 培训分享',
    slides: [
      { title: '主题导入', url: '/home-previews/film/01.svg' },
      { title: '核心问题', url: '/home-previews/film/02.svg' },
      { title: '原因分析', url: '/home-previews/film/03.svg' },
      { title: '发展时间线', url: '/home-previews/film/04.svg' }
    ]
  }
];

const navItems = [
  { label: '工作流', target: 'workflow' },
  { label: '预览', target: 'preview' },
  { label: '能力', target: 'features' },
];

const workflowSteps = [
  {
    title: '输入资料',
    label: 'INPUT',
    detail: '上传文档、主题、链接或关键要点，先把素材放进统一上下文。',
    icon: Upload
  },
  {
    title: '选择 Skill',
    label: 'SKILL',
    detail: '按路演、课程、活动方案等场景匹配生成策略。',
    icon: Sparkles
  },
  {
    title: 'Agent 生成',
    label: 'AGENT',
    detail: '生成大纲、页面内容和版式初稿，保留可审阅节点。',
    icon: Bot
  },
  {
    title: '预览编辑',
    label: 'PREVIEW',
    detail: '先看页面结果，再继续调整内容、结构和视觉表达。',
    icon: PanelTop
  },
  {
    title: '导出交付',
    label: 'PPTX',
    detail: '完成质检后导出可演示、可修改的 PPT 文件。',
    icon: Download
  }
];

const features = [
  {
    title: '结构先行',
    text: '先生成大纲和章节关系，避免一开始就陷入页面细节。',
    icon: Layers3
  },
  {
    title: 'Skill 驱动',
    text: '把不同演示场景拆成可复用能力，让生成结果更贴近目的。',
    icon: Sparkles
  },
  {
    title: '真实预览',
    text: '生成页面可以立即预览，方便判断方向、重试和继续编辑。',
    icon: MonitorPlay
  },
  {
    title: '交付闭环',
    text: '从资料到 PPT 文件，覆盖生成、质检、导出和后续维护。',
    icon: FileCheck2
  }
];

const scenes = ['活动策划', '产品发布', '培训课件', '项目复盘', '商业路演', '知识科普'];

function enterConsole() {
  void router.push(authStore.token ? '/my-ppt' : '/login');
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
</script>

<template>
  <main class="home-page">
    <header class="home-header">
      <button class="brand" type="button" aria-label="返回首页" @click="scrollToSection('top')">
        <span class="brand__mark">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect width="24" height="24" rx="6" fill="var(--color-accent)" />
            <path d="M7 12L9.5 9.5L12 12L14.5 9.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M7 15L9.5 12.5L12 15L14.5 12.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.6" />
          </svg>
        </span>
        <span>
          <strong>NEXIOUS PPT</strong>
          <small>AI Deck Agent</small>
        </span>
      </button>

      <nav class="home-header__nav" aria-label="首页导航">
        <button v-for="item in navItems" :key="item.target" type="button" @click="scrollToSection(item.target)">
          {{ item.label }}
        </button>
      </nav>

      <UiButton size="sm" variant="primary" @click="enterConsole">
        {{ actionText }}
        <ArrowRight :size="15" aria-hidden="true" />
      </UiButton>
    </header>

    <section id="top" class="hero" aria-labelledby="home-title">
      <div class="hero__content">
        <span class="hero__badge">
          <span class="hero__pulse" />
          AI PPT Agent 在线
        </span>
        <h1 id="home-title">Nexious PPT</h1>
        <p class="hero__lead">资料进场，演示成型。</p>
        <p class="hero__desc">
          仿照产品官网的清晰叙事，把输入、Skill、Agent 生成、预览和导出组织成一条可理解的 PPT 生产通道。
        </p>

        <div class="hero__actions">
          <UiButton size="lg" variant="primary" @click="enterConsole">
            {{ actionText }}
            <ArrowRight :size="17" aria-hidden="true" />
          </UiButton>
          <UiButton size="lg" variant="secondary" @click="scrollToSection('preview')">
            查看生成预览
          </UiButton>
        </div>
      </div>

      <div class="hero-preview" aria-label="产品预览">
        <div class="hero-preview__toolbar">
          <span />
          <strong>Deck Output</strong>
          <small>Ready</small>
        </div>
        <div class="hero-preview__canvas">
          <img src="/home-previews/iphone/01.svg" alt="产品发布演示封面预览" />
          <img src="/home-previews/film/02.svg" alt="知识科普课件页面预览" />
          <img src="/home-previews/chess/04.svg" alt="活动策划流程页面预览" />
        </div>
      </div>
    </section>

    <section id="workflow" class="section-block" aria-labelledby="workflow-title">
      <div class="section-heading section-heading--center">
        <span class="section-kicker">Workflow</span>
        <h2 id="workflow-title">一条清楚的 PPT Agent 工作流</h2>
        <p>让用户知道每一步在做什么，也知道 Skill 在生成策略里起什么作用。</p>
      </div>

      <ol class="workflow-grid">
        <li v-for="(step, index) in workflowSteps" :key="step.title">
          <span class="workflow-grid__index">{{ String(index + 1).padStart(2, '0') }}</span>
          <span class="workflow-grid__icon">
            <component :is="step.icon" :size="18" />
          </span>
          <small>{{ step.label }}</small>
          <strong>{{ step.title }}</strong>
          <p>{{ step.detail }}</p>
        </li>
      </ol>
    </section>

    <section id="preview" class="section-block" aria-labelledby="preview-title">
      <div class="section-heading section-heading--split">
        <div>
          <span class="section-kicker">Preview</span>
          <h2 id="preview-title">ppt预览</h2>
        </div>
      </div>

      <GeneratedDeckPreview :projects="showcaseProjects" />
    </section>

    <section id="features" class="section-block" aria-labelledby="features-title">
      <div class="section-heading section-heading--center">
        <span class="section-kicker">Core</span>
        <h2 id="features-title">PPT 的核心能力</h2>
      </div>

      <div class="feature-grid">
        <article v-for="feature in features" :key="feature.title" class="feature-card">
          <span>
            <component :is="feature.icon" :size="18" />
          </span>
          <strong>{{ feature.title }}</strong>
          <p>{{ feature.text }}</p>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.home-page {
  --home-max: 1180px;

  height: 100dvh;
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--color-bg);
  color: var(--color-text);
  scroll-behavior: smooth;
}

.home-header {
  position: sticky;
  top: 0;
  z-index: 30;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  width: min(100%, var(--home-max));
  min-height: 68px;
  margin: 0 auto;
  padding: 0 24px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
}

.brand,
.home-header__nav,
.hero__badge,
.section-kicker,
.workflow-grid__icon,
.feature-card span {
  display: inline-flex;
  align-items: center;
}

.brand {
  gap: 10px;
  color: var(--color-text);
  text-align: left;
}

.brand__mark {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 10px;
  background: var(--color-accent);
  color: var(--color-inverse);
}

.brand strong,
.brand small {
  display: block;
  line-height: 1;
}

.brand strong {
  font-size: 14px;
  font-weight: 900;
}

.brand small {
  margin-top: 4px;
  color: var(--color-subtle);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 800;
}

.home-header__nav {
  justify-content: center;
  gap: 6px;
}

.home-header__nav button {
  min-height: 38px;
  border-radius: 8px;
  color: var(--color-muted);
  padding: 0 12px;
  font-size: 13px;
  font-weight: 800;
}

.home-header__nav button:hover {
  background: var(--color-panel);
  color: var(--color-text);
}

.hero,
.section-block,
.final-cta {
  width: min(100%, var(--home-max));
  margin: 0 auto;
  padding-right: 24px;
  padding-left: 24px;
}

.hero {
  display: grid;
  justify-items: center;
  padding-top: clamp(52px, 8vw, 92px);
  text-align: center;
}

.hero__content {
  max-width: 860px;
}

.hero__badge {
  gap: 9px;
  min-height: 36px;
  border: 1px solid color-mix(in srgb, var(--color-accent) 28%, var(--color-border));
  border-radius: var(--radius-full);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  padding: 0 14px;
  font-size: 13px;
  font-weight: 800;
}

.hero__pulse {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--color-success);
  box-shadow: 0 0 0 4px var(--color-success-soft);
}

.hero h1 {
  margin: 22px 0 0;
  color: var(--color-text);
  font-size: clamp(58px, 10vw, 112px);
  font-weight: 950;
  letter-spacing: 0;
  line-height: 0.94;
}

.hero__lead {
  margin-top: 14px;
  color: var(--color-text);
  font-size: clamp(28px, 4.4vw, 54px);
  font-weight: 900;
  line-height: 1.08;
}

.hero__desc {
  max-width: 680px;
  margin: 22px auto 0;
  color: var(--color-muted);
  font-size: clamp(15px, 1.7vw, 18px);
  line-height: 1.78;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 30px;
}

.hero-preview {
  width: min(100%, 1080px);
  margin-top: 48px;
  border: 1px solid var(--color-border-strong);
  border-radius: 10px;
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.hero-preview__toolbar {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 50px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-panel);
  padding: 0 16px;
}

.hero-preview__toolbar span {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  background: var(--color-accent);
  box-shadow:
    16px 0 0 var(--color-warning),
    32px 0 0 var(--color-success);
}

.hero-preview__toolbar strong,
.hero-preview__toolbar small,
.section-kicker {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
}

.hero-preview__toolbar strong {
  color: var(--color-subtle);
  text-align: left;
}

.hero-preview__toolbar small {
  color: var(--color-success);
}

.hero-preview__canvas {
  display: grid;
  grid-template-columns: 1fr 0.64fr;
  grid-template-rows: repeat(2, auto);
  gap: 12px;
  padding: 16px;
}

.hero-preview__canvas img {
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #ffffff;
  object-fit: cover;
  box-shadow: var(--shadow-card);
}

.hero-preview__canvas img:first-child {
  grid-row: span 2;
  align-self: center;
}

.section-block {
  padding-top: clamp(72px, 10vw, 118px);
}

.section-heading {
  max-width: 760px;
  margin-bottom: 24px;
}

.section-heading--center {
  margin-right: auto;
  margin-left: auto;
  text-align: center;
}

.section-heading--split {
  display: flex;
  max-width: none;
  align-items: end;
  justify-content: space-between;
  gap: 28px;
}

.section-kicker {
  gap: 8px;
  color: var(--color-accent);
}

.section-heading h2 {
  margin-top: 10px;
  color: var(--color-text);
  font-size: clamp(30px, 4.4vw, 56px);
  font-weight: 950;
  line-height: 1.05;
}

.section-heading p {
  margin-top: 12px;
  color: var(--color-muted);
  font-size: 15px;
  line-height: 1.72;
}

.section-heading--split p {
  max-width: 430px;
  margin-top: 0;
}

.workflow-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.workflow-grid li,
.feature-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}

.workflow-grid li {
  display: grid;
  align-content: start;
  min-height: 240px;
  padding: 16px;
}

.workflow-grid__index {
  color: var(--color-subtle);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 900;
}

.workflow-grid__icon,
.feature-card span {
  justify-content: center;
  width: 38px;
  height: 38px;
  margin-top: 16px;
  border-radius: 8px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.workflow-grid small {
  margin-top: 16px;
  color: var(--color-accent);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 900;
}

.workflow-grid strong,
.feature-card strong {
  margin-top: 8px;
  color: var(--color-text);
  font-size: 16px;
  font-weight: 900;
  line-height: 1.25;
}

.workflow-grid p,
.feature-card p {
  margin-top: 10px;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.65;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.feature-card {
  display: grid;
  min-height: 210px;
  padding: 18px;
}

.scene-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.scene-list span {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text-secondary);
  padding: 12px 14px;
  font-size: 14px;
  font-weight: 850;
  box-shadow: var(--shadow-card);
}

.final-cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding-top: clamp(76px, 10vw, 120px);
  padding-bottom: 82px;
}

.final-cta strong {
  display: block;
  margin-top: 10px;
  color: var(--color-text);
  font-size: clamp(28px, 4vw, 52px);
  font-weight: 950;
  line-height: 1.06;
}

.section-block{
  margin-bottom: 15px;
}

@media (max-width: 1040px) {
  .workflow-grid,
  .feature-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 820px) {
  .home-header {
    grid-template-columns: auto auto;
  }

  .home-header__nav {
    display: none;
  }

  .section-heading--split,
  .final-cta {
    align-items: flex-start;
    flex-direction: column;
  }

  .hero-preview__canvas {
    grid-template-columns: 1fr;
  }

  .hero-preview__canvas img:first-child {
    grid-row: auto;
  }
}

@media (max-width: 640px) {
  .home-header,
  .hero,
  .section-block,
  .final-cta {
    padding-right: 16px;
    padding-left: 16px;
  }

  .brand small,
  .hero-preview__toolbar small {
    display: none;
  }

  .hero h1 {
    font-size: clamp(52px, 18vw, 78px);
  }

  .hero__lead {
    font-size: clamp(26px, 9vw, 38px);
  }

  .hero__actions {
    align-items: stretch;
    flex-direction: column;
  }

  .workflow-grid,
  .feature-grid {
    grid-template-columns: 1fr;
  }

  .workflow-grid li,
  .feature-card {
    min-height: auto;
  }
}
</style>

