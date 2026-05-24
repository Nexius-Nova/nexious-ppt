import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { ImageModelConfig, TextModelConfig } from '@/types/agent';
import { apiKeyApi, type ApiKey } from '@/services/api';
import { useToastStore } from './toastStore';

function mapApiKeyToLocal(apiKey: ApiKey): TextModelConfig | ImageModelConfig {
  return {
    id: String(apiKey.id),
    name: apiKey.name,
    provider: apiKey.provider as any,
    apiKey: '',
    baseUrl: apiKey.base_url || '',
    model: apiKey.model || '',
    enabled: apiKey.is_active,
    isDefault: apiKey.is_default,
    createdAt: new Date(apiKey.created_at).getTime(),
    updatedAt: new Date(apiKey.updated_at || apiKey.created_at).getTime(),
    hasKey: apiKey.has_key
  };
}

export const useApiKeyStore = defineStore('apiKey', () => {
  const textModels = ref<TextModelConfig[]>([]);
  const imageModels = ref<ImageModelConfig[]>([]);
  const activeTextModelId = ref<string | null>(null);
  const activeImageModelId = ref<string | null>(null);
  const loading = ref(false);
  const initialized = ref(false);

  const activeTextModel = computed(() => textModels.value.find((model) => model.id === activeTextModelId.value) || textModels.value[0]);
  const activeImageModel = computed(() => imageModels.value.find((model) => model.id === activeImageModelId.value) || imageModels.value[0]);
  const isTextModelConfigured = computed(() => textModels.value.some((model) => model.hasKey));
  const isImageModelConfigured = computed(() => imageModels.value.some((model) => model.hasKey));
  const isFullyConfigured = computed(() => isTextModelConfigured.value && isImageModelConfigured.value);

  async function fetchApiKeys() {
    loading.value = true;
    try {
      const response = await apiKeyApi.getAll();
      if (response.success && response.data) {
        const serverTextModels = response.data.filter((key) => key.type === 'text').map(mapApiKeyToLocal) as TextModelConfig[];
        const serverImageModels = response.data.filter((key) => key.type === 'image').map(mapApiKeyToLocal) as ImageModelConfig[];

        textModels.value = serverTextModels;
        imageModels.value = serverImageModels;

        const defaultText = serverTextModels.find((model) => model.isDefault);
        const defaultImage = serverImageModels.find((model) => model.isDefault);
        activeTextModelId.value = defaultText?.id || serverTextModels[0]?.id || null;
        activeImageModelId.value = defaultImage?.id || serverImageModels[0]?.id || null;
        initialized.value = true;
      }
    } catch (error) {
      console.error('获取 API Key 失败：', error);
    } finally {
      loading.value = false;
    }
  }

  async function addTextModel(config: Partial<TextModelConfig> = {}): Promise<TextModelConfig | null> {
    const toastStore = useToastStore();

    if (!config.apiKey) {
      toastStore.warning('API Key 不能为空', '请输入有效的 API Key');
      return null;
    }

    loading.value = true;
    try {
      const response = await apiKeyApi.create({
        name: config.name || `文本模型 ${textModels.value.length + 1}`,
        type: 'text',
        provider: config.provider || 'openai',
        api_key: config.apiKey,
        base_url: config.baseUrl,
        model: config.model || 'gpt-4o',
        custom_provider_name: config.customProviderName,
        custom_model_name: config.customModelName,
        is_default: config.isDefault || textModels.value.length === 0
      });

      if (response.success && response.data) {
        await fetchApiKeys();
        const newModel = textModels.value.find((model) => model.id === String(response.data!.id));
        toastStore.success('添加成功', `文本模型 ${config.name || ''} 已添加`);
        return newModel || null;
      }

      toastStore.error('添加失败', response.message || '未知错误');
      return null;
    } catch (error) {
      toastStore.error('添加失败', error instanceof Error ? error.message : '未知错误');
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function addImageModel(config: Partial<ImageModelConfig> = {}): Promise<ImageModelConfig | null> {
    const toastStore = useToastStore();

    if (!config.apiKey) {
      toastStore.warning('API Key 不能为空', '请输入有效的 API Key');
      return null;
    }

    loading.value = true;
    try {
      const response = await apiKeyApi.create({
        name: config.name || `图像模型 ${imageModels.value.length + 1}`,
        type: 'image',
        provider: config.provider || 'openai',
        api_key: config.apiKey,
        base_url: config.baseUrl,
        model: config.model || 'dall-e-3',
        custom_provider_name: config.customProviderName,
        custom_model_name: config.customModelName,
        is_default: config.isDefault || imageModels.value.length === 0
      });

      if (response.success && response.data) {
        await fetchApiKeys();
        const newModel = imageModels.value.find((model) => model.id === String(response.data!.id));
        toastStore.success('添加成功', `图像模型 ${config.name || ''} 已添加`);
        return newModel || null;
      }

      toastStore.error('添加失败', response.message || '未知错误');
      return null;
    } catch (error) {
      toastStore.error('添加失败', error instanceof Error ? error.message : '未知错误');
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function updateTextModel(id: string, config: Partial<TextModelConfig>) {
    const toastStore = useToastStore();

    loading.value = true;
    try {
      const response = await apiKeyApi.update(parseInt(id), {
        name: config.name,
        provider: config.provider,
        api_key: config.apiKey,
        base_url: config.baseUrl,
        model: config.model,
        custom_provider_name: config.customProviderName,
        custom_model_name: config.customModelName,
        is_default: config.isDefault,
        is_active: config.enabled
      });

      if (response.success) {
        await fetchApiKeys();
        toastStore.success('更新成功', '文本模型配置已保存');
      } else {
        toastStore.error('更新失败', response.message || '未知错误');
      }
    } catch (error) {
      toastStore.error('更新失败', error instanceof Error ? error.message : '未知错误');
    } finally {
      loading.value = false;
    }
  }

  async function updateImageModel(id: string, config: Partial<ImageModelConfig>) {
    const toastStore = useToastStore();

    loading.value = true;
    try {
      const response = await apiKeyApi.update(parseInt(id), {
        name: config.name,
        provider: config.provider,
        api_key: config.apiKey,
        base_url: config.baseUrl,
        model: config.model,
        custom_provider_name: config.customProviderName,
        custom_model_name: config.customModelName,
        is_default: config.isDefault,
        is_active: config.enabled
      });

      if (response.success) {
        await fetchApiKeys();
        toastStore.success('更新成功', '图像模型配置已保存');
      } else {
        toastStore.error('更新失败', response.message || '未知错误');
      }
    } catch (error) {
      toastStore.error('更新失败', error instanceof Error ? error.message : '未知错误');
    } finally {
      loading.value = false;
    }
  }

  async function deleteTextModel(id: string) {
    const toastStore = useToastStore();

    if (textModels.value.length <= 1) {
      toastStore.warning('无法删除', '至少需要保留一个文本模型');
      return;
    }

    loading.value = true;
    try {
      const response = await apiKeyApi.delete(parseInt(id));
      if (response.success) {
        await fetchApiKeys();
        toastStore.success('删除成功', '文本模型已删除');
      } else {
        toastStore.error('删除失败', response.message || '未知错误');
      }
    } catch (error) {
      toastStore.error('删除失败', error instanceof Error ? error.message : '未知错误');
    } finally {
      loading.value = false;
    }
  }

  async function deleteImageModel(id: string) {
    const toastStore = useToastStore();

    if (imageModels.value.length <= 1) {
      toastStore.warning('无法删除', '至少需要保留一个图像模型');
      return;
    }

    loading.value = true;
    try {
      const response = await apiKeyApi.delete(parseInt(id));
      if (response.success) {
        await fetchApiKeys();
        toastStore.success('删除成功', '图像模型已删除');
      } else {
        toastStore.error('删除失败', response.message || '未知错误');
      }
    } catch (error) {
      toastStore.error('删除失败', error instanceof Error ? error.message : '未知错误');
    } finally {
      loading.value = false;
    }
  }

  async function setActiveTextModel(id: string) {
    if (!textModels.value.find((model) => model.id === id)) return;

    loading.value = true;
    try {
      const response = await apiKeyApi.setDefault(parseInt(id));
      if (response.success) {
        activeTextModelId.value = id;
        await fetchApiKeys();
      }
    } catch (error) {
      console.error('设置默认文本模型失败：', error);
    } finally {
      loading.value = false;
    }
  }

  async function setActiveImageModel(id: string) {
    if (!imageModels.value.find((model) => model.id === id)) return;

    loading.value = true;
    try {
      const response = await apiKeyApi.setDefault(parseInt(id));
      if (response.success) {
        activeImageModelId.value = id;
        await fetchApiKeys();
      }
    } catch (error) {
      console.error('设置默认图像模型失败：', error);
    } finally {
      loading.value = false;
    }
  }

  async function setTextModelProvider(id: string, provider: string) {
    await updateTextModel(id, { provider: provider as any });
  }

  async function setImageModelProvider(id: string, provider: string) {
    await updateImageModel(id, { provider: provider as any });
  }

  function clear() {
    textModels.value = [];
    imageModels.value = [];
    activeTextModelId.value = null;
    activeImageModelId.value = null;
    initialized.value = false;
  }

  return {
    textModels,
    imageModels,
    activeTextModelId,
    activeImageModelId,
    activeTextModel,
    activeImageModel,
    isTextModelConfigured,
    isImageModelConfigured,
    isFullyConfigured,
    loading,
    initialized,
    fetchApiKeys,
    addTextModel,
    addImageModel,
    updateTextModel,
    updateImageModel,
    deleteTextModel,
    deleteImageModel,
    setActiveTextModel,
    setActiveImageModel,
    setTextModelProvider,
    setImageModelProvider,
    clear
  };
});
