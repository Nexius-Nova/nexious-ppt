import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from './auth.js';
import {
  getProjectById,
  getProjectsByUserId,
  getProjectsByStatus,
  createProject,
  updateProject,
  deleteProject,
  getProjectStats
} from '../models/project.js';

const router = Router();

function normalizeProjectText(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isDuplicateEntryError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (error as { code?: string }).code === 'ER_DUP_ENTRY'
  );
}

function duplicateProjectNameResponse(res: Response, title: unknown) {
  const projectTitle = String(title || '').trim() || '当前名称';
  return res.status(409).json({
    success: false,
    code: 'PROJECT_NAME_DUPLICATED',
    message: `项目名称「${projectTitle}」已存在，请换一个名称`
  });
}

function isSameProjectIdentity(
  left: { title: unknown; topic: unknown },
  right: { title: unknown; topic: unknown }
): boolean {
  const leftTitle = normalizeProjectText(left.title);
  const rightTitle = normalizeProjectText(right.title);
  if (!leftTitle || leftTitle !== rightTitle) return false;

  const leftTopic = normalizeProjectText(left.topic);
  const rightTopic = normalizeProjectText(right.topic);
  return leftTopic === rightTopic || !leftTopic || !rightTopic;
}

async function findReusableProjectId(userId: number, title: unknown, topic: unknown): Promise<number | null> {
  if (!normalizeProjectText(title)) return null;

  const projects = await getProjectsByUserId(userId);
  const match = projects.find((project) => isSameProjectIdentity(project, { title, topic }));

  return match?.id || null;
}

async function findDuplicateProjectId(userId: number, title: unknown, excludeId?: number): Promise<number | null> {
  const normalizedTitle = normalizeProjectText(title);
  if (!normalizedTitle) return null;

  const projects = await getProjectsByUserId(userId);
  const match = projects.find((project) =>
    normalizeProjectText(project.title) === normalizedTitle && project.id !== excludeId
  );

  return match?.id || null;
}

router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      });
    }

    const projects = await getProjectsByUserId(req.userId);

    res.json({
      success: true,
      data: projects
    });
  } catch (error) {
    console.error('获取项目列表错误:', error);
    res.status(500).json({
      success: false,
      message: '获取项目列表失败'
    });
  }
});

router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      });
    }

    const stats = await getProjectStats(req.userId);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('获取项目统计错误:', error);
    res.status(500).json({
      success: false,
      message: '获取项目统计失败'
    });
  }
});

router.get('/status/:status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      });
    }

    const { status } = req.params;
    if (!['draft', 'generating', 'completed'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: '状态必须是 draft、generating 或 completed'
      });
    }

    const projects = await getProjectsByStatus(req.userId, status as any);

    res.json({
      success: true,
      data: projects
    });
  } catch (error) {
    console.error('获取项目列表错误:', error);
    res.status(500).json({
      success: false,
      message: '获取项目列表失败'
    });
  }
});

router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      });
    }

    const { id } = req.params;
    const projectId = parseInt(id, 10);

    const project = await getProjectById(projectId);
    if (!project || project.user_id !== req.userId) {
      return res.status(404).json({
        success: false,
        message: '项目不存在'
      });
    }

    res.json({
      success: true,
      data: project
    });
  } catch (error) {
    console.error('获取项目详情错误:', error);
    res.status(500).json({
      success: false,
      message: '获取项目详情失败'
    });
  }
});

router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      });
    }

    const { title, topic, content, status, state } = req.body;
    const compactState = state !== undefined ? compactProjectState(state) : undefined;
    const syncedContent = getProjectContentFromState(compactState) ?? content;

    if (!String(title || '').trim()) {
      return res.status(400).json({
        success: false,
        message: '项目标题不能为空'
      });
    }

    const duplicateProjectId = await findDuplicateProjectId(req.userId, title);
    if (duplicateProjectId) {
      return duplicateProjectNameResponse(res, title);
    }

    const projectId = await createProject({
      user_id: req.userId,
      title,
      topic,
      content: syncedContent,
      status: status || 'draft',
      state: compactState
    });

    res.status(201).json({
      success: true,
      data: { id: projectId },
      message: '项目创建成功'
    });
  } catch (error) {
    console.error('创建项目错误:', error);
    if (isDuplicateEntryError(error)) {
      return duplicateProjectNameResponse(res, req.body?.title);
    }
    res.status(500).json({
      success: false,
      message: '创建项目失败'
    });
  }
});

router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      });
    }

    const { id } = req.params;
    const projectId = parseInt(id, 10);

    const existingProject = await getProjectById(projectId);
    if (!existingProject || existingProject.user_id !== req.userId) {
      const { title, topic, content, status, state } = req.body;
      const compactState = state !== undefined ? compactProjectState(state) : undefined;
      const syncedContent = getProjectContentFromState(compactState) ?? content;
      const fallbackTitle = title || state?.input?.topic || topic || '未命名 PPT';
      const fallbackTopic = topic || state?.input?.topic || '';
      const reusableProjectId = await findReusableProjectId(req.userId, fallbackTitle, fallbackTopic);

      if (reusableProjectId) {
        return res.json({
          success: true,
          data: { id: reusableProjectId, replacedMissingId: projectId, reused: true },
          message: '原项目不存在，已复用已有项目'
        });
      }

      const newProjectId = await createProject({
        user_id: req.userId,
        title: fallbackTitle,
        topic: fallbackTopic,
        content: syncedContent || '',
        status: status || 'draft',
        state: compactState
      });

      return res.status(201).json({
        success: true,
        data: { id: newProjectId, replacedMissingId: projectId },
        message: '原项目不存在，已创建新项目'
      });
    }

    const { title, topic, content, status, state } = req.body;
    const compactState = state !== undefined ? compactProjectState(state) : undefined;
    const syncedContent = getProjectContentFromState(compactState);
    const updateData: any = {};

    if (title !== undefined) updateData.title = title;
    if (topic !== undefined) updateData.topic = topic;
    if (content !== undefined) updateData.content = content;
    if (syncedContent !== undefined) updateData.content = syncedContent;
    if (status !== undefined) updateData.status = status;
    if (state !== undefined) updateData.state = compactState;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有提供要更新的数据'
      });
    }

    if (updateData.title !== undefined) {
      if (!String(updateData.title || '').trim()) {
        return res.status(400).json({
          success: false,
          message: '项目标题不能为空'
        });
      }
      const duplicateProjectId = await findDuplicateProjectId(req.userId, updateData.title, projectId);
      if (duplicateProjectId) {
        return duplicateProjectNameResponse(res, updateData.title);
      }
    }

    const success = await updateProject(projectId, updateData);
    if (!success) {
      return res.status(400).json({
        success: false,
        message: '更新失败'
      });
    }

    res.json({
      success: true,
      message: '项目更新成功'
    });
  } catch (error) {
    console.error('更新项目错误:', error);
    if (isDuplicateEntryError(error)) {
      return duplicateProjectNameResponse(res, req.body?.title);
    }
    res.status(500).json({
      success: false,
      message: '更新项目失败'
    });
  }
});

router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      });
    }

    const { id } = req.params;
    const projectId = parseInt(id, 10);

    const existingProject = await getProjectById(projectId);
    if (!existingProject || existingProject.user_id !== req.userId) {
      return res.status(404).json({
        success: false,
        message: '项目不存在'
      });
    }

    const success = await deleteProject(projectId);
    if (!success) {
      return res.status(400).json({
        success: false,
        message: '删除失败'
      });
    }

    res.json({
      success: true,
      message: '项目已删除'
    });
  } catch (error) {
    console.error('删除项目错误:', error);
    res.status(500).json({
      success: false,
      message: '删除项目失败'
    });
  }
});

export default router;

function getProjectContentFromState(state: any): string | undefined {
  if (!state || typeof state !== 'object' || !state.input || typeof state.input !== 'object') return undefined;
  if (!('content' in state.input)) return undefined;
  return String(state.input.content || '');
}

function compactProjectState(state: any) {
  if (!state || typeof state !== 'object') return state;
  const compactInput = state.input
    ? {
        ...state.input,
        files: Array.isArray(state.input.files)
          ? state.input.files.filter((file: any) => typeof file === 'string')
          : [],
      }
    : state.input;

  return {
    ...state,
    input: compactInput,
    images: Array.isArray(state.images)
      ? state.images.map((image: any) => ({
          ...image,
          url: typeof image.url === 'string' && image.url.startsWith('data:') ? '' : image.url,
        }))
      : state.images,
    svgPages: Array.isArray(state.svgPages)
      ? state.svgPages.map((page: any) => ({
          pageNumber: page.pageNumber,
          svg: typeof page.svg === 'string' ? page.svg : '',
          speakerNotes: page.speakerNotes || '',
        }))
      : [],
  };
}
