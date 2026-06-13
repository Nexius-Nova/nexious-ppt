<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  ArrowDownRight,
  ArrowRight,
  Bot,
  Download,
  FileCheck2,
  Layers3,
  MonitorPlay,
  PanelTop,
  Sparkles,
  Upload
} from 'lucide-vue-next';
import GeneratedDeckPreview from '@/components/home/GeneratedDeckPreview.vue';
import UiButton from '@/components/ui/UiButton.vue';
import { useAuthStore } from '@/stores/authStore';

interface ShowcaseProject {
  id: string;
  title: string;
  scene: string;
  slides: Array<{ title: string; url: string }>;
}

const router = useRouter();
const authStore = useAuthStore();
const actionText = computed(() => (authStore.token ? '进入工作台' : '开始使用'));

const showcaseProjects: ShowcaseProject[] = [
  {
    id: 'green1',
    title: '绿色生命的奇迹',
    scene: '光合作用 / 科学探究',
    slides: [
      { title: '主题封面', url: '/home-previews/green1/01.svg' },
      { title: '汇报提纲', url: '/home-previews/green1/02.svg' },
      { title: '光合作用机制', url: '/home-previews/green1/03.svg' },
      { title: '阳光与二氧化碳', url: '/home-previews/green1/04.svg' }
    ]
  },
  {
    id: 'marvel',
    title: '漫威英雄图鉴',
    scene: '热血登场 / 人物介绍',
    slides: [
      { title: '英雄图鉴封面', url: '/home-previews/marvel/01.svg' },
      { title: '登场名单', url: '/home-previews/marvel/02.svg' },
      { title: '钢铁侠', url: '/home-previews/marvel/03.svg' },
      { title: '集结时刻', url: '/home-previews/marvel/04.svg' }
    ]
  },
  {
    id: 'film',
    title: '电影技术发展入门',
    scene: '视觉特效 / 动作捕捉 / 虚拟制作',
    slides: [
      { title: '主题封面', url: '/home-previews/film/01.svg' },
      { title: '核心问题', url: '/home-previews/film/02.svg' },
      { title: '视觉特效 VFX', url: '/home-previews/film/03.svg' },
      { title: '动作捕捉', url: '/home-previews/film/04.svg' }
    ]
  }
];

const pipeline = [
  { icon: Upload, tag: '01', label: '输入', desc: '文档、链接、要点' },
  { icon: Sparkles, tag: '02', label: 'Skill', desc: '场景匹配策略' },
  { icon: Bot, tag: '03', label: '生成', desc: '大纲 + 内容 + 版式' },
  { icon: PanelTop, tag: '04', label: '预览', desc: '实时查看结果' },
  { icon: Download, tag: '05', label: '导出', desc: '可编辑 PPTX' },
];

const capabilities = [
  { icon: Layers3, title: '结构先行', body: '大纲优先，避免陷入细节', num: '01' },
  { icon: Sparkles, title: 'Skill 驱动', body: '场景化生成策略', num: '02' },
  { icon: MonitorPlay, title: '真实预览', body: '即看即改即确认', num: '03' },
  { icon: FileCheck2, title: '交付闭环', body: '从资料到 PPT 文件', num: '04' },
];

const scrollY = ref(0);
const menuOpen = ref(false);

function enterConsole() {
  void router.push(authStore.token ? '/my-ppt' : '/login');
}

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  menuOpen.value = false;
}

function onScroll() {
  scrollY.value = window.scrollY;
}

onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }));
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll));
</script>

<template>
  <main class="nx">
    <!-- ═══════════════════════════════════════
         NAV
         ═══════════════════════════════════════ -->
    <header class="nx-nav" :class="{ 'nx-nav--solid': scrollY > 80 }">
      <div class="nx-nav__inner">
        <button class="nx-nav__logo" type="button" @click="scrollTo('hero')">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <rect width="28" height="28" rx="7" fill="var(--color-accent)" />
            <path d="M8 14L11 11L14 14L17 11" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M8 18L11 15L14 18L17 15" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity=".5" />
          </svg>
          <span>NEXIOUS</span>
        </button>

        <nav class="nx-nav__links">
          <button type="button" @click="scrollTo('pipeline')">流程</button>
          <button type="button" @click="scrollTo('showcase')">作品</button>
          <button type="button" @click="scrollTo('capabilities')">能力</button>
        </nav>

        <UiButton size="sm" variant="primary" class="nx-nav__cta" @click="enterConsole">
          {{ actionText }}
        </UiButton>

        <button class="nx-nav__ham" type="button" :class="{ 'is-open': menuOpen }" @click="menuOpen = !menuOpen" aria-label="菜单">
          <i /><i /><i />
        </button>
      </div>
    </header>

    <!-- Mobile drawer -->
    <Transition name="drawer">
      <aside v-if="menuOpen" class="nx-drawer">
        <button type="button" @click="scrollTo('pipeline')">流程</button>
        <button type="button" @click="scrollTo('showcase')">作品</button>
        <button type="button" @click="scrollTo('capabilities')">能力</button>
        <UiButton size="lg" variant="primary" block @click="enterConsole">{{ actionText }}</UiButton>
      </aside>
    </Transition>

    <!-- ═══════════════════════════════════════
         HERO — Dark cinematic
         ═══════════════════════════════════════ -->
    <section id="hero" class="nx-hero">
      <!-- Geometric background -->
      <div class="nx-hero__geo" aria-hidden="true">
        <span class="nx-hero__circle" />
        <span class="nx-hero__line" />
        <span class="nx-hero__grid" />
      </div>

      <div class="nx-hero__content">
        <div class="nx-hero__left">
          <span class="nx-hero__eyebrow">AI Deck Agent</span>

          <h1 class="nx-hero__title">
            <span class="nx-hero__title-small">Nexious</span>
            <span class="nx-hero__title-big">PPT</span>
          </h1>

          <p class="nx-hero__tagline">
            把想法变成演示，<br />不需要设计技能。
          </p>

          <div class="nx-hero__actions">
            <UiButton size="lg" variant="primary" @click="enterConsole">
              {{ actionText }} <ArrowRight :size="16" />
            </UiButton>
            <button class="nx-hero__scroll" type="button" @click="scrollTo('pipeline')">
              <ArrowDownRight :size="18" />
              <span>了解流程</span>
            </button>
          </div>
        </div>

        <div class="nx-hero__right">
          <div class="nx-hero__window">
            <div class="nx-hero__window-bar">
              <i /><i /><i />
              <span>deck.output</span>
              <em>ready</em>
            </div>
            <div class="nx-hero__window-body">
              <img src="/home-previews/green1/01.svg" alt="绿色生命的奇迹封面" />
              <img src="/home-previews/marvel/01.svg" alt="漫威英雄图鉴封面" />
              <img src="/home-previews/film/03.svg" alt="视觉特效页面" />
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom ticker -->
      <div class="nx-hero__ticker" aria-hidden="true">
        <div class="nx-hero__ticker-track">
          <span v-for="n in 8" :key="n">INPUT → SKILL → AGENT → PREVIEW → PPTX ✦</span>
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════
         PIPELINE — Horizontal infographic
         ═══════════════════════════════════════ -->
    <section id="pipeline" class="nx-pipeline">
      <div class="nx-pipeline__head">
        <span class="nx-label">Pipeline</span>
        <h2 class="nx-heading">五步，从素材到交付</h2>
      </div>

      <div class="nx-pipeline__track">
        <template v-for="(step, i) in pipeline" :key="step.tag">
          <div class="nx-pipeline__node" :style="{ '--i': i }">
            <div class="nx-pipeline__icon">
              <component :is="step.icon" :size="20" />
            </div>
            <strong>{{ step.label }}</strong>
            <span>{{ step.desc }}</span>
            <em class="nx-pipeline__num">{{ step.tag }}</em>
          </div>
          <span v-if="i < pipeline.length - 1" class="nx-pipeline__arrow" aria-hidden="true">→</span>
        </template>
      </div>
    </section>

    <!-- ═══════════════════════════════════════
         SHOWCASE
         ═══════════════════════════════════════ -->
    <section id="showcase" class="nx-showcase">
      <div class="nx-showcase__head">
        <span class="nx-label">Showcase</span>
        <h2 class="nx-heading">看看生成效果</h2>
      </div>
      <GeneratedDeckPreview :projects="showcaseProjects" />
    </section>

    <!-- ═══════════════════════════════════════
         CAPABILITIES — 2×2 editorial
         ═══════════════════════════════════════ -->
    <section id="capabilities" class="nx-caps">
      <div class="nx-caps__head">
        <span class="nx-label">Capabilities</span>
        <h2 class="nx-heading">核心能力</h2>
      </div>

      <div class="nx-caps__grid">
        <article
          v-for="(cap, i) in capabilities"
          :key="cap.num"
          class="nx-cap"
          :class="[`nx-cap--${i + 1}`]"
          :style="{ '--i': i }"
        >
          <em class="nx-cap__num">{{ cap.num }}</em>
          <span class="nx-cap__icon"><component :is="cap.icon" :size="22" /></span>
          <h3>{{ cap.title }}</h3>
          <p>{{ cap.body }}</p>
        </article>
      </div>
    </section>

    <!-- ═══════════════════════════════════════
         FOOTER
         ═══════════════════════════════════════ -->
    <footer class="nx-foot">
      <span>© Nexious PPT</span>
      <span>AI Deck Agent</span>
    </footer>
  </main>
</template>

<style scoped>
/* ══════════════════════════════════════════
   SWISS KINETIC — Design System
   ══════════════════════════════════════════ */
.nx {
  --nx-max: 1160px;
  --nx-pad: clamp(20px, 4vw, 48px);
  --nx-dark: #18181b;
  --nx-dark-2: #222226;
  --nx-dark-3: #2c2c32;
  --nx-light: #fafafa;
  --nx-red: var(--color-accent);
  --nx-gray: #71717a;

  position: relative;
  height: 100dvh;
  overflow-x: hidden;
  overflow-y: auto;
  scroll-behavior: smooth;
  background: var(--nx-dark);
  color: #fff;
}

/* ── Reusable tokens ── */
.nx-label {
  display: inline-block;
  color: var(--nx-red);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.nx-heading {
  margin-top: 10px;
  font-size: clamp(28px, 4.2vw, 48px);
  font-weight: 950;
  line-height: 1.05;
  letter-spacing: -0.03em;
}

/* ══════════════════════════════════════════
   NAV
   ══════════════════════════════════════════ */
.nx-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 200;
  transition: background 0.4s, box-shadow 0.4s;
}

.nx-nav--solid {
  background: color-mix(in srgb, var(--nx-dark) 90%, transparent);
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
  box-shadow: 0 1px 0 rgb(255 255 255 / 8%);
}

.nx-nav__inner {
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: var(--nx-max);
  min-height: 56px;
  margin: 0 auto;
  padding: 0 var(--nx-pad);
}

.nx-nav__logo {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #fff;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.14em;
}

.nx-nav__links {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.nx-nav__links button {
  min-height: 34px;
  border-radius: 6px;
  color: rgb(255 255 255 / 55%);
  padding: 0 14px;
  font-size: 13px;
  font-weight: 700;
  transition: color 0.2s, background 0.2s;
}

.nx-nav__links button:hover {
  color: #fff;
  background: rgb(255 255 255 / 8%);
}

.nx-nav__cta {
  margin-left: 12px;
}

.nx-nav__ham {
  display: none;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  width: 36px;
  height: 36px;
  margin-left: auto;
  align-items: center;
}

.nx-nav__ham i {
  display: block;
  width: 20px;
  height: 2px;
  border-radius: 2px;
  background: #fff;
  transition: transform 0.3s, opacity 0.3s;
}

.nx-nav__ham.is-open i:nth-child(1) { transform: translateY(7px) rotate(45deg); }
.nx-nav__ham.is-open i:nth-child(2) { opacity: 0; }
.nx-nav__ham.is-open i:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

/* Mobile drawer */
.nx-drawer {
  position: fixed;
  top: 56px;
  left: 0;
  right: 0;
  z-index: 199;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px var(--nx-pad) 24px;
  background: var(--nx-dark);
  border-bottom: 1px solid rgb(255 255 255 / 10%);
}

.nx-drawer button {
  min-height: 44px;
  border-radius: 8px;
  color: #fff;
  padding: 0 16px;
  font-size: 15px;
  font-weight: 700;
  text-align: left;
  transition: background 0.2s;
}

.nx-drawer button:hover {
  background: rgb(255 255 255 / 6%);
}

.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.25s, transform 0.25s;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* ══════════════════════════════════════════
   HERO — Dark cinematic
   ══════════════════════════════════════════ */
.nx-hero {
  position: relative;
  min-height: 100dvh;
  background: var(--nx-dark);
  color: #fff;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Geometric decorations */
.nx-hero__geo {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.nx-hero__circle {
  position: absolute;
  top: -20%;
  right: -8%;
  width: 680px;
  height: 680px;
  border-radius: 50%;
  border: 1px solid rgb(255 255 255 / 6%);
  animation: heroCircle 20s linear infinite;
}

.nx-hero__line {
  position: absolute;
  top: 0;
  left: 38%;
  width: 1px;
  height: 100%;
  background: linear-gradient(to bottom, transparent, rgb(255 255 255 / 8%) 30%, rgb(255 255 255 / 8%) 70%, transparent);
}

.nx-hero__grid {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 40%;
  background:
    linear-gradient(to top, var(--nx-dark), transparent),
    repeating-linear-gradient(90deg, rgb(255 255 255 / 3%) 0 1px, transparent 1px 80px),
    repeating-linear-gradient(0deg, rgb(255 255 255 / 3%) 0 1px, transparent 1px 80px);
}

@keyframes heroCircle {
  to { transform: rotate(360deg); }
}

.nx-hero__content {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: clamp(32px, 5vw, 64px);
  align-items: center;
  max-width: var(--nx-max);
  width: 100%;
  margin: 0 auto;
  padding: clamp(120px, 16vh, 200px) var(--nx-pad) clamp(60px, 8vh, 100px);
  flex: 1;
}

.nx-hero__left {
  animation: heroFadeIn 1s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.nx-hero__eyebrow {
  display: inline-block;
  color: var(--nx-red);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  animation: heroFadeIn 0.8s 0.1s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.nx-hero__title {
  margin-top: 20px;
  line-height: 0.85;
  letter-spacing: -0.05em;
}

.nx-hero__title-small {
  display: block;
  font-size: clamp(28px, 3.5vw, 42px);
  font-weight: 300;
  letter-spacing: 0.06em;
  color: rgb(255 255 255 / 45%);
  animation: heroFadeIn 0.9s 0.15s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.nx-hero__title-big {
  display: block;
  font-size: clamp(96px, 15vw, 200px);
  font-weight: 950;
  color: #fff;
  animation: heroFadeIn 1s 0.25s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.nx-hero__tagline {
  margin-top: 28px;
  font-size: clamp(20px, 2.8vw, 32px);
  font-weight: 300;
  line-height: 1.35;
  color: rgb(255 255 255 / 65%);
  animation: heroFadeIn 0.9s 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.nx-hero__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-top: 36px;
  animation: heroFadeIn 0.9s 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.nx-hero__scroll {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: rgb(255 255 255 / 45%);
  font-size: 13px;
  font-weight: 600;
  transition: color 0.2s;
}

.nx-hero__scroll:hover {
  color: #fff;
}

/* Hero window */
.nx-hero__right {
  animation: heroFadeIn 1.1s 0.3s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.nx-hero__window {
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 14px;
  background: var(--nx-dark-2);
  box-shadow:
    0 0 0 1px rgb(255 255 255 / 4%),
    0 40px 100px rgb(0 0 0 / 40%);
  overflow: hidden;
}

.nx-hero__window-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  border-bottom: 1px solid rgb(255 255 255 / 8%);
  padding: 0 14px;
}

.nx-hero__window-bar i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: rgb(255 255 255 / 12%);
}

.nx-hero__window-bar i:first-child { background: var(--nx-red); }
.nx-hero__window-bar i:nth-child(2) { background: #eab308; }
.nx-hero__window-bar i:nth-child(3) { background: #22c55e; }

.nx-hero__window-bar span {
  margin-left: 10px;
  color: rgb(255 255 255 / 35%);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
}

.nx-hero__window-bar em {
  margin-left: auto;
  color: #22c55e;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 800;
  font-style: normal;
  text-transform: uppercase;
}

.nx-hero__window-body {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 10px;
  padding: 14px;
}

.nx-hero__window-body img {
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 1px solid rgb(255 255 255 / 8%);
  border-radius: 8px;
  background: #fff;
  object-fit: cover;
  transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

.nx-hero__window-body img:hover {
  transform: scale(1.03);
}

.nx-hero__window-body img:first-child {
  grid-row: span 2;
  align-self: center;
}

/* Ticker */
.nx-hero__ticker {
  position: relative;
  z-index: 2;
  border-top: 1px solid rgb(255 255 255 / 8%);
  overflow: hidden;
  padding: 14px 0;
}

.nx-hero__ticker-track {
  display: flex;
  gap: 32px;
  white-space: nowrap;
  animation: tickerScroll 30s linear infinite;
}

.nx-hero__ticker-track span {
  color: rgb(255 255 255 / 20%);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

@keyframes tickerScroll {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

@keyframes heroFadeIn {
  from {
    opacity: 0;
    transform: translateY(32px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ══════════════════════════════════════════
   PIPELINE
   ══════════════════════════════════════════ */
.nx-pipeline {
  position: relative;
  max-width: var(--nx-max);
  margin: 0 auto;
  padding: clamp(72px, 10vw, 120px) var(--nx-pad);
}

.nx-pipeline::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(to right, transparent, rgb(255 255 255 / 10%), transparent);
}

.nx-pipeline__head {
  margin-bottom: 48px;
}

.nx-pipeline__track {
  display: flex;
  align-items: flex-start;
  gap: 0;
}

.nx-pipeline__node {
  position: relative;
  flex: 1;
  text-align: center;
  padding: 28px 12px 24px;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 12px;
  background: var(--nx-dark-2);
  color: #fff;
  transition: border-color 0.3s, transform 0.3s, box-shadow 0.3s;
  animation: pipeNode 0.6s calc(var(--i) * 0.08s) cubic-bezier(0.16, 1, 0.3, 1) both;
}

.nx-pipeline__node:hover {
  border-color: var(--nx-red);
  transform: translateY(-4px);
  box-shadow: 0 8px 30px rgb(0 0 0 / 30%);
}

.nx-pipeline__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--color-accent-soft);
  color: var(--nx-red);
  margin-bottom: 14px;
}

.nx-pipeline__node strong {
  display: block;
  font-size: 17px;
  font-weight: 900;
}

.nx-pipeline__node span {
  display: block;
  margin-top: 6px;
  color: rgb(255 255 255 / 45%);
  font-size: 13px;
}

.nx-pipeline__num {
  position: absolute;
  top: 10px;
  right: 12px;
  color: rgb(255 255 255 / 14%);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 900;
  font-style: normal;
}

.nx-pipeline__arrow {
  flex-shrink: 0;
  align-self: center;
  padding: 0 4px;
  color: rgb(255 255 255 / 20%);
  font-size: 18px;
  font-weight: 200;
}

@keyframes pipeNode {
  from {
    opacity: 0;
    transform: translateY(24px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ══════════════════════════════════════════
   SHOWCASE
   ══════════════════════════════════════════ */
.nx-showcase {
  position: relative;
  max-width: var(--nx-max);
  margin: 0 auto;
  padding: 0 var(--nx-pad) clamp(72px, 10vw, 120px);
}

.nx-showcase::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(to right, transparent, rgb(255 255 255 / 10%), transparent);
}

.nx-showcase__head {
  margin-bottom: 32px;
  color: #fff;
}

/* 深色穿透到 GeneratedDeckPreview 子组件 */
.nx-showcase :deep(.showcase) {
  border-color: rgb(255 255 255 / 10%);
  background: var(--nx-dark-2);
}

.nx-showcase :deep(.showcase__header strong) {
  color: #fff;
}

.nx-showcase :deep(.showcase__header span),
.nx-showcase :deep(.showcase__footer span) {
  color: rgb(255 255 255 / 45%);
}

.nx-showcase :deep(.showcase__projects button) {
  border-color: rgb(255 255 255 / 10%);
  background: var(--nx-dark-3);
  color: rgb(255 255 255 / 55%);
}

.nx-showcase :deep(.showcase__projects button:hover),
.nx-showcase :deep(.showcase__projects button.is-active) {
  border-color: var(--nx-red);
  background: rgba(255, 75, 75, 0.12);
  color: var(--nx-red);
}

.nx-showcase :deep(.showcase__stage) {
  border-color: rgb(255 255 255 / 8%);
  background: var(--nx-dark-3);
}

.nx-showcase :deep(.showcase__arrow) {
  border-color: rgb(255 255 255 / 10%);
  background: var(--nx-dark-2);
  color: rgb(255 255 255 / 55%);
}

.nx-showcase :deep(.showcase__arrow:hover) {
  border-color: rgb(255 255 255 / 18%);
  background: var(--nx-dark-3);
  color: #fff;
}

.nx-showcase :deep(.showcase__pages button) {
  background: rgb(255 255 255 / 14%);
}

.nx-showcase :deep(.showcase__pages button.is-active) {
  background: var(--nx-red);
}

/* ══════════════════════════════════════════
   CAPABILITIES — 2×2 editorial
   ══════════════════════════════════════════ */
.nx-caps {
  position: relative;
  background: var(--nx-dark);
  color: #fff;
  padding: clamp(72px, 10vw, 120px) 0;
  overflow: hidden;
}

.nx-caps::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(to right, transparent, var(--nx-red), transparent);
}

.nx-caps__head {
  max-width: var(--nx-max);
  margin: 0 auto;
  padding: 0 var(--nx-pad);
  margin-bottom: 48px;
}

.nx-caps__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  max-width: var(--nx-max);
  margin: 0 auto;
  background: rgb(255 255 255 / 8%);
}

.nx-cap {
  position: relative;
  padding: clamp(32px, 4vw, 52px) clamp(28px, 3.5vw, 44px);
  background: var(--nx-dark);
  transition: background 0.4s;
  animation: capFade 0.7s calc(var(--i) * 0.1s) cubic-bezier(0.16, 1, 0.3, 1) both;
}

.nx-cap:hover {
  background: var(--nx-dark-2);
}

.nx-cap__num {
  position: absolute;
  top: 20px;
  right: 24px;
  font-family: var(--font-mono);
  font-size: clamp(56px, 8vw, 96px);
  font-weight: 900;
  font-style: normal;
  line-height: 1;
  color: rgb(255 255 255 / 4%);
  pointer-events: none;
  user-select: none;
}

.nx-cap__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: var(--nx-red);
  color: #fff;
  margin-bottom: 20px;
}

.nx-cap h3 {
  font-size: clamp(20px, 2.4vw, 28px);
  font-weight: 900;
  line-height: 1.15;
}

.nx-cap p {
  margin-top: 10px;
  color: rgb(255 255 255 / 50%);
  font-size: 15px;
  line-height: 1.6;
}

@keyframes capFade {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ══════════════════════════════════════════
   FOOTER
   ══════════════════════════════════════════ */
.nx-foot {
  display: flex;
  justify-content: space-between;
  max-width: var(--nx-max);
  margin: 0 auto;
  padding: 24px var(--nx-pad) 36px;
  color: rgb(255 255 255 / 30%);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

/* ══════════════════════════════════════════
   RESPONSIVE
   ══════════════════════════════════════════ */
@media (max-width: 960px) {
  .nx-hero__content {
    grid-template-columns: 1fr;
    text-align: center;
  }

  .nx-hero__left {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .nx-hero__actions {
    justify-content: center;
  }

  .nx-hero__line {
    display: none;
  }

  .nx-pipeline__track {
    flex-wrap: wrap;
    gap: 10px;
  }

  .nx-pipeline__node {
    flex: 1 1 calc(33% - 10px);
  }

  .nx-pipeline__arrow {
    display: none;
  }

  .nx-caps__grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .nx-nav__links,
  .nx-nav__cta {
    display: none;
  }

  .nx-nav__ham {
    display: flex;
  }

  .nx-hero__window-body {
    grid-template-columns: 1fr;
  }

  .nx-hero__window-body img:first-child {
    grid-row: auto;
  }

  .nx-pipeline__node {
    flex: 1 1 calc(50% - 10px);
  }
}

@media (max-width: 520px) {
  .nx-hero__title-big {
    font-size: clamp(72px, 22vw, 100px);
  }

  .nx-pipeline__node {
    flex: 1 1 100%;
  }

  .nx-hero__ticker {
    display: none;
  }
}
</style>
