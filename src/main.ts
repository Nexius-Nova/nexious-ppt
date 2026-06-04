import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './app/App.vue';
import { router } from './router';
import { useApiKeyStore } from './stores/apiKeyStore';
import { useAuthStore } from './stores/authStore';
import { useToastStore } from './stores/toastStore';
import './styles/theme.css';
import './styles/base.css';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);

const authStore = useAuthStore();
const apiKeyStore = useApiKeyStore();
const toastStore = useToastStore();

authStore.init();
if (authStore.token) {
  void authStore.fetchUser();
  void apiKeyStore.fetchApiKeys();
}

window.addEventListener('api:unauthorized', async (event) => {
  const message = event instanceof CustomEvent ? event.detail : '登录状态已失效，请重新登录';
  authStore.logout();
  toastStore.warning('需要重新登录', message);
  if (router.currentRoute.value.path !== '/login') {
    await router.replace({
      path: '/login',
      query: { redirect: router.currentRoute.value.fullPath }
    });
  }
});

app.use(router);

app.mount('#app');
