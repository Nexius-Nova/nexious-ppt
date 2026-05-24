<script setup lang="ts">
import { computed, ref } from 'vue';
import { Check, FilePlus2, Layers, Pencil, Trash2 } from 'lucide-vue-next';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiField from '@/components/ui/UiField.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiTextarea from '@/components/ui/UiTextarea.vue';
import type { PptProject, PptTemplate } from '@/types/agent';

const props = defineProps<{
  projects: PptProject[];
  templates: PptTemplate[];
  activeId: string | null;
}>();

const emit = defineEmits<{
  add: [value: { title: string; topic: string; description: string; templateId: string }];
  update: [id: string, value: Partial<Pick<PptProject, 'title' | 'topic' | 'description' | 'templateId'>>];
  delete: [id: string];
  select: [id: string];
}>();

const form = ref({
  title: '',
  topic: '',
  description: '',
  templateId: props.templates[0]?.id || ''
});
const editingId = ref<string | null>(null);
const editingForm = ref({
  title: '',
  topic: '',
  description: '',
  templateId: ''
});

const activeTemplate = computed(() => props.templates.find((template) => template.id === form.value.templateId));

function addProject() {
  if (!form.value.title.trim() && !form.value.topic.trim()) return;
  emit('add', { ...form.value });
  form.value = {
    title: '',
    topic: '',
    description: '',
    templateId: form.value.templateId
  };
}

function startEdit(project: PptProject) {
  editingId.value = project.id;
  editingForm.value = {
    title: project.title,
    topic: project.topic,
    description: project.description,
    templateId: project.templateId
  };
}

function saveEdit() {
  if (!editingId.value) return;
  emit('update', editingId.value, { ...editingForm.value });
  editingId.value = null;
}

function useTemplate(templateId: string) {
  form.value.templateId = templateId;
}
</script>

<template>
  <div class="deck-library">
    <UiCard title="我的 PPT" subtitle="先添加或选择 PPT 项目，再运行生成流程。">
      <template #actions>
        <UiBadge :tone="activeId ? 'success' : 'warning'">{{ activeId ? '已选择' : '待添加' }}</UiBadge>
      </template>

      <div class="deck-library__form">
        <UiField label="PPT 名称" required>
          <UiInput v-model="form.title" placeholder="例如：智能硬件品牌年度增长计划" />
        </UiField>
        <UiField label="主题">
          <UiInput v-model="form.topic" placeholder="用于生成大纲的核心主题" />
        </UiField>
        <UiField label="资料摘要">
          <UiTextarea v-model="form.description" :rows="4" placeholder="粘贴背景信息、关键观点、会议纪要或生成要求" />
        </UiField>
        <div class="deck-library__selected-template">
          <Layers :size="14" />
          <span>当前模板：{{ activeTemplate?.name || '未选择模板' }}</span>
        </div>
        <UiButton variant="primary" block :disabled="!form.title.trim() && !form.topic.trim()" @click="addProject">
          <FilePlus2 :size="15" />
          添加 PPT
        </UiButton>
      </div>

      <div class="deck-library__projects">
        <article
          v-for="project in projects"
          :key="project.id"
          class="project-card"
          :class="{ 'project-card--active': project.id === activeId }"
        >
          <template v-if="editingId === project.id">
            <UiField label="PPT 名称">
              <UiInput v-model="editingForm.title" />
            </UiField>
            <UiField label="主题">
              <UiInput v-model="editingForm.topic" />
            </UiField>
            <UiField label="资料摘要">
              <UiTextarea v-model="editingForm.description" :rows="3" />
            </UiField>
            <div class="project-card__actions">
              <UiButton size="sm" variant="ghost" @click="editingId = null">取消</UiButton>
              <UiButton size="sm" variant="primary" @click="saveEdit">
                <Check :size="13" />
                保存
              </UiButton>
            </div>
          </template>

          <template v-else>
            <div class="project-card__top">
              <div>
                <h4>{{ project.title }}</h4>
                <p>{{ project.topic || '未填写主题' }}</p>
              </div>
              <UiBadge v-if="project.id === activeId" tone="success" size="sm">当前</UiBadge>
            </div>
            <p class="project-card__desc">{{ project.description || '暂无资料摘要' }}</p>
            <div class="project-card__actions">
              <UiButton size="sm" variant="secondary" @click="$emit('select', project.id)">选择</UiButton>
              <button class="icon-button" title="编辑 PPT" @click="startEdit(project)">
                <Pencil :size="14" />
              </button>
              <button class="icon-button icon-button--danger" title="删除 PPT" @click="$emit('delete', project.id)">
                <Trash2 :size="14" />
              </button>
            </div>
          </template>
        </article>

        <div v-if="projects.length === 0" class="deck-library__empty">
          还没有 PPT 项目。添加一个项目后，生成按钮会进入完整流程。
        </div>
      </div>
    </UiCard>

    <UiCard title="示例模板" subtitle="选择模板会同步到新建 PPT，生成时沿用系统参数。">
      <div class="template-grid">
        <article
          v-for="template in templates"
          :key="template.id"
          class="template-card"
          :class="{ 'template-card--active': form.templateId === template.id }"
          @click="useTemplate(template.id)"
        >
          <div class="template-card__preview">
            <span :style="{ background: template.accent }" />
            <div />
            <div />
          </div>
          <div class="template-card__content">
            <div class="template-card__top">
              <strong>{{ template.name }}</strong>
              <UiBadge tone="neutral" size="sm">{{ template.category }}</UiBadge>
            </div>
            <p>{{ template.description }}</p>
            <span>{{ template.slideCount }} 页示例结构</span>
          </div>
        </article>
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.deck-library {
  display: grid;
  gap: 16px;
}

.deck-library__form {
  display: grid;
  gap: 14px;
}

.deck-library__selected-template {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-muted);
  font-size: 12px;
}

.deck-library__projects {
  display: grid;
  gap: 10px;
  margin-top: 16px;
}

.project-card,
.template-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  padding: 12px;
  transition: all var(--transition-fast);
}

.project-card--active,
.template-card--active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.project-card__top,
.project-card__actions,
.template-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.project-card__top h4 {
  margin: 0;
  color: var(--color-text);
  font-size: 14px;
}

.project-card__top p,
.project-card__desc,
.template-card p {
  margin: 4px 0 0;
  color: var(--color-subtle);
  font-size: 12px;
  line-height: 1.5;
}

.project-card__desc {
  margin: 10px 0;
}

.project-card__actions {
  align-items: center;
  justify-content: flex-end;
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

.deck-library__empty {
  padding: 16px;
  border: 1px dashed var(--color-border-strong);
  border-radius: 8px;
  color: var(--color-subtle);
  font-size: 13px;
  text-align: center;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.template-card {
  cursor: pointer;
}

.template-card__preview {
  display: grid;
  gap: 8px;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  padding: 12px;
}

.template-card__preview span {
  width: 42%;
  height: 8px;
  border-radius: 4px;
}

.template-card__preview div {
  height: 7px;
  border-radius: 4px;
  background: var(--color-border);
}

.template-card__content {
  margin-top: 10px;
}

.template-card__top strong {
  color: var(--color-text);
  font-size: 13px;
}

.template-card__content span {
  display: inline-block;
  margin-top: 8px;
  color: var(--color-muted);
  font-size: 11px;
}

@media (max-width: 760px) {
  .template-grid {
    grid-template-columns: 1fr;
  }
}
</style>
