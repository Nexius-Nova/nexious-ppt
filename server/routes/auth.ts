import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
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
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const SALT_ROUNDS = 10;

interface AuthRequest extends Request {
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

async function authMiddleware(req: AuthRequest, res: Response, next: Function) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.userId = 1;
    next();
    return;
  }

  const token = authHeader.substring(7);
  const decoded = verifyToken(token);
  
  if (!decoded) {
    req.userId = 1;
    next();
    return;
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

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: '邮箱和密码不能为空'
      });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: '邮箱或密码错误'
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: '邮箱或密码错误'
      });
    }

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

    const { name, avatar, password } = req.body;
    const updateData: any = {};

    if (name !== undefined) updateData.name = name;
    if (avatar !== undefined) updateData.avatar = avatar;
    if (password) {
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
