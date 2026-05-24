import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from './auth.js';
import { query } from '../db/connection.js';

const router = Router();

router.use(authMiddleware);

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const prompts = await query(
      'SELECT id, title, scene, content, created_at, updated_at FROM prompts WHERE user_id = ? ORDER BY updated_at DESC',
      [req.userId]
    );
    res.json({ success: true, data: prompts });
  } catch (error) {
    console.error('获取提示词列表失败:', error);
    res.status(500).json({ success: false, message: '获取提示词列表失败' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const prompts = await query(
      'SELECT id, title, scene, content, created_at, updated_at FROM prompts WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (prompts.length === 0) {
      return res.status(404).json({ success: false, message: '提示词不存在' });
    }
    res.json({ success: true, data: prompts[0] });
  } catch (error) {
    console.error('获取提示词详情失败:', error);
    res.status(500).json({ success: false, message: '获取提示词详情失败' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { title, scene, content } = req.body;
    if (!title || !content) {
      return res.status(400).json({ success: false, message: '标题和内容不能为空' });
    }
    const result = await query(
      'INSERT INTO prompts (user_id, title, scene, content) VALUES (?, ?, ?, ?)',
      [req.userId, title, scene || '', content]
    );
    const newPrompt = await query(
      'SELECT id, title, scene, content, created_at, updated_at FROM prompts WHERE id = ?',
      [(result as any).insertId]
    );
    res.status(201).json({ success: true, data: newPrompt[0], message: '提示词创建成功' });
  } catch (error) {
    console.error('创建提示词失败:', error);
    res.status(500).json({ success: false, message: '创建提示词失败' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { title, scene, content } = req.body;
    const existing = await query(
      'SELECT id FROM prompts WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '提示词不存在' });
    }
    await query(
      'UPDATE prompts SET title = ?, scene = ?, content = ? WHERE id = ?',
      [title, scene || '', content, req.params.id]
    );
    const updated = await query(
      'SELECT id, title, scene, content, created_at, updated_at FROM prompts WHERE id = ?',
      [req.params.id]
    );
    res.json({ success: true, data: updated[0], message: '提示词更新成功' });
  } catch (error) {
    console.error('更新提示词失败:', error);
    res.status(500).json({ success: false, message: '更新提示词失败' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await query(
      'SELECT id FROM prompts WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '提示词不存在' });
    }
    await query('DELETE FROM prompts WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: '提示词删除成功' });
  } catch (error) {
    console.error('删除提示词失败:', error);
    res.status(500).json({ success: false, message: '删除提示词失败' });
  }
});

export default router;
