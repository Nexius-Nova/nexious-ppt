<script setup lang="ts">
import { ref } from 'vue';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiInput from '@/components/ui/UiInput.vue';
import { useToastStore } from '@/stores/toastStore';
import { useAgentStore } from '@/stores/agentStore';
import type { ConfigOptionKey } from '@/types/agent';

const toastStore = useToastStore();
const store = useAgentStore();

const paramDefs: Array<{ key: ConfigOptionKey; label: string; description: string }> = [
  {
    key: 'summaryLength',
    label: '摘要长度',
    description: '控制内容提炼的详略程度。'
  },
  {
    key: 'tone',
    label: '语言风格',
    description: '控制标题、正文和讲稿的表达口吻。'
  },
  {
    key: 'imageStyle',
    label: '图像风格',
    description: '控制需要配图时的画面方向。'
  }
];

const addingLabels = ref<Record<ConfigOptionKey, string>>({
  summaryLength: '',
  tone: '',
  imageStyle: ''
});
const editingOption = ref<{ key: ConfigOptionKey; value: string } | null>(null);
const editingLabel = ref('');

function startEdit(key: ConfigOptionKey, value: string, label: string) {
  editingOption.value = { key, value };
  editingLabel.value = label;
}

function cancelEdit() {
  editingOption.value = null;
  editingLabel.value = '';
}

function saveEdit() {
  if (!editingOption.value) return;
  const label = editingLabel.value.trim();
  if (!label) {
    toastStore.warning('名称不能为空', '请输入一个清晰的配置名称');
    return;
  }
  store.updateConfigOption(editingOption.value.key, editingOption.value.value, label);
  cancelEdit();
}

function addOption(key: ConfigOptionKey) {
  const label = addingLabels.value[key].trim();
  if (!label) {
    toastStore.warning('名称不能为空', '请输入要添加的配置名称');
    return;
  }
  store.addConfigOption(key, label);
  addingLabels.value[key] = '';
}

function deleteOption(key: ConfigOptionKey, value: string) {
  if (store.configOptions[key].length <= 1) return;
  if (editingOption.value?.key === key && editingOption.value.value === value) {
    cancelEdit();
  }
  store.deleteConfigOption(key, value);
}
</script>

<template>
  <div class="config-page">
    <div class="page-header">
      <div class="page-header__info">
        <h2>运行配置</h2>
        <p>维护输入页可用的摘要、语言和图像选项，不改变当前 PPT 的已选设置。</p>
      </div>
    </div>

    <div class="param-list">
      <section
        v-for="def in paramDefs"
        :key="def.key"
        class="param-card"
      >
        <header class="param-card__header">
          <div class="param-card__info">
            <h3>{{ def.label }}</h3>
            <p>{{ def.description }}</p>
          </div>
          <UiBadge tone="neutral" size="sm">选项库</UiBadge>
        </header>

        <div class="setting-options" role="group" :aria-label="def.label">
          <div
            v-for="option in store.configOptions[def.key]"
            :key="option.value"
            class="setting-option"
          >
            <div
              v-if="!(editingOption?.key === def.key && editingOption.value === option.value)"
              class="setting-option__label"
            >
              <span>{{ option.label }}</span>
            </div>

            <div v-else class="setting-option__edit">
              <UiInput
                v-model="editingLabel"
                @keydown.enter.prevent="saveEdit"
                @keydown.esc.prevent="cancelEdit"
              />
              <button type="button" class="icon-button" title="保存" @click="saveEdit">
                <Check :size="14" />
              </button>
              <button type="button" class="icon-button" title="取消" @click="cancelEdit">
                <X :size="14" />
              </button>
            </div>

            <div
              v-if="!(editingOption?.key === def.key && editingOption.value === option.value)"
              class="setting-option__actions"
            >
              <button type="button" class="icon-button" title="编辑" @click="startEdit(def.key, option.value, option.label)">
                <Pencil :size="13" />
              </button>
              <button
                type="button"
                class="icon-button icon-button--danger"
                title="删除"
                :disabled="store.configOptions[def.key].length <= 1"
                @click="deleteOption(def.key, option.value)"
              >
                <Trash2 :size="13" />
              </button>
            </div>
          </div>
        </div>

        <form class="add-option" @submit.prevent="addOption(def.key)">
          <UiInput
            v-model="addingLabels[def.key]"
            :placeholder="`添加${def.label}`"
          />
          <UiButton type="submit" variant="secondary">
            <Plus :size="14" />
            添加
          </UiButton>
        </form>
      </section>
    </div>
  </div>
</template>

<style scoped>
.config-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
  padding: 20px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.page-header__info h2 {
  margin: 0;
  color: var(--color-text);
  font-size: 24px;
  font-weight: 700;
}

.page-header__info p {
  margin: 6px 0 0;
  color: var(--color-subtle);
  font-size: 14px;
  line-height: 1.6;
}

.param-list {
  display: grid;
  gap: 12px;
}

.param-card {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.param-card:hover {
  border-color: var(--color-border-strong);
}

.param-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.param-card__info h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 15px;
  font-weight: 700;
}

.param-card__info p {
  margin: 5px 0 0;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.6;
}

.setting-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.setting-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  max-width: 100%;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-card);
  color: var(--color-muted);
  transition: border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
}

.setting-option:hover {
  border-color: var(--color-border-strong);
}

.setting-option__label {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  min-height: 28px;
  padding: 0 8px;
  color: inherit;
  font-size: 13px;
  font-weight: 600;
}

.setting-option__label span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.setting-option__actions,
.setting-option__edit {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.setting-option__edit {
  min-width: 240px;
}

.icon-button {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
  transition: border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
}

.icon-button:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.icon-button--danger:hover:not(:disabled) {
  border-color: var(--color-danger);
  color: var(--color-danger);
  background: var(--color-danger-soft);
}

.icon-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.add-option {
  display: grid;
  grid-template-columns: minmax(180px, 320px) auto;
  gap: 8px;
  align-items: center;
}

@media (max-width: 760px) {
  .add-option {
    grid-template-columns: 1fr;
  }

  .setting-option,
  .setting-option__edit {
    width: 100%;
  }

  .setting-option__label {
    flex: 1;
  }
}
</style>
