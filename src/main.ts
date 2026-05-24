import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './app/App.vue';
import { router } from './router';
import { useApiKeyStore } from './stores/apiKeyStore';
import './styles/theme.css';
import './styles/base.css';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

const apiKeyStore = useApiKeyStore();
apiKeyStore.fetchApiKeys();

app.mount('#app');
