<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { MoveHorizontal, RefreshCw, ShieldCheck, X } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';
import { authApi, type AuthCaptchaChallenge } from '@/services/api';
import { useToastStore } from '@/stores/toastStore';

const props = withDefaults(
  defineProps<{
    show: boolean;
    email: string;
    reloadKey?: number;
  }>(),
  {
    reloadKey: 0
  }
);

const emit = defineEmits<{
  close: [];
  verified: [captchaToken: string];
}>();

const toastStore = useToastStore();
const challenge = ref<AuthCaptchaChallenge | null>(null);
const loading = ref(false);
const verifying = ref(false);
const sliderX = ref(18);
const dragging = ref(false);
const dragOffset = ref(0);
const trackRef = ref<HTMLElement | null>(null);
const CAPTCHA_WIDTH = 320;
const CAPTCHA_HEIGHT = 170;
const DEFAULT_PIECE_SIZE = 48;
const THUMB_WIDTH = 38;

const prompt = computed(() => challenge.value?.prompt || '请完成图片行为验证码');
const isSlider = computed(() => challenge.value?.type === 'slider');
const sliderChallenge = computed(() => challenge.value?.type === 'slider' ? challenge.value : null);
const isBusy = computed(() => loading.value || verifying.value);
const pieceSize = computed(() => sliderChallenge.value?.pieceSize ?? DEFAULT_PIECE_SIZE);
const sliderMax = computed(() => Math.max(0, (sliderChallenge.value?.trackWidth ?? CAPTCHA_WIDTH) - pieceSize.value));
const sliderRatio = computed(() => sliderMax.value > 0 ? sliderX.value / sliderMax.value : 0);
const thumbLeft = computed(() => `calc(${(sliderRatio.value * 100).toFixed(4)}% - ${(sliderRatio.value * THUMB_WIDTH).toFixed(2)}px)`);
const pieceStyle = computed(() => {
  const pieceY = sliderChallenge.value?.pieceY ?? 72;
  return {
    left: `${((sliderX.value / CAPTCHA_WIDTH) * 100).toFixed(4)}%`,
    top: `${((pieceY / CAPTCHA_HEIGHT) * 100).toFixed(4)}%`,
    width: `${((pieceSize.value / CAPTCHA_WIDTH) * 100).toFixed(4)}%`
  };
});

function resetChallenge() {
  challenge.value = null;
  sliderX.value = 18;
  dragging.value = false;
  dragOffset.value = 0;
}

async function refreshCaptcha() {
  if (!props.show || loading.value) return;
  if (!props.email) {
    toastStore.warning('请先输入有效邮箱');
    return;
  }

  loading.value = true;
  resetChallenge();
  try {
    const response = await authApi.createCaptcha(props.email);
    if (!response.success || !response.data) {
      toastStore.error('验证码加载失败', response.message || undefined);
      return;
    }
    challenge.value = response.data;
    if (response.data.type === 'slider') {
      await nextTick();
      sliderX.value = response.data.initialX;
    }
  } finally {
    loading.value = false;
  }
}

async function verifyPosition(x: number, y?: number) {
  if (!challenge.value || verifying.value) return;
  verifying.value = true;
  try {
    const response = await authApi.verifyCaptcha({
      email: props.email,
      challengeId: challenge.value.challengeId,
      x,
      y
    });

    if (!response.success || !response.data?.captchaToken) {
      toastStore.warning(response.message || '验证码未通过');
      if (response.status === 400) await refreshCaptcha();
      return;
    }

    emit('verified', response.data.captchaToken);
  } finally {
    verifying.value = false;
  }
}

function handleClickCaptcha(event: MouseEvent) {
  if (!challenge.value || challenge.value.type !== 'click' || isBusy.value) return;
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 320;
  const y = ((event.clientY - rect.top) / rect.height) * 170;
  void verifyPosition(x, y);
}

function updateSliderFromPointer(event: PointerEvent) {
  const track = trackRef.value;
  if (!track) return;
  const rect = track.getBoundingClientRect();
  const usableWidth = Math.max(1, rect.width - THUMB_WIDTH);
  const nextRatio = (event.clientX - rect.left - dragOffset.value) / usableWidth;
  sliderX.value = Math.min(sliderMax.value, Math.max(0, nextRatio * sliderMax.value));
}

function startSliderDrag(event: PointerEvent) {
  if (!sliderChallenge.value || isBusy.value) return;
  const target = event.currentTarget as HTMLElement;
  dragging.value = true;
  const rect = target.getBoundingClientRect();
  dragOffset.value = Math.min(THUMB_WIDTH, Math.max(0, event.clientX - rect.left));
  target.setPointerCapture?.(event.pointerId);
  updateSliderFromPointer(event);
}

function moveSlider(event: PointerEvent) {
  if (!dragging.value || isBusy.value) return;
  updateSliderFromPointer(event);
}

function endSliderDrag(event: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  const target = event.currentTarget as HTMLElement;
  target.releasePointerCapture?.(event.pointerId);
  void verifyPosition(sliderX.value);
}

function close() {
  if (isBusy.value) return;
  emit('close');
}

watch(
  () => props.show,
  (show) => {
    if (show) {
      void refreshCaptcha();
      return;
    }
    resetChallenge();
  },
  { immediate: true }
);

watch(
  () => props.reloadKey,
  () => {
    if (props.show) void refreshCaptcha();
  }
);
</script>

<template>
  <Teleport to="body">
    <Transition name="auth-captcha-fade">
      <div v-if="show" class="auth-captcha" @click.self="close">
        <section class="auth-captcha__panel" role="dialog" aria-modal="true" aria-labelledby="auth-captcha-title">
          <header class="auth-captcha__header">
            <div class="auth-captcha__heading">
              <span><ShieldCheck :size="14" /> 安全验证</span>
            </div>
            <button type="button" class="auth-captcha__close" title="关闭" :disabled="isBusy" @click="close">
              <X :size="18" />
            </button>
          </header>

          <div class="auth-captcha__body">
            <button
              v-if="!isSlider"
              type="button"
              class="auth-captcha__image auth-captcha__image--click"
              :disabled="isBusy || !challenge"
              @click="handleClickCaptcha"
            >
              <span v-if="loading" class="auth-captcha__state">正在加载验证码...</span>
              <span v-else-if="verifying" class="auth-captcha__state">正在校验...</span>
              <span v-else-if="challenge" class="auth-captcha__svg" v-html="challenge.imageSvg" />
              <span v-else class="auth-captcha__state">验证码加载失败</span>
            </button>

            <div v-else class="auth-captcha__slider">
              <div class="auth-captcha__stage" :aria-busy="isBusy">
                <span class="auth-captcha__svg" v-html="sliderChallenge?.imageSvg" />
                <span class="auth-captcha__piece-layer">
                  <span
                    v-if="sliderChallenge"
                    class="auth-captcha__piece"
                    :style="pieceStyle"
                    v-html="sliderChallenge.pieceSvg"
                  />
                </span>
                <span v-if="loading || verifying" class="auth-captcha__stage-mask">
                  {{ loading ? '正在加载验证码...' : '正在校验...' }}
                </span>
              </div>

              <div
                ref="trackRef"
                class="auth-captcha__track"
                :class="{ 'auth-captcha__track--dragging': dragging }"
                :style="{ '--captcha-thumb-left': thumbLeft, '--captcha-track-progress': `calc(${(sliderRatio * 100).toFixed(4)}% + ${((1 - sliderRatio) * (THUMB_WIDTH / 2)).toFixed(2)}px)` }"
              >
                <button
                  type="button"
                  class="auth-captcha__thumb"
                  title="拖动滑块"
                  :disabled="isBusy"
                  @pointerdown.prevent="startSliderDrag"
                  @pointermove.prevent="moveSlider"
                  @pointerup.prevent="endSliderDrag"
                  @pointercancel.prevent="endSliderDrag"
                >
                  <MoveHorizontal :size="18" />
                </button>
                <span class="auth-captcha__track-label">拖动滑块完成拼图</span>
              </div>
            </div>
          </div>

          <footer class="auth-captcha__footer">
            <span>{{ isSlider ? '拖动拼图块到缺口位置后会自动校验。' : '点击正确图形后会自动校验。' }}</span>
            <UiButton type="button" size="sm" variant="secondary" :loading="loading" :disabled="verifying" @click="refreshCaptcha">
              <RefreshCw :size="13" />
              换一张
            </UiButton>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.auth-captcha {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  padding: 18px;
  background: var(--color-overlay);
}

.auth-captcha__panel {
  display: grid;
  gap: 14px;
  width: min(440px, calc(100vw - 28px));
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 18px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
}

.auth-captcha__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 36px;
  gap: 12px;
  align-items: start;
}

.auth-captcha__heading {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.auth-captcha__heading span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--color-accent);
  font-size: 12px;
  font-weight: 800;
}

.auth-captcha__heading h2 {
  margin: 0;
  color: var(--color-text);
  font-size: 16px;
  line-height: 1.35;
  word-break: break-word;
}

.auth-captcha__close {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
}

.auth-captcha__close:hover:not(:disabled) {
  border-color: var(--color-border-strong);
  background: var(--color-panel);
  color: var(--color-text);
}

.auth-captcha__close:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.auth-captcha__body {
  display: grid;
  gap: 12px;
}

.auth-captcha__image,
.auth-captcha__stage {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  overflow: hidden;
}

.auth-captcha__image {
  aspect-ratio: 320 / 170;
  padding: 0;
}

.auth-captcha__image--click {
  cursor: crosshair;
}

.auth-captcha__image:disabled {
  cursor: wait;
  opacity: 0.86;
}

.auth-captcha__slider {
  display: grid;
  gap: 12px;
}

.auth-captcha__stage {
  aspect-ratio: 320 / 170;
  padding: 0;
}

.auth-captcha__svg {
  display: block;
  width: 100%;
}

.auth-captcha__svg :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
}

.auth-captcha__piece-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.auth-captcha__piece {
  position: absolute;
  aspect-ratio: 1;
  filter: drop-shadow(0 8px 14px rgb(15 23 42 / 0.18));
  pointer-events: none;
  transition: filter var(--transition-fast);
}

.auth-captcha__piece :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}

.auth-captcha__stage-mask {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: color-mix(in srgb, var(--color-surface) 82%, transparent);
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 700;
}

.auth-captcha__track {
  --captcha-thumb-left: 18px;
  --captcha-track-progress: 37px;
  position: relative;
  height: 44px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  touch-action: none;
  user-select: none;
}

.auth-captcha__track::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: var(--captcha-track-progress);
  border-radius: 7px 0 0 7px;
  background: var(--color-accent-soft);
  content: '';
}

.auth-captcha__thumb {
  position: absolute;
  top: 3px;
  left: var(--captcha-thumb-left);
  z-index: 1;
  display: grid;
  place-items: center;
  width: 38px;
  height: 36px;
  border: 1px solid var(--color-border-strong);
  border-radius: 7px;
  background: var(--color-surface);
  color: var(--color-accent);
  cursor: grab;
  transition: box-shadow var(--transition-fast), transform var(--transition-fast);
}

.auth-captcha__thumb:hover:not(:disabled),
.auth-captcha__track--dragging .auth-captcha__thumb {
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}

.auth-captcha__thumb:active:not(:disabled) {
  cursor: grabbing;
  transform: translateY(0);
}

.auth-captcha__thumb:disabled {
  cursor: wait;
  opacity: 0.65;
}

.auth-captcha__track-label {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 700;
  pointer-events: none;
}

.auth-captcha__state,
.auth-captcha__footer span {
  color: var(--color-muted);
  font-size: 12px;
}

.auth-captcha__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.auth-captcha-fade-enter-active,
.auth-captcha-fade-leave-active {
  transition: opacity var(--transition-fast);
}

.auth-captcha-fade-enter-from,
.auth-captcha-fade-leave-to {
  opacity: 0;
}

@media (max-width: 520px) {
  .auth-captcha {
    padding: 14px;
  }

  .auth-captcha__panel {
    padding: 14px;
  }

  .auth-captcha__footer {
    align-items: stretch;
    flex-direction: column;
  }

  .auth-captcha__footer :deep(.ui-button) {
    width: 100%;
  }
}
</style>
