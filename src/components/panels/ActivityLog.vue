<script setup lang="ts">
import { Terminal, Clock } from 'lucide-vue-next';

defineProps<{
  logs: string[];
}>();
</script>

<template>
  <div class="activity-log">
    <!-- <div class="activity-log__header">
    </div> -->
    <div class="activity-log__content">
      <div v-for="(log, index) in logs" :key="index" class="activity-log__item">
        <Terminal :size="11" class="activity-log__icon" />
        <span class="activity-log__text">{{ log }}</span>
      </div>
      <div v-if="!logs.length" class="activity-log__empty">
        <Clock :size="12" />
        <span>等待操作...</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.activity-log {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.activity-log__header {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border);
}

.activity-log__header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text);
}

.activity-log__header p {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--color-subtle);
}

.activity-log__content {
  display: grid;
  gap: 6px;
  max-height: min(64vh, 680px);
  overflow-y: auto;
  padding-right: 4px;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-strong) transparent;
}

.activity-log__content::-webkit-scrollbar {
  width: 6px;
}

.activity-log__content::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: var(--color-border-strong);
}

.activity-log__item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  transition: background var(--transition-fast);
}

.activity-log__item:hover {
  background: var(--color-panel);
}

.activity-log__icon {
  flex: 0 0 auto;
  margin-top: 1px;
  color: var(--color-subtle);
}

.activity-log__text {
  flex: 1;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.5;
  word-break: break-all;
}

.activity-log__empty {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  color: var(--color-subtle);
  font-size: 11px;
}
</style>
