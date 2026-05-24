<script setup lang="ts">
import { computed, ref } from 'vue';
import { BarChart3, Eye, GripVertical, Palette, Pencil, PlugZap, Plus, Trash2, Wand2 } from 'lucide-vue-next';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiField from '@/components/ui/UiField.vue';
import UiInput from '@/components/ui/UiInput.vue';
import UiTextarea from '@/components/ui/UiTextarea.vue';
import type { SkillDefinition } from '@/types/agent';

const skillIcons: Record<string, any> = {
  'speaker-notes': Wand2,
  'data-chart': BarChart3,
  'design-polish': Palette
};

const props = defineProps<{
  skills: SkillDefinition[];
}>();

const emit = defineEmits<{
  toggle: [id: string];
  run: [];
  add: [value: { name: string; description: string; params: Record<string, string> }];
  update: [id: string, value: Partial<Omit<SkillDefinition, 'id'>>];
  delete: [id: string];
  reorder: [fromIndex: number, toIndex: number];
}>();

const previewId = ref<string | null>(null);
const editingId = ref<string | null>(null);

// Drag & drop state
const dragSkillIndex = ref<number | null>(null);
const dropSkillIndex = ref<number | null>(null);

function onSkillDragStart(index: number, event: DragEvent) {
  dragSkillIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }
}

function onSkillDragOver(index: number, event: DragEvent) {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dropSkillIndex.value = index;
}

function onSkillDrop(index: number) {
  if (dragSkillIndex.value !== null && dragSkillIndex.value !== index) {
    emit('reorder', dragSkillIndex.value, index);
  }
  dragSkillIndex.value = null;
  dropSkillIndex.value = null;
}

function onSkillDragEnd() {
  dragSkillIndex.value = null;
  dropSkillIndex.value = null;
}

const newSkill = ref({
  name: '',
  description: '',
  params: 'mode:auto\nfocus:structure'
});
const editingForm = ref({
  name: '',
  description: '',
  params: ''
});

const previewSkill = computed(() => props.skills.find((skill) => skill.id === previewId.value) || null);

function parseParams(input: string) {
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, line) => {
      const [key, ...rest] = line.split(':');
      if (key && rest.length) {
        acc[key.trim()] = rest.join(':').trim();
      }
      return acc;
    }, {});
}

function stringifyParams(params: Record<string, string | number | boolean>) {
  return Object.entries(params)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join('\n');
}

function addSkill() {
  if (!newSkill.value.name.trim()) return;
  emit('add', {
    name: newSkill.value.name,
    description: newSkill.value.description,
    params: parseParams(newSkill.value.params)
  });
  newSkill.value = {
    name: '',
    description: '',
    params: 'mode:auto\nfocus:structure'
  };
}

function startEdit(skill: SkillDefinition) {
  editingId.value = skill.id;
  editingForm.value = {
    name: skill.name,
    description: skill.description,
    params: stringifyParams(skill.params)
  };
}

function saveEdit() {
  if (!editingId.value) return;
  emit('update', editingId.value, {
    name: editingForm.value.name,
    description: editingForm.value.description,
    params: parseParams(editingForm.value.params)
  });
  editingId.value = null;
}
</script>

<template>
  <div class="skill-board">
    <UiCard title="Skill 管理" subtitle="支持预览、添加、编辑、删除，并参与当前工作流。">
      <template #actions>
        <UiButton size="sm" variant="primary" @click="$emit('run')">运行 Skill</UiButton>
      </template>

      <div class="skill-board__grid">
        <article
          v-for="(skill, index) in skills"
          :key="skill.id"
          class="skill-card"
          :class="{
            'skill-card--enabled': skill.enabled,
            'skill-card--dragging': dragSkillIndex === index,
            'skill-card--drop-target': dropSkillIndex === index && dragSkillIndex !== index
          }"
          draggable="true"
          @dragstart="onSkillDragStart(index, $event)"
          @dragover="onSkillDragOver(index, $event)"
          @drop="onSkillDrop(index)"
          @dragend="onSkillDragEnd"
        >
          <template v-if="editingId === skill.id">
            <UiField label="Skill 名称">
              <UiInput v-model="editingForm.name" />
            </UiField>
            <UiField label="描述">
              <UiTextarea v-model="editingForm.description" :rows="3" />
            </UiField>
            <UiField label="参数">
              <UiTextarea v-model="editingForm.params" :rows="4" placeholder="每行一个 key: value" />
            </UiField>
            <div class="skill-card__actions">
              <UiButton size="sm" variant="ghost" @click="editingId = null">取消</UiButton>
              <UiButton size="sm" variant="primary" @click="saveEdit">保存</UiButton>
            </div>
          </template>

          <template v-else>
            <div class="skill-card__top">
              <div class="skill-card__name">
                <span class="skill-card__drag-handle">
                  <GripVertical :size="12" />
                </span>
                <component :is="skillIcons[skill.id] || PlugZap" :size="13" />
                <strong>{{ skill.name }}</strong>
              </div>
              <UiBadge :tone="skill.enabled ? 'accent' : 'neutral'" size="sm">#{{ skill.order }}</UiBadge>
            </div>
            <p>{{ skill.description }}</p>
            <div class="skill-card__params">
              <span v-for="(value, key) in skill.params" :key="key" class="skill-card__param">{{ key }}: {{ value }}</span>
            </div>
            <div class="skill-card__actions">
              <UiButton size="sm" :variant="skill.enabled ? 'secondary' : 'ghost'" @click="$emit('toggle', skill.id)">
                {{ skill.enabled ? '停用' : '启用' }}
              </UiButton>
              <button class="icon-button" title="预览 Skill" @click="previewId = skill.id">
                <Eye :size="14" />
              </button>
              <button class="icon-button" title="编辑 Skill" @click="startEdit(skill)">
                <Pencil :size="14" />
              </button>
              <button class="icon-button icon-button--danger" title="删除 Skill" @click="$emit('delete', skill.id)">
                <Trash2 :size="14" />
              </button>
            </div>
          </template>
        </article>
      </div>

      <div v-if="previewSkill" class="skill-preview">
        <div class="skill-preview__header">
          <strong>Skill 预览</strong>
          <UiButton size="sm" variant="text" @click="previewId = null">关闭</UiButton>
        </div>
        <h4>{{ previewSkill.name }}</h4>
        <p>{{ previewSkill.description }}</p>
        <div class="skill-card__params">
          <span v-for="(value, key) in previewSkill.params" :key="key" class="skill-card__param">{{ key }}: {{ value }}</span>
        </div>
      </div>
    </UiCard>

    <UiCard title="添加 Skill" subtitle="沿用系统卡片风格，使用参数文本快速录入。">
      <div class="skill-form">
        <UiField label="Skill 名称" required>
          <UiInput v-model="newSkill.name" placeholder="例如：内容精炼" />
        </UiField>
        <UiField label="描述">
          <UiTextarea v-model="newSkill.description" :rows="3" placeholder="描述这个 Skill 在 PPT 工作流里的作用" />
        </UiField>
        <UiField label="参数">
          <UiTextarea v-model="newSkill.params" :rows="4" placeholder="每行一个 key: value" />
        </UiField>
        <UiButton variant="primary" block :disabled="!newSkill.name.trim()" @click="addSkill">
          <Plus :size="15" />
          添加 Skill
        </UiButton>
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.skill-board {
  display: grid;
  gap: 16px;
}

.skill-board__grid {
  display: grid;
  gap: 10px;
}

.skill-card {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  transition: all var(--transition-fast);
}

.skill-card--enabled {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.skill-card__top,
.skill-card__actions,
.skill-preview__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.skill-card__name {
  display: flex;
  align-items: center;
  gap: 8px;
}

.skill-card__drag-handle {
  display: grid;
  place-items: center;
  color: var(--color-muted);
  opacity: 0;
  cursor: grab;
  transition: opacity var(--transition-fast);
}

.skill-card:hover .skill-card__drag-handle {
  opacity: 0.5;
}

.skill-card__drag-handle:active {
  cursor: grabbing;
}

.skill-card--dragging {
  opacity: 0.4;
}

.skill-card--drop-target {
  border-color: var(--color-accent) !important;
  box-shadow: 0 0 0 2px var(--color-accent-soft);
}

.skill-card__name strong,
.skill-preview h4 {
  color: var(--color-text);
  font-size: 13px;
  font-weight: 600;
  margin: 0;
}

.skill-card p,
.skill-preview p {
  margin: 0;
  color: var(--color-subtle);
  font-size: 12px;
  line-height: 1.5;
}

.skill-card__params {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.skill-card__param {
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 11px;
  font-family: var(--font-mono);
}

.skill-card__actions {
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

.skill-preview {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}

.skill-form {
  display: grid;
  gap: 14px;
}
</style>
