import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from './auth.js';
import {
  createGenerationJob,
  getGenerationJobById,
  getGenerationJobsByProject,
  getRecentGenerationJobs,
  updateGenerationJob,
  type GenerationJobStatus,
} from '../models/generationJob.js';

const router = Router();
const ALLOWED_STATUSES = new Set<GenerationJobStatus>([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

router.use(authMiddleware);

function parseLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(1, Math.min(100, Math.round(parsed)));
}

function normalizeJob(job: any) {
  let metadata = {};
  try {
    metadata = typeof job.metadata === 'string'
      ? JSON.parse(job.metadata || '{}')
      : job.metadata || {};
  } catch {
    metadata = {};
  }

  return {
    ...job,
    metadata,
  };
}

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { projectId, title, metadata } = req.body || {};
    const normalizedProjectId = String(projectId || '').trim();

    if (!normalizedProjectId) {
      return res.status(400).json({
        success: false,
        code: 'PROJECT_REQUIRED',
        message: '缺少 PPT 项目 ID',
      });
    }

    const id = await createGenerationJob({
      userId,
      projectId: normalizedProjectId,
      title: typeof title === 'string' ? title.trim() : undefined,
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
    });

    res.status(201).json({ success: true, data: { id }, message: '生成任务已创建' });
  } catch (error) {
    console.error('创建生成任务失败:', error);
    res.status(500).json({ success: false, message: '创建生成任务失败' });
  }
});

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const jobs = await getRecentGenerationJobs(req.userId!, parseLimit(req.query.limit));
    res.json({ success: true, data: jobs.map(normalizeJob) });
  } catch (error) {
    console.error('获取生成任务失败:', error);
    res.status(500).json({ success: false, message: '获取生成任务失败' });
  }
});

router.get('/project/:projectId', async (req: AuthRequest, res: Response) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) {
      return res.status(400).json({ success: false, message: '缺少 PPT 项目 ID' });
    }

    const jobs = await getGenerationJobsByProject(req.userId!, projectId, parseLimit(req.query.limit));
    res.json({ success: true, data: jobs.map(normalizeJob) });
  } catch (error) {
    console.error('获取项目生成任务失败:', error);
    res.status(500).json({ success: false, message: '获取项目生成任务失败' });
  }
});

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, message: '无效的生成任务 ID' });
    }

    const existing = await getGenerationJobById(id);
    if (!existing || existing.user_id !== userId) {
      return res.status(404).json({ success: false, message: '生成任务不存在' });
    }

    const { status, phase, progress, errorMessage, metadata } = req.body || {};
    if (status !== undefined && !ALLOWED_STATUSES.has(status as GenerationJobStatus)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_STATUS',
        message: '无效的生成任务状态',
      });
    }

    const nextProgress = progress === undefined ? undefined : Number(progress);
    if (nextProgress !== undefined && !Number.isFinite(nextProgress)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PROGRESS',
        message: '无效的生成任务进度',
      });
    }

    const updated = await updateGenerationJob(id, userId, {
      status: status as GenerationJobStatus | undefined,
      phase: typeof phase === 'string' ? phase.trim().slice(0, 50) : undefined,
      progress: nextProgress,
      errorMessage: errorMessage === undefined ? undefined : String(errorMessage || '').slice(0, 2000),
      metadata: metadata && typeof metadata === 'object' ? metadata : undefined,
    });

    res.json({ success: true, data: { updated } });
  } catch (error) {
    console.error('更新生成任务失败:', error);
    res.status(500).json({ success: false, message: '更新生成任务失败' });
  }
});

router.post('/:id/cancel', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, message: '无效的生成任务 ID' });
    }

    const existing = await getGenerationJobById(id);
    if (!existing || existing.user_id !== userId) {
      return res.status(404).json({ success: false, message: '生成任务不存在' });
    }

    await updateGenerationJob(id, userId, {
      status: 'cancelled',
      phase: 'cancelled',
      progress: existing.progress,
    });

    res.json({ success: true, message: '生成任务已取消' });
  } catch (error) {
    console.error('取消生成任务失败:', error);
    res.status(500).json({ success: false, message: '取消生成任务失败' });
  }
});

export default router;
