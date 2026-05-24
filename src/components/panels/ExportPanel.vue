<script setup lang="ts">
import { ref, computed } from 'vue';
import { Download, FileDown, History, Loader2, CheckCircle2, XCircle } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiField from '@/components/ui/UiField.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiSelect from '@/components/ui/UiSelect.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiEmpty from '@/components/ui/UiEmpty.vue';

export interface ExportHistoryItem {
  id: string;
  filename: string;
  format: 'pptx' | 'pdf';
  status: 'ready' | 'queued' | 'exporting';
  createdAt: number;
}

const props = defineProps<{
  history: ExportHistoryItem[];
  isExporting: boolean;
  exportProgress: number;
  slideCount: number;
}>();

const emit = defineEmits<{
  export: [format: 'pptx' | 'pdf', options: ExportOptions];
}>();

export interface ExportOptions {
  filename: string;
  pageRange: 'all' | 'current';
}

const filename = ref('');
const pageRange = ref<'all' | 'current'>('all');
const selectedFormat = ref<'pptx' | 'pdf'>('pptx');

function doExport() {
  emit('export', selectedFormat.value, {
    filename: filename.value.trim() || `nexious-deck-${Date.now()}`,
    pageRange: pageRange.value
  });
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

const historyByDate = computed(() => {
  const groups: Record<string, ExportHistoryItem[]> = {};
  for (const item of props.history) {
    const date = new Date(item.createdAt).toLocaleDateString('zh-CN');
    if (!groups[date]) groups[date] = [];
    groups[date].push(item);
  }
  return groups;
});
</script>

<template>
  <div class="export-panel">
    <UiCard title="导出 PPT" subtitle="选择格式和选项，导出可编辑的演示文稿">
      <!-- Export options -->
      <div class="export-options">
        <div class="export-format-grid">
          <button
            class="export-format-card"
            :class="{ 'export-format-card--active': selectedFormat === 'pptx' }"
            @click="selectedFormat = 'pptx'"
          >
            <div class="export-format-icon export-format-icon--pptx">
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                <rect width="32" height="32" rx="6" fill="#ef2d2d" />
                <text x="16" y="21" text-anchor="middle" fill="white" font-size="9" font-weight="bold">PPTX</text>
              </svg>
            </div>
            <div class="export-format-info">
              <strong>PowerPoint</strong>
              <span>.pptx — 可继续编辑</span>
            </div>
          </button>

          <button
            class="export-format-card"
            :class="{ 'export-format-card--active': selectedFormat === 'pdf' }"
            @click="selectedFormat = 'pdf'"
          >
            <div class="export-format-icon export-format-icon--pdf">
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                <rect width="32" height="32" rx="6" fill="#d71920" />
                <text x="16" y="21" text-anchor="middle" fill="white" font-size="9" font-weight="bold">PDF</text>
              </svg>
            </div>
            <div class="export-format-info">
              <strong>PDF 格式</strong>
              <span>.pdf — 便于分享</span>
            </div>
          </button>
        </div>

        <div class="export-detail-options">
          <UiField label="文件名">
            <UiInput v-model="filename" :placeholder="`nexious-deck-${Date.now()}`" />
          </UiField>

          <UiField label="导出范围">
            <UiSelect
              :model-value="pageRange"
              :options="[
                { value: 'all', label: `全部（${slideCount} 页）` },
                { value: 'current', label: '当前页面' }
              ]"
              @update:model-value="pageRange = $event as 'all' | 'current'"
            />
          </UiField>
        </div>

        <!-- Progress bar -->
        <div v-if="isExporting" class="export-progress">
          <div class="export-progress__header">
            <Loader2 :size="14" class="animate-spin" />
            <span>正在导出{{ selectedFormat === 'pptx' ? ' PPTX' : ' PDF' }}...</span>
            <span class="export-progress__pct">{{ exportProgress }}%</span>
          </div>
          <div class="export-progress__bar">
            <div class="export-progress__fill" :style="{ width: `${exportProgress}%` }" />
          </div>
        </div>

        <UiButton
          variant="primary"
          size="lg"
          block
          :disabled="isExporting"
          @click="doExport"
        >
          <Download :size="16" />
          {{ isExporting ? '导出中...' : `导出 ${selectedFormat === 'pptx' ? 'PPTX' : 'PDF'}` }}
        </UiButton>
      </div>

      <!-- Export history -->
      <div v-if="history.length" class="export-history">
        <div class="export-history__header">
          <History :size="14" />
          <span>导出历史</span>
        </div>
        <div v-for="(items, date) in historyByDate" :key="date" class="export-history__group">
          <div class="export-history__date">{{ date }}</div>
          <div v-for="item in items" :key="item.id" class="export-history__item">
            <component :is="item.status === 'ready' ? CheckCircle2 : item.status === 'exporting' ? Loader2 : XCircle" :size="14" :class="{ 'animate-spin': item.status === 'exporting' }" />
            <span class="export-history__name">{{ item.filename }}</span>
            <UiBadge :tone="item.status === 'ready' ? 'success' : 'warning'" size="sm">{{ item.status === 'ready' ? '就绪' : '导出中' }}</UiBadge>
            <span class="export-history__time">{{ formatTime(item.createdAt) }}</span>
          </div>
        </div>
      </div>

      <UiEmpty
        v-else-if="!isExporting"
        title="暂无导出记录"
        description="导出 PPT 后将出现在这里"
      />
    </UiCard>
  </div>
</template>

<style scoped>
.export-options {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.export-format-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.export-format-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1.5px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  cursor: pointer;
  text-align: left;
  transition: all var(--transition-fast);
}

.export-format-card:hover {
  border-color: var(--color-border-strong);
}

.export-format-card--active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.export-format-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.export-format-info strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.export-format-info span {
  font-size: 11px;
  color: var(--color-subtle);
}

.export-detail-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
}

/* Progress */
.export-progress {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--color-accent-soft);
  border-radius: 8px;
  background: var(--color-accent-soft);
}

.export-progress__header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-accent);
}

.export-progress__pct {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 12px;
}

.export-progress__bar {
  height: 4px;
  border-radius: 2px;
  background: var(--color-border);
  overflow: hidden;
}

.export-progress__fill {
  height: 100%;
  border-radius: 2px;
  background: var(--color-accent);
  transition: width 0.3s ease;
}

/* History */
.export-history {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}

.export-history__header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.export-history__group {
  margin-bottom: 10px;
}

.export-history__date {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-subtle);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.export-history__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--color-muted);
  transition: background var(--transition-fast);
}

.export-history__item:hover {
  background: var(--color-panel);
}

.export-history__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.export-history__time {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-subtle);
}

.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
