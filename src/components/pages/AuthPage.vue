<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { LogIn, UserPlus } from 'lucide-vue-next';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiField from '@/components/ui/UiField.vue';
import UiInput from '@/components/ui/UiInput.vue';
import { useAuthStore } from '@/stores/authStore';
import { useToastStore } from '@/stores/toastStore';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const toastStore = useToastStore();

const mode = ref<'login' | 'register'>('login');
const email = ref('');
const password = ref('');
const name = ref('');

const isRegister = computed(() => mode.value === 'register');
const title = computed(() => isRegister.value ? '创建账号' : '登录账号');
const subtitle = computed(() => isRegister.value ? '注册后即可开始生成并管理自己的 PPT。' : '生成 PPT 前需要先登录。');

function validate() {
  if (!email.value.trim()) {
    toastStore.warning('请填写邮箱');
    return false;
  }
  if (!password.value || password.value.length < 6) {
    toastStore.warning('密码至少 6 位');
    return false;
  }
  return true;
}

async function submit() {
  if (!validate()) return;

  const ok = isRegister.value
    ? await authStore.register(email.value.trim(), password.value, name.value.trim() || undefined)
    : await authStore.login(email.value.trim(), password.value);

  if (!ok) {
    toastStore.error(isRegister.value ? '注册失败' : '登录失败', authStore.error || undefined);
    return;
  }

  toastStore.success(isRegister.value ? '注册成功' : '登录成功');
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/my-ppt';
  await router.replace(redirect);
}
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

          <UiField label="邮箱" required>
            <UiInput v-model="email" type="email" placeholder="you@example.com" autocomplete="email" />
          </UiField>

          <UiField label="密码" required hint="至少 6 位">
            <UiInput v-model="password" type="password" placeholder="请输入密码" autocomplete="current-password" />
          </UiField>

          <UiButton variant="primary" block :loading="authStore.loading">
            <UserPlus v-if="isRegister" :size="16" />
            <LogIn v-else :size="16" />
            {{ isRegister ? '注册并进入' : '登录并进入' }}
          </UiButton>
        </form>

        <div class="auth-switch">
          <span>{{ isRegister ? '已有账号？' : '还没有账号？' }}</span>
          <button type="button" @click="mode = isRegister ? 'login' : 'register'">
            {{ isRegister ? '去登录' : '创建账号' }}
          </button>
        </div>
      </UiCard>
    </section>
  </main>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
  background: var(--color-bg);
}

.auth-page__panel {
  width: min(420px, 100%);
  display: grid;
  gap: 20px;
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
  color: #fff;
  font-weight: 800;
}

.auth-page__brand h1 {
  font-size: 18px;
  line-height: 1.2;
  letter-spacing: 0;
}

.auth-page__brand p {
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

.auth-switch {
  margin-top: 16px;
  display: flex;
  justify-content: center;
  gap: 8px;
  color: var(--color-muted);
  font-size: 13px;
}

.auth-switch button {
  color: var(--color-accent);
  font-weight: 600;
}
</style>
