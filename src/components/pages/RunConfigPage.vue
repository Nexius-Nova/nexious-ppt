<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { Save, RotateCcw, Plus, Trash2, Edit3 } from 'lucide-vue-next';
import UiCard from '@/components/ui/UiCard.vue';
import UiButton from '@/components/ui/UiButton.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiSelect from '@/components/ui/UiSelect.vue';
import UiField from '@/components/ui/UiField.vue';
import UiBadge from '@/components/ui/UiBadge.vue';
import { useToastStore } from '@/stores/toastStore';
import { configApi, type RunConfig } from '@/services/api';

const toastStore = useToastStore();

const parameters = ref<RunConfig[]>([]);
const loading = ref(false);
const showModal = ref(false);
const editingParam = ref<RunConfig | null>(null);
const formData = ref({
  name: '',
  key: '',
  type: 'string' as 'string' | 'number' | 'select' | 'boolean',
  value: '',
  description: '',
  min_value: undefined as number | undefined,
  max_value: undefined as number | undefined,
  optionsText: ''
});

const originalParameters = ref<RunConfig[]>([]);

const hasChanges = computed(() => {
  return JSON.stringify(parameters.value) !== JSON.stringify(originalParameters.value);
});

async function fetchConfigs() {
  loading.value = true;
  try {
    const response = await configApi.getAll();
    if (response.success && response.data) {
      parameters.value = response.data;
      originalParameters.value = JSON.parse(JSON.stringify(response.data));
    }
  } catch (error) {
    console.error('Failed to fetch configs:', error);
  } finally {
    loading.value = false;
  }
}

function openCreateModal() {
  editingParam.value = null;
  formData.value = {
    name: '',
    key: '',
    type: 'string',
    value: '',
    description: '',
    min_value: undefined,
    max_value: undefined,
    optionsText: ''
  };
  showModal.value = true;
}

function openEditModal(param: RunConfig) {
  editingParam.value = param;
  formData.value = {
    name: param.name,
    key: param.key,
    type: param.type,
    value: param.value,
    description: param.description || '',
    min_value: param.min_value || undefined,
    max_value: param.max_value || undefined,
    optionsText: param.options?.map(o => `${o.value}:${o.label}`).join('\n') || ''
  };
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
  editingParam.value = null;
}

async function saveParameter() {
  if (!formData.value.name.trim() || !formData.value.key.trim()) {
    toastStore.warning('请填写完整信息', '名称和键名不能为空');
    return;
  }

  const options = formData.value.type === 'select' && formData.value.optionsText
    ? formData.value.optionsText.split('\n').map(line => {
        const [value, label] = line.split(':');
        return { value: value.trim(), label: (label || value).trim() };
      }).filter(o => o.value)
    : [];

  loading.value = true;
  try {
    if (editingParam.value) {
      const response = await configApi.update(editingParam.value.id, {
        name: formData.value.name,
        key: formData.value.key,
        type: formData.value.type,
        value: formData.value.value,
        options,
        min_value: formData.value.min_value,
        max_value: formData.value.max_value,
        description: formData.value.description
      });
      if (response.success) {
        toastStore.success('保存成功', '参数已更新');
        await fetchConfigs();
      }
    } else {
      const response = await configApi.create({
        name: formData.value.name,
        key: formData.value.key,
        type: formData.value.type,
        value: formData.value.value,
        options,
        min_value: formData.value.min_value,
        max_value: formData.value.max_value,
        description: formData.value.description
      });
      if (response.success) {
        toastStore.success('添加成功', '新参数已添加');
        await fetchConfigs();
      }
    }
    closeModal();
  } catch (error) {
    toastStore.error('操作失败', error instanceof Error ? error.message : '未知错误');
  } finally {
    loading.value = false;
  }
}

async function deleteParameter(param: RunConfig) {
  if (!confirm(`确定要删除参数「${param.name}」吗？`)) return;
  
  try {
    const response = await configApi.delete(param.id);
    if (response.success) {
      toastStore.success('删除成功', '参数已删除');
      await fetchConfigs();
    }
  } catch (error) {
    toastStore.error('删除失败', error instanceof Error ? error.message : '未知错误');
  }
}

async function saveConfig() {
  loading.value = true;
  try {
    for (const param of parameters.value) {
      await configApi.update(param.id, {
        name: param.name,
        key: param.key,
        type: param.type,
        value: param.value,
        options: param.options,
        min_value: param.min_value || undefined,
        max_value: param.max_value || undefined,
        description: param.description || ''
      });
    }
    originalParameters.value = JSON.parse(JSON.stringify(parameters.value));
    toastStore.success('保存成功', '运行配置已更新');
  } catch (error) {
    toastStore.error('保存失败', error instanceof Error ? error.message : '未知错误');
  } finally {
    loading.value = false;
  }
}

async function resetConfig() {
  parameters.value = JSON.parse(JSON.stringify(originalParameters.value));
  toastStore.info('已重置', '配置已恢复到上次保存的状态');
}

async function resetToDefault() {
  if (!confirm('确定要恢复默认配置吗？这将删除所有自定义参数。')) return;
  
  loading.value = true;
  try {
    const response = await configApi.reset();
    if (response.success && response.data) {
      parameters.value = response.data;
      originalParameters.value = JSON.parse(JSON.stringify(response.data));
      toastStore.success('已重置', '配置已恢复为默认值');
    }
  } catch (error) {
    toastStore.error('重置失败', error instanceof Error ? error.message : '未知错误');
  } finally {
    loading.value = false;
  }
}

function getTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    string: '文本',
    number: '数字',
    select: '选项',
    boolean: '布尔'
  };
  return labels[type] || type;
}

onMounted(() => {
  fetchConfigs();
});
</script>

<template>
  <div class="config-page">
    <div class="page-header">
      <div class="page-header__info">
        <h2>运行配置</h2>
        <p>自定义 PPT 生成的各项参数</p>
      </div>
      <div class="page-header__actions">
        <UiButton variant="secondary" @click="openCreateModal">
          <Plus :size="14" />
          添加参数
        </UiButton>
        <UiButton v-if="hasChanges" variant="secondary" @click="resetConfig">
          <RotateCcw :size="14" />
          重置
        </UiButton>
        <UiButton :disabled="!hasChanges || loading" @click="saveConfig">
          <Save :size="14" />
          保存配置
        </UiButton>
      </div>
    </div>

    <div v-if="loading && parameters.length === 0" class="loading-state">
      加载中...
    </div>

    <div v-else class="param-list">
      <div
        v-for="param in parameters"
        :key="param.id"
        class="param-card"
      >
        <div class="param-card__header">
          <div class="param-card__info">
            <h4>{{ param.name }}</h4>
            <div class="param-card__meta">
              <UiBadge tone="neutral" size="sm">{{ param.key }}</UiBadge>
              <UiBadge tone="info" size="sm">{{ getTypeLabel(param.type) }}</UiBadge>
            </div>
          </div>
          <div class="param-card__actions">
            <button class="btn-icon" title="编辑" @click="openEditModal(param)">
              <Edit3 :size="14" />
            </button>
            <button class="btn-icon btn-icon--danger" title="删除" @click="deleteParameter(param)">
              <Trash2 :size="14" />
            </button>
          </div>
        </div>

        <div class="param-card__body">
          <p v-if="param.description" class="param-card__description">{{ param.description }}</p>
          
          <div class="param-card__value">
            <template v-if="param.type === 'number'">
              <div class="number-input">
                <input
                  v-model.number="param.value"
                  type="range"
                  :min="param.min_value ?? undefined"
                  :max="param.max_value ?? undefined"
                  class="slider"
                />
                <div class="number-value">
                  <span class="value">{{ param.value }}</span>
                  <span v-if="param.min_value !== null && param.max_value !== null" class="range">
                    ({{ param.min_value }} - {{ param.max_value }})
                  </span>
                </div>
              </div>
            </template>

            <template v-else-if="param.type === 'select'">
              <div class="select-grid">
                <button
                  v-for="opt in param.options"
                  :key="opt.value"
                  class="select-option"
                  :class="{ 'select-option--active': param.value === opt.value }"
                  @click="param.value = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </template>

            <template v-else-if="param.type === 'boolean'">
              <div class="toggle-switch">
                <button
                  class="toggle-btn"
                  :class="{ 'toggle-btn--active': param.value === 'true' }"
                  @click="param.value = param.value === 'true' ? 'false' : 'true'"
                >
                  {{ param.value === 'true' ? '开启' : '关闭' }}
                </button>
              </div>
            </template>

            <template v-else>
              <input
                v-model="param.value"
                type="text"
                class="text-input"
                :placeholder="`输入 ${param.name}`"
              />
            </template>
          </div>
        </div>
      </div>
    </div>

    <div class="config-footer">
      <UiButton variant="secondary" @click="resetToDefault">
        恢复默认配置
      </UiButton>
      <UiButton :disabled="!hasChanges || loading" @click="saveConfig">
        <Save :size="14" />
        保存配置
      </UiButton>
    </div>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
        <div class="modal">
          <div class="modal__header">
            <h3>{{ editingParam ? '编辑参数' : '添加参数' }}</h3>
            <button class="modal__close" @click="closeModal">×</button>
          </div>
          <div class="modal__body">
            <div class="form-grid">
              <UiField label="参数名称" required>
                <UiInput
                  v-model="formData.name"
                  placeholder="例如：PPT 页数"
                />
              </UiField>

              <UiField label="参数键名" required>
                <UiInput
                  v-model="formData.key"
                  placeholder="例如：slideCount"
                />
              </UiField>
            </div>

            <UiField label="参数类型">
              <UiSelect
                v-model="formData.type"
                :options="[
                  { value: 'string', label: '文本' },
                  { value: 'number', label: '数字' },
                  { value: 'select', label: '选项' },
                  { value: 'boolean', label: '布尔' }
                ]"
              />
            </UiField>

            <UiField v-if="formData.type === 'number'" label="数值范围">
              <div class="range-inputs">
                <input
                  v-model.number="formData.min_value"
                  type="number"
                  class="range-input"
                  placeholder="最小值"
                />
                <span class="range-separator">-</span>
                <input
                  v-model.number="formData.max_value"
                  type="number"
                  class="range-input"
                  placeholder="最大值"
                />
              </div>
            </UiField>

            <UiField v-if="formData.type === 'select'" label="选项列表">
              <textarea
                v-model="formData.optionsText"
                class="options-textarea"
                placeholder="每行一个选项，格式：值:标签&#10;例如：&#10;concise:简洁&#10;balanced:均衡&#10;detailed:详细"
                rows="4"
              ></textarea>
            </UiField>

            <UiField label="默认值">
              <UiInput
                v-model="formData.value"
                :placeholder="formData.type === 'number' ? '输入数字' : '输入默认值'"
              />
            </UiField>

            <UiField label="描述">
              <textarea
                v-model="formData.description"
                class="description-textarea"
                placeholder="参数的用途说明"
                rows="2"
              ></textarea>
            </UiField>
          </div>
          <div class="modal__footer">
            <UiButton variant="secondary" @click="closeModal">取消</UiButton>
            <UiButton :disabled="loading" @click="saveParameter">
              {{ editingParam ? '保存' : '添加' }}
            </UiButton>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.config-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px;
  width: 100%;
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
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text);
}

.page-header__info p {
  margin: 4px 0 0;
  font-size: 14px;
  color: var(--color-subtle);
}

.page-header__actions {
  display: flex;
  gap: 8px;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px;
  color: var(--color-muted);
}

.param-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.param-card {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  overflow: hidden;
  transition: all var(--transition-fast);
}

.param-card:hover {
  border-color: var(--color-border-strong);
}

.param-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--color-border);
}

.param-card__info h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

.param-card__meta {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.param-card__actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.param-card:hover .param-card__actions {
  opacity: 1;
}

.btn-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-icon:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.btn-icon--danger:hover {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.param-card__body {
  padding: 16px;
}

.param-card__description {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--color-muted);
}

.param-card__value {
  margin-top: 8px;
}

.number-input {
  display: flex;
  align-items: center;
  gap: 16px;
}

.slider {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--color-border);
  appearance: none;
  cursor: pointer;
}

.slider::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-accent);
  cursor: pointer;
  transition: transform var(--transition-fast);
}

.slider::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

.number-value {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 80px;
}

.number-value .value {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text);
  font-family: var(--font-mono);
}

.number-value .range {
  font-size: 12px;
  color: var(--color-muted);
}

.select-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.select-option {
  padding: 8px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.select-option:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.select-option--active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.toggle-switch {
  display: flex;
}

.toggle-btn {
  padding: 8px 20px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.toggle-btn--active {
  border-color: var(--color-accent);
  background: var(--color-accent);
  color: white;
}

.text-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  color: var(--color-text);
  font-size: 13px;
  transition: all var(--transition-fast);
}

.text-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.config-footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  width: 100%;
  max-width: 520px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
}

.modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
}

.modal__header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
}

.modal__close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  font-size: 20px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.modal__close:hover {
  background: var(--color-panel);
  color: var(--color-text);
}

.modal__body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.modal__footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 16px 20px;
  border-top: 1px solid var(--color-border);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.range-inputs {
  display: flex;
  align-items: center;
  gap: 8px;
}

.range-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  color: var(--color-text);
  font-size: 13px;
  transition: all var(--transition-fast);
}

.range-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.range-separator {
  color: var(--color-muted);
}

.options-textarea,
.description-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  color: var(--color-text);
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
  font-family: inherit;
  transition: all var(--transition-fast);
}

.options-textarea:focus,
.description-textarea:focus {
  outline: none;
  border-color: var(--color-accent);
}
</style>
