/**
 * Express 服务器入口文件
 * 提供 API 接口供前端调用
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { randomUUID } from 'crypto';
import { testConnection, closePool } from './db/connection.js';
import authRoutes, { authMiddleware } from './routes/auth.js';
import apiKeyRoutes from './routes/apiKeys.js';
import projectRoutes from './routes/projects.js';
import aiRoutes from './routes/ai.js';
import promptRoutes from './routes/prompts.js';
import skillRoutes from './routes/skills.js';
import templateRoutes from './routes/templates.js';
import configRoutes from './routes/configs.js';
import workflowRoutes from './routes/workflows.js';
import versionRoutes from './routes/versions.js';
import generateRoutes from './routes/generate.js';
import generationJobRoutes from './routes/generationJobs.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '30mb';
app.disable('x-powered-by');
const allowLocalDevOrigins = process.env.NODE_ENV !== 'production';
const allowedOrigins = new Set(
  [
    ...(allowLocalDevOrigins ? ['http://localhost:3000', 'http://localhost:5173'] : []),
    ...(process.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) || []),
  ]
);
const localDevOriginPattern = /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/;

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin) || (allowLocalDevOrigins && localDevOriginPattern.test(origin))) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true
}));

app.use((req, res, next) => {
  const requestId = req.headers['x-request-id']?.toString() || randomUUID();
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  (req as any).requestId = requestId;
  next();
});

app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use('/generated-images', authMiddleware, express.static(path.join(process.cwd(), '.generated', 'images')));
app.use('/avatars', authMiddleware, express.static(path.join(process.cwd(), '.generated', 'avatars')));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get('/api', (req, res) => {
  res.json({
    message: 'Nexious-PPT API Server',
    version: '0.1.0',
    endpoints: {
      health: '/health',
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        me: 'GET /api/auth/me',
        updateMe: 'PUT /api/auth/me',
        deleteMe: 'DELETE /api/auth/me'
      },
      apiKeys: {
        list: 'GET /api/api-keys',
        listByType: 'GET /api/api-keys/type/:type',
        default: 'GET /api/api-keys/default/:type',
        create: 'POST /api/api-keys',
        update: 'PUT /api/api-keys/:id',
        delete: 'DELETE /api/api-keys/:id',
        setDefault: 'POST /api/api-keys/:id/set-default'
      },
      projects: {
        list: 'GET /api/projects',
        stats: 'GET /api/projects/stats',
        listByStatus: 'GET /api/projects/status/:status',
        get: 'GET /api/projects/:id',
        create: 'POST /api/projects',
        update: 'PUT /api/projects/:id',
        delete: 'DELETE /api/projects/:id'
      }
    },
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/api-keys', apiKeyRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/prompts', promptRoutes);
app.use('/api/skills', skillRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/configs', configRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/versions', versionRoutes);
app.use('/api/generation-jobs', generationJobRoutes);
app.use('/api/generate', generateRoutes);

app.use((req, res) => {
  const requestId = (req as any).requestId || res.getHeader('X-Request-Id');
  res.status(404).json({
    success: false,
    code: 'NOT_FOUND',
    message: '接口不存在',
    requestId
  });
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const requestId = (req as any).requestId || res.getHeader('X-Request-Id');
  console.error('服务器错误:', { requestId, message: err?.message, stack: err?.stack });
  const status = err?.type === 'entity.too.large' ? 413 : 500;
  res.status(status).json({
    success: false,
    code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'SERVER_ERROR',
    message: status === 413 ? '请求内容过大，请减少内容后重试' : '服务器内部错误',
    requestId,
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

async function startServer() {
  try {
    const dbConnected = await testConnection();

    if (!dbConnected) {
      console.error('❌ 数据库连接失败，请检查配置');
      process.exit(1);
    }

    const server = app.listen(PORT, () => {
      console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
      console.log(`📡 API 文档: http://localhost:${PORT}/api`);
      console.log(`💚 健康检查: http://localhost:${PORT}/health`);
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Stop the existing server or set a different PORT in .env.`);
        process.exit(1);
      }

      throw error;
    });
  } catch (error) {
    console.error('❌ 服务器启动失败:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  console.log('\n🛑 收到 SIGTERM 信号，正在关闭服务器...');
  await closePool();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 收到 SIGINT 信号，正在关闭服务器...');
  await closePool();
  process.exit(0);
});

startServer();
