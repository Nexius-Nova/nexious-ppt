<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  Bot,
  Loader2,
  RefreshCw,
  SendHorizonal,
  Sparkles,
  User,
  X
} from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import UiButton from '@/components/ui/UiButton.vue';
import DeleteConfirmModal from '@/components/common/DeleteConfirmModal.vue';
import { useAgentStore } from '@/stores/agentStore';
import { chatService, type ChatMessage } from '@/services/chatService';
import { parseSlideActions } from '@/composables/slideActionHelpers';

const props = defineProps<{
  projectId: string;
  projectTitle?: string;
}>();

const store = useAgentStore();
const {
  outline,
  parameters,
  activeStep,
  activePptId,
  isRunning,
  isPaused,
  pauseRequested,
  steps,
  images,
  svgPages,
  prompts,
  selectedPromptId,
  templates,
  selectedTemplate,
  skills,
  enabledSkills,
  designSpec
} = storeToRefs(store);

type PetMood = 'idle' | 'running' | 'paused' | 'error' | 'success';
type ConfirmTarget =
  | { type: 'image'; slideId: string; title: string }
  | { type: 'page'; pageNumber: number; title: string };

const isOpen = ref(false);
const messages = ref<ChatMessage[]>([]);
const inputText = ref('');
const isLoading = ref(false);
const actionRunning = ref('');
const messagesContainer = ref<HTMLDivElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const confirmTarget = ref<ConfirmTarget | null>(null);
const versions = ref<Array<{ id: string; label?: string; timestamp: number; slideCount: number }>>([]);
const petPosition = ref({ x: 0, y: 0 });
const viewportSize = ref({ width: 1280, height: 720 });
const petReady = ref(false);
const petBubbleAwake = ref(false);
const suppressNextFabClick = ref(false);
let petBubbleTimer: number | null = null;
let petDragState:
  | {
      pointerId: number;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
      moved: boolean;
    }
  | null = null;
const deleteConfirmMessage = computed(() => {
  if (!confirmTarget.value) return '';
  if (confirmTarget.value.type === 'page') {
    return `确定删除第 ${confirmTarget.value.pageNumber} 页「${confirmTarget.value.title}」吗？删除后页码会重新整理。`;
  }
  return `确定删除图片「${confirmTarget.value.title}」吗？`;
});

const currentStep = computed(() => steps.value.find((step) => step.id === activeStep.value));
const hasStepError = computed(() => steps.value.some((step) => step.status === 'idle' && step.progress > 0 && step.progress < 100));
const petMood = computed<PetMood>(() => {
  if (isPaused.value || pauseRequested.value) return 'paused';
  if (isRunning.value || currentStep.value?.status === 'running') return 'running';
  if (hasStepError.value) return 'error';
  if (activeStep.value === 'preview' && svgPages.value.length > 0) return 'success';
  return 'idle';
});
const petStatusText = computed(() => {
  if (petMood.value === 'running') return `${currentStep.value?.title || '工作流'}处理中`;
  if (petMood.value === 'paused') return '工作流已暂停';
  if (petMood.value === 'error') return '需要处理异常';
  if (petMood.value === 'success') return 'PPT 已生成';
  return '随时待命';
});
const petHint = computed(() => {
  if (petMood.value === 'running') return '我会跟着流程变化';
  if (petMood.value === 'paused') return '可继续或调整后重试';
  if (petMood.value === 'error') return '可以让我重试单页';
  if (petMood.value === 'success') return '可保存、导出或微调页面';
  return '模板、提示词、Skill 都能从这里控制';
});
const workflowSignal = computed(() =>
  [
    activeStep.value,
    petMood.value,
    isRunning.value ? 'running' : 'idle',
    isPaused.value ? 'paused' : 'normal',
    pauseRequested.value ? 'pause-requested' : 'no-pause-request',
    steps.value.map((step) => `${step.id}:${step.status}`).join('|')
  ].join('::')
);
const showPetBubble = computed(() => petBubbleAwake.value && !isOpen.value);
const petFabStyle = computed(() => ({
  transform: `translate3d(${petPosition.value.x}px, ${petPosition.value.y}px, 0)`,
  opacity: petReady.value ? '1' : '0'
}));
const petBubbleSide = computed(() =>
  petPosition.value.x > viewportSize.value.width / 2 ? 'left' : 'right'
);
const assistantPanelStyle = computed(() => {
  const width = Math.min(420, Math.max(300, viewportSize.value.width - 32));
  const height = Math.min(580, Math.max(360, viewportSize.value.height - 48));
  const opensLeft = petPosition.value.x > viewportSize.value.width / 2;
  const preferredX = opensLeft ? petPosition.value.x - width + 76 : petPosition.value.x;
  const preferredY = petPosition.value.y - height + 72;
  return {
    left: `${clamp(preferredX, 16, viewportSize.value.width - width - 16)}px`,
    top: `${clamp(preferredY, 16, viewportSize.value.height - height - 16)}px`,
    width: `${width}px`,
    height: `${height}px`
  };
});
const slideOptions = computed(() => {
  const source = designSpec.value?.outline.length ? designSpec.value.outline : outline.value.map((slide, index) => ({
    ...slide,
    pageNumber: index + 1
  }));
  return source.map((slide) => ({
    label: `第 ${slide.pageNumber} 页：${slide.title}`,
    value: slide.id,
    pageNumber: slide.pageNumber,
    title: slide.title
  }));
});
const suggestionChips = computed(() => {
  const chips: Array<{ label: string; text: string }> = [];
  const prompt = prompts.value.find((item) => item.id === selectedPromptId.value);
  const firstPrompt = prompt || prompts.value[0];
  const firstTemplate = selectedTemplate.value || templates.value[0];
  const imageTarget = images.value.find((image) => image.error || !image.url) || images.value[0];
  const pageTarget = slideOptions.value.find((slide) => svgPages.value.some((page) => page.pageNumber === slide.pageNumber)) || slideOptions.value[0];

  if (firstPrompt) chips.push({ label: '调整提示词', text: `帮我使用提示词「${firstPrompt.title}」` });
  if (firstTemplate) chips.push({ label: '调整模板', text: `帮我使用参考模板「${firstTemplate.name}」` });
  chips.push({ label: '调整参数', text: '帮我把生成参数调整得更适合当前 PPT' });
  if (imageTarget) chips.push({ label: '重试图片', text: `帮我重试图片：${imageTarget.title}` });
  if (pageTarget) chips.push({ label: '修改页面', text: `帮我修改第 ${pageTarget.pageNumber} 页的 SVG 页面内容` });
  if (versions.value.length) chips.push({ label: '切换版本', text: '帮我切换到最近的历史版本' });
  chips.push({ label: isPaused.value ? '继续工作流' : '暂停工作流', text: isPaused.value ? '继续当前 PPT 工作流' : '暂停当前 PPT 工作流' });
  chips.push({ label: '保存 PPT', text: '帮我保存并导出当前 PPT' });
  return chips.slice(0, 8);
});

onMounted(() => {
  updateViewportSize();
  resetPetPosition();
  window.addEventListener('resize', handleViewportResize);
  window.addEventListener('pointermove', handlePetPointerMove);
  window.addEventListener('pointerup', handlePetPointerUp);
  window.addEventListener('pointercancel', handlePetPointerUp);
  addWelcomeMessage();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleViewportResize);
  window.removeEventListener('pointermove', handlePetPointerMove);
  window.removeEventListener('pointerup', handlePetPointerUp);
  window.removeEventListener('pointercancel', handlePetPointerUp);
  clearPetBubbleTimer();
});

watch(
  () => props.projectId,
  () => {
    isOpen.value = false;
    isLoading.value = false;
    actionRunning.value = '';
    inputText.value = '';
    versions.value = [];
    confirmTarget.value = null;
    messages.value = [];
    addWelcomeMessage();
  }
);

watch(isOpen, (open) => {
  if (open) {
    petBubbleAwake.value = false;
    void loadVersions();
  }
});

watch(
  workflowSignal,
  (_next, previous) => {
    if (!previous || isOpen.value) return;
    wakePetBubble();
  }
);

function addWelcomeMessage() {
  messages.value.push({
    role: 'assistant',
    content: `你好，我是这个 PPT 的桌面助手。现在可以帮你切换模板和提示词、调整参数，也能重试图片或单页 SVG、保存、暂停/继续、切换版本。Skill 只会在你明确选择后参与生成。删除图片或页面前我会先确认。`
  });
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
}

function toggle() {
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    nextTick(() => inputRef.value?.focus());
    scrollToBottom();
  }
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function updateViewportSize() {
  if (typeof window === 'undefined') return;
  viewportSize.value = {
    width: window.innerWidth,
    height: window.innerHeight
  };
}

function resetPetPosition() {
  const x = viewportSize.value.width - 112;
  const y = viewportSize.value.height - 112;
  petPosition.value = {
    x: clamp(x, 12, viewportSize.value.width - 88),
    y: clamp(y, 12, viewportSize.value.height - 88)
  };
  petReady.value = true;
}

function clampPetPosition(x: number, y: number) {
  return {
    x: clamp(x, 12, viewportSize.value.width - 88),
    y: clamp(y, 12, viewportSize.value.height - 88)
  };
}

function handleViewportResize() {
  updateViewportSize();
  petPosition.value = clampPetPosition(petPosition.value.x, petPosition.value.y);
}

function clearPetBubbleTimer() {
  if (petBubbleTimer) {
    window.clearTimeout(petBubbleTimer);
    petBubbleTimer = null;
  }
}

function wakePetBubble() {
  petBubbleAwake.value = true;
  clearPetBubbleTimer();
  petBubbleTimer = window.setTimeout(() => {
    petBubbleAwake.value = false;
    petBubbleTimer = null;
  }, 3600);
}

function startPetDrag(event: PointerEvent) {
  if (isOpen.value || event.button !== 0) return;
  petDragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: petPosition.value.x,
    originY: petPosition.value.y,
    moved: false
  };
}

function handlePetPointerMove(event: PointerEvent) {
  if (!petDragState || event.pointerId !== petDragState.pointerId) return;
  const deltaX = event.clientX - petDragState.startX;
  const deltaY = event.clientY - petDragState.startY;
  if (Math.abs(deltaX) + Math.abs(deltaY) > 4) {
    petDragState.moved = true;
    suppressNextFabClick.value = true;
  }
  petPosition.value = clampPetPosition(
    petDragState.originX + deltaX,
    petDragState.originY + deltaY
  );
}

function handlePetPointerUp(event: PointerEvent) {
  if (!petDragState || event.pointerId !== petDragState.pointerId) return;
  if (petDragState.moved) {
    window.setTimeout(() => {
      suppressNextFabClick.value = false;
    }, 180);
  }
  petDragState = null;
}

function handleFabClick() {
  if (suppressNextFabClick.value) {
    suppressNextFabClick.value = false;
    return;
  }
  toggle();
}

function isCurrentProject(projectId: string) {
  return props.projectId === projectId && activePptId.value === projectId;
}

function buildContext() {
  return {
    projectId: props.projectId,
    projectTitle: props.projectTitle || '',
    currentStep: activeStep.value,
    totalSlides: outline.value.length,
    slideTitles: outline.value.map(s => s.title),
    parameters: { ...parameters.value },
    selectedPrompt: prompts.value.find((prompt) => prompt.id === selectedPromptId.value)?.title || '无',
    selectedTemplate: selectedTemplate.value?.name || '无',
    enabledSkills: enabledSkills.value.map((skill) => skill.name),
    generatedImages: images.value.map((image) => ({ slideId: image.slideId, title: image.title, ready: Boolean(image.url && !image.error) })),
    svgPages: svgPages.value.map((page) => page.pageNumber)
  };
}

async function sendMessage() {
  const text = inputText.value.trim();
  if (!text || isLoading.value) return;
  const requestProjectId = props.projectId;

  inputText.value = '';
  messages.value.push({ role: 'user', content: text });
  scrollToBottom();

  isLoading.value = true;
  const assistantMessage: ChatMessage = { role: 'assistant', content: '' };
  messages.value.push(assistantMessage);
  scrollToBottom();

  try {
    await chatService.sendMessage(
      messages.value.slice(-20),
      buildContext(),
      {
        onContent: (text) => {
          if (!isCurrentProject(requestProjectId)) return;
          assistantMessage.content = text;
          scrollToBottom();
        },
        onComplete: (text) => {
          if (!isCurrentProject(requestProjectId)) return;
          assistantMessage.content = text;
          scrollToBottom();
          void processActions(text, requestProjectId);
        },
        onError: () => {
          if (!isCurrentProject(requestProjectId)) return;
          assistantMessage.content = '抱歉，AI 回复失败。请检查模型配置后重试。';
        }
      }
    );
  } catch {
    if (isCurrentProject(requestProjectId)) {
      assistantMessage.content = '抱歉，AI 回复失败。请检查模型配置后重试。';
    }
  } finally {
    if (isCurrentProject(requestProjectId)) {
      isLoading.value = false;
      scrollToBottom();
    }
  }
}

async function processActions(text: string, projectId: string) {
  if (!isCurrentProject(projectId)) return;
  const actions = parseSlideActions(text);
  if (actions.length === 0) return;

  for (const action of actions.slice(0, 1)) {
    const confirm = toConfirmTarget(action);
    if (confirm) {
      confirmTarget.value = confirm;
      pushAssistantMessage(`需要确认后再执行：${confirm.type === 'image' ? `删除图片「${confirm.title}」` : `删除第 ${confirm.pageNumber} 页「${confirm.title}」`}`);
      return;
    }
    const feedback = await store.executeChatAction(action, projectId);
    if (feedback) pushAssistantMessage(feedback);
  }
}

function toConfirmTarget(action: { type: string; params: Record<string, string> }): ConfirmTarget | null {
  const type = action.type;
  if (type !== 'deleteImage' && type !== 'delete_image' && type !== 'deletePage' && type !== 'delete_page') return null;
  if (type === 'deleteImage' || type === 'delete_image') {
    const pageNumber = Number.parseInt(action.params.pageNumber || action.params.page || action.params.index || '', 10);
    const slideId = action.params.slideId || slideOptions.value.find((slide) => slide.pageNumber === pageNumber)?.value || '';
    const image = images.value.find((item) => item.slideId === slideId || item.id === slideId);
    if (!slideId || !image) return null;
    return { type: 'image', slideId, title: image.title };
  }
  const pageNumber = Number.parseInt(action.params.pageNumber || action.params.page || action.params.index || '', 10);
  const slide = slideOptions.value.find((item) => item.pageNumber === pageNumber);
  if (!slide) return null;
  return { type: 'page', pageNumber, title: slide.title };
}

function pushAssistantMessage(content: string) {
  messages.value.push({ role: 'assistant', content: `已处理：${content}` });
  scrollToBottom();
}

async function runAction(label: string, task: () => Promise<string | null | void>) {
  if (actionRunning.value) return;
  actionRunning.value = label;
  try {
    const result = await task();
    if (result) pushAssistantMessage(result);
  } finally {
    actionRunning.value = '';
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

function clearHistory() {
  messages.value = [];
  addWelcomeMessage();
}

function sendSuggestion(text: string) {
  if (isLoading.value) return;
  inputText.value = text;
  void sendMessage();
}

async function loadVersions() {
  if (!activePptId.value) return;
  versions.value = await store.getVersions(activePptId.value);
}

async function confirmDelete() {
  if (!confirmTarget.value) return;
  const target = confirmTarget.value;
  await runAction('delete', async () => {
    const feedback = target.type === 'image'
      ? store.deleteSlideImage(target.slideId)
      : store.deleteSvgPage(target.pageNumber);
    confirmTarget.value = null;
    return feedback || '未找到要删除的内容';
  });
}

</script>

<template>
  <button
    v-if="!isOpen"
    class="pet-fab"
    :class="`pet-fab--${petMood}`"
    :style="petFabStyle"
    type="button"
    title="AI PPT 桌面助手"
    @pointerdown="startPetDrag"
    @click="handleFabClick"
  >
    <span class="pet-fab__halo" />
    <span class="pet-fab__body">
      <span class="pet-fab__tab" />
      <span class="pet-fab__wing pet-fab__wing--left" />
      <span class="pet-fab__wing pet-fab__wing--right" />
      <span class="pet-fab__screen">
        <span class="pet-fab__spark" />
        <span class="pet-fab__eyes">
          <span />
          <span />
        </span>
        <span class="pet-fab__smile" />
        <span class="pet-fab__chart">
          <span />
          <span />
          <span />
        </span>
      </span>
      <span class="pet-fab__status-light" />
      <span class="pet-fab__feet">
        <span />
        <span />
      </span>
    </span>
    <span
      class="pet-fab__bubble"
      :class="[
        `pet-fab__bubble--${petBubbleSide}`,
        { 'pet-fab__bubble--awake': showPetBubble }
      ]"
    >
      <strong>{{ petStatusText }}</strong>
      <small>{{ petHint }}</small>
    </span>
  </button>

  <Transition name="chat-slide">
    <div v-if="isOpen" class="assistant-panel" :style="assistantPanelStyle">
      <div class="assistant-header">
        <div class="assistant-header__pet" :class="`assistant-header__pet--${petMood}`">
          <Bot :size="18" />
        </div>
        <div class="assistant-header__title">
          <span>AI PPT 桌面助手</span>
          <small>{{ projectTitle || '当前 PPT' }} · {{ petStatusText }}</small>
        </div>
        <button class="assistant-icon-btn" type="button" title="关闭" @click="toggle">
          <X :size="16" />
        </button>
      </div>

      <div class="assistant-body">
        <section ref="messagesContainer" class="chat-messages">
          <div class="chat-suggestions">
            <button
              v-for="chip in suggestionChips"
              :key="chip.label"
              type="button"
              class="chat-suggestion"
              :disabled="isLoading"
              @click="sendSuggestion(chip.text)"
            >
              <Sparkles :size="12" />
              <span>{{ chip.label }}</span>
            </button>
          </div>
          <div v-for="(msg, i) in messages" :key="i" class="chat-msg" :class="`chat-msg--${msg.role}`">
            <div class="chat-msg__avatar">
              <component :is="msg.role === 'user' ? User : Bot" :size="14" />
            </div>
            <div class="chat-msg__bubble">
              <pre class="chat-msg__text">{{ msg.content }}</pre>
            </div>
          </div>
          <div v-if="isLoading" class="chat-msg chat-msg--assistant">
            <div class="chat-msg__avatar">
              <Bot :size="14" />
            </div>
            <div class="chat-msg__bubble chat-msg__bubble--loading">
              <Loader2 :size="14" class="animate-spin" />
              <span>思考中...</span>
            </div>
          </div>
        </section>
      </div>

      <div class="chat-input-area">
        <button class="assistant-icon-btn" type="button" title="清空对话" @click="clearHistory">
          <RefreshCw :size="14" />
        </button>
        <input
          ref="inputRef"
          v-model="inputText"
          class="chat-input"
          placeholder="告诉我你想调整的页面、图片或生成设置..."
          :disabled="isLoading"
          @keydown="onKeydown"
        />
        <button
          class="chat-send-btn"
          :class="{ 'chat-send-btn--active': inputText.trim() }"
          :disabled="!inputText.trim() || isLoading"
          @click="sendMessage"
        >
          <SendHorizonal :size="16" />
        </button>
      </div>
    </div>
  </Transition>

  <DeleteConfirmModal
    :open="Boolean(confirmTarget)"
    :loading="actionRunning === 'delete'"
    :item-name="confirmTarget?.title || ''"
    :message="deleteConfirmMessage"
    @close="confirmTarget = null"
    @confirm="confirmDelete"
  />
</template>

<style scoped>
.pet-fab {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 9990;
  display: flex;
  align-items: center;
  gap: 10px;
  border: none;
  background: transparent;
  color: var(--color-text);
  touch-action: none;
  user-select: none;
  cursor: pointer;
  transition: opacity 0.12s ease;
}

.pet-fab:active {
  cursor: grabbing;
}

.pet-fab__halo {
  position: absolute;
  left: 4px;
  bottom: -4px;
  width: 74px;
  height: 74px;
  border-radius: 22px;
  background: var(--color-accent-soft);
  animation: pet-pulse 1.8s ease-in-out infinite;
}

.pet-fab__body {
  position: relative;
  display: block;
  flex: 0 0 auto;
  width: 76px;
  height: 70px;
  border: 2px solid var(--color-accent);
  border-radius: 18px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
  transform-origin: 50% 100%;
}

.pet-fab__tab {
  position: absolute;
  right: 8px;
  top: -9px;
  width: 24px;
  height: 14px;
  border: 2px solid var(--color-accent);
  border-bottom: 0;
  border-radius: 10px 10px 0 0;
  background: var(--color-accent);
}

.pet-fab__screen {
  position: absolute;
  inset: 9px 9px 10px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-panel);
}

.pet-fab__spark {
  position: absolute;
  left: 8px;
  top: 7px;
  width: 10px;
  height: 10px;
}

.pet-fab__spark::before,
.pet-fab__spark::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 0;
  width: 2px;
  height: 10px;
  border-radius: 99px;
  background: var(--color-accent);
}

.pet-fab__spark::after {
  transform: rotate(90deg);
}

.pet-fab__eyes {
  position: absolute;
  top: 15px;
  left: 50%;
  display: flex;
  gap: 12px;
  transform: translateX(-50%);
}

.pet-fab__eyes span {
  width: 6px;
  height: 8px;
  border-radius: 99px;
  background: var(--color-text);
}

.pet-fab__smile {
  position: absolute;
  top: 26px;
  left: 50%;
  width: 18px;
  height: 8px;
  border-bottom: 2px solid var(--color-accent);
  border-radius: 0 0 99px 99px;
  transform: translateX(-50%);
}

.pet-fab__chart {
  position: absolute;
  right: 8px;
  bottom: 7px;
  display: flex;
  align-items: end;
  gap: 2px;
  height: 13px;
}

.pet-fab__chart span {
  width: 4px;
  border-radius: 3px 3px 0 0;
  background: var(--color-accent);
}

.pet-fab__chart span:nth-child(1) {
  height: 6px;
}

.pet-fab__chart span:nth-child(2) {
  height: 10px;
}

.pet-fab__chart span:nth-child(3) {
  height: 8px;
}

.pet-fab__status-light {
  position: absolute;
  left: -5px;
  top: 12px;
  width: 10px;
  height: 10px;
  border: 2px solid var(--color-surface);
  border-radius: 50%;
  background: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.pet-fab__wing {
  position: absolute;
  top: 36px;
  width: 14px;
  height: 22px;
  border: 2px solid var(--color-accent);
  border-radius: 12px;
  background: var(--color-surface);
}

.pet-fab__wing--left {
  left: -10px;
  transform: rotate(-18deg);
}

.pet-fab__wing--right {
  right: -10px;
  transform: rotate(18deg);
}

.pet-fab__feet {
  position: absolute;
  left: 50%;
  bottom: -7px;
  display: flex;
  gap: 12px;
  transform: translateX(-50%);
}

.pet-fab__feet span {
  width: 15px;
  height: 7px;
  border-radius: 999px;
  background: var(--color-accent);
}

.pet-fab__bubble {
  position: absolute;
  top: 8px;
  display: grid;
  gap: 2px;
  width: max-content;
  max-width: 184px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
  text-align: left;
  opacity: 0;
  pointer-events: none;
  transform: translateY(4px) scale(0.98);
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.pet-fab__bubble--right {
  left: 88px;
}

.pet-fab__bubble--left {
  right: 88px;
}

.pet-fab:hover .pet-fab__bubble,
.pet-fab:focus-visible .pet-fab__bubble,
.pet-fab__bubble--awake {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0) scale(1);
}

.pet-fab__bubble strong,
.pet-fab__bubble small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pet-fab__bubble strong {
  font-size: 13px;
}

.pet-fab__bubble small {
  color: var(--color-muted);
  font-size: 11px;
}

.pet-fab--running .pet-fab__body {
  animation: pet-waddle 1.05s ease-in-out infinite;
}

.pet-fab--running .pet-fab__status-light {
  animation: pet-blink 0.9s ease-in-out infinite;
}

.pet-fab--paused .pet-fab__halo {
  background: var(--color-warning-soft);
  animation-play-state: paused;
}

.pet-fab--paused .pet-fab__status-light,
.pet-fab--paused .pet-fab__tab {
  background: var(--color-warning);
}

.pet-fab--error .pet-fab__halo {
  background: var(--color-danger-soft);
}

.pet-fab--error .pet-fab__status-light,
.pet-fab--error .pet-fab__tab {
  background: var(--color-danger);
}

.pet-fab--success .pet-fab__halo {
  background: var(--color-success-soft);
}

.pet-fab--success .pet-fab__status-light,
.pet-fab--success .pet-fab__tab {
  background: var(--color-success);
}

.assistant-panel {
  position: fixed;
  z-index: 9990;
  display: flex;
  flex-direction: column;
  overflow: visible;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
}

.assistant-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-panel);
}

.assistant-header__pet {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 12px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.assistant-header__pet--running {
  animation: pet-bob 1.2s ease-in-out infinite;
}

.assistant-header__pet--paused {
  background: var(--color-warning-soft);
  color: var(--color-warning);
}

.assistant-header__pet--error {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}

.assistant-header__pet--success {
  background: var(--color-success-soft);
  color: var(--color-success);
}

.assistant-header__title {
  display: grid;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.assistant-header__title span,
.assistant-header__title small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-header__title span {
  font-size: 14px;
  font-weight: 700;
}

.assistant-header__title small {
  color: var(--color-muted);
  font-size: 11px;
}

.assistant-icon-btn {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.assistant-icon-btn:hover {
  border-color: var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
}

.assistant-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  padding: 12px;
  border-radius: 0 0 14px 14px;
}

.chat-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 2px 0 4px 36px;
}

.chat-suggestion {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.chat-suggestion:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.chat-suggestion:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.chat-messages {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  flex: 1;
  overflow-y: auto;
}

.chat-msg {
  display: flex;
  gap: 8px;
  max-width: 95%;
}

.chat-msg--user {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.chat-msg--assistant {
  align-self: flex-start;
}

.chat-msg__avatar {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  margin-top: 2px;
}

.chat-msg--user .chat-msg__avatar {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.chat-msg--assistant .chat-msg__avatar {
  background: var(--color-info-soft);
  color: var(--color-info);
}

.chat-msg__bubble {
  min-width: 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--color-panel);
  color: var(--color-text);
  font-size: 13px;
  line-height: 1.5;
}

.chat-msg--user .chat-msg__bubble {
  background: var(--color-accent);
  color: var(--color-inverse);
}

.chat-msg__text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: inherit;
}

.chat-msg__bubble--loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-muted);
}

.chat-input-area {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--color-border);
  background: var(--color-panel);
}

.chat-input {
  flex: 1;
  min-width: 0;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: 13px;
  outline: none;
}

.chat-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.chat-send-btn {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 10px;
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.chat-send-btn--active,
.chat-send-btn:hover:not(:disabled) {
  background: var(--color-accent);
  color: var(--color-inverse);
}

.chat-send-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.chat-slide-enter-active,
.chat-slide-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.chat-slide-enter-from,
.chat-slide-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}

.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes pet-pulse {
  0%, 100% { transform: scale(0.96); opacity: 0.75; }
  50% { transform: scale(1.08); opacity: 1; }
}

@keyframes pet-blink {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(0.35); }
}

@keyframes pet-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}

@keyframes pet-waddle {
  0%, 100% { transform: rotate(0deg) translateY(0); }
  25% { transform: rotate(-2deg) translateY(-2px); }
  75% { transform: rotate(2deg) translateY(-2px); }
}

@media (max-width: 640px) {
  .pet-fab {
    gap: 0;
  }

  .pet-fab__bubble {
    top: auto;
    right: 0;
    bottom: 82px;
    left: auto;
    max-width: min(236px, calc(100vw - 28px));
  }

  .assistant-panel {
    max-width: calc(100vw - 20px);
    max-height: calc(100dvh - 20px);
  }
}
</style>
