<script setup lang="ts">
import { ref } from 'vue';
import { Check, Pencil, Plus, Send, Trash2 } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiField from '@/components/ui/UiField.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiTextarea from '@/components/ui/UiTextarea.vue';
import type { PromptDefinition } from '@/types/agent';

const props = defineProps<{
  prompts: PromptDefinition[];
}>();

const emit = defineEmits<{
  add: [value: { title: string; scene: string; content: string }];
  update: [id: string, value: { title: string; scene: string; content: string }];
  delete: [id: string];
  apply: [id: string];
}>();

const form = ref({
  title: '',
  scene: '',
  content: ''
});
const editingId = ref<string | null>(null);
const editingForm = ref({
  title: '',
  scene: '',
  content: ''
});

function addPrompt() {
  if (!form.value.title.trim() || !form.value.content.trim()) return;
  emit('add', { ...form.value });
  form.value = { title: '', scene: '', content: '' };
}

function startEdit(prompt: PromptDefinition) {
  editingId.value = prompt.id;
  editingForm.value = {
    title: prompt.title,
    scene: prompt.scene,
    content: prompt.content
  };
}

function saveEdit() {
  if (!editingId.value) return;
  emit('update', editingId.value, { ...editingForm.value });
  editingId.value = null;
}
</script>

<template>
  <div class="prompt-manager">
    <UiCard title="提示词管理" subtitle="沉淀不同场景的生成提示词，并可一键应用到当前 PPT。">
      <div class="prompt-list">
        <article v-for="prompt in prompts" :key="prompt.id" class="prompt-card">
          <template v-if="editingId === prompt.id">
            <UiField label="名称">
              <UiInput v-model="editingForm.title" />
            </UiField>
            <UiField label="场景">
              <UiInput v-model="editingForm.scene" />
            </UiField>
            <UiField label="内容">
              <UiTextarea v-model="editingForm.content" :rows="4" />
            </UiField>
            <div class="prompt-card__actions">
              <UiButton size="sm" variant="ghost" @click="editingId = null">取消</UiButton>
              <UiButton size="sm" variant="primary" @click="saveEdit">
                <Check :size="13" />
                保存
              </UiButton>
            </div>
          </template>

          <template v-else>
            <div class="prompt-card__top">
              <div>
                <h4>{{ prompt.title }}</h4>
                <p>{{ prompt.scene || '通用场景' }}</p>
              </div>
              <span>{{ new Date(prompt.updatedAt).toLocaleDateString('zh-CN') }}</span>
            </div>
            <p class="prompt-card__content">{{ prompt.content }}</p>
            <div class="prompt-card__actions">
              <UiButton size="sm" variant="secondary" @click="$emit('apply', prompt.id)">
                <Send :size="13" />
                应用
              </UiButton>
              <button class="icon-button" title="编辑提示词" @click="startEdit(prompt)">
                <Pencil :size="14" />
              </button>
              <button class="icon-button icon-button--danger" title="删除提示词" @click="$emit('delete', prompt.id)">
                <Trash2 :size="14" />
              </button>
            </div>
          </template>
        </article>
      </div>
    </UiCard>

    <UiCard title="新增提示词" subtitle="适合沉淀汇报、路演、培训等场景模板。">
      <div class="prompt-form">
        <UiField label="名称" required>
          <UiInput v-model="form.title" placeholder="例如：季度经营复盘" />
        </UiField>
        <UiField label="场景">
          <UiInput v-model="form.scene" placeholder="例如：管理层汇报 / 客户提案" />
        </UiField>
        <UiField label="内容" required>
          <UiTextarea v-model="form.content" :rows="5" placeholder="描述结构要求、语言风格、页面重点和输出边界" />
        </UiField>
        <UiButton variant="primary" block :disabled="!form.title.trim() || !form.content.trim()" @click="addPrompt">
          <Plus :size="15" />
          添加提示词
        </UiButton>
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.prompt-manager {
  display: grid;
  gap: 16px;
}

.prompt-list,
.prompt-form {
  display: grid;
  gap: 12px;
}

.prompt-card {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
}

.prompt-card__top,
.prompt-card__actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.prompt-card__top h4 {
  margin: 0;
  color: var(--color-text);
  font-size: 14px;
}

.prompt-card__top p,
.prompt-card__content,
.prompt-card__top span {
  margin: 4px 0 0;
  color: var(--color-subtle);
  font-size: 12px;
  line-height: 1.5;
}

.prompt-card__actions {
  justify-content: flex-end;
  align-items: center;
}

.icon-button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
}

.icon-button:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

.icon-button--danger:hover {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}
</style>
