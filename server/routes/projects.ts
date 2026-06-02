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
import {
  getSlidesByProjectId,
  createSlide,
  updateSlide,
  deleteSlide,
  updateSlideOrder
} from '../models/slide.js';
import {
  getImagesBySlideId,
  createImage,
  updateImage,
  deleteImage,
  selectImage
} from '../models/image.js';

const router = Router();

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

    const slides = await getSlidesByProjectId(projectId);

    res.json({
      success: true,
      data: {
        ...project,
        slides
      }
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

    const { title, topic, content, status, settings } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        message: '项目标题不能为空'
      });
    }

    const projectId = await createProject({
      user_id: req.userId,
      title,
      topic,
      content,
      status: status || 'draft',
      settings
    });

    res.status(201).json({
      success: true,
      data: { id: projectId },
      message: '项目创建成功'
    });
  } catch (error) {
    console.error('创建项目错误:', error);
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
      return res.status(404).json({
        success: false,
        message: '项目不存在'
      });
    }

    const { title, topic, content, status, settings, state } = req.body;
    const updateData: any = {};

    if (title !== undefined) updateData.title = title;
    if (topic !== undefined) updateData.topic = topic;
    if (content !== undefined) updateData.content = content;
    if (status !== undefined) updateData.status = status;
    if (settings !== undefined) updateData.settings = settings;
    if (state !== undefined) updateData.state = compactProjectState(state);

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有提供要更新的数据'
      });
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

router.get('/:id/slides', authMiddleware, async (req: AuthRequest, res: Response) => {
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

    const slides = await getSlidesByProjectId(projectId);

    res.json({
      success: true,
      data: slides
    });
  } catch (error) {
    console.error('获取幻灯片列表错误:', error);
    res.status(500).json({
      success: false,
      message: '获取幻灯片列表失败'
    });
  }
});

router.post('/:id/slides', authMiddleware, async (req: AuthRequest, res: Response) => {
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

    const { title, bullets, speaker_notes, visual_prompt, order_index } = req.body;

    const slideId = await createSlide({
      project_id: projectId,
      title,
      bullets,
      speaker_notes,
      visual_prompt,
      order_index
    });

    res.status(201).json({
      success: true,
      data: { id: slideId },
      message: '幻灯片创建成功'
    });
  } catch (error) {
    console.error('创建幻灯片错误:', error);
    res.status(500).json({
      success: false,
      message: '创建幻灯片失败'
    });
  }
});

router.put('/:projectId/slides/:slideId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      });
    }

    const { projectId, slideId } = req.params;
    const projId = parseInt(projectId, 10);
    const slId = parseInt(slideId, 10);

    const project = await getProjectById(projId);
    if (!project || project.user_id !== req.userId) {
      return res.status(404).json({
        success: false,
        message: '项目不存在'
      });
    }

    const { title, bullets, speaker_notes, visual_prompt, image_url, order_index } = req.body;

    const success = await updateSlide(slId, {
      title,
      bullets,
      speaker_notes,
      visual_prompt,
      image_url,
      order_index
    });

    if (!success) {
      return res.status(400).json({
        success: false,
        message: '更新失败'
      });
    }

    res.json({
      success: true,
      message: '幻灯片更新成功'
    });
  } catch (error) {
    console.error('更新幻灯片错误:', error);
    res.status(500).json({
      success: false,
      message: '更新幻灯片失败'
    });
  }
});

router.delete('/:projectId/slides/:slideId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      });
    }

    const { projectId, slideId } = req.params;
    const projId = parseInt(projectId, 10);
    const slId = parseInt(slideId, 10);

    const project = await getProjectById(projId);
    if (!project || project.user_id !== req.userId) {
      return res.status(404).json({
        success: false,
        message: '项目不存在'
      });
    }

    const success = await deleteSlide(slId);
    if (!success) {
      return res.status(400).json({
        success: false,
        message: '删除失败'
      });
    }

    res.json({
      success: true,
      message: '幻灯片已删除'
    });
  } catch (error) {
    console.error('删除幻灯片错误:', error);
    res.status(500).json({
      success: false,
      message: '删除幻灯片失败'
    });
  }
});

router.get('/:projectId/slides/:slideId/images', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      });
    }

    const { projectId, slideId } = req.params;
    const projId = parseInt(projectId, 10);
    const slId = parseInt(slideId, 10);

    const project = await getProjectById(projId);
    if (!project || project.user_id !== req.userId) {
      return res.status(404).json({
        success: false,
        message: '项目不存在'
      });
    }

    const images = await getImagesBySlideId(slId);

    res.json({
      success: true,
      data: images
    });
  } catch (error) {
    console.error('获取图片列表错误:', error);
    res.status(500).json({
      success: false,
      message: '获取图片列表失败'
    });
  }
});

router.post('/:projectId/slides/:slideId/images', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      });
    }

    const { projectId, slideId } = req.params;
    const projId = parseInt(projectId, 10);
    const slId = parseInt(slideId, 10);

    const project = await getProjectById(projId);
    if (!project || project.user_id !== req.userId) {
      return res.status(404).json({
        success: false,
        message: '项目不存在'
      });
    }

    const { prompt, style, url, is_selected } = req.body;

    const imageId = await createImage({
      slide_id: slId,
      prompt,
      style,
      url,
      is_selected
    });

    res.status(201).json({
      success: true,
      data: { id: imageId },
      message: '图片创建成功'
    });
  } catch (error) {
    console.error('创建图片错误:', error);
    res.status(500).json({
      success: false,
      message: '创建图片失败'
    });
  }
});

router.put('/:projectId/slides/:slideId/images/:imageId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      });
    }

    const { projectId, imageId } = req.params;
    const projId = parseInt(projectId, 10);
    const imgId = parseInt(imageId, 10);

    const project = await getProjectById(projId);
    if (!project || project.user_id !== req.userId) {
      return res.status(404).json({
        success: false,
        message: '项目不存在'
      });
    }

    const { url, is_selected } = req.body;

    const success = await updateImage(imgId, { url, is_selected });

    if (!success) {
      return res.status(400).json({
        success: false,
        message: '更新失败'
      });
    }

    res.json({
      success: true,
      message: '图片更新成功'
    });
  } catch (error) {
    console.error('更新图片错误:', error);
    res.status(500).json({
      success: false,
      message: '更新图片失败'
    });
  }
});

router.post('/:projectId/slides/:slideId/images/:imageId/select', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      });
    }

    const { projectId, slideId, imageId } = req.params;
    const projId = parseInt(projectId, 10);
    const slId = parseInt(slideId, 10);
    const imgId = parseInt(imageId, 10);

    const project = await getProjectById(projId);
    if (!project || project.user_id !== req.userId) {
      return res.status(404).json({
        success: false,
        message: '项目不存在'
      });
    }

    const success = await selectImage(slId, imgId);

    if (!success) {
      return res.status(400).json({
        success: false,
        message: '设置选中失败'
      });
    }

    res.json({
      success: true,
      message: '已选为当前图片'
    });
  } catch (error) {
    console.error('设置选中图片错误:', error);
    res.status(500).json({
      success: false,
      message: '设置选中图片失败'
    });
  }
});

export default router;

function compactProjectState(state: any) {
  if (!state || typeof state !== 'object') return state;
  return {
    ...state,
    input: state.input ? { ...state.input, files: [] } : state.input,
    images: Array.isArray(state.images)
      ? state.images.map((image: any) => ({
          ...image,
          url: typeof image.url === 'string' && image.url.startsWith('data:') ? '' : image.url,
        }))
      : state.images,
    svgPages: Array.isArray(state.svgPages)
      ? state.svgPages.map((page: any) => ({
          pageNumber: page.pageNumber,
          svg: '',
          speakerNotes: page.speakerNotes || '',
        }))
      : [],
  };
}
