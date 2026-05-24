/**
 * 加密工具类
 * 用于加密和解密敏感信息（如API密钥）
 */

import crypto from 'crypto';

// 加密算法
const ALGORITHM = 'aes-256-cbc';
// 从环境变量获取加密密钥，如果没有则使用默认值（生产环境必须设置）
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'nexious-ppt-default-32-char-key';
// 确保密钥长度为32字节
const KEY = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);

/**
 * 加密文本
 * @param text 要加密的文本
 * @returns 加密后的字符串（格式：iv:encryptedData）
 */
export function encrypt(text: string): string {
  // 生成随机初始化向量
  const iv = crypto.randomBytes(16);

  // 创建加密器
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);

  // 加密数据
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // 返回格式：iv:encryptedData
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * 解密文本
 * @param encryptedData 加密的字符串（格式：iv:encryptedData）
 * @returns 解密后的原始文本
 */
export function decrypt(encryptedData: string): string {
  try {
    if (!encryptedData || typeof encryptedData !== 'string') {
      throw new Error('Invalid encrypted data: empty or not a string');
    }
    
    const [ivHex, encrypted] = encryptedData.split(':');

    if (!ivHex || !encrypted) {
      console.error('Invalid encrypted data format:', encryptedData.substring(0, 20));
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(ivHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('解密失败:', error);
    throw new Error('解密失败，请重新配置 API Key');
  }
}

/**
 * 哈希密码
 * @param password 原始密码
 * @returns 哈希后的密码
 */
export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * 验证密码
 * @param password 原始密码
 * @param hash 哈希值
 * @returns 是否匹配
 */
export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

/**
 * 生成随机令牌
 * @param length 令牌长度（默认32）
 * @returns 随机令牌
 */
export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * 生成UUID
 * @returns UUID字符串
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}
