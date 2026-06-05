<script setup lang="ts">
import { ref, nextTick, watch, onMounted } from 'vue';
import { MessageCircle, X, SendHorizonal, Bot, User, Loader2 } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { useAgentStore } from '@/stores/agentStore';
import { chatService, type ChatMessage } from '@/services/chatService';
import { parseSlideActions } from '@/composables/slideActionHelpers';

const props = defineProps<{
  projectId: string;
  projectTitle?: string;
}>();

const store = useAgentStore();
const { outline, parameters, activeStep, activePptId } = storeToRefs(store);

const isOpen = ref(false);
const messages = ref<ChatMessage[]>([]);
const inputText = ref('');
const isLoading = ref(false);
const messagesContainer = ref<HTMLDivElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);

onMounted(() => {
  addWelcomeMessage();
});

watch(
  () => props.projectId,
  () => {
    isOpen.value = false;
    isLoading.value = false;
    inputText.value = '';
    messages.value = [];
    addWelcomeMessage();
  }
);

function addWelcomeMessage() {
  messages.value.push({
    role: 'assistant',
    content: `你好！我是 AI PPT 助手，当前只会操作「${props.projectTitle || '当前 PPT'}」。\n\n• 修改幻灯片标题和内容\n• 添加或删除要点\n• 回答本 PPT 相关问题\n\n你可以直接说"把第3页标题改为xxx"或"为第1页添加一个要点"。`
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

function buildContext() {
  return {
    projectId: props.projectId,
    projectTitle: props.projectTitle || '',
    currentStep: activeStep.value,
    totalSlides: outline.value.length,
    slideTitles: outline.value.map(s => s.title),
    parameters: { ...parameters.value }
  };
}

async function sendMessage() {
  const text = inputText.value.trim();
  if (!text || isLoading.value) return;
  const requestProjectId = props.projectId;

  inputText.value = '';
  const userMessage: ChatMessage = { role: 'user', content: text };
  messages.value.push(userMessage);
  scrollToBottom();

  isLoading.value = true;

  const assistantMessage: ChatMessage = { role: 'assistant', content: '' };
  messages.value.push(assistantMessage);
  scrollToBottom();

  try {
    const fullText = await chatService.sendMessage(
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
          processActions(text, requestProjectId);
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

function isCurrentProject(projectId: string) {
  return props.projectId === projectId && activePptId.value === projectId;
}

function processActions(text: string, projectId: string) {
  if (!isCurrentProject(projectId)) return;
  const actions = parseSlideActions(text);
  if (actions.length === 0) return;

  const action = actions[0];
  const feedback = store.executeChatAction(action, projectId);
  if (feedback) {
    const actionMsg: ChatMessage = {
      role: 'assistant',
      content: `✅ ${feedback}`
    };
    messages.value.push(actionMsg);
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
</script>

<template>
  <!-- Floating chat button -->
  <button v-if="!isOpen" class="chat-fab" @click="toggle" title="AI 助手">
    <MessageCircle :size="22" />
  </button>

  <!-- Chat panel -->
  <Transition name="chat-slide">
    <div v-if="isOpen" class="chat-panel">
      <!-- Header -->
      <div class="chat-header">
        <div class="chat-header__info">
          <Bot :size="16" />
          <div class="chat-header__title">
            <span>AI PPT 助手</span>
            <small>当前仅操作：{{ projectTitle || '当前 PPT' }}</small>
          </div>
        </div>
        <div class="chat-header__actions">
          <button class="chat-header-btn" title="清空对话" @click="clearHistory">⟳</button>
          <button class="chat-header-btn" title="关闭" @click="toggle">
            <X :size="14" />
          </button>
        </div>
      </div>

      <!-- Messages -->
      <div ref="messagesContainer" class="chat-messages">
        <div
          v-for="(msg, i) in messages"
          :key="i"
          class="chat-msg"
          :class="`chat-msg--${msg.role}`"
        >
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

        <div v-if="messages.length === 1" class="chat-hint">
          <p>💡 试试这样说：</p>
          <button class="hint-chip" @click="inputText = '把第3页标题改为xxx'; sendMessage()">修改标题</button>
          <button class="hint-chip" @click="inputText = '为第1页添加一个要点'; sendMessage()">添加要点</button>
          <button class="hint-chip" @click="inputText = '帮我优化第2页的内容'; sendMessage()">优化内容</button>
        </div>
      </div>

      <!-- Input -->
      <div class="chat-input-area">
        <input
          ref="inputRef"
          v-model="inputText"
          class="chat-input"
          placeholder="输入消息..."
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
</template>

<style scoped>
/* ---- FAB ---- */
.chat-fab {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 9990;
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border: none;
  border-radius: 50%;
  background: var(--color-accent);
  color: var(--color-inverse);
  cursor: pointer;
  box-shadow: var(--shadow-panel);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.chat-fab:hover {
  transform: scale(1.06);
  box-shadow: var(--shadow-lg);
}

/* ---- Panel ---- */
.chat-panel {
  position: fixed;
  bottom: 80px;
  right: 24px;
  z-index: 9990;
  width: 380px;
  height: 520px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

/* ---- Header ---- */
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-panel);
}

.chat-header__info {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-accent);
  font-size: 14px;
  font-weight: 600;
  min-width: 0;
}

.chat-header__title {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.chat-header__title span,
.chat-header__title small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-header__title small {
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 500;
}

.chat-header__actions {
  display: flex;
  gap: 4px;
}

.chat-header-btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  font-size: 14px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.chat-header-btn:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

/* ---- Messages ---- */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  min-width: 0;
}

.chat-msg--user .chat-msg__bubble {
  background: var(--color-accent);
  color: var(--color-inverse);
  border-bottom-right-radius: 4px;
}

.chat-msg--assistant .chat-msg__bubble {
  background: var(--color-panel);
  color: var(--color-text);
  border-bottom-left-radius: 4px;
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

.chat-hint {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 4px;
}

.chat-hint p {
  width: 100%;
  margin: 0 0 4px;
  font-size: 11px;
  color: var(--color-subtle);
}

.hint-chip {
  padding: 4px 10px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-muted);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.hint-chip:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

/* ---- Input ---- */
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
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color var(--transition-fast);
}

.chat-input:focus {
  border-color: var(--color-accent);
}

.chat-input:disabled {
  opacity: 0.5;
}

.chat-send-btn {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.chat-send-btn--active {
  background: var(--color-accent);
  color: var(--color-inverse);
}

.chat-send-btn:hover:not(:disabled) {
  background: var(--color-accent);
  color: var(--color-inverse);
}

.chat-send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ---- Animations ---- */
.chat-slide-enter-active {
  transition: all 0.2s ease-out;
}

.chat-slide-leave-active {
  transition: all 0.15s ease-in;
}

.chat-slide-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}

.chat-slide-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}

.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 640px) {
  .chat-fab {
    right: 16px;
    bottom: 80px;
  }

  .chat-panel {
    right: 12px;
    bottom: 76px;
    left: 12px;
    width: auto;
    height: min(560px, calc(100dvh - 104px));
  }
}
</style>
