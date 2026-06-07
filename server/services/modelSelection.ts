import { getApiKeyByIdForUserAndType, getDefaultApiKey, type ApiKey } from '../models/apiKey.js';

export type GenerationModelType = 'text' | 'image';

function parseModelId(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function resolveGenerationApiKey(
  userId: number,
  type: GenerationModelType,
  selectedModelId?: unknown
): Promise<ApiKey | null> {
  const parsedId = parseModelId(selectedModelId);
  if (!parsedId) {
    return getDefaultApiKey(userId, type);
  }

  const key = await getApiKeyByIdForUserAndType(userId, parsedId, type, true);
  if (!key) {
    const label = type === 'text' ? '文本模型' : '图片模型';
    throw new Error(`当前 PPT 选择的${label}不可用，请重新选择或清空为默认模型`);
  }
  return key;
}
