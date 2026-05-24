import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from './auth.js';
import { query } from '../db/connection.js';

const router = Router();

router.use(authMiddleware);

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const skills = await query(
      'SELECT id, name, description, icon, category, parameters, is_enabled, created_at, updated_at FROM skills WHERE user_id = ? ORDER BY created_at DESC',
      [req.userId]
    );
    res.json({ success: true, data: skills });
  } catch (error) {
    console.error('获取技能列表失败:', error);
    res.status(500).json({ success: false, message: '获取技能列表失败' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const skills = await query(
      'SELECT id, name, description, icon, category, parameters, is_enabled, created_at, updated_at FROM skills WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (skills.length === 0) {
      return res.status(404).json({ success: false, message: '技能不存在' });
    }
    res.json({ success: true, data: skills[0] });
  } catch (error) {
    console.error('获取技能详情失败:', error);
    res.status(500).json({ success: false, message: '获取技能详情失败' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, icon, category, parameters, is_enabled } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: '技能名称不能为空' });
    }
    const result = await query(
      'INSERT INTO skills (user_id, name, description, icon, category, parameters, is_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.userId, name, description || '', icon || 'Zap', category || '其他', JSON.stringify(parameters || {}), is_enabled ? 1 : 0]
    );
    const newSkill = await query(
      'SELECT id, name, description, icon, category, parameters, is_enabled, created_at, updated_at FROM skills WHERE id = ?',
      [(result as any).insertId]
    );
    res.status(201).json({ success: true, data: newSkill[0], message: '技能创建成功' });
  } catch (error) {
    console.error('创建技能失败:', error);
    res.status(500).json({ success: false, message: '创建技能失败' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, icon, category, parameters, is_enabled } = req.body;
    const existing = await query(
      'SELECT id FROM skills WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '技能不存在' });
    }
    await query(
      'UPDATE skills SET name = ?, description = ?, icon = ?, category = ?, parameters = ?, is_enabled = ? WHERE id = ?',
      [name, description || '', icon || 'Zap', category || '其他', JSON.stringify(parameters || {}), is_enabled ? 1 : 0, req.params.id]
    );
    const updated = await query(
      'SELECT id, name, description, icon, category, parameters, is_enabled, created_at, updated_at FROM skills WHERE id = ?',
      [req.params.id]
    );
    res.json({ success: true, data: updated[0], message: '技能更新成功' });
  } catch (error) {
    console.error('更新技能失败:', error);
    res.status(500).json({ success: false, message: '更新技能失败' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await query(
      'SELECT id FROM skills WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '技能不存在' });
    }
    await query('DELETE FROM skills WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: '技能删除成功' });
  } catch (error) {
    console.error('删除技能失败:', error);
    res.status(500).json({ success: false, message: '删除技能失败' });
  }
});

router.post('/:id/toggle', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await query(
      'SELECT id, is_enabled FROM skills WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '技能不存在' });
    }
    const newStatus = (existing[0] as any).is_enabled ? 0 : 1;
    await query('UPDATE skills SET is_enabled = ? WHERE id = ?', [newStatus, req.params.id]);
    res.json({ success: true, message: newStatus ? '技能已启用' : '技能已禁用' });
  } catch (error) {
    console.error('切换技能状态失败:', error);
    res.status(500).json({ success: false, message: '切换技能状态失败' });
  }
});

export default router;
