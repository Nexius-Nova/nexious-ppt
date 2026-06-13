<script setup lang="ts">
import { ref } from 'vue';
import { RefreshCw, GripVertical, Loader2, Plus, Trash2, MessageSquare, CheckSquare, Square, FileText } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiEmpty from '@/components/ui/UiEmpty.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
import type { SlideOutline } from '@/types/agent';
import { generateSuggestion, getSuggestionLabel, parseSuggestionResult, type SuggestionType } from '@/composables/useCopilot';
import { useToastStore } from '@/stores/toastStore';
import { slideNeedsImage } from '@/utils/slideVisuals';

const toastStore = useToastStore();

const props = defineProps<{
  outline: SlideOutline[];
  isRunning?: boolean;
  showRunAction?: boolean;
}>();

const emit = defineEmits<{
  updateTitle: [id: string, title: string];
  updateBullet: [id: string, index: number, text: string];
  addBullet: [id: string];
  deleteBullet: [id: string, index: number];
  reorderBullet: [id: string, fromIndex: number, toIndex: number];
  updateNotes: [id: string, notes: string];
  updateVisualPrompt: [id: string, prompt: string];
  reorder: [fromIndex: number, toIndex: number];
  run: [];
  batchDelete: [ids: string[]];
}>();

// ---- Slide drag state ----
const dragIndex = ref<number | null>(null);
const dropIndex = ref<number | null>(null);

// ---- Batch selection ----
const selectedSlides = ref<Set<string>>(new Set());

const allSelected = ref(false);

function toggleSlide(id: string) {
  const next = new Set(selectedSlides.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  selectedSlides.value = next;
  allSelected.value = next.size === props.outline.length;
}

function toggleAllSlides() {
  if (allSelected.value) {
    selectedSlides.value = new Set();
    allSelected.value = false;
  } else {
    selectedSlides.value = new Set(props.outline.map(s => s.id));
    allSelected.value = true;
  }
}

function batchDeleteSlides() {
  if (selectedSlides.value.size === 0) return;
  emit('batchDelete', Array.from(selectedSlides.value));
  selectedSlides.value = new Set();
  allSelected.value = false;
}

function onSlideDragStart(index: number, event: DragEvent) {
  dragIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }
}

function onSlideDragOver(index: number, event: DragEvent) {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dropIndex.value = index;
}

function onSlideDragLeave() {
  dropIndex.value = null;
}

function onSlideDrop(index: number) {
  if (dragIndex.value !== null && dragIndex.value !== index) {
    emit('reorder', dragIndex.value, index);
  }
  dragIndex.value = null;
  dropIndex.value = null;
}

function onSlideDragEnd() {
  dragIndex.value = null;
  dropIndex.value = null;
}

// ---- Bullet editing state ----
const editingNotesId = ref<string | null>(null);

function onBulletKeydown(slide: SlideOutline, index: number, event: KeyboardEvent) {
  const target = event.target as HTMLInputElement;
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    emit('addBullet', slide.id);
    // Focus the new bullet after Vue renders
    requestAnimationFrame(() => {
      const container = document.querySelector(`[data-slide-id="${slide.id}"]`);
      if (container) {
        const inputs = container.querySelectorAll('.bullet-input');
        if (inputs[index + 1]) {
          (inputs[index + 1] as HTMLInputElement).focus();
        }
      }
    });
  } else if (event.key === 'Backspace' && target.value === '' && slide.bullets.length > 1) {
    event.preventDefault();
    emit('deleteBullet', slide.id, index);
    requestAnimationFrame(() => {
      const container = document.querySelector(`[data-slide-id="${slide.id}"]`);
      if (container) {
        const inputs = container.querySelectorAll('.bullet-input');
        const focusIndex = Math.min(index, inputs.length - 1);
        if (inputs[focusIndex]) {
          (inputs[focusIndex] as HTMLInputElement).focus();
        }
      }
    });
  }
}

// ---- Bullet drag state ----
const bulletDragState = ref<{ slideId: string; fromIndex: number } | null>(null);
const bulletDropIndex = ref<{ slideId: string; index: number } | null>(null);

function onBulletDragStart(slideId: string, index: number, event: DragEvent) {
  bulletDragState.value = { slideId, fromIndex: index };
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
}

function onBulletDragOver(slideId: string, index: number, event: DragEvent) {
  if (bulletDragState.value?.slideId !== slideId) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  bulletDropIndex.value = { slideId, index };
}

function onBulletDrop(slideId: string, index: number) {
  if (bulletDragState.value && bulletDragState.value.slideId === slideId && bulletDragState.value.fromIndex !== index) {
    emit('reorderBullet', slideId, bulletDragState.value.fromIndex, index);
  }
  bulletDragState.value = null;
  bulletDropIndex.value = null;
}

function onBulletDragEnd() {
  bulletDragState.value = null;
  bulletDropIndex.value = null;
}

function toggleNotes(slideId: string) {
  editingNotesId.value = editingNotesId.value === slideId ? null : slideId;
}

// ---- AI Copilot state ----
const copilotActive = ref<{ slideId: string; type: SuggestionType } | null>(null);
const copilotResults = ref<Record<string, string>>({});
const copilotLoading = ref<Record<string, boolean>>({});

async function runCopilot(slideId: string, type: SuggestionType) {
  const slide = props.outline.find(s => s.id === slideId);
  if (!slide) return;

  const key = `${slideId}-${type}`;
  copilotActive.value = { slideId, type };
  copilotLoading.value[key] = true;
  copilotResults.value[key] = '';

  try {
    const text = await generateSuggestion(type, slide.title, slide.bullets, (content) => {
      copilotResults.value[key] = content;
    });

    const parsed = parseSuggestionResult(text);
    if (parsed) {
      emit('updateTitle', slideId, parsed.title);
      // Replace bullets
      slide.bullets.forEach((_, i) => {
        if (parsed.bullets[i] !== undefined) {
          emit('updateBullet', slideId, i, parsed.bullets[i]);
        }
      });
      // Add extra bullets if AI generated more
      for (let i = slide.bullets.length; i < parsed.bullets.length; i++) {
        emit('addBullet', slideId);
        // Need to wait for reactivity, then set value
        setTimeout(() => emit('updateBullet', slideId, i, parsed.bullets[i]), 50);
      }
      toastStore.success('建议已应用', getSuggestionLabel(type));
    }
    copilotActive.value = null;
  } catch {
    toastStore.error('生成建议失败', '请检查模型配置');
    copilotActive.value = null;
  } finally {
    copilotLoading.value[key] = false;
  }
}

function getCopilotResult(slideId: string, type: SuggestionType): string {
  return copilotResults.value[`${slideId}-${type}`] || '';
}

function isCopilotLoading(slideId: string, type: SuggestionType): boolean {
  return !!copilotLoading.value[`${slideId}-${type}`];
}

function scrollToSlide(slideId: string) {
  const target = document.querySelector(`[data-slide-id="${slideId.replace(/"/g, '\\"')}"]`);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const copilotTypes: SuggestionType[] = ['polish', 'condense', 'expand'];

const CHART_HINT_LABELS: Record<string, string> = {
  area_chart: '面积趋势图：展示 1-2 条累计趋势，突出随时间变化的规模感',
  bar_chart: '柱状对比图：比较 3-8 个类别的单项数值差异',
  box_plot_chart: '箱线分布图：比较不同分组的中位数、区间和异常点',
  bubble_chart: '气泡散点图：同时表达横轴、纵轴和规模三类变量',
  bullet_chart: '目标达成图：对比多个 KPI 的实际值、目标值和完成差距',
  butterfly_chart: '镜像对比图：左右两组数据围绕同一轴线进行对照',
  donut_chart: '环形占比图：展示整体中的 3-6 个组成部分，并突出中心指标',
  dual_axis_line_chart: '双轴折线图：对比两类单位不同的时间趋势',
  dumbbell_chart: '哑铃对比图：展示多个项目在前后、两态之间的变化幅度',
  funnel_chart: '漏斗转化图：呈现 3-5 个连续阶段的转化递减',
  gantt_chart: '甘特计划图：展示任务周期、依赖关系和排期节奏',
  gauge_chart: '仪表盘图：突出单个核心指标的目标完成度',
  grouped_bar_chart: '分组柱状图：并列比较同一类别下 2-4 组系列',
  heatmap_chart: '热力矩阵图：用色块强弱展示二维维度中的密度或强度',
  horizontal_bar_chart: '横向排行图：适合长标签项目的 5-12 项排名对比',
  kpi_cards: 'KPI 指标卡：用 4-8 个核心数字快速概览结果',
  line_chart: '折线趋势图：展示 1-3 条连续时间序列的方向变化',
  matrix_2x2: '四象限矩阵：按两条评价轴定位项目、优先级或策略选择',
  quadrant_text_bullets: '四象限框架：每个象限承载标题和要点列表',
  quadrant_bubble_scatter: '气泡四象限：在二维矩阵中加入规模权重',
  pareto_chart: '帕累托图：用降序柱和累计线突出关键贡献项',
  pie_chart: '饼图：展示 3-6 个部分对整体的占比关系',
  hub_inward_arrows: '中心压力图：周边力量向核心对象施加影响',
  process_flow: '流程图：展示 3-8 个顺序步骤和节点之间的连接',
  progress_bar_chart: '进度条图：并列展示多个事项的完成百分比',
  radar_chart: '雷达能力图：比较 4-8 个维度的能力或评分',
  sankey_chart: '桑基流向图：展示来源、节点和去向之间的流量分配',
  scatter_chart: '散点图：展示两个变量之间的相关性、聚类或异常点',
  stacked_area_chart: '堆叠面积图：表达多系列随时间变化的总量和构成',
  stacked_bar_chart: '堆叠柱状图：比较各类别总量及其内部组成',
  timeline: '时间线：展示 3-8 个里程碑事件和先后顺序',
  treemap_chart: '矩形树图：展示层级或多项目的面积占比关系',
  waterfall_chart: '瀑布图：拆解从起点到终点的增减贡献',
  pyramid_chart: '金字塔层级图：展示 3-6 层分层结构、等级或成熟度',
  pyramid_isometric: '立体金字塔：用更强视觉层次表现四级成长或成熟模型',
  venn_diagram: '维恩图：展示 2-3 个集合的重叠与交集价值',
  pros_cons_chart: '利弊对照图：左右列出优势、风险或正反观点',
  circular_stages: '循环阶段图：展示 4-6 个闭环阶段和持续迭代关系',
  numbered_steps: '编号步骤图：用数字强调 3-6 个顺序步骤',
  icon_grid: '图标网格：展示 4-9 个并列能力、功能或价值点',
  isometric_stairs: '阶梯进阶图：表现成长、提升或阶段性跃迁',
  mind_map: '思维导图：围绕一个核心主题发散 3-6 个分支',
  comparison_table: '对比表：按多项维度比较 2-4 个方案、产品或对象',
  snake_flow: '蛇形长流程：容纳 6-10 个连续旅程或生命周期步骤',
  roadmap_vertical: '纵向路线图：展示 4-8 个里程碑及状态推进',
  word_cloud: '词云图：用大小权重突出关键词频率或重要性',
  concentric_circles: '同心圆层级图：展示由核心到外围的优先级或影响圈',
  segmented_wheel: '分段轮盘图：围绕中心主题拆分 4-8 个并列维度',
  arc_anchored_list: '弧形锚点列表：用左侧弧形视觉统一 3-5 条并列主线',
  chevron_process: '箭头阶段图：用连续箭头表现 3-6 个方法阶段',
  chevron_chain_with_tail: '箭头价值链：展示连续环节如何汇聚到最终成果',
  comparison_columns: '并列方案卡：对比 2-4 个套餐、服务层级或方案',
  fishbone_diagram: '鱼骨图：分析问题背后的 4-6 类原因',
  hub_spoke: '中心辐射图：一个核心能力连接 4-8 个周边能力',
  vertical_list: '纵向重点列表：展示 3-6 条核心观点、建议或行动项',
  vertical_pillars: '支柱图：并列展示 3-5 个独立支柱或战略维度',
  layered_architecture: '分层架构图：展示 3-4 层结构、每层模块职责和跨层关系',
  module_composition: '模块组成图：展示一个系统/功能由多个子模块构成',
  pipeline_with_stages: '管道阶段图：展示数据、构建或业务流水线的阶段与产物',
  client_server_flow: '客户端服务端交互图：展示请求、响应和关键交互方向',
  basic_table: '基础表格：用行列结构整理文本或数字信息',
  consulting_table: '咨询表格：高密度呈现指标、条形微图和结论',
  project_schedule_table: '项目排期表：展示任务、负责人、状态和时间安排',
  financial_statement_table: '财务报表：展示收入、成本、利润等结构化数字',
  feature_matrix_table: '功能矩阵表：按产品或方案对比功能支持情况',
  harvey_balls_table: '评分矩阵表：用圆点评级展示定性评估结果',
  team_roster: '团队名册：展示成员、角色和简短背景',
  top_down_tree: '层级树图：展示组织、目标或任务的上下级分解关系',
  journey_map: '旅程地图：按阶段呈现用户行为、情绪和痛点',
  agenda_list: '议程列表：展示演示结构、议题顺序和时间安排',
};

function humanizeChartKey(key: string) {
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatChartHint(chartHint?: string) {
  const raw = String(chartHint || '').trim();
  if (!raw) return '';
  const key = raw.match(/[a-z0-9_]+(?:-[a-z0-9_]+)*/i)?.[0] || '';
  const label = key ? CHART_HINT_LABELS[key] : '';
  const detail = raw
    .replace(new RegExp(`^\\s*${key}\\s*([|:：,，-]+)?\\s*`, 'i'), '')
    .replace(/\s*\|\s*/g, '\n')
    .replace(/^(具体表达|表达重点|结构|用途|建议)\s*[：:]\s*/i, '')
    .trim();
  if (label && detail) return `${label}\n${detail}`;
  if (label) return label;
  return raw.includes('_') || raw.includes('-') ? `${humanizeChartKey(raw)}：请结合本页内容细化图表结构` : raw;
}
</script>

<template>
  <UiCard title="大纲" subtitle="调整页面顺序、要点、讲稿和图片需求。修改后会影响后续页面生成。">
    <template v-if="showRunAction !== false" #actions>
      <UiButton size="sm" variant="secondary" :disabled="isRunning" @click="$emit('run')">
        <span v-if="isRunning" class="outline-spinner outline-spinner--button" aria-hidden="true" />
        <RefreshCw v-else :size="13" />
        {{ isRunning ? '生成中...' : outline.length ? '重新生成大纲' : '生成大纲' }}
      </UiButton>
    </template>

    <div v-if="isRunning" class="streaming-container">
      <div class="streaming-header">
        <span class="outline-spinner" aria-hidden="true" />
        <span>{{ outline.length ? `已生成 ${outline.length} 页` : '正在生成大纲...' }}</span>
      </div>
      <p class="streaming-hint">AI 返回内容会实时整理成下面的大纲卡片。</p>
    </div>

    <div v-if="outline.length" class="outline-editor">
      <div class="outline-editor__main">
        <!-- Batch toolbar -->
        <Transition name="slide-fade">
          <div v-if="selectedSlides.size > 0" class="batch-bar">
            <span class="batch-bar__info">
              <CheckSquare :size="14" />
              已选 {{ selectedSlides.size }} 页
            </span>
            <div class="batch-bar__actions">
              <UiButton size="sm" variant="danger" @click="batchDeleteSlides">
                <Trash2 :size="12" />
                删除选中
              </UiButton>
              <UiButton size="sm" variant="ghost" @click="selectedSlides = new Set(); allSelected = false">
                取消
              </UiButton>
            </div>
          </div>
        </Transition>

        <article
          v-for="(slide, index) in outline"
          :key="slide.id"
          :data-slide-id="slide.id"
          class="outline-slide"
          :class="{
            'outline-slide--dragging': dragIndex === index,
            'outline-slide--drop-target': dropIndex === index && dragIndex !== index,
            'outline-slide--selected': selectedSlides.has(slide.id)
          }"
          draggable="true"
          @dragstart="onSlideDragStart(index, $event)"
          @dragover="onSlideDragOver(index, $event)"
          @dragleave="onSlideDragLeave"
          @drop="onSlideDrop(index)"
          @dragend="onSlideDragEnd"
        >
        <div class="outline-slide__header">
          <button class="slide-checkbox" @click.stop="toggleSlide(slide.id)">
            <component :is="selectedSlides.has(slide.id) ? CheckSquare : Square" :size="14" />
          </button>
          <div class="outline-slide__index">
            <GripVertical :size="13" class="drag-handle" />
            <span>{{ index + 1 }}</span>
          </div>
          <UiInput
            :model-value="slide.title"
            placeholder="幻灯片标题"
            @update:model-value="$emit('updateTitle', slide.id, $event)"
          />
        </div>

        <div class="outline-slide__content">
          <div class="outline-slide__bullets-wrapper">
            <div
              v-for="(bullet, bIndex) in slide.bullets"
              :key="bIndex"
              class="bullet-row"
              :class="{
                'bullet-row--drag-over': bulletDropIndex?.slideId === slide.id && bulletDropIndex?.index === bIndex
              }"
              draggable="true"
              @dragstart="onBulletDragStart(slide.id, bIndex, $event)"
              @dragover="onBulletDragOver(slide.id, bIndex, $event)"
              @drop="onBulletDrop(slide.id, bIndex)"
              @dragend="onBulletDragEnd"
            >
              <span class="bullet-grip">
                <GripVertical :size="10" />
              </span>
              <input
                class="bullet-input"
                :value="bullet"
                :placeholder="`要点 ${bIndex + 1}`"
                @input="$emit('updateBullet', slide.id, bIndex, ($event.target as HTMLInputElement).value)"
                @keydown="onBulletKeydown(slide, bIndex, $event)"
              />
              <button
                v-if="slide.bullets.length > 1"
                class="bullet-remove"
                title="删除要点"
                @click="$emit('deleteBullet', slide.id, bIndex)"
              >
                <Trash2 :size="11" />
              </button>
            </div>
            <button class="bullet-add" @click="$emit('addBullet', slide.id)">
              <Plus :size="11" />
              <span>添加要点</span>
            </button>
          </div>

          <!-- Speaker notes inline editor -->
          <div class="outline-slide__notes-section">
            <button class="notes-toggle" :class="{ 'notes-toggle--open': editingNotesId === slide.id }" @click="toggleNotes(slide.id)">
              <MessageSquare :size="12" />
              <span>{{ slide.speakerNotes ? '编辑讲稿' : '添加讲稿' }}</span>
              <UiBadge v-if="slide.speakerNotes" tone="info" size="sm">已添加</UiBadge>
            </button>
            <Transition name="slide-fade">
              <textarea
                v-if="editingNotesId === slide.id"
                class="notes-editor"
                :value="slide.speakerNotes"
                placeholder="输入演讲备注/讲稿..."
                rows="3"
                @input="$emit('updateNotes', slide.id, ($event.target as HTMLTextAreaElement).value)"
              />
            </Transition>
          </div>

          <div class="outline-slide__visual-section">
            <div class="visual-row">
              <UiBadge :tone="slideNeedsImage(slide) ? 'success' : 'neutral'" size="sm">
                {{ slideNeedsImage(slide) ? '需要图片' : '无需图片' }}
              </UiBadge>
              <input
                class="visual-input"
                :value="slide.visualPrompt"
                placeholder="图片需求，例如：产品场景图、流程示意图、封面插图"
                @input="$emit('updateVisualPrompt', slide.id, ($event.target as HTMLInputElement).value)"
              />
            </div>
          </div>

          <div v-if="slide.chartHint" class="outline-slide__chart">
            <div class="outline-slide__chart-header">
              <UiBadge tone="warning" size="sm">图表建议</UiBadge>
            </div>
            <p class="outline-slide__chart-text">{{ formatChartHint(slide.chartHint) }}</p>
          </div>

          <div v-if="slide.animationDescription" class="outline-slide__animation-plan">
            <UiBadge tone="info" size="sm">动画</UiBadge>
            <span>{{ slide.animationDescription }}</span>
          </div>

          <!-- AI Copilot -->
          <div class="copilot-section">
            <div class="copilot-triggers">
              <button
                v-for="cType in copilotTypes"
                :key="cType"
                class="copilot-btn"
                :class="{ 'copilot-btn--loading': isCopilotLoading(slide.id, cType) }"
                :disabled="isCopilotLoading(slide.id, cType)"
                @click="runCopilot(slide.id, cType)"
              >
                <Loader2 v-if="isCopilotLoading(slide.id, cType)" :size="10" class="animate-spin" />
                <FileText v-else :size="10" />
                {{ getSuggestionLabel(cType) }}
              </button>
            </div>
            <Transition name="slide-fade">
              <div
                v-if="getCopilotResult(slide.id, copilotTypes[0]) ||
                  getCopilotResult(slide.id, copilotTypes[1]) ||
                  getCopilotResult(slide.id, copilotTypes[2])"
                class="copilot-preview"
              >
                <pre class="copilot-preview__text">{{ getCopilotResult(slide.id, 'polish') || getCopilotResult(slide.id, 'condense') || getCopilotResult(slide.id, 'expand') }}</pre>
              </div>
            </Transition>
          </div>
        </div>
        </article>
      </div>

      <nav class="outline-toc" aria-label="大纲目录">
        <span class="outline-toc__title">目录</span>
        <button
          v-for="(slide, index) in outline"
          :key="`toc-${slide.id}`"
          type="button"
          class="outline-toc__item"
          @click="scrollToSlide(slide.id)"
        >
          <span>{{ index + 1 }}</span>
          <strong>{{ slide.title }}</strong>
        </button>
      </nav>
    </div>

    <UiEmpty
      v-else-if="!isRunning"
      title="还没有大纲"
      description="运行文本分析后，AI 会根据当前 PPT 输入生成可编辑大纲。"
    >
      <div class="empty-actions">
        <UiButton size="sm" :disabled="isRunning" @click="$emit('run')">
          <RefreshCw :size="13" />
          运行文本分析
        </UiButton>
      </div>
    </UiEmpty>
  </UiCard>
</template>

<style scoped>
.streaming-container {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid var(--color-accent-soft);
  border-radius: var(--radius-md);
  background: var(--color-accent-soft);
  margin-bottom: 10px;
  contain: paint;
}

.streaming-header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-accent);
  font-size: 13px;
  font-weight: 500;
}

.outline-spinner {
  position: relative;
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  transform: translateZ(0);
}

.outline-spinner::before {
  content: "";
  width: 100%;
  height: 100%;
  border: 2px solid color-mix(in srgb, currentColor 18%, transparent);
  border-top-color: currentColor;
  border-radius: 999px;
  transform: translateZ(0);
  will-change: transform;
  animation: outline-spinner-rotate 0.9s linear infinite;
}

.outline-spinner--button {
  width: 13px;
  height: 13px;
}

.streaming-hint {
  margin: 0;
  color: var(--color-muted);
  font-size: 12px;
}

.outline-editor {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 176px;
  align-items: start;
  gap: var(--space-3);
}

.outline-editor__main {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.outline-toc {
  display: grid;
  gap: 6px;
  position: sticky;
  top: 12px;
  max-height: calc(100vh - 180px);
  overflow-y: auto;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.outline-toc__title {
  padding: 0 4px 4px;
  color: var(--color-subtle);
  font-size: 11px;
  font-weight: 700;
}

.outline-toc__item {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 30px;
  padding: 4px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  transition: border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
}

.outline-toc__item:hover {
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.outline-toc__item span {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: var(--color-panel);
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
}

.outline-toc__item strong {
  min-width: 0;
  overflow: hidden;
  font-size: 11px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Batch bar */
.batch-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border: 1px solid var(--color-accent);
  border-radius: 8px;
  background: var(--color-accent-soft);
}

.batch-bar__info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-accent);
}

.batch-bar__actions {
  display: flex;
  gap: 6px;
}

/* Slide checkbox */
.slide-checkbox {
  display: grid;
  place-items: center;
  background: transparent;
  border: none;
  color: var(--color-muted);
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  flex-shrink: 0;
  transition: color var(--transition-fast);
}

.slide-checkbox:hover {
  color: var(--color-accent);
}

.empty-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.outline-slide--selected {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.outline-slide {
  scroll-margin-top: 76px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-panel);
  transition: border-color var(--transition-fast), opacity var(--transition-fast), box-shadow var(--transition-fast);
}

.outline-slide:hover {
  border-color: var(--color-border-strong);
}

.outline-slide--dragging {
  opacity: 0.4;
}

.outline-slide--drop-target {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-accent-soft);
}

.outline-slide__header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.outline-slide__index {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  color: var(--color-subtle);
  cursor: grab;
}

.outline-slide__index:active {
  cursor: grabbing;
}

.drag-handle {
  opacity: 0.4;
  transition: opacity var(--transition-fast);
}

.outline-slide:hover .drag-handle {
  opacity: 0.8;
}

.outline-slide__index span {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
}

.outline-slide__content {
  padding-left: 36px;
  display: grid;
  gap: 10px;
}

/* ---- Bullets ---- */
.outline-slide__bullets-wrapper {
  display: grid;
  gap: 4px;
}

.bullet-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  border-radius: 6px;
  transition: background var(--transition-fast);
}

.bullet-row:hover {
  background: var(--color-surface);
}

.bullet-row--drag-over {
  background: var(--color-accent-soft);
  outline: 1px dashed var(--color-accent);
}

.bullet-grip {
  display: grid;
  place-items: center;
  opacity: 0;
  color: var(--color-muted);
  cursor: grab;
  flex-shrink: 0;
  transition: opacity var(--transition-fast);
}

.bullet-row:hover .bullet-grip,
.bullet-row:focus-within .bullet-grip {
  opacity: 0.5;
}

.bullet-grip:active {
  cursor: grabbing;
}

.bullet-input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.5;
  font-family: inherit;
  transition: all var(--transition-fast);
  outline: none;
}

.bullet-input:hover {
  background: var(--color-surface);
  border-color: var(--color-border);
}

.bullet-input:focus {
  background: var(--color-surface);
  border-color: var(--color-accent);
  color: var(--color-text);
}

.bullet-input::placeholder {
  color: var(--color-placeholder);
  font-size: 12px;
}

.bullet-remove {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  opacity: 0;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.bullet-row:hover .bullet-remove {
  opacity: 0.5;
}

.bullet-remove:hover {
  opacity: 1 !important;
  background: var(--color-danger-soft);
  color: var(--color-danger);
}

.bullet-add {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--transition-fast);
  margin-top: 2px;
}

.bullet-add:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

/* ---- Notes ---- */
.outline-slide__notes-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.outline-slide__visual-section {
  margin-top: 8px;
}

.visual-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.visual-input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--color-text);
  font-size: 12px;
}

.visual-input::placeholder {
  color: var(--color-subtle);
}

.notes-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all var(--transition-fast);
  width: fit-content;
}

.notes-toggle:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.notes-toggle--open {
  border-color: var(--color-info);
  color: var(--color-info);
}

.notes-editor {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 12px;
  line-height: 1.6;
  font-family: inherit;
  resize: vertical;
  transition: border-color var(--transition-fast);
}

.notes-editor:focus {
  outline: none;
  border-color: var(--color-accent);
}

.notes-editor::placeholder {
  color: var(--color-placeholder);
}

/* ---- Chart hint ---- */
.outline-slide__chart {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--color-muted);
  line-height: 1.5;
  background: var(--color-warning-soft);
}

.outline-slide__chart-header {
  display: flex;
  align-items: center;
  min-width: 0;
}

.outline-slide__chart-text {
  max-height: 72px;
  min-width: 0;
  margin: 0;
  padding-right: 4px;
  overflow: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  scrollbar-width: thin;
}

.outline-slide__animation-plan {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-info-soft);
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.55;
}

.outline-slide__animation-plan span {
  min-width: 0;
  overflow-wrap: anywhere;
}

/* ---- Animations ---- */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.15s ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.animate-spin {
  transform: translateZ(0);
  will-change: transform;
  animation: spin 1s linear infinite;
}

@keyframes outline-spinner-rotate {
  to {
    transform: translateZ(0) rotate(360deg);
  }
}

/* ---- Copilot ---- */
.copilot-section {
  margin-top: 4px;
}

.copilot-triggers {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.copilot-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.copilot-btn:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.copilot-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.copilot-btn--loading {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.copilot-preview {
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid var(--color-accent-soft);
  border-radius: 8px;
  background: var(--color-accent-soft);
  max-height: 200px;
  overflow-y: auto;
}

.copilot-preview__text {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (max-width: 1100px) {
  .outline-editor {
    grid-template-columns: 1fr;
  }

  .outline-toc {
    order: -1;
    display: flex;
    position: static;
    max-height: none;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .outline-toc__title {
    display: none;
  }

  .outline-toc__item {
    width: auto;
    min-width: 124px;
    max-width: 220px;
  }
}
</style>
