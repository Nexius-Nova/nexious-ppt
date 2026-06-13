<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { Component } from "vue";
import {
  BarChart3,
  Brain,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Image,
  LayoutDashboard,
  Loader2,
  MessageSquareText,
  Palette,
  Pause,
  Play,
  PlugZap,
  RotateCcw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X
} from "lucide-vue-next";
import UiBadge from "@/components/ui/UiBadge.vue";
import UiButton from "@/components/ui/UiButton.vue";
import UiField from "@/components/ui/UiField.vue";
import UiProgress from "@/components/ui/UiProgress.vue";
import UiSelect from "@/components/ui/UiSelect.vue";
import UiTextarea from "@/components/ui/UiTextarea.vue";

type StageStatus = "idle" | "running" | "done";
type DrawerPanel = "prompt" | "template" | "skills" | "settings" | "logs";

interface Scenario {
  id: string;
  title: string;
  mission: string;
  promptId: string;
  templateId: string;
  skills: string[];
}

interface Stage {
  id: string;
  title: string;
  icon: Component;
  status: StageStatus;
  progress: number;
}

interface SimulationEvent {
  stageId: string;
  status: StageStatus;
  progress: number;
  message: string;
}

const scenarios: Scenario[] = [
  {
    id: "review",
    title: "经营复盘",
    mission: "做一份 8 页季度经营复盘，给管理层看。先讲结论，再讲数据、问题和行动计划。",
    promptId: "decision",
    templateId: "board",
    skills: ["outline", "chart", "notes", "qa"]
  },
  {
    id: "launch",
    title: "产品发布",
    mission: "做一份产品发布演示，突出痛点、价值、功能场景和下一步行动。",
    promptId: "story",
    templateId: "product",
    skills: ["outline", "visual", "notes"]
  },
  {
    id: "course",
    title: "培训课件",
    mission: "做一份 30 分钟培训课件，包含目标、核心概念、案例练习和总结。",
    promptId: "teaching",
    templateId: "course",
    skills: ["outline", "notes", "qa"]
  }
];

const promptOptions = [
  {
    label: "结论先行",
    value: "decision",
    description: "适合复盘、汇报、决策材料",
    content: "先给结论，再展开证据、风险、建议和下一步。每页只保留一个主张。"
  },
  {
    label: "叙事推进",
    value: "story",
    description: "适合发布、路演、解决方案",
    content: "按痛点、洞察、方案、价值证明和行动号召组织内容，让每页自然推进。"
  },
  {
    label: "教学讲解",
    value: "teaching",
    description: "适合培训、课程、知识分享",
    content: "按学习目标、核心概念、示例练习和复盘总结组织内容，补充讲师备注。"
  }
];

const templateOptions = [
  { label: "董事会汇报", value: "board", description: "克制、清晰、数据友好", accent: "var(--color-accent)" },
  { label: "产品舞台", value: "product", description: "突出价值和场景", accent: "var(--color-info)" },
  { label: "课程讲义", value: "course", description: "结构清楚，适合教学", accent: "var(--color-success)" }
];

const skillOptions = [
  { id: "outline", name: "大纲", description: "规划页结构" },
  { id: "chart", name: "图表", description: "建议可视化" },
  { id: "visual", name: "视觉", description: "生成画面方向" },
  { id: "notes", name: "讲稿", description: "补充备注" },
  { id: "qa", name: "质检", description: "检查交付风险" }
];

const slideCountOptions = [
  { label: "6 页", value: "6" },
  { label: "8 页", value: "8" },
  { label: "10 页", value: "10" },
  { label: "12 页", value: "12" }
];

const audienceOptions = [
  { label: "管理层", value: "executive" },
  { label: "客户", value: "client" },
  { label: "团队", value: "team" },
  { label: "学员", value: "learner" }
];

const densityOptions = [
  { label: "清爽", value: "light" },
  { label: "标准", value: "balanced" },
  { label: "紧凑", value: "dense" }
];

const imagePolicyOptions = [
  { label: "跟随模板", value: "template" },
  { label: "关键页配图", value: "selective" },
  { label: "仅图表", value: "chart-only" }
];

const createStages = (): Stage[] => [
  { id: "brief", title: "理解", icon: FileText, status: "idle", progress: 0 },
  { id: "outline", title: "大纲", icon: Brain, status: "idle", progress: 0 },
  { id: "visual", title: "视觉", icon: Image, status: "idle", progress: 0 },
  { id: "slides", title: "页面", icon: LayoutDashboard, status: "idle", progress: 0 },
  { id: "export", title: "检查", icon: ShieldCheck, status: "idle", progress: 0 }
];

const simulationEvents: SimulationEvent[] = [
  { stageId: "brief", status: "running", progress: 46, message: "理解任务目标" },
  { stageId: "brief", status: "done", progress: 100, message: "任务已确认" },
  { stageId: "outline", status: "running", progress: 48, message: "生成页面大纲" },
  { stageId: "outline", status: "done", progress: 100, message: "大纲已完成" },
  { stageId: "visual", status: "running", progress: 54, message: "匹配模板和视觉方向" },
  { stageId: "visual", status: "done", progress: 100, message: "视觉方向已确认" },
  { stageId: "slides", status: "running", progress: 38, message: "生成页面草稿" },
  { stageId: "slides", status: "running", progress: 82, message: "补充讲稿备注" },
  { stageId: "slides", status: "done", progress: 100, message: "页面预览已完成" },
  { stageId: "export", status: "running", progress: 66, message: "执行交付检查" },
  { stageId: "export", status: "done", progress: 100, message: "本地模拟完成" }
];

const mission = ref(scenarios[0].mission);
const selectedScenarioId = ref(scenarios[0].id);
const slideCount = ref("8");
const audience = ref("executive");
const density = ref("balanced");
const imagePolicy = ref("template");
const selectedPromptId = ref("decision");
const selectedTemplateId = ref("board");
const selectedSkillIds = ref<string[]>(["outline", "chart", "notes", "qa"]);
const promptDraft = ref(promptOptions[0].content);
const stages = ref<Stage[]>(createStages());
const activeStageId = ref("brief");
const eventCursor = ref(0);
const isRunning = ref(false);
const isPaused = ref(false);
const timer = ref<ReturnType<typeof setInterval> | null>(null);
const isDrawerOpen = ref(false);
const drawerPanel = ref<DrawerPanel>("prompt");
const logs = ref<string[]>(["页面就绪"]);

const selectedPrompt = computed(() => promptOptions.find((item) => item.value === selectedPromptId.value) || promptOptions[0]);
const selectedTemplate = computed(() => templateOptions.find((item) => item.value === selectedTemplateId.value) || templateOptions[0]);
const selectedSkills = computed(() => skillOptions.filter((skill) => selectedSkillIds.value.includes(skill.id)));
const activeStage = computed(() => stages.value.find((stage) => stage.id === activeStageId.value) || stages.value[0]);
const doneCount = computed(() => stages.value.filter((stage) => stage.status === "done").length);
const runningStage = computed(() => stages.value.find((stage) => stage.status === "running") || null);
const progress = computed(() =>
  Math.round(stages.value.reduce((sum, stage) => sum + (stage.status === "done" ? 100 : stage.progress), 0) / stages.value.length)
);
const canRun = computed(() => Boolean(mission.value.trim()) && selectedSkillIds.value.length > 0);
const canResume = computed(() => isPaused.value && eventCursor.value < simulationEvents.length);
const statusText = computed(() => {
  if (isRunning.value) return runningStage.value?.title || activeStage.value.title;
  if (isPaused.value) return "已暂停";
  if (doneCount.value === stages.value.length) return "已完成";
  return "准备就绪";
});
const drawerTitle = computed(() => {
  if (drawerPanel.value === "prompt") return "提示词";
  if (drawerPanel.value === "template") return "模板";
  if (drawerPanel.value === "skills") return "Skill";
  if (drawerPanel.value === "logs") return "运行记录";
  return "偏好";
});
const pages = computed(() => {
  const names = ["封面", "背景", "数据", "诊断", "方案", "计划", "风险", "下一步", "案例", "附录", "补充", "问答"];
  const count = Math.min(Number(slideCount.value) || 8, names.length);
  const slideReady = stages.value.find((stage) => stage.id === "slides")?.status === "done";
  return Array.from({ length: count }, (_, index) => ({
    page: index + 1,
    title: names[index],
    ready: slideReady || index < doneCount.value,
    main: index === 0
  }));
});
const currentSlideTitle = computed(() => {
  if (doneCount.value >= 4) return "页面草稿";
  if (doneCount.value >= 2) return "大纲预览";
  return "等待生成";
});
const currentAudienceLabel = computed(() => audienceOptions.find((item) => item.value === audience.value)?.label || "管理层");
const compactContext = computed(() => [
  { id: "prompt" as DrawerPanel, icon: MessageSquareText, label: selectedPrompt.value.label },
  { id: "template" as DrawerPanel, icon: Palette, label: selectedTemplate.value.label },
  { id: "skills" as DrawerPanel, icon: PlugZap, label: `${selectedSkills.value.length} Skill` },
  { id: "settings" as DrawerPanel, icon: SlidersHorizontal, label: `${slideCount.value} 页` }
]);

function addLog(message: string) {
  logs.value = [`${new Date().toLocaleTimeString("zh-CN", { hour12: false })} ${message}`, ...logs.value].slice(0, 12);
}

function clearTimer() {
  if (!timer.value) return;
  clearInterval(timer.value);
  timer.value = null;
}

function chooseScenario(scenario: Scenario) {
  selectedScenarioId.value = scenario.id;
  mission.value = scenario.mission;
  selectedPromptId.value = scenario.promptId;
  selectedTemplateId.value = scenario.templateId;
  selectedSkillIds.value = [...scenario.skills];
  promptDraft.value = promptOptions.find((item) => item.value === scenario.promptId)?.content || promptDraft.value;
  addLog(`选择：${scenario.title}`);
}

function openDrawer(panel: DrawerPanel) {
  drawerPanel.value = panel;
  isDrawerOpen.value = true;
}

function selectPrompt(value: string) {
  selectedPromptId.value = value;
  promptDraft.value = promptOptions.find((item) => item.value === value)?.content || promptDraft.value;
}

function toggleSkill(skillId: string) {
  selectedSkillIds.value = selectedSkillIds.value.includes(skillId)
    ? selectedSkillIds.value.filter((id) => id !== skillId)
    : [...selectedSkillIds.value, skillId];
}

function resetSimulation(writeLog = true) {
  clearTimer();
  stages.value = createStages();
  activeStageId.value = "brief";
  eventCursor.value = 0;
  isRunning.value = false;
  isPaused.value = false;
  if (writeLog) logs.value = ["页面已重置"];
}

function applyNextEvent() {
  const event = simulationEvents[eventCursor.value];
  if (!event) {
    isRunning.value = false;
    isPaused.value = false;
    return;
  }
  stages.value = stages.value.map((stage) =>
    stage.id === event.stageId ? { ...stage, status: event.status, progress: event.progress } : stage
  );
  activeStageId.value = event.stageId;
  addLog(event.message);
  eventCursor.value += 1;
  if (eventCursor.value >= simulationEvents.length) {
    isRunning.value = false;
    isPaused.value = false;
    clearTimer();
  }
}

function scheduleNextEvent() {
  clearTimer();
  if (!isRunning.value || isPaused.value) return;
  timer.value = setInterval(() => {
    if (!isRunning.value || isPaused.value) {
      clearTimer();
      return;
    }
    applyNextEvent();
  }, 720);
}

function startSimulation() {
  if (!canRun.value) return;
  const shouldRestart = eventCursor.value >= simulationEvents.length || doneCount.value === stages.value.length;
  const wasPaused = canResume.value;
  if (shouldRestart) resetSimulation(false);
  isRunning.value = true;
  isPaused.value = false;
  addLog(wasPaused ? "继续生成" : "开始生成");
  applyNextEvent();
  scheduleNextEvent();
}

function pauseSimulation() {
  if (!isRunning.value) return;
  isRunning.value = false;
  isPaused.value = true;
  clearTimer();
  addLog("暂停");
}

onBeforeUnmount(() => {
  clearTimer();
});
</script>

<template>
  <main class="agent-page">
    <header class="topbar">
      <div class="brand">
        <span class="brand__mark"><Sparkles :size="18" /></span>
        <div>
          <span>PPT Agent</span>
          <h1>一句话生成演示稿</h1>
        </div>
      </div>

      <div class="run">
        <span>{{ statusText }}</span>
        <strong>{{ progress }}%</strong>
        <UiProgress :value="progress" size="sm" />
        <UiButton v-if="!isRunning" variant="primary" :disabled="!canRun" @click="startSimulation">
          <Play :size="15" />
          {{ canResume ? "继续" : "开始" }}
        </UiButton>
        <UiButton v-else variant="secondary" @click="pauseSimulation">
          <Pause :size="15" />
          暂停
        </UiButton>
        <UiButton variant="ghost" title="重置" @click="resetSimulation()">
          <RotateCcw :size="15" />
        </UiButton>
      </div>
    </header>

    <section class="agent-canvas">
      <aside class="brief-panel">
        <section class="composer">
          <div class="composer__title">
            <h2>要做什么？</h2>
            <UiBadge :tone="canRun ? 'success' : 'warning'" size="sm">{{ canRun ? "就绪" : "待输入" }}</UiBadge>
          </div>

          <UiTextarea
            v-model="mission"
            :rows="5"
            placeholder="例如：做一份 8 页季度经营复盘，给管理层看，先讲结论。"
          />

          <div class="composer__actions">
            <UiSelect v-model="audience" :options="audienceOptions" />
            <UiButton variant="primary" :disabled="!canRun" @click="startSimulation">
              <Send :size="15" />
              生成
            </UiButton>
          </div>
        </section>

        <section class="quick-start" aria-label="快捷场景">
          <button
            v-for="scenario in scenarios"
            :key="scenario.id"
            type="button"
            :class="{ active: selectedScenarioId === scenario.id }"
            @click="chooseScenario(scenario)"
          >
            {{ scenario.title }}
          </button>
        </section>

        <section class="context-chips" aria-label="生成上下文">
          <button v-for="item in compactContext" :key="item.id" type="button" @click="openDrawer(item.id)">
            <component :is="item.icon" :size="14" />
            {{ item.label }}
          </button>
        </section>
      </aside>

      <section class="preview-panel">
        <div class="preview-toolbar">
          <div>
            <span>预览</span>
            <h2>{{ currentSlideTitle }}</h2>
          </div>
          <button type="button" @click="openDrawer('logs')">
            <Clock3 :size="14" />
            记录
          </button>
        </div>

        <div class="deck-stage">
          <div class="slide-preview">
            <div class="slide-preview__bar">
              <span />
              <span />
              <span />
              <strong>{{ selectedTemplate.label }}</strong>
            </div>
            <div class="slide-preview__body">
              <UiBadge :tone="doneCount >= 4 ? 'success' : 'neutral'" size="sm">{{ doneCount >= 4 ? "草稿" : "等待" }}</UiBadge>
              <h3>{{ mission || "描述你要做的 PPT" }}</h3>
              <p>{{ selectedPrompt.label }} · {{ currentAudienceLabel }}</p>
            </div>
          </div>
        </div>

        <div class="page-strip" aria-label="页面预览">
          <article v-for="page in pages" :key="page.page" :class="{ ready: page.ready, main: page.main }">
            <span>{{ page.page }}</span>
            <strong>{{ page.title }}</strong>
          </article>
        </div>
      </section>

      <aside class="status-panel">
        <section class="agent-status">
          <span class="agent-pulse" :class="{ active: isRunning }">
            <Loader2 v-if="isRunning" :size="16" class="spin" />
            <CheckCircle2 v-else-if="doneCount === stages.length" :size="16" />
            <Sparkles v-else :size="16" />
          </span>
          <div>
            <strong>{{ statusText }}</strong>
            <small>{{ activeStage.title }}</small>
          </div>
        </section>

        <section class="stage-rail">
          <button
            v-for="stage in stages"
            :key="stage.id"
            type="button"
            :class="[`is-${stage.status}`, { active: activeStageId === stage.id }]"
          >
            <component
              :is="stage.status === 'running' ? Loader2 : stage.status === 'done' ? CheckCircle2 : stage.icon"
              :size="15"
              :class="{ spin: stage.status === 'running' }"
            />
            <span>{{ stage.title }}</span>
          </button>
        </section>

        <section class="output-mini">
          <div>
            <strong>{{ doneCount }}/{{ stages.length }}</strong>
            <span>完成步骤</span>
          </div>
          <UiButton v-if="doneCount === stages.length" variant="secondary" size="sm">
            <Download :size="14" />
            导出
          </UiButton>
        </section>
      </aside>
    </section>

    <div v-if="isDrawerOpen" class="drawer-overlay" @click.self="isDrawerOpen = false">
      <aside class="drawer">
        <header>
          <h2>{{ drawerTitle }}</h2>
          <button type="button" title="关闭" @click="isDrawerOpen = false">
            <X :size="18" />
          </button>
        </header>

        <div v-if="drawerPanel !== 'logs'" class="drawer-tabs">
          <button :class="{ active: drawerPanel === 'prompt' }" @click="drawerPanel = 'prompt'">提示词</button>
          <button :class="{ active: drawerPanel === 'template' }" @click="drawerPanel = 'template'">模板</button>
          <button :class="{ active: drawerPanel === 'skills' }" @click="drawerPanel = 'skills'">Skill</button>
          <button :class="{ active: drawerPanel === 'settings' }" @click="drawerPanel = 'settings'">偏好</button>
        </div>

        <div class="drawer-body">
          <template v-if="drawerPanel === 'prompt'">
            <UiField label="提示词">
              <UiSelect :model-value="selectedPromptId" :options="promptOptions" @update:model-value="selectPrompt" />
            </UiField>
            <UiTextarea v-model="promptDraft" :rows="6" />
          </template>

          <template v-else-if="drawerPanel === 'template'">
            <button
              v-for="template in templateOptions"
              :key="template.value"
              type="button"
              class="drawer-option"
              :class="{ active: selectedTemplateId === template.value }"
              @click="selectedTemplateId = template.value"
            >
              <span :style="{ background: template.accent }" />
              <strong>{{ template.label }}</strong>
              <small>{{ template.description }}</small>
            </button>
          </template>

          <template v-else-if="drawerPanel === 'skills'">
            <button
              v-for="skill in skillOptions"
              :key="skill.id"
              type="button"
              class="skill-row"
              :class="{ active: selectedSkillIds.includes(skill.id) }"
              @click="toggleSkill(skill.id)"
            >
              <strong>{{ skill.name }}</strong>
              <small>{{ skill.description }}</small>
              <CheckCircle2 v-if="selectedSkillIds.includes(skill.id)" :size="15" />
            </button>
          </template>

          <template v-else-if="drawerPanel === 'settings'">
            <UiField label="页数">
              <UiSelect v-model="slideCount" :options="slideCountOptions" />
            </UiField>
            <UiField label="密度">
              <UiSelect v-model="density" :options="densityOptions" />
            </UiField>
            <UiField label="图片">
              <UiSelect v-model="imagePolicy" :options="imagePolicyOptions" />
            </UiField>
          </template>

          <template v-else>
            <div class="log-list">
              <article v-for="log in logs" :key="log">
                <Clock3 :size="13" />
                <span>{{ log }}</span>
              </article>
            </div>
          </template>
        </div>
      </aside>
    </div>
  </main>
</template>

<style scoped>
.agent-page {
  height: 100vh;
  overflow-y: auto;
  padding: 18px;
  background: var(--color-bg);
  color: var(--color-text);
}

.topbar,
.agent-canvas {
  width: min(100%, 1360px);
  margin: 0 auto;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  min-height: 74px;
  padding: 10px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.brand,
.run,
.composer__title,
.context-chips,
.preview-toolbar,
.page-strip,
.agent-status,
.stage-rail button,
.output-mini,
.log-list article {
  display: flex;
  align-items: center;
}

.brand {
  gap: 10px;
  min-width: 0;
}

.brand__mark,
.agent-pulse {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.brand__mark {
  width: 42px;
  height: 42px;
}

.brand span:not(.brand__mark) {
  color: var(--color-subtle);
  font-size: 12px;
}

.brand h1 {
  margin: 2px 0 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: 22px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run {
  gap: 10px;
}

.run > span {
  min-width: 72px;
  color: var(--color-muted);
  font-size: 12px;
  text-align: right;
}

.run > strong {
  width: 42px;
  color: var(--color-text);
  font-size: 14px;
  text-align: right;
}

.run :deep(.ui-progress) {
  width: 190px;
}

.agent-canvas {
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr) 220px;
  gap: 12px;
  margin-top: 12px;
}

.brief-panel,
.preview-panel,
.status-panel {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.composer,
.quick-start,
.context-chips,
.preview-panel,
.status-panel > section {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.composer {
  display: grid;
  gap: 12px;
  padding: 14px;
}

.composer__title {
  justify-content: space-between;
  gap: 10px;
}

.composer__title h2,
.preview-toolbar h2,
.drawer h2 {
  margin: 0;
  color: var(--color-text);
  font-size: 18px;
  line-height: 1.2;
}

.composer__actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.quick-start {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 10px;
}

.quick-start button,
.context-chips button,
.preview-toolbar button,
.stage-rail button,
.drawer-option,
.skill-row {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  color: var(--color-text);
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    transform var(--transition-fast);
}

.quick-start button {
  min-height: 42px;
  font-size: 13px;
  font-weight: 700;
}

.quick-start button:hover,
.quick-start button.active,
.context-chips button:hover,
.preview-toolbar button:hover,
.stage-rail button:hover,
.drawer-option:hover,
.drawer-option.active,
.skill-row:hover,
.skill-row.active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  color: var(--color-accent-strong);
}

.context-chips {
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px;
}

.context-chips button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 10px;
  color: var(--color-muted);
  font-size: 12px;
}

.preview-panel {
  display: grid;
  grid-template-rows: auto minmax(360px, 1fr) auto;
  padding: 14px;
}

.preview-toolbar {
  justify-content: space-between;
  gap: 12px;
}

.preview-toolbar span {
  color: var(--color-subtle);
  font-size: 12px;
}

.preview-toolbar button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 10px;
  color: var(--color-muted);
  font-size: 12px;
}

.deck-stage {
  display: grid;
  place-items: center;
  min-height: 360px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
}

.slide-preview {
  width: min(100%, 760px);
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}

.slide-preview__bar {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-panel);
}

.slide-preview__bar span {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--color-border-strong);
}

.slide-preview__bar strong {
  margin-left: auto;
  color: var(--color-muted);
  font-size: 11px;
}

.slide-preview__body {
  display: grid;
  align-content: center;
  gap: 14px;
  height: calc(100% - 34px);
  padding: 44px;
}

.slide-preview__body h3 {
  display: -webkit-box;
  max-width: 680px;
  margin: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: clamp(24px, 4vw, 42px);
  line-height: 1.15;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.slide-preview__body p {
  margin: 0;
  color: var(--color-muted);
  font-size: 14px;
}

.page-strip {
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.page-strip article {
  display: grid;
  flex: 0 0 86px;
  gap: 6px;
  min-height: 58px;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
}

.page-strip article.ready {
  border-color: var(--color-success);
  background: var(--color-success-soft);
}

.page-strip article.main {
  flex-basis: 118px;
}

.page-strip span {
  color: var(--color-subtle);
  font-size: 11px;
  font-weight: 800;
}

.page-strip strong {
  color: var(--color-text);
  font-size: 12px;
}

.status-panel {
  position: sticky;
  top: 98px;
  align-self: start;
}

.status-panel > section {
  padding: 12px;
}

.agent-status {
  gap: 10px;
}

.agent-pulse {
  width: 36px;
  height: 36px;
}

.agent-pulse.active {
  color: var(--color-inverse);
  background: var(--color-accent);
}

.agent-status strong,
.output-mini strong {
  display: block;
  color: var(--color-text);
  font-size: 15px;
}

.agent-status small,
.output-mini span,
.log-list span,
.drawer-option small,
.skill-row small {
  color: var(--color-muted);
  font-size: 12px;
}

.stage-rail {
  display: grid;
  gap: 8px;
}

.stage-rail button {
  gap: 8px;
  justify-content: flex-start;
  min-height: 36px;
  padding: 0 10px;
  color: var(--color-muted);
  font-size: 12px;
  text-align: left;
}

.stage-rail button.is-done {
  color: var(--color-success);
}

.stage-rail button.is-running,
.stage-rail button.active {
  color: var(--color-accent);
}

.output-mini {
  justify-content: space-between;
  gap: 10px;
}

.drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  justify-items: end;
  background: var(--color-overlay);
}

.drawer {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  width: min(420px, 100vw);
  height: 100%;
  padding: 16px;
  border-left: 1px solid var(--color-border);
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
}

.drawer header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.drawer header button {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-muted);
}

.drawer-tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  margin-top: 14px;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
}

.drawer-tabs button {
  min-height: 32px;
  border-radius: 6px;
  color: var(--color-muted);
  font-size: 12px;
}

.drawer-tabs button.active {
  background: var(--color-surface);
  color: var(--color-accent);
  box-shadow: var(--shadow-sm);
}

.drawer-body {
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 0;
  margin-top: 14px;
  overflow: auto;
}

.drawer-option,
.skill-row {
  display: grid;
  gap: 4px;
  padding: 10px;
  text-align: left;
}

.drawer-option {
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: center;
}

.drawer-option span {
  width: 22px;
  height: 22px;
  border: 1px solid var(--color-border);
  border-radius: 7px;
}

.drawer-option small {
  grid-column: 2;
}

.skill-row {
  grid-template-columns: minmax(0, 1fr) 18px;
  align-items: center;
}

.skill-row small {
  grid-column: 1;
}

.log-list {
  display: grid;
  gap: 8px;
}

.log-list article {
  gap: 8px;
  padding: 9px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1180px) {
  .agent-canvas {
    grid-template-columns: 340px minmax(0, 1fr);
  }

  .status-panel {
    grid-column: 1 / -1;
    position: static;
    grid-template-columns: 220px minmax(0, 1fr) 180px;
  }
}

@media (max-width: 840px) {
  .topbar,
  .agent-canvas {
    grid-template-columns: 1fr;
  }

  .run {
    justify-content: stretch;
    flex-wrap: wrap;
  }

  .run :deep(.ui-progress) {
    width: 100%;
    flex: 1 1 100%;
  }

  .status-panel {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .agent-page {
    padding: 10px;
  }

  .brand h1 {
    white-space: normal;
  }

  .composer__actions,
  .quick-start {
    grid-template-columns: 1fr;
  }

  .slide-preview__body {
    padding: 24px;
  }
}
</style>
