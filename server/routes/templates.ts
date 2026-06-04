import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from './auth.js';
import { query } from '../db/connection.js';

const router = Router();

router.use(authMiddleware);

function normalizeName(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

async function findDuplicateTemplate(
  userId: number,
  name: unknown,
  excludeId?: string | number
): Promise<any | null> {
  const normalized = normalizeName(name);
  if (!normalized) return null;

  const templates = await query(
    'SELECT id, name FROM templates WHERE user_id = ?',
    [userId]
  );
  return templates.find((template: any) =>
    normalizeName(template.name) === normalized && String(template.id) !== String(excludeId || '')
  ) || null;
}

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { category } = req.query;
    let sql = 'SELECT id, name, category, description, slide_count, accent, preview_url, settings, is_public, created_at, updated_at FROM templates WHERE (user_id = ? OR is_public = 1)';
    const params: any[] = [req.userId];
    
    if (category && category !== '全部') {
      sql += ' AND category = ?';
      params.push(category);
    }
    
    sql += ' ORDER BY is_public DESC, updated_at DESC';
    
    const templates = await query(sql, params);
    res.json({ success: true, data: templates });
  } catch (error) {
    console.error('获取模版列表失败:', error);
    res.status(500).json({ success: false, message: '获取模版列表失败' });
  }
});

router.get('/categories', async (req: AuthRequest, res: Response) => {
  try {
    const categories = await query(
      'SELECT DISTINCT category FROM templates WHERE category IS NOT NULL ORDER BY category'
    );
    res.json({ success: true, data: categories.map((c: any) => c.category) });
  } catch (error) {
    console.error('获取模版分类失败:', error);
    res.status(500).json({ success: false, message: '获取模版分类失败' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const templates = await query(
      'SELECT * FROM templates WHERE id = ? AND (user_id = ? OR is_public = 1)',
      [req.params.id, req.userId]
    );
    if (templates.length === 0) {
      return res.status(404).json({ success: false, message: '模版不存在' });
    }
    res.json({ success: true, data: templates[0] });
  } catch (error) {
    console.error('获取模版详情失败:', error);
    res.status(500).json({ success: false, message: '获取模版详情失败' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, category, description, slide_count, accent, preview_url, settings, is_public } = req.body;
    const templateName = String(name || '').trim();
    if (!templateName) {
      return res.status(400).json({ success: false, message: '模版名称不能为空' });
    }
    const duplicate = await findDuplicateTemplate(req.userId!, templateName);
    if (duplicate) {
      return res.status(409).json({ success: false, message: `模版名称「${templateName}」已存在，请换一个名称` });
    }
    const result = await query(
      'INSERT INTO templates (user_id, name, category, description, slide_count, accent, preview_url, settings, is_public) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.userId, templateName, category || '其他', description || '', slide_count || 10, accent || '#ef2d2d', preview_url, JSON.stringify(settings || {}), is_public ? 1 : 0]
    );
    const newTemplate = await query(
      'SELECT * FROM templates WHERE id = ?',
      [(result as any).insertId]
    );
    res.status(201).json({ success: true, data: newTemplate[0], message: '模版创建成功' });
  } catch (error) {
    console.error('创建模版失败:', error);
    res.status(500).json({ success: false, message: '创建模版失败' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { name, category, description, slide_count, accent, preview_url, settings, is_public } = req.body;
    const templateName = String(name || '').trim();
    if (!templateName) {
      return res.status(400).json({ success: false, message: '模版名称不能为空' });
    }
    const existing = await query(
      'SELECT id FROM templates WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '模版不存在或无权编辑' });
    }
    const duplicate = await findDuplicateTemplate(req.userId!, templateName, req.params.id);
    if (duplicate) {
      return res.status(409).json({ success: false, message: `模版名称「${templateName}」已存在，请换一个名称` });
    }
    await query(
      'UPDATE templates SET name = ?, category = ?, description = ?, slide_count = ?, accent = ?, preview_url = ?, settings = ?, is_public = ? WHERE id = ?',
      [templateName, category || '其他', description || '', slide_count || 10, accent || '#ef2d2d', preview_url, JSON.stringify(settings || {}), is_public ? 1 : 0, req.params.id]
    );
    const updated = await query(
      'SELECT * FROM templates WHERE id = ?',
      [req.params.id]
    );
    res.json({ success: true, data: updated[0], message: '模版更新成功' });
  } catch (error) {
    console.error('更新模版失败:', error);
    res.status(500).json({ success: false, message: '更新模版失败' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await query(
      'SELECT id FROM templates WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '模版不存在或无权删除' });
    }
    await query('DELETE FROM templates WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: '模版删除成功' });
  } catch (error) {
    console.error('删除模版失败:', error);
    res.status(500).json({ success: false, message: '删除模版失败' });
  }
});

export default router;
