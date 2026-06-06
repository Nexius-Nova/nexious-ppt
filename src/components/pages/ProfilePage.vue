<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { CheckCircle2, LogOut, Save, ShieldCheck, Upload, X } from 'lucide-vue-next';
import UiBadge from '@/components/ui/UiBadge.vue';
import UiButton from '@/components/ui/UiButton.vue';
import UiCard from '@/components/ui/UiCard.vue';
import UiField from '@/components/ui/UiField.vue';
import UiInput from '@/components/ui/UiInput.vue';
import PrivateImage from '@/components/common/PrivateImage.vue';
import { useAuthStore } from '@/stores/authStore';
import { useToastStore } from '@/stores/toastStore';

const router = useRouter();
const authStore = useAuthStore();
const toastStore = useToastStore();

const name = ref('');
const avatar = ref('');
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const avatarInput = ref<HTMLInputElement | null>(null);
const isAvatarProcessing = ref(false);

const displayName = computed(() => authStore.user?.name || authStore.user?.email || '当前用户');
const userInitial = computed(() => displayName.value.trim().slice(0, 1).toUpperCase() || 'U');
const avatarSrc = computed(() => avatar.value);
const wantsPasswordChange = computed(() => Boolean(currentPassword.value || newPassword.value || confirmPassword.value));
const passwordRules = computed(() => [
  { label: '至少 8 位', done: newPassword.value.length >= 8 },
  { label: '包含字母和数字', done: /[A-Za-z]/.test(newPassword.value) && /\d/.test(newPassword.value) },
  { label: '两次输入一致', done: Boolean(newPassword.value) && newPassword.value === confirmPassword.value },
]);

watch(
  () => authStore.user,
  (user) => {
    name.value = user?.name || '';
    avatar.value = user?.avatar || '';
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
  },
  { immediate: true }
);

function openAvatarPicker() {
  avatarInput.value?.click();
}

function removeAvatar() {
  avatar.value = '';
}

async function handleAvatarChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = '';
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    toastStore.warning('请选择图片文件');
    return;
  }

  try {
    isAvatarProcessing.value = true;
    const avatarBlob = await compressAvatar(file);
    const ok = await authStore.uploadAvatar(avatarBlob);
    if (!ok) {
      toastStore.error('头像上传失败', authStore.error || undefined);
      return;
    }
    avatar.value = authStore.user?.avatar || '';
    toastStore.success('头像已更新');
  } catch (error) {
    toastStore.error('头像上传失败', error instanceof Error ? error.message : undefined);
  } finally {
    isAvatarProcessing.value = false;
  }
}

function compressAvatar(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const size = 256;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('浏览器不支持图片处理'));
        return;
      }

      canvas.width = size;
      canvas.height = size;
      const sourceSize = Math.min(image.width, image.height);
      const sx = (image.width - sourceSize) / 2;
      const sy = (image.height - sourceSize) / 2;
      ctx.drawImage(image, sx, sy, sourceSize, sourceSize, 0, 0, size, size);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('头像压缩失败'));
          return;
        }
        resolve(blob);
      }, 'image/jpeg', 0.86);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('无法读取图片'));
    };

    image.src = objectUrl;
  });
}

async function saveProfile() {
  const payload: { name?: string; avatar?: string; currentPassword?: string; password?: string } = {
    name: name.value.trim(),
    avatar: avatar.value
  };

  if (wantsPasswordChange.value) {
    if (!currentPassword.value) {
      toastStore.warning('请输入当前密码');
      return;
    }
    if (!passwordRules.value.every((rule) => rule.done)) {
      toastStore.warning('新密码不符合要求');
      return;
    }
    payload.currentPassword = currentPassword.value;
    payload.password = newPassword.value;
  }

  const ok = await authStore.updateUser(payload);
  if (!ok) {
    toastStore.error('保存失败', authStore.error || undefined);
    return;
  }

  currentPassword.value = '';
  newPassword.value = '';
  confirmPassword.value = '';
  toastStore.success('个人资料已保存');
}

async function logout() {
  authStore.logout();
  toastStore.info('已退出登录');
  await router.replace('/login');
}
</script>

<template>
  <section class="profile-page">
    <div class="profile-page__header">
      <div>
        <h2>个人中心</h2>
      </div>
      <UiBadge tone="success">已登录</UiBadge>
    </div>

    <div class="profile-page__grid">
      <UiCard title="账号信息" subtitle="头像、昵称和密码只会更新当前账号。">
        <div class="profile-fields">
          <div class="avatar-editor">
            <div class="avatar-editor__preview">
              <PrivateImage v-if="avatarSrc" :src="avatarSrc" :alt="displayName" />
              <span v-else>{{ userInitial }}</span>
            </div>
            <div class="avatar-editor__actions">
              <strong>头像</strong>
              <p>上传图片后会自动裁成方形头像。</p>
              <div class="avatar-editor__buttons">
                <UiButton variant="secondary" size="sm" :loading="isAvatarProcessing" @click="openAvatarPicker">
                  <Upload :size="14" />
                  上传头像
                </UiButton>
                <UiButton v-if="avatar" variant="ghost" size="sm" :disabled="isAvatarProcessing" @click="removeAvatar">
                  <X :size="14" />
                  移除
                </UiButton>
              </div>
              <input ref="avatarInput" type="file" accept="image/*" class="avatar-editor__input" @change="handleAvatarChange" />
            </div>
          </div>

          <UiField label="邮箱">
            <UiInput :model-value="authStore.user?.email || ''" disabled />
          </UiField>
          <UiField label="昵称">
            <UiInput v-model="name" placeholder="请输入昵称" />
          </UiField>

          <section class="password-panel">
            <header class="password-panel__header">
              <ShieldCheck :size="17" />
              <div>
                <strong>修改密码</strong>
                <span>不修改密码时保持为空。</span>
              </div>
            </header>
            <div class="password-panel__fields">
              <UiField label="当前密码">
                <UiInput v-model="currentPassword" type="password" placeholder="请输入当前密码" autocomplete="current-password" />
              </UiField>
              <UiField label="新密码">
                <UiInput v-model="newPassword" type="password" placeholder="至少 8 位，包含字母和数字" autocomplete="new-password" />
              </UiField>
              <UiField label="确认新密码">
                <UiInput v-model="confirmPassword" type="password" placeholder="再次输入新密码" autocomplete="new-password" />
              </UiField>
            </div>
            <div class="password-rules">
              <span
                v-for="rule in passwordRules"
                :key="rule.label"
                class="password-rule"
                :class="{ 'password-rule--done': rule.done }"
              >
                <CheckCircle2 :size="13" />
                {{ rule.label }}
              </span>
            </div>
          </section>

          <div class="profile-actions">
            <UiButton variant="primary" :loading="authStore.loading" @click="saveProfile">
              <Save :size="15" />
              保存资料
            </UiButton>
            <UiButton variant="secondary" @click="logout">
              <LogOut :size="15" />
              退出登录
            </UiButton>
          </div>
        </div>
      </UiCard>
    </div>
  </section>
</template>

<style scoped>
.profile-page {
  display: grid;
  gap: 18px;
  padding: 24px;
}

.profile-page__header {
  display: flex;
  align-items: center;
  gap: 14px;
}

.profile-page__header h2 {
  margin: 0;
  color: var(--color-text);
  font-size: 20px;
  letter-spacing: 0;
}

.profile-page__header p {
  margin: 4px 0 0;
  color: var(--color-muted);
  font-size: 13px;
}

.profile-page__avatar,
.avatar-editor__preview {
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-weight: 800;
  overflow: hidden;
}

.profile-page__avatar {
  width: 48px;
  height: 48px;
}

.profile-page__avatar img,
.avatar-editor__preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.profile-page__grid {
  display: grid;
  grid-template-columns: minmax(0, 760px);
  gap: 16px;
  align-items: start;
}

.profile-fields {
  display: grid;
  gap: 14px;
}

.avatar-editor {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.avatar-editor__preview {
  flex: 0 0 auto;
  width: 76px;
  height: 76px;
  font-size: 24px;
}

.avatar-editor__actions {
  min-width: 0;
}

.avatar-editor__actions strong {
  display: block;
  color: var(--color-text);
  font-size: 14px;
}

.avatar-editor__actions p {
  margin: 4px 0 10px;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.5;
}

.avatar-editor__buttons,
.profile-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.avatar-editor__input {
  display: none;
}

.password-panel {
  display: grid;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}

.password-panel__header {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  color: var(--color-muted);
}

.password-panel__header strong,
.password-panel__header span {
  display: block;
}

.password-panel__header strong {
  color: var(--color-text);
  font-size: 14px;
}

.password-panel__header span {
  margin-top: 3px;
  font-size: 12px;
}

.password-panel__fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.password-rules {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.password-rule {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  color: var(--color-muted);
  background: var(--color-card);
  font-size: 12px;
}

.password-rule--done {
  border-color: var(--color-success);
  color: var(--color-success);
  background: var(--color-success-soft);
}

@media (max-width: 900px) {
  .profile-page__grid {
    grid-template-columns: 1fr;
  }

  .password-panel__fields {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 520px) {
  .avatar-editor {
    align-items: flex-start;
  }
}
</style>
