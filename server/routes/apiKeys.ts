import { Router, Response, Request } from 'express';
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

const router = Router();

const DEFAULT_USER_ID = 1;

router.get('/', async (req: Request, res: Response) => {
  try {
    const keys = await getApiKeysByUserId(DEFAULT_USER_ID);
    
    const safeKeys = keys.map(key => ({
      id: key.id,
      name: key.name,
      type: key.type,
      provider: key.provider,
      model: key.model,
      custom_provider_name: key.custom_provider_name,
      custom_model_name: key.custom_model_name,
      is_default: key.is_default,
      is_active: key.is_active,
      created_at: key.created_at,
      updated_at: key.updated_at,
      has_key: !!key.api_key,
      base_url: key.base_url
    }));

    res.json({
      success: true,
      data: safeKeys
    });
  } catch (error) {
    console.error('获取API密钥列表错误:', error);
    res.status(500).json({
      success: false,
      message: '获取API密钥列表失败'
    });
  }
});

router.get('/type/:type', async (req: Request, res: Response) => {
  try {
    const { type } = req.params;
    if (type !== 'text' && type !== 'image') {
      return res.status(400).json({
        success: false,
        message: '类型必须是 text 或 image'
      });
    }

    const keys = await getApiKeysByUserIdAndType(DEFAULT_USER_ID, type);
    
    const safeKeys = keys.map(key => ({
      id: key.id,
      name: key.name,
      type: key.type,
      provider: key.provider,
      model: key.model,
      custom_provider_name: key.custom_provider_name,
      custom_model_name: key.custom_model_name,
      is_default: key.is_default,
      is_active: key.is_active,
      created_at: key.created_at,
      has_key: !!key.api_key,
      base_url: key.base_url
    }));

    res.json({
      success: true,
      data: safeKeys
    });
  } catch (error) {
    console.error('获取API密钥列表错误:', error);
    res.status(500).json({
      success: false,
      message: '获取API密钥列表失败'
    });
  }
});

router.get('/default/:type', async (req: Request, res: Response) => {
  try {
    const { type } = req.params;
    if (type !== 'text' && type !== 'image') {
      return res.status(400).json({
        success: false,
        message: '类型必须是 text 或 image'
      });
    }

    const key = await getDefaultApiKey(DEFAULT_USER_ID, type);
    if (!key) {
      return res.json({
        success: true,
        data: null,
        message: '未设置默认API密钥'
      });
    }

    res.json({
      success: true,
      data: {
        id: key.id,
        name: key.name,
        type: key.type,
        provider: key.provider,
        model: key.model,
        custom_provider_name: key.custom_provider_name,
        custom_model_name: key.custom_model_name,
        is_default: key.is_default,
        base_url: key.base_url
      }
    });
  } catch (error) {
    console.error('获取默认API密钥错误:', error);
    res.status(500).json({
      success: false,
      message: '获取默认API密钥失败'
    });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, type, provider, api_key, base_url, model, custom_provider_name, custom_model_name, is_default } = req.body;

    if (!name || !type || !provider || !api_key) {
      return res.status(400).json({
        success: false,
        message: '名称、类型、服务商和API密钥不能为空'
      });
    }

    if (type !== 'text' && type !== 'image') {
      return res.status(400).json({
        success: false,
        message: '类型必须是 text 或 image'
      });
    }

    const encryptedKey = encrypt(api_key);

    const keyId = await createApiKey({
      user_id: DEFAULT_USER_ID,
      name,
      type,
      provider,
      api_key: encryptedKey,
      base_url,
      model,
      custom_provider_name,
      custom_model_name,
      is_default: is_default || false
    });

    if (is_default) {
      await setDefaultApiKey(DEFAULT_USER_ID, keyId, type);
    }

    res.status(201).json({
      success: true,
      data: { id: keyId },
      message: 'API密钥创建成功'
    });
  } catch (error) {
    console.error('创建API密钥错误:', error);
    res.status(500).json({
      success: false,
      message: '创建API密钥失败'
    });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const keyId = parseInt(id, 10);

    const existingKey = await getApiKeyById(keyId);
    if (!existingKey) {
      return res.status(404).json({
        success: false,
        message: 'API密钥不存在'
      });
    }

    const { name, provider, api_key, base_url, model, custom_provider_name, custom_model_name, is_default, is_active } = req.body;
    const updateData: any = {};

    if (name !== undefined) updateData.name = name;
    if (provider !== undefined) updateData.provider = provider;
    if (api_key) updateData.api_key = encrypt(api_key);
    if (base_url !== undefined) updateData.base_url = base_url;
    if (model !== undefined) updateData.model = model;
    if (custom_provider_name !== undefined) updateData.custom_provider_name = custom_provider_name;
    if (custom_model_name !== undefined) updateData.custom_model_name = custom_model_name;
    if (is_default !== undefined) updateData.is_default = is_default;
    if (is_active !== undefined) updateData.is_active = is_active;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有提供要更新的数据'
      });
    }

    const success = await updateApiKey(keyId, updateData);
    if (!success) {
      return res.status(400).json({
        success: false,
        message: '更新失败'
      });
    }

    if (is_default && existingKey.type) {
      await setDefaultApiKey(DEFAULT_USER_ID, keyId, existingKey.type as 'text' | 'image');
    }

    res.json({
      success: true,
      message: 'API密钥更新成功'
    });
  } catch (error) {
    console.error('更新API密钥错误:', error);
    res.status(500).json({
      success: false,
      message: '更新API密钥失败'
    });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const keyId = parseInt(id, 10);

    const existingKey = await getApiKeyById(keyId);
    if (!existingKey) {
      return res.status(404).json({
        success: false,
        message: 'API密钥不存在'
      });
    }

    const success = await deleteApiKey(keyId);
    if (!success) {
      return res.status(400).json({
        success: false,
        message: '删除失败'
      });
    }

    res.json({
      success: true,
      message: 'API密钥已删除'
    });
  } catch (error) {
    console.error('删除API密钥错误:', error);
    res.status(500).json({
      success: false,
      message: '删除API密钥失败'
    });
  }
});

router.post('/:id/set-default', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const keyId = parseInt(id, 10);

    const existingKey = await getApiKeyById(keyId);
    if (!existingKey) {
      return res.status(404).json({
        success: false,
        message: 'API密钥不存在'
      });
    }

    const success = await setDefaultApiKey(
      DEFAULT_USER_ID,
      keyId,
      existingKey.type as 'text' | 'image'
    );

    if (!success) {
      return res.status(400).json({
        success: false,
        message: '设置默认失败'
      });
    }

    res.json({
      success: true,
      message: '已设置为默认API密钥'
    });
  } catch (error) {
    console.error('设置默认API密钥错误:', error);
    res.status(500).json({
      success: false,
      message: '设置默认API密钥失败'
    });
  }
});

export default router;
