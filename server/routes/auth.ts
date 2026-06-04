import express, { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import {
  getUserById,
  getUserByEmail,
  createUser,
  updateUser,
  deleteUser,
  getAllUsers,
  getUserCount
} from '../models/user.js';
import { encrypt, decrypt } from '../utils/crypto.js';

const router = Router();
const DEFAULT_JWT_SECRET = 'your-secret-key-change-in-production';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
const SALT_ROUNDS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 8);
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const loginAttempts = new Map<string, { count: number; firstAt: number }>();

if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEFAULT_JWT_SECRET) {
  throw new Error('JWT_SECRET must be configured in production');
}

export interface AuthRequest extends Request {
  userId?: number;
}

function generateToken(userId: number): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token: string): { userId: number } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: number };
  } catch {
    return null;
  }
}

function loginAttemptKey(req: Request, email: unknown): string {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return `${ip}:${String(email || '').trim().toLowerCase()}`;
}

function isLoginRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 0, firstAt: now });
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function recordLoginFailure(key: string) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
}

function clearLoginFailures(key: string) {
  loginAttempts.delete(key);
}

async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      code: 'UNAUTHORIZED',
      message: '请先登录后再操作'
    });
  }

  const token = authHeader.substring(7);
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({
      success: false,
      code: 'TOKEN_INVALID',
      message: '登录状态已失效，请重新登录'
    });
  }

  req.userId = decoded.userId;
  next();
}

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: '邮箱和密码不能为空'
      });
    }

    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: '该邮箱已被注册'
      });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const userId = await createUser({
      email,
      password_hash: passwordHash,
      name
    });

    const token = generateToken(userId);

    res.status(201).json({
      success: true,
      data: {
        userId,
        email,
        name,
        token
      },
      message: '注册成功'
    });
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({
      success: false,
      message: '注册失败',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const attemptKey = loginAttemptKey(req, email);

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: '邮箱和密码不能为空'
      });
    }

    if (isLoginRateLimited(attemptKey)) {
      return res.status(429).json({
        success: false,
        code: 'LOGIN_RATE_LIMITED',
        message: '登录失败次数过多，请稍后再试'
      });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      recordLoginFailure(attemptKey);
      return res.status(401).json({
        success: false,
        message: '邮箱或密码错误'
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      recordLoginFailure(attemptKey);
      return res.status(401).json({
        success: false,
        message: '邮箱或密码错误'
      });
    }

    clearLoginFailures(attemptKey);
    const token = generateToken(user.id);

    res.json({
      success: true,
      data: {
        userId: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        token
      },
      message: '登录成功'
    });
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({
      success: false,
      message: '登录失败',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      });
    }

    const user = await getUserById(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    res.json({
      success: true,
      data: {
        userId: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(500).json({
      success: false,
      message: '获取用户信息失败'
    });
  }
});

router.put('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      });
    }

    const { name, avatar, currentPassword, password } = req.body;
    const updateData: any = {};

    if (name !== undefined) updateData.name = name;
    if (avatar !== undefined) {
      const avatarValue = String(avatar || '');
      if (avatarValue.startsWith('data:')) {
        return res.status(400).json({
          success: false,
          message: '头像请通过上传接口保存，不能写入 base64 数据'
        });
      }
      if (avatarValue.length > 500) {
        return res.status(400).json({
          success: false,
          message: '头像地址过长'
        });
      }
      updateData.avatar = avatarValue || null;
    }
    if (password) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: '请输入当前密码'
        });
      }
      if (String(password).length < 8) {
        return res.status(400).json({
          success: false,
          message: '新密码至少 8 位'
        });
      }
      const currentUser = await getUserById(req.userId);
      if (!currentUser || !(await bcrypt.compare(currentPassword, currentUser.password_hash))) {
        return res.status(400).json({
          success: false,
          message: '当前密码不正确'
        });
      }
      updateData.password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有提供要更新的数据'
      });
    }

    const success = await updateUser(req.userId, updateData);
    if (!success) {
      return res.status(400).json({
        success: false,
        message: '更新失败'
      });
    }

    const user = await getUserById(req.userId);
    res.json({
      success: true,
      data: {
        userId: user?.id,
        email: user?.email,
        name: user?.name,
        avatar: user?.avatar
      },
      message: '更新成功'
    });
  } catch (error) {
    console.error('更新用户信息错误:', error);
    res.status(500).json({
      success: false,
      message: '更新用户信息失败'
    });
  }
});

router.put(
  '/me/avatar',
  authMiddleware,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], limit: AVATAR_MAX_BYTES }),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.userId) {
        return res.status(401).json({
          success: false,
          message: '未授权'
        });
      }

      const mimeType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() || '';
      const ext = AVATAR_MIME_EXT[mimeType];
      if (!ext) {
        return res.status(400).json({
          success: false,
          message: '仅支持 JPG、PNG、WEBP 或 GIF 图片'
        });
      }

      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({
          success: false,
          message: '请选择头像图片'
        });
      }

      const avatarDir = path.join(process.cwd(), '.generated', 'avatars');
      await fs.mkdir(avatarDir, { recursive: true });
      const fileName = `${req.userId}-${Date.now()}-${randomUUID()}.${ext}`;
      const filePath = path.join(avatarDir, fileName);
      await fs.writeFile(filePath, req.body);

      const avatarUrl = `/avatars/${fileName}`;
      const success = await updateUser(req.userId, { avatar: avatarUrl });
      if (!success) {
        return res.status(400).json({
          success: false,
          message: '头像保存失败'
        });
      }

      const user = await getUserById(req.userId);
      res.json({
        success: true,
        data: {
          userId: user?.id,
          email: user?.email,
          name: user?.name,
          avatar: user?.avatar
        },
        message: '头像已更新'
      });
    } catch (error) {
      console.error('上传头像错误:', error);
      res.status(500).json({
        success: false,
        message: '上传头像失败'
      });
    }
  }
);

router.delete('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      });
    }

    const success = await deleteUser(req.userId);
    if (!success) {
      return res.status(400).json({
        success: false,
        message: '删除失败'
      });
    }

    res.json({
      success: true,
      message: '账户已删除'
    });
  } catch (error) {
    console.error('删除用户错误:', error);
    res.status(500).json({
      success: false,
      message: '删除用户失败'
    });
  }
});

export default router;
export { authMiddleware };
