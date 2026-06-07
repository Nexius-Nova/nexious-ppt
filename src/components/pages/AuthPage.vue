<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, KeyRound, LogIn, Mail, UserPlus } from 'lucide-vue-next';
import AuthCaptchaModal from '@/components/common/AuthCaptchaModal.vue';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiField from '@/components/ui/UiField.vue';
import UiInput from '@/components/ui/UiInput.vue';
import { authApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useToastStore } from '@/stores/toastStore';

type AuthMode = 'login' | 'register' | 'forgot';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const toastStore = useToastStore();

const mode = ref<AuthMode>('login');
const email = ref('');
const password = ref('');
const name = ref('');
const confirmPassword = ref('');
const registerEmailCode = ref('');
const resetEmail = ref('');
const resetEmailCode = ref('');
const resetPassword = ref('');
const resetConfirmPassword = ref('');
const sendingEmailCode = ref<'register' | 'reset' | null>(null);
const registerCooldown = ref(0);
const resetCooldown = ref(0);
let emailCodeTimer: number | null = null;

const captchaOpen = ref(false);
const captchaReloadKey = ref(0);

const isLogin = computed(() => mode.value === 'login');
const isRegister = computed(() => mode.value === 'register');
const isForgot = computed(() => mode.value === 'forgot');
const title = computed(() => {
  if (isRegister.value) return '创建账号';
  if (isForgot.value) return '找回密码';
  return '登录账号';
});
const subtitle = computed(() => {
  if (isRegister.value) return '注册后即可生成并管理自己的 PPT。';
  if (isForgot.value) return '通过邮箱验证码重置密码。';
  return '登录后进入你的 PPT 工作台。';
});
const registerCodeButtonText = computed(() => registerCooldown.value > 0 ? `${registerCooldown.value}s 后重发` : '获取验证码');
const resetCodeButtonText = computed(() => resetCooldown.value > 0 ? `${resetCooldown.value}s 后重发` : '获取验证码');

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isStrongPassword(value: string) {
  return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

function switchMode(nextMode: AuthMode) {
  mode.value = nextMode;
  captchaOpen.value = false;
}

function startEmailCodeCooldown(kind: 'register' | 'reset', seconds = 60) {
  if (kind === 'register') registerCooldown.value = seconds;
  else resetCooldown.value = seconds;

  if (emailCodeTimer !== null) return;
  emailCodeTimer = window.setInterval(() => {
    registerCooldown.value = Math.max(0, registerCooldown.value - 1);
    resetCooldown.value = Math.max(0, resetCooldown.value - 1);
    if (registerCooldown.value === 0 && resetCooldown.value === 0 && emailCodeTimer !== null) {
      window.clearInterval(emailCodeTimer);
      emailCodeTimer = null;
    }
  }, 1000);
}

function validateLogin() {
  if (!isValidEmail(email.value)) {
    toastStore.warning('请输入有效邮箱');
    return false;
  }
  if (!password.value) {
    toastStore.warning('请输入密码');
    return false;
  }
  if (!isStrongPassword(password.value)) {
    toastStore.warning('密码至少 8 位，并包含字母和数字');
    return false;
  }
  return true;
}

function validateRegister() {
  if (!isValidEmail(email.value)) {
    toastStore.warning('请输入有效邮箱');
    return false;
  }
  if (!isStrongPassword(password.value)) {
    toastStore.warning('密码至少 8 位，并包含字母和数字');
    return false;
  }
  if (password.value !== confirmPassword.value) {
    toastStore.warning('两次输入的密码不一致');
    return false;
  }
  if (!registerEmailCode.value.trim()) {
    toastStore.warning('请输入邮箱验证码');
    return false;
  }
  return true;
}

function validateForgot() {
  if (!isValidEmail(resetEmail.value)) {
    toastStore.warning('请输入有效邮箱');
    return false;
  }
  if (!isStrongPassword(resetPassword.value)) {
    toastStore.warning('新密码至少 8 位，并包含字母和数字');
    return false;
  }
  if (resetPassword.value !== resetConfirmPassword.value) {
    toastStore.warning('两次输入的新密码不一致');
    return false;
  }
  if (!resetEmailCode.value.trim()) {
    toastStore.warning('请输入邮箱验证码');
    return false;
  }
  return true;
}

function openCaptcha() {
  if (!validateLogin()) return;
  captchaOpen.value = true;
}

async function submitLogin(captchaToken: string) {
  captchaOpen.value = false;
  const ok = await authStore.login(email.value.trim(), password.value, captchaToken);
  if (!ok) {
    toastStore.error('登录失败', authStore.error || undefined);
    return;
  }

  toastStore.success('登录成功');
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/my-ppt';
  await router.replace(redirect);
}

async function submitRegister() {
  if (!validateRegister()) return;
  const ok = await authStore.register(
    email.value.trim(),
    password.value,
    name.value.trim() || undefined,
    registerEmailCode.value.trim()
  );
  if (!ok) {
    toastStore.error('注册失败', authStore.error || undefined);
    return;
  }

  toastStore.success('注册成功');
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/my-ppt';
  await router.replace(redirect);
}

async function requestEmailCode(kind: 'register' | 'reset') {
  const targetEmail = kind === 'register' ? email.value : resetEmail.value;
  if (!isValidEmail(targetEmail)) {
    toastStore.warning('请先输入有效邮箱');
    return;
  }
  if ((kind === 'register' && registerCooldown.value > 0) || (kind === 'reset' && resetCooldown.value > 0)) {
    return;
  }

  sendingEmailCode.value = kind;
  const response = await authApi.sendEmailCode({
    email: targetEmail.trim(),
    purpose: kind === 'register' ? 'register' : 'reset-password'
  });
  sendingEmailCode.value = null;
  if (!response.success) {
    toastStore.error('验证码发送失败', response.message || undefined);
    return;
  }

  startEmailCodeCooldown(kind, response.data?.cooldown || 60);
  toastStore.success(response.message || '邮箱验证码已发送');
}

async function submitForgot() {
  if (!validateForgot()) return;
  const ok = await authStore.resetPassword(resetEmail.value.trim(), resetEmailCode.value.trim(), resetPassword.value);
  if (!ok) {
    toastStore.error('重置密码失败', authStore.error || undefined);
    return;
  }
  toastStore.success('密码已重置，请使用新密码登录');
  password.value = '';
  resetEmailCode.value = '';
  resetPassword.value = '';
  resetConfirmPassword.value = '';
  switchMode('login');
}

function submit() {
  if (isLogin.value) {
    openCaptcha();
    return;
  }
  if (isRegister.value) {
    submitRegister();
    return;
  }
  submitForgot();
}

onBeforeUnmount(() => {
  if (emailCodeTimer !== null) {
    window.clearInterval(emailCodeTimer);
  }
});
</script>

<template>
  <main class="auth-page">
    <section class="auth-page__panel">
      <div class="auth-page__brand">
        <span class="auth-page__mark">N</span>
        <div>
          <h1>NEXIOUS PPT</h1>
          <p>AI PPT Agent</p>
        </div>
      </div>

      <UiCard class="auth-card" :title="title" :subtitle="subtitle">
        <form class="auth-form" @submit.prevent="submit">
          <UiField v-if="isRegister" label="昵称">
            <UiInput v-model="name" placeholder="用于个人中心显示" autocomplete="name" />
          </UiField>

          <template v-if="!isForgot">
            <UiField label="邮箱" required>
              <UiInput v-model="email" type="email" placeholder="you@example.com" autocomplete="email" />
            </UiField>

            <UiField label="密码" required hint="至少 8 位，包含字母和数字">
              <UiInput
                v-model="password"
                type="password"
                placeholder="请输入密码"
                :autocomplete="isRegister ? 'new-password' : 'current-password'"
              />
            </UiField>
          </template>

          <template v-if="isRegister">
            <UiField label="确认密码" required>
              <UiInput v-model="confirmPassword" type="password" placeholder="再次输入密码" autocomplete="new-password" />
            </UiField>
            <UiField label="邮箱验证码" required hint="验证码 5 分钟内有效。">
              <div class="auth-code-row">
                <UiInput v-model="registerEmailCode" placeholder="请输入 6 位验证码" />
                <UiButton
                  type="button"
                  variant="secondary"
                  :loading="sendingEmailCode === 'register'"
                  :disabled="registerCooldown > 0"
                  @click="requestEmailCode('register')"
                >
                  <Mail :size="14" />
                  {{ registerCodeButtonText }}
                </UiButton>
              </div>
            </UiField>
          </template>

          <template v-if="isForgot">
            <UiField label="邮箱" required>
              <UiInput v-model="resetEmail" type="email" placeholder="you@example.com" autocomplete="email" />
            </UiField>
            <UiField label="邮箱验证码" required hint="验证码 5 分钟内有效。">
              <div class="auth-code-row">
                <UiInput v-model="resetEmailCode" placeholder="请输入 6 位验证码" />
                <UiButton
                  type="button"
                  variant="secondary"
                  :loading="sendingEmailCode === 'reset'"
                  :disabled="resetCooldown > 0"
                  @click="requestEmailCode('reset')"
                >
                  <Mail :size="14" />
                  {{ resetCodeButtonText }}
                </UiButton>
              </div>
            </UiField>
            <UiField label="新密码" required hint="至少 8 位，包含字母和数字">
              <UiInput v-model="resetPassword" type="password" placeholder="请输入新密码" autocomplete="new-password" />
            </UiField>
            <UiField label="确认新密码" required hint="至少 8 位，包含字母和数字">
              <UiInput v-model="resetConfirmPassword" type="password" placeholder="再次输入新密码" autocomplete="new-password" />
            </UiField>
          </template>

          <UiButton variant="primary" block :loading="authStore.loading">
            <UserPlus v-if="isRegister" :size="16" />
            <KeyRound v-else-if="isForgot" :size="16" />
            <LogIn v-else :size="16" />
            {{ isRegister ? '注册并进入' : isForgot ? '重置密码' : '登录并进入' }}
          </UiButton>
        </form>

        <div class="auth-links">
          <button v-if="isLogin" type="button" @click="switchMode('forgot')">忘记密码</button>
          <button v-if="isForgot" type="button" @click="switchMode('login')">
            <ArrowLeft :size="14" />
            返回登录
          </button>
        </div>

        <div class="auth-switch" v-if="!isForgot">
          <span>{{ isRegister ? '已有账号？' : '还没有账号？' }}</span>
          <button type="button" @click="switchMode(isRegister ? 'login' : 'register')">
            {{ isRegister ? '去登录' : '创建账号' }}
          </button>
        </div>
      </UiCard>
    </section>

    <AuthCaptchaModal
      :show="captchaOpen"
      :email="email.trim()"
      :reload-key="captchaReloadKey"
      @close="captchaOpen = false"
      @verified="submitLogin"
    />
  </main>
</template>

<style scoped>
.auth-page {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 28px;
  background: var(--color-bg);
}

.auth-page__panel {
  display: grid;
  gap: 18px;
  width: min(440px, 100%);
}

.auth-page__brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.auth-page__mark {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: var(--color-accent);
  color: var(--color-inverse);
  font-weight: 800;
}

.auth-page__brand h1 {
  margin: 0;
  color: var(--color-text);
  font-size: 18px;
  line-height: 1.2;
  letter-spacing: 0;
}

.auth-page__brand p {
  margin: 2px 0 0;
  color: var(--color-muted);
  font-size: 13px;
}

.auth-card {
  box-shadow: var(--shadow-panel);
}

.auth-form {
  display: grid;
  gap: 14px;
}

.auth-code-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.auth-links,
.auth-switch {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 14px;
  color: var(--color-muted);
  font-size: 13px;
}

.auth-links {
  justify-content: space-between;
}

.auth-links button,
.auth-switch button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--color-accent);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

@media (max-width: 520px) {
  .auth-page {
    align-items: start;
    padding: 18px;
  }

  .auth-code-row {
    grid-template-columns: 1fr;
  }

  .auth-code-row {
    display: grid;
  }

  .auth-code-row :deep(.ui-button) {
    width: 100%;
  }

  .auth-links {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
