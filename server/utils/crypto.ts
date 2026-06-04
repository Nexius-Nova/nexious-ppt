import crypto from 'crypto';

const DEFAULT_ENCRYPTION_KEY = 'nexious-ppt-default-32-char-key';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || DEFAULT_ENCRYPTION_KEY;
const KEY = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);

if (process.env.NODE_ENV === 'production' && ENCRYPTION_KEY === DEFAULT_ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY must be configured in production');
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return [
    'v2',
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex')
  ].join(':');
}

export function decrypt(encryptedData: string): string {
  try {
    if (!encryptedData || typeof encryptedData !== 'string') {
      throw new Error('Invalid encrypted data');
    }

    const parts = encryptedData.split(':');
    if (parts[0] === 'v2') {
      const [, ivHex, authTagHex, encryptedHex] = parts;
      if (!ivHex || !authTagHex || !encryptedHex) {
        throw new Error('Invalid AES-GCM encrypted data format');
      }

      const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedHex, 'hex')),
        decipher.final()
      ]);
      return decrypted.toString('utf8');
    }

    // Backward compatibility for existing aes-256-cbc values: iv:encrypted.
    const [ivHex, encrypted] = parts;
    if (!ivHex || !encrypted) {
      throw new Error('Invalid legacy encrypted data format');
    }

    const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, Buffer.from(ivHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('解密失败:', error);
    throw new Error('解密失败，请重新配置 API Key');
  }
}

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

export function generateUUID(): string {
  return crypto.randomUUID();
}
