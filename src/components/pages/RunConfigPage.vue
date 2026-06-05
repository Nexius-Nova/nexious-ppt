<script setup lang="ts">
import { ref } from 'vue';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-vue-next';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiButton from '@/components/ui/UiButton.vue';
import UiInput from '@/components/ui/UiInput.vue';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import type { ConfigOptionKey } from '@/types/agent';

const store = useAgentStore();
const toastStore = useToastStore();

const paramDefs: Array<{ key: ConfigOptionKey; label: string; description: string; example: string }> = [
  {
    key: 'slideCount',
    label: 'PPT 页数',
    description: '维护输入页可选择的目标页数。',
    example: '例如：8 页'
  },
  {
    key: 'summaryLength',
    label: '摘要长度',
    description: '维护内容提炼的详略程度。',
    example: '例如：精简版'
  },
  {
    key: 'tone',
    label: '语言风格',
    description: '维护标题、正文和讲稿的表达口吻。',
    example: '例如：商务汇报'
  },
  {
    key: 'imageStyle',
    label: '图像风格',
    description: '维护需要配图时的画面方向。',
    example: '例如：写实摄影'
  },
  {
    key: 'skillIntensity',
    label: '增强强度',
    description: '维护 Skill 扩展处理深度。',
    example: '例如：80'
  }
];

const addingLabels = ref<Record<ConfigOptionKey, string>>({
  slideCount: '',
  summaryLength: '',
  tone: '',
  imageStyle: '',
  skillIntensity: ''
});
const editingOption = ref<{ key: ConfigOptionKey; value: string } | null>(null);
const editingLabel = ref('');
const savingKey = ref<ConfigOptionKey | null>(null);

function startEdit(key: ConfigOptionKey, value: string, label: string) {
  editingOption.value = { key, value };
  editingLabel.value = label;
}

function cancelEdit() {
  editingOption.value = null;
  editingLabel.value = '';
}

async function saveEdit() {
  if (!editingOption.value || savingKey.value) return;
  const label = editingLabel.value.trim();
  if (!label) {
    toastStore.warning('名称不能为空', '请输入清晰的配置名称');
    return;
  }

  savingKey.value = editingOption.value.key;
  await store.updateConfigOption(editingOption.value.key, editingOption.value.value, label);
  savingKey.value = null;
  cancelEdit();
}

async function addOption(key: ConfigOptionKey) {
  if (savingKey.value) return;
  const label = addingLabels.value[key].trim();
  if (!label) {
    toastStore.warning('名称不能为空', '请输入要添加的配置名称');
    return;
  }

  savingKey.value = key;
  await store.addConfigOption(key, label);
  savingKey.value = null;
  addingLabels.value[key] = '';
}

async function deleteOption(key: ConfigOptionKey, value: string) {
  if (savingKey.value || store.configOptions[key].length <= 1) return;
  if (editingOption.value?.key === key && editingOption.value.value === value) {
    cancelEdit();
  }

  savingKey.value = key;
  await store.deleteConfigOption(key, value);
  savingKey.value = null;
}
</script>

<template>
  <div class="config-page">
    <header class="page-header">
      <div class="page-header__info">
        <h2>运行配置</h2>
        <p>管理 PPT 输入页的可选项。这里不改变当前项目已选择的参数，项目选择会独立保存。</p>
      </div>
      <UiBadge tone="info">选项管理</UiBadge>
    </header>

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
          <UiBadge tone="neutral" size="sm">{{ store.configOptions[def.key].length }} 项</UiBadge>
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
                :disabled="savingKey === def.key"
                @keydown.enter.prevent="saveEdit"
                @keydown.esc.prevent="cancelEdit"
              />
              <button type="button" class="icon-button" title="保存" :disabled="savingKey === def.key" @click="saveEdit">
                <Check :size="14" />
              </button>
              <button type="button" class="icon-button" title="取消" :disabled="savingKey === def.key" @click="cancelEdit">
                <X :size="14" />
              </button>
            </div>

            <div
              v-if="!(editingOption?.key === def.key && editingOption.value === option.value)"
              class="setting-option__actions"
            >
              <button type="button" class="icon-button" title="编辑" :disabled="savingKey === def.key" @click="startEdit(def.key, option.value, option.label)">
                <Pencil :size="13" />
              </button>
              <button
                type="button"
                class="icon-button icon-button--danger"
                title="删除"
                :disabled="savingKey === def.key || store.configOptions[def.key].length <= 1"
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
            :placeholder="def.example"
            :disabled="savingKey === def.key"
          />
          <UiButton type="submit" variant="secondary" size="sm" class="add-option__button" :loading="savingKey === def.key" title="添加选项">
            <Plus :size="14" />
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
  letter-spacing: 0;
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
  letter-spacing: 0;
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
  grid-template-columns: minmax(180px, 260px) 34px;
  gap: 8px;
  align-items: center;
  justify-content: start;
}

.add-option :deep(.ui-button) {
  width: 34px;
  min-width: 34px;
  height: 34px;
  min-height: 34px;
  padding: 0;
  border-radius: 8px;
}

@media (max-width: 760px) {
  .config-page {
    gap: 14px;
    padding: 14px;
  }

  .page-header {
    align-items: stretch;
    flex-direction: column;
  }

  .param-card__header {
    flex-direction: column;
  }

  .add-option {
    grid-template-columns: minmax(0, 1fr) 34px;
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
