/**
 * API密钥表模型
 * 提供API密钥相关的数据库操作
 */

import { query, insert, update, remove } from '../db/connection.js';

// API密钥接口定义
export interface ApiKey {
  id: number;
  user_id: number;
  name: string;
  type: 'text' | 'image';
  provider: string;
  api_key: string;
  base_url: string | null;
  model: string | null;
  custom_provider_name: string | null;
  custom_model_name: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// 创建API密钥数据
export interface CreateApiKeyData {
  user_id: number;
  name: string;
  type: 'text' | 'image';
  provider: string;
  api_key: string;
  base_url?: string;
  model?: string;
  custom_provider_name?: string;
  custom_model_name?: string;
  is_default?: boolean;
  is_active?: boolean;
}

// 更新API密钥数据
export interface UpdateApiKeyData {
  name?: string;
  provider?: string;
  api_key?: string;
  base_url?: string;
  model?: string;
  custom_provider_name?: string;
  custom_model_name?: string;
  is_default?: boolean;
  is_active?: boolean;
}

/**
 * 根据ID查询API密钥
 */
export async function getApiKeyById(id: number): Promise<ApiKey | null> {
  const keys = await query<ApiKey>(
    'SELECT * FROM api_keys WHERE id = ?',
    [id]
  );
  return keys.length > 0 ? keys[0] : null;
}

/**
 * 根据用户ID查询所有API密钥
 */
export async function getApiKeysByUserId(userId: number): Promise<ApiKey[]> {
  return await query<ApiKey>(
    'SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  );
}

/**
 * 根据用户ID和类型查询API密钥
 */
export async function getApiKeysByUserIdAndType(
  userId: number,
  type: 'text' | 'image'
): Promise<ApiKey[]> {
  return await query<ApiKey>(
    'SELECT * FROM api_keys WHERE user_id = ? AND type = ? ORDER BY is_default DESC, created_at DESC',
    [userId, type]
  );
}

/**
 * 获取用户的默认API密钥
 */
export async function getDefaultApiKey(
  userId: number,
  type: 'text' | 'image'
): Promise<ApiKey | null> {
  const keys = await query<ApiKey>(
    'SELECT * FROM api_keys WHERE user_id = ? AND type = ? AND is_default = 1 AND is_active = 1 LIMIT 1',
    [userId, type]
  );
  return keys.length > 0 ? keys[0] : null;
}

/**
 * 创建API密钥
 */
export async function createApiKey(data: CreateApiKeyData): Promise<number> {
  const result = await insert(
    `INSERT INTO api_keys 
     (user_id, name, type, provider, api_key, base_url, model, custom_provider_name, custom_model_name, is_default, is_active) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.user_id,
      data.name,
      data.type,
      data.provider,
      data.api_key,
      data.base_url || null,
      data.model || null,
      data.custom_provider_name || null,
      data.custom_model_name || null,
      data.is_default ? 1 : 0,
      data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1,
    ]
  );
  return result.insertId;
}

/**
 * 更新API密钥
 */
export async function updateApiKey(id: number, data: UpdateApiKeyData): Promise<boolean> {
  const fields: string[] = [];
  const values: any[] = [];

  if (data.name !== undefined) {
    fields.push('name = ?');
    values.push(data.name);
  }
  if (data.provider !== undefined) {
    fields.push('provider = ?');
    values.push(data.provider);
  }
  if (data.api_key !== undefined) {
    fields.push('api_key = ?');
    values.push(data.api_key);
  }
  if (data.base_url !== undefined) {
    fields.push('base_url = ?');
    values.push(data.base_url);
  }
  if (data.model !== undefined) {
    fields.push('model = ?');
    values.push(data.model);
  }
  if (data.custom_provider_name !== undefined) {
    fields.push('custom_provider_name = ?');
    values.push(data.custom_provider_name);
  }
  if (data.custom_model_name !== undefined) {
    fields.push('custom_model_name = ?');
    values.push(data.custom_model_name);
  }
  if (data.is_default !== undefined) {
    fields.push('is_default = ?');
    values.push(data.is_default ? 1 : 0);
  }
  if (data.is_active !== undefined) {
    fields.push('is_active = ?');
    values.push(data.is_active ? 1 : 0);
  }

  if (fields.length === 0) {
    return false;
  }

  values.push(id);
  const result = await update(
    `UPDATE api_keys SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
  return result.affectedRows > 0;
}

/**
 * 删除API密钥
 */
export async function deleteApiKey(id: number): Promise<boolean> {
  const result = await remove(
    'DELETE FROM api_keys WHERE id = ?',
    [id]
  );
  return result.affectedRows > 0;
}

/**
 * 设置默认API密钥（会先清除同类型其他默认值）
 */
export async function setDefaultApiKey(
  userId: number,
  apiKeyId: number,
  type: 'text' | 'image'
): Promise<boolean> {
  // 先清除同类型的其他默认值
  await update(
    'UPDATE api_keys SET is_default = 0 WHERE user_id = ? AND type = ?',
    [userId, type]
  );

  // 设置新的默认值
  const result = await update(
    'UPDATE api_keys SET is_default = 1 WHERE id = ? AND user_id = ? AND type = ?',
    [apiKeyId, userId, type]
  );
  return result.affectedRows > 0;
}
