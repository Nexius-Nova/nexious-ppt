<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  ArrowRight,
  Bot,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileText,
  FolderKanban,
  Layers3,
  PanelTop,
  Play,
  ScanLine,
  Sparkles,
  Upload,
  Wand2,
  Zap
} from 'lucide-vue-next';
import GeneratedDeckPreview from '@/components/home/GeneratedDeckPreview.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
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

const primaryActionText = computed(() => (authStore.token ? '进入工作台' : '免费开始'));

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

const heroChecks = ['Input', 'Skill', 'Agent', 'PPT'];

const productMetrics = [
  { value: '01', label: 'INPUT', detail: '资料汇入' },
  { value: '02', label: 'COMPOSE', detail: 'Agent 成稿' },
  { value: '03', label: 'EXPORT', detail: 'PPT 交付' }
];

const workflowSteps = [
  {
    label: '输入',
    title: 'INPUT',
    detail: '资料 / 主题 / 链接',
    icon: Upload
  },
  {
    label: '编排',
    title: 'SKILL',
    detail: '场景 / 风格 / 结构',
    icon: Boxes
  },
  {
    label: '生成',
    title: 'AGENT',
    detail: '大纲 / 页面 / 质检',
    icon: Bot
  },
  {
    label: '交付',
    title: 'PPTX',
    detail: '预览 / 导出 / 编辑',
    icon: Download
  }
];

const featureCards = [
  {
    title: 'Deck Pipeline',
    detail: '资料到页面的生成轨道',
    icon: Layers3
  },
  {
    title: 'Skill Engine',
    detail: '场景策略即插即用',
    icon: Sparkles
  },
  {
    title: 'Live Preview',
    detail: '先看页面，再做判断',
    icon: PanelTop
  },
  {
    title: 'Workspace',
    detail: '项目、模板、模型归档',
    icon: FolderKanban
  }
];

function enterConsole() {
  void router.push(authStore.token ? '/my-ppt' : '/login');
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
</script>

<template>
  <main class="home-page">
    <header class="home-nav">
      <button class="brand" type="button" aria-label="返回 Nexious PPT 首页" @click="scrollToSection('top')">
        <span class="brand__mark">
          <Zap :size="17" aria-hidden="true" />
        </span>
        <span class="brand__copy">
          <strong>NEXIOUS PPT</strong>
          <small>AI Deck Agent</small>
        </span>
      </button>

      <nav class="home-nav__links" aria-label="产品页导航">
        <button type="button" @click="scrollToSection('workflow')">流程</button>
        <button type="button" @click="scrollToSection('preview')">预览</button>
        <button type="button" @click="scrollToSection('features')">能力</button>
      </nav>

      <UiButton size="sm" variant="primary" @click="enterConsole">
        {{ primaryActionText }}
        <ArrowRight :size="15" aria-hidden="true" />
      </UiButton>
    </header>

    <section id="top" class="hero" aria-labelledby="home-title">
      <div class="hero__copy">
        <UiBadge tone="accent" size="md">
          <ScanLine :size="13" aria-hidden="true" />
          AI PPT 生产工作台
        </UiBadge>

        <h1 id="home-title">Nexious PPT</h1>
        <p class="hero__lead">资料进场，演示成型。</p>

        <div class="hero-signal" aria-label="生成状态">
          <span>INPUT</span>
          <i />
          <span>SKILL</span>
          <i />
          <span>AGENT</span>
          <i />
          <span>PPTX</span>
        </div>

        <div class="hero__actions">
          <UiButton size="lg" variant="primary" @click="enterConsole">
            <Play :size="17" aria-hidden="true" />
            {{ primaryActionText }}
          </UiButton>
          <UiButton size="lg" variant="secondary" @click="scrollToSection('preview')">
            查看生成效果
            <ArrowRight :size="17" aria-hidden="true" />
          </UiButton>
        </div>

        <ul class="hero__checks" aria-label="产品亮点">
          <li v-for="item in heroChecks" :key="item">
            <CheckCircle2 :size="16" aria-hidden="true" />
            {{ item }}
          </li>
        </ul>
      </div>

      <aside class="hero-board" aria-label="Nexious PPT 产品预览">
        <div class="hero-board__toolbar">
          <span />
          <strong>LIVE DECK OUTPUT</strong>
          <small>04 slides</small>
        </div>

        <div class="hero-board__stage">
          <img src="/home-previews/iphone/01.svg" alt="产品发布演示稿封面预览" />
          <img src="/home-previews/film/02.svg" alt="知识科普课件核心问题页预览" />
          <img src="/home-previews/chess/04.svg" alt="活动策划流程安排页预览" />
        </div>

        <div class="hero-board__status">
          <span>
            <Wand2 :size="15" aria-hidden="true" />
            Agent 正在生成页面
          </span>
          <b>Ready for export</b>
        </div>
      </aside>
    </section>

    <section class="metrics-section" aria-label="产品生成路径概览">
      <article v-for="item in productMetrics" :key="item.label" class="metric-card">
        <span>{{ item.value }}</span>
        <strong>{{ item.label }}</strong>
        <p>{{ item.detail }}</p>
      </article>
    </section>

    <section id="workflow" class="product-section workflow-section" aria-labelledby="workflow-title">
      <div class="section-heading">
        <span class="section-kicker">Workflow</span>
        <h2 id="workflow-title">四段生成轨道</h2>
      </div>

      <ol class="workflow-list">
        <li v-for="(step, index) in workflowSteps" :key="step.title">
          <span class="workflow-list__index">{{ String(index + 1).padStart(2, '0') }}</span>
          <span class="workflow-list__icon">
            <component :is="step.icon" :size="18" />
          </span>
          <small>{{ step.label }}</small>
          <strong>{{ step.title }}</strong>
          <div class="workflow-list__bars" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <p>{{ step.detail }}</p>
        </li>
      </ol>
    </section>

    <section id="preview" class="product-section preview-section" aria-labelledby="preview-title">
      <div class="section-heading section-heading--split">
        <div>
          <span class="section-kicker">Preview</span>
          <h2 id="preview-title">真实成稿预览</h2>
        </div>
        <p>活动 / 产品 / 课程</p>
      </div>

      <GeneratedDeckPreview :projects="showcaseProjects" />
    </section>

    <section id="features" class="product-section feature-section" aria-labelledby="features-title">
      <div class="section-heading">
        <span class="section-kicker">Product DNA</span>
        <h2 id="features-title">不是聊天，是出稿系统</h2>
      </div>

      <div class="feature-grid">
        <article v-for="item in featureCards" :key="item.title" class="feature-card">
          <span>
            <component :is="item.icon" :size="18" />
          </span>
          <strong>{{ item.title }}</strong>
          <div class="feature-card__meter" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
          <small>{{ item.detail }}</small>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.home-page {
  --home-max-width: 1240px;
  height: 100dvh;
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--color-bg);
  color: var(--color-text);
  scroll-behavior: smooth;
}

.home-nav {
  position: sticky;
  top: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-4);
  width: min(100%, var(--home-max-width));
  min-height: 64px;
  margin: 0 auto;
  padding: 0 24px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
}

.brand,
.brand__mark,
.home-nav__links,
.hero__actions,
.hero__checks li,
.hero-signal,
.hero-board__status span,
.section-kicker,
.workflow-list__icon,
.feature-card span,
.proof-panel li {
  display: inline-flex;
  align-items: center;
}

.brand {
  gap: 10px;
  min-height: 44px;
  min-width: 0;
  color: var(--color-text);
  text-align: left;
}

.brand__mark {
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--color-accent);
  border-radius: 8px;
  background: var(--color-accent);
  color: var(--color-inverse);
}

.brand__copy {
  display: grid;
  gap: 1px;
}

.brand__copy strong {
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0;
  line-height: 1;
}

.brand__copy small {
  color: var(--color-subtle);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
}

.home-nav__links {
  justify-content: center;
  gap: 4px;
}

.home-nav__links button {
  min-width: 52px;
  min-height: 44px;
  border-radius: 8px;
  color: var(--color-muted);
  padding: 0 12px;
  font-size: 13px;
  font-weight: 800;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.home-nav__links button:hover,
.home-nav__links button:focus-visible {
  background: var(--color-panel);
  color: var(--color-text);
}

.home-nav :deep(.ui-button--sm) {
  min-height: 44px;
  padding-right: 14px;
  padding-left: 14px;
}

.hero,
.metrics-section,
.product-section,
.proof-section,
.final-cta {
  width: min(100%, var(--home-max-width));
  margin: 0 auto;
  padding-right: 24px;
  padding-left: 24px;
}

.product-section{
  margin-bottom: 15px;
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(360px, 1.05fr);
  gap: clamp(28px, 5vw, 72px);
  align-items: center;
  min-height: calc(100svh - 64px);
  padding-top: clamp(42px, 6vw, 78px);
  padding-bottom: clamp(42px, 6vw, 78px);
}

.hero__copy {
  min-width: 0;
}

.hero h1 {
  margin: 18px 0 0;
  color: var(--color-text);
  font-size: clamp(58px, 9vw, 116px);
  font-weight: 950;
  letter-spacing: 0;
  line-height: 0.88;
}

.hero__lead {
  max-width: 720px;
  margin-top: 20px;
  color: var(--color-text);
  font-size: clamp(24px, 3.4vw, 46px);
  font-weight: 900;
  letter-spacing: 0;
  line-height: 1.12;
}

.hero__actions {
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 30px;
}

.hero-signal {
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 28px;
  color: var(--color-subtle);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 900;
}

.hero-signal span {
  display: inline-grid;
  min-height: 38px;
  place-items: center;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  padding: 0 12px;
  box-shadow: var(--shadow-card);
}

.hero-signal i {
  width: clamp(26px, 4vw, 58px);
  height: 2px;
  border-radius: var(--radius-full);
  background: var(--color-accent);
}

.hero__checks {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 26px;
}

.hero__checks li {
  gap: 8px;
  min-height: 40px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text-secondary);
  padding: 0 12px;
  font-size: 13px;
  font-weight: 800;
  box-shadow: var(--shadow-card);
}

.hero__checks svg {
  color: var(--color-success);
}

.hero-board {
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.hero-board__toolbar {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 0 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-panel);
}

.hero-board__toolbar span {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  background: var(--color-accent);
  box-shadow: 16px 0 0 var(--color-warning), 32px 0 0 var(--color-success);
}

.hero-board__toolbar strong,
.hero-board__toolbar small,
.section-kicker {
  font-family: var(--font-mono);
  font-weight: 900;
  letter-spacing: 0;
  text-transform: uppercase;
}

.hero-board__toolbar strong {
  margin-left: 34px;
  color: var(--color-subtle);
  font-size: 11px;
}

.hero-board__toolbar small {
  color: var(--color-muted);
  font-size: 11px;
}

.hero-board__stage {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 0.62fr;
  grid-template-rows: auto auto;
  gap: 12px;
  padding: 16px;
  background: var(--color-card);
}

.hero-board__stage img {
  width: 100%;
  min-width: 0;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #ffffff;
  object-fit: cover;
  box-shadow: var(--shadow-card);
}

.hero-board__stage img:first-child {
  grid-row: span 2;
  align-self: center;
}

.hero-board__status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 54px;
  padding: 0 16px;
  border-top: 1px solid var(--color-border);
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 800;
}

.hero-board__status span {
  gap: 8px;
}

.hero-board__status svg {
  color: var(--color-accent);
}

.hero-board__status b {
  color: var(--color-success);
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase;
}

.metrics-section {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding-top: 10px;
}

.metric-card,
.workflow-list li,
.feature-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}

.metric-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px 14px;
  padding: 18px;
}

.metric-card span {
  grid-row: span 2;
  color: var(--color-accent);
  font-family: var(--font-mono);
  font-size: 28px;
  font-weight: 900;
  line-height: 1;
}

.metric-card strong {
  color: var(--color-text);
  font-size: 15px;
  font-weight: 900;
}

.metric-card p {
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.55;
}

.product-section,
.proof-section {
  padding-top: clamp(64px, 9vw, 104px);
}

.section-heading {
  max-width: 760px;
  margin-bottom: 22px;
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
  font-size: 12px;
}

.section-heading h2,
.proof-panel h2 {
  margin-top: 8px;
  color: var(--color-text);
  font-size: clamp(30px, 4vw, 54px);
  font-weight: 950;
  letter-spacing: 0;
  line-height: 1.05;
}

.section-heading p,
.proof-panel p {
  margin-top: 10px;
  color: var(--color-muted);
  font-size: 15px;
  line-height: 1.72;
}

.section-heading--split p {
  max-width: 440px;
  margin-top: 0;
}

.workflow-list {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.workflow-list li {
  display: grid;
  min-height: 260px;
  padding: 18px;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-fast);
}

.workflow-list li:hover,
.feature-card:hover {
  transform: translateY(-2px);
  border-color: var(--color-border-strong);
  box-shadow: var(--shadow-panel);
}

.workflow-list__index {
  color: var(--color-subtle);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 900;
}

.workflow-list__icon,
.feature-card span {
  justify-content: center;
  width: 40px;
  height: 40px;
  margin-top: 18px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.workflow-list small {
  margin-top: 16px;
  color: var(--color-accent);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
}

.workflow-list strong,
.feature-card strong {
  margin-top: 8px;
  color: var(--color-text);
  font-size: 17px;
  font-weight: 900;
  line-height: 1.28;
}

.workflow-list p,
.feature-card small {
  margin-top: 10px;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.66;
}

.workflow-list__bars,
.feature-card__meter {
  display: grid;
  gap: 6px;
  margin-top: 14px;
}

.workflow-list__bars i,
.feature-card__meter i {
  display: block;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--color-border);
}

.workflow-list__bars i:first-child,
.feature-card__meter i:first-child,
.feature-card__meter i:nth-child(2) {
  background: var(--color-accent);
}

.workflow-list__bars i:nth-child(2) {
  width: 72%;
  background: var(--color-border-strong);
}

.workflow-list__bars i:nth-child(3) {
  width: 44%;
}

.feature-card__meter {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.feature-card {
  display: grid;
  min-height: 212px;
  padding: 18px;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-fast);
}

.proof-panel {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(320px, 1fr);
  gap: clamp(24px, 5vw, 64px);
  align-items: center;
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  background: var(--color-surface);
  padding: clamp(22px, 4vw, 42px);
  box-shadow: var(--shadow-panel);
}

.proof-panel ul {
  display: grid;
  gap: 10px;
}

.proof-panel li {
  gap: 12px;
  min-height: 54px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-card);
  color: var(--color-text-secondary);
  padding: 0 14px;
  font-size: 14px;
  font-weight: 850;
}

.proof-panel svg {
  color: var(--color-accent);
}

.final-cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding-top: clamp(70px, 9vw, 112px);
  padding-bottom: 82px;
}

.final-cta strong {
  display: block;
  max-width: 760px;
  margin-top: 8px;
  color: var(--color-text);
  font-size: clamp(30px, 4vw, 54px);
  font-weight: 950;
  letter-spacing: 0;
  line-height: 1.05;
}

@media (prefers-reduced-motion: reduce) {
  .home-page {
    scroll-behavior: auto;
  }

  .workflow-list li,
  .feature-card {
    transition: none;
  }

  .workflow-list li:hover,
  .feature-card:hover {
    transform: none;
  }
}

@media (max-width: 1040px) {
  .hero {
    grid-template-columns: 1fr;
    min-height: auto;
  }

  .workflow-list,
  .feature-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .proof-panel {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 820px) {
  .home-nav {
    grid-template-columns: auto auto;
  }

  .home-nav__links {
    display: none;
  }

  .metrics-section {
    grid-template-columns: 1fr;
  }

  .section-heading--split,
  .final-cta {
    align-items: flex-start;
    flex-direction: column;
  }

  .section-heading--split p {
    max-width: 680px;
  }
}

@media (max-width: 640px) {
  .home-nav,
  .hero,
  .metrics-section,
  .product-section,
  .proof-section,
  .final-cta {
    padding-right: 16px;
    padding-left: 16px;
  }

  .brand__copy small {
    display: none;
  }

  .hero {
    padding-top: 38px;
  }

  .hero h1 {
    font-size: clamp(54px, 18vw, 76px);
  }

  .hero__lead {
    font-size: clamp(24px, 8vw, 34px);
  }

  .hero__actions {
    align-items: stretch;
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .hero__actions :deep(.ui-button) {
    width: 100%;
  }

  .hero-board__stage,
  .workflow-list,
  .feature-grid {
    grid-template-columns: 1fr;
  }

  .hero-board__stage img:first-child {
    grid-row: auto;
  }

  .hero-board__toolbar {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .hero-board__toolbar small,
  .hero-board__status b {
    display: none;
  }

  .workflow-list li,
  .feature-card {
    min-height: auto;
  }

  .proof-panel {
    padding: 18px;
  }
}
</style>
