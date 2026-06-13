/**
 * BullMQ Worker 独立进程入口
 * 将生成/导出任务从主 Express 进程中分离，避免影响 API 响应速度
 */
import './utils/env.js';

import { testConnection, closePool } from './db/connection.js';
import { initRedisQueue, shutdownRedisQueue } from './services/generationQueue.js';

async function startWorker() {
  console.log('[Worker] 正在启动 BullMQ Worker 进程...');

  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.error('[Worker] 数据库连接失败，退出');
    process.exit(1);
  }

  const initialized = await initRedisQueue({ startWorker: true });
  if (!initialized) {
    // Redis 队列不可用（如版本不兼容），主进程已降级到内存队列模式，
    // 任务会在主进程中直接执行，Worker 进程无需继续运行。
    console.warn('[Worker] Redis 队列不可用，主进程已降级到内存队列模式，Worker 进程无需运行');
    console.log('[Worker] 如需使用 BullMQ Worker，请升级 Redis 至 6.2.0+ 并设置 maxmemory-policy=noeviction');
    process.exit(0);
  }

  console.log('[Worker] BullMQ Worker 已就绪，等待任务...');

  process.on('SIGTERM', async () => {
    console.log('[Worker] 收到 SIGTERM，正在关闭...');
    await shutdownRedisQueue();
    await closePool();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('[Worker] 收到 SIGINT，正在关闭...');
    await shutdownRedisQueue();
    await closePool();
    process.exit(0);
  });
}

startWorker().catch((err) => {
  console.error('[Worker] 启动失败:', err);
  process.exit(1);
});
