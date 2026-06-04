import { Router, Response } from 'express';
import {
  getApiKeyById,
  getApiKeysByUserId,
  getApiKeysByUserIdAndType,
  getDefaultApiKey,
  createApiKey,
  updateApiKey,
  deleteApiKey,
  setDefaultApiKey
} from '../models/apiKey.js';
import { encrypt } from '../utils/crypto.js';
import { authMiddleware, AuthRequest } from './auth.js';

const router = Router();

router.use(authMiddleware);

function toSafeKey(key: any) {
  return {
    id: key.id,
    name: key.name,
    type: key.type,
    provider: key.provider,
    model: key.model,
    custom_provider_name: key.custom_provider_name,
    custom_model_name: key.custom_model_name,
    is_default: Boolean(key.is_default),
    is_active: Boolean(key.is_active),
    created_at: key.created_at,
    updated_at: key.updated_at,
    has_key: Boolean(key.api_key),
    base_url: key.base_url
  };
}

function isApiKeyType(type: unknown): type is 'text' | 'image' {
  return type === 'text' || type === 'image';
}

async function getOwnedApiKey(id: number, userId: number) {
  const key = await getApiKeyById(id);
  if (!key || key.user_id !== userId) return null;
  return key;
}

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const keys = await getApiKeysByUserId(req.userId!);
    res.json({ success: true, data: keys.map(toSafeKey) });
  } catch (error) {
    console.error('获取 API Key 列表失败:', error);
    res.status(500).json({ success: false, message: '获取 API Key 列表失败' });
  }
});

router.get('/type/:type', async (req: AuthRequest, res: Response) => {
  try {
    const { type } = req.params;
    if (!isApiKeyType(type)) {
      return res.status(400).json({ success: false, message: '类型必须是 text 或 image' });
    }

    const keys = await getApiKeysByUserIdAndType(req.userId!, type);
    res.json({ success: true, data: keys.map(toSafeKey) });
  } catch (error) {
    console.error('获取 API Key 列表失败:', error);
    res.status(500).json({ success: false, message: '获取 API Key 列表失败' });
  }
});

router.get('/default/:type', async (req: AuthRequest, res: Response) => {
  try {
    const { type } = req.params;
    if (!isApiKeyType(type)) {
      return res.status(400).json({ success: false, message: '类型必须是 text 或 image' });
    }

    const key = await getDefaultApiKey(req.userId!, type);
    res.json({
      success: true,
      data: key ? toSafeKey(key) : null,
      message: key ? undefined : '未设置默认 API Key'
    });
  } catch (error) {
    console.error('获取默认 API Key 失败:', error);
    res.status(500).json({ success: false, message: '获取默认 API Key 失败' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, type, provider, api_key, base_url, model, custom_provider_name, custom_model_name, is_default } = req.body;

    if (!name || !type || !provider || !api_key) {
      return res.status(400).json({ success: false, message: '名称、类型、服务商和 API Key 不能为空' });
    }

    if (!isApiKeyType(type)) {
      return res.status(400).json({ success: false, message: '类型必须是 text 或 image' });
    }

    const keyId = await createApiKey({
      user_id: req.userId!,
      name: String(name).trim(),
      type,
      provider,
      api_key: encrypt(api_key),
      base_url,
      model,
      custom_provider_name,
      custom_model_name,
      is_default: Boolean(is_default)
    });

    if (is_default) {
      await setDefaultApiKey(req.userId!, keyId, type);
    }

    res.status(201).json({
      success: true,
      data: { id: keyId },
      message: 'API Key 创建成功'
    });
  } catch (error) {
    console.error('创建 API Key 失败:', error);
    res.status(500).json({ success: false, message: '创建 API Key 失败' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const keyId = parseInt(req.params.id, 10);
    const existingKey = await getOwnedApiKey(keyId, req.userId!);
    if (!existingKey) {
      return res.status(404).json({ success: false, message: 'API Key 不存在或无权操作' });
    }

    const { name, provider, api_key, base_url, model, custom_provider_name, custom_model_name, is_default, is_active } = req.body;
    const updateData: any = {};

    if (name !== undefined) updateData.name = String(name).trim();
    if (provider !== undefined) updateData.provider = provider;
    if (api_key) updateData.api_key = encrypt(api_key);
    if (base_url !== undefined) updateData.base_url = base_url;
    if (model !== undefined) updateData.model = model;
    if (custom_provider_name !== undefined) updateData.custom_provider_name = custom_provider_name;
    if (custom_model_name !== undefined) updateData.custom_model_name = custom_model_name;
    if (is_default !== undefined) updateData.is_default = Boolean(is_default);
    if (is_active !== undefined) updateData.is_active = Boolean(is_active);

    if (updateData.name !== undefined && !updateData.name) {
      return res.status(400).json({ success: false, message: 'API Key 名称不能为空' });
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, message: '没有提供要更新的数据' });
    }

    const success = await updateApiKey(keyId, updateData);
    if (!success) {
      return res.status(400).json({ success: false, message: '更新失败' });
    }

    if (is_default && existingKey.type) {
      await setDefaultApiKey(req.userId!, keyId, existingKey.type);
    }

    res.json({ success: true, message: 'API Key 更新成功' });
  } catch (error) {
    console.error('更新 API Key 失败:', error);
    res.status(500).json({ success: false, message: '更新 API Key 失败' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const keyId = parseInt(req.params.id, 10);
    const existingKey = await getOwnedApiKey(keyId, req.userId!);
    if (!existingKey) {
      return res.status(404).json({ success: false, message: 'API Key 不存在或无权操作' });
    }

    const success = await deleteApiKey(keyId);
    if (!success) {
      return res.status(400).json({ success: false, message: '删除失败' });
    }

    res.json({ success: true, message: 'API Key 已删除' });
  } catch (error) {
    console.error('删除 API Key 失败:', error);
    res.status(500).json({ success: false, message: '删除 API Key 失败' });
  }
});

router.post('/:id/set-default', async (req: AuthRequest, res: Response) => {
  try {
    const keyId = parseInt(req.params.id, 10);
    const existingKey = await getOwnedApiKey(keyId, req.userId!);
    if (!existingKey) {
      return res.status(404).json({ success: false, message: 'API Key 不存在或无权操作' });
    }

    const success = await setDefaultApiKey(req.userId!, keyId, existingKey.type);
    if (!success) {
      return res.status(400).json({ success: false, message: '设置默认失败' });
    }

    res.json({ success: true, message: '已设置为默认 API Key' });
  } catch (error) {
    console.error('设置默认 API Key 失败:', error);
    res.status(500).json({ success: false, message: '设置默认 API Key 失败' });
  }
});

export default router;
