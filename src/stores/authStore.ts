import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api, authApi, type User } from '@/services/api';
import { useApiKeyStore } from './apiKeyStore';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const token = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const isAuthenticated = computed(() => !!token.value && !!user.value);

  function init() {
    const storedToken = localStorage.getItem('auth_token');
    const storedUser = localStorage.getItem('auth_user');
    
    if (storedToken && storedUser) {
      token.value = storedToken;
      user.value = JSON.parse(storedUser);
      api.setToken(storedToken);
    }
  }

  async function register(email: string, password: string, name?: string, emailCode?: string) {
    loading.value = true;
    error.value = null;

    const response = await authApi.register(email, password, name, emailCode);

    if (response.success && response.data) {
      token.value = response.data.token;
      user.value = {
        userId: response.data.userId,
        email: response.data.email,
        name: response.data.name,
        avatar: null,
      };
      api.setToken(response.data.token);
      localStorage.setItem('auth_user', JSON.stringify(user.value));
      loading.value = false;
      
      const apiKeyStore = useApiKeyStore();
      apiKeyStore.fetchApiKeys();
      
      return true;
    } else {
      error.value = response.message || '注册失败';
      loading.value = false;
      return false;
    }
  }

  async function login(email: string, password: string, captchaToken: string) {
    loading.value = true;
    error.value = null;

    const response = await authApi.login(email, password, captchaToken);

    if (response.success && response.data) {
      token.value = response.data.token;
      user.value = {
        userId: response.data.userId,
        email: response.data.email,
        name: response.data.name,
        avatar: response.data.avatar,
      };
      api.setToken(response.data.token);
      localStorage.setItem('auth_user', JSON.stringify(user.value));
      loading.value = false;
      
      const apiKeyStore = useApiKeyStore();
      apiKeyStore.fetchApiKeys();
      
      return true;
    } else {
      error.value = response.message || '登录失败';
      loading.value = false;
      return false;
    }
  }

  async function fetchUser() {
    if (!token.value) return false;

    const response = await authApi.getMe();

    if (response.success && response.data) {
      user.value = response.data;
      localStorage.setItem('auth_user', JSON.stringify(user.value));
      return true;
    } else {
      logout();
      return false;
    }
  }

  async function resetPassword(email: string, emailCode: string, password: string) {
    loading.value = true;
    error.value = null;

    const response = await authApi.resetPassword({ email, emailCode, password });

    if (response.success) {
      loading.value = false;
      return true;
    }
    error.value = response.message || '重置密码失败';
    loading.value = false;
    return false;
  }

  async function updateUser(data: { name?: string; avatar?: string; currentPassword?: string; password?: string; emailCode?: string }) {
    loading.value = true;
    error.value = null;

    const response = await authApi.updateMe(data);

    if (response.success && response.data) {
      user.value = response.data;
      localStorage.setItem('auth_user', JSON.stringify(user.value));
      loading.value = false;
      return true;
    } else {
      error.value = response.message || '更新失败';
      loading.value = false;
      return false;
    }
  }

  async function uploadAvatar(file: Blob) {
    loading.value = true;
    error.value = null;

    const response = await authApi.uploadAvatar(file);

    if (response.success && response.data) {
      user.value = response.data;
      localStorage.setItem('auth_user', JSON.stringify(user.value));
      loading.value = false;
      return true;
    } else {
      error.value = response.message || '头像上传失败';
      loading.value = false;
      return false;
    }
  }

  async function deleteAccount() {
    loading.value = true;
    error.value = null;

    const response = await authApi.deleteMe();

    if (response.success) {
      logout();
      loading.value = false;
      return true;
    } else {
      error.value = response.message || '删除失败';
      loading.value = false;
      return false;
    }
  }

  function logout() {
    user.value = null;
    token.value = null;
    api.setToken(null);
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    
    const apiKeyStore = useApiKeyStore();
    apiKeyStore.clear();
  }

  return {
    user,
    token,
    loading,
    error,
    isAuthenticated,
    init,
    register,
    login,
    fetchUser,
    updateUser,
    resetPassword,
    uploadAvatar,
    deleteAccount,
    logout,
  };
});
