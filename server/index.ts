/**
 * Express 服务器入口文件
 * 提供 API 接口供前端调用
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { testConnection, closePool } from './db/connection.js';
import authRoutes from './routes/auth.js';
import apiKeyRoutes from './routes/apiKeys.js';
import projectRoutes from './routes/projects.js';
import aiRoutes from './routes/ai.js';
import promptRoutes from './routes/prompts.js';
import skillRoutes from './routes/skills.js';
import templateRoutes from './routes/templates.js';
import configRoutes from './routes/configs.js';
import workflowRoutes from './routes/workflows.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
        delete: 'DELETE /api/projects/:id',
        slides: {
          list: 'GET /api/projects/:id/slides',
          create: 'POST /api/projects/:id/slides',
          update: 'PUT /api/projects/:projectId/slides/:slideId',
          delete: 'DELETE /api/projects/:projectId/slides/:slideId',
          images: {
            list: 'GET /api/projects/:projectId/slides/:slideId/images',
            create: 'POST /api/projects/:projectId/slides/:slideId/images',
            update: 'PUT /api/projects/:projectId/slides/:slideId/images/:imageId',
            select: 'POST /api/projects/:projectId/slides/:slideId/images/:imageId/select'
          }
        }
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

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: '接口不存在'
  });
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('服务器错误:', err);
  res.status(500).json({
    success: false,
    message: '服务器内部错误',
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

    app.listen(PORT, () => {
      console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
      console.log(`📡 API 文档: http://localhost:${PORT}/api`);
      console.log(`💚 健康检查: http://localhost:${PORT}/health`);
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
