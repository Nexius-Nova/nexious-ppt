import { Router, Response } from 'express';
import crypto from 'crypto';
import path from 'path';
import { authMiddleware, AuthRequest } from './auth.js';
import { query } from '../db/connection.js';
import { convertPptxToSvg } from '../vendor/pptx_to_svg/pptxToSvg.js';

const router = Router();

router.use(authMiddleware);

function normalizeName(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isDuplicateEntryError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (error as { code?: string }).code === 'ER_DUP_ENTRY'
  );
}

function duplicateTemplateNameResponse(res: Response, name: unknown) {
  const templateName = String(name || '').trim() || '当前名称';
  return res.status(409).json({
    success: false,
    code: 'TEMPLATE_NAME_DUPLICATED',
    message: `模板名称「${templateName}」已存在，请换一个名称`,
  });
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
    console.error('获取模板列表失败:', error);
    res.status(500).json({ success: false, message: '获取模板列表失败' });
  }
});

router.get('/categories', async (_req: AuthRequest, res: Response) => {
  try {
    const categories = await query(
      'SELECT DISTINCT category FROM templates WHERE category IS NOT NULL ORDER BY category'
    );
    res.json({ success: true, data: categories.map((c: any) => c.category) });
  } catch (error) {
    console.error('获取模板分类失败:', error);
    res.status(500).json({ success: false, message: '获取模板分类失败' });
  }
});

router.post('/import-pptx/preview', async (req: AuthRequest, res: Response) => {
  try {
    const { filename, dataBase64 } = req.body || {};
    if (!filename || !dataBase64) {
      return res.status(400).json({ success: false, message: '请上传 PPTX 文件' });
    }

    const safeUserId = String(req.userId || 'anonymous');
    const importId = `${Date.now()}-${crypto.randomUUID()}`;
    const mediaOutputDir = path.join(process.cwd(), '.generated', 'images', 'pptx-previews', safeUserId, importId);
    const mediaUrlPrefix = `/generated-images/pptx-previews/${safeUserId}/${importId}`;
    const result = await convertPptxToSvg(String(filename), String(dataBase64), {
      mediaOutputDir,
      mediaUrlPrefix,
    });
    res.json({ success: true, data: result, message: 'PPTX 已转换为 SVG 预览' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PPTX 转 SVG 失败';
    console.error('PPTX 转 SVG 失败:', error);
    res.status(400).json({ success: false, message });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const templates = await query(
      'SELECT * FROM templates WHERE id = ? AND (user_id = ? OR is_public = 1)',
      [req.params.id, req.userId]
    );
    if (templates.length === 0) {
      return res.status(404).json({ success: false, message: '模板不存在' });
    }
    res.json({ success: true, data: templates[0] });
  } catch (error) {
    console.error('获取模板详情失败:', error);
    res.status(500).json({ success: false, message: '获取模板详情失败' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, category, description, slide_count, accent, preview_url, settings, is_public } = req.body;
    const templateName = String(name || '').trim();
    if (!templateName) {
      return res.status(400).json({ success: false, message: '模板名称不能为空' });
    }

    const duplicate = await findDuplicateTemplate(req.userId!, templateName);
    if (duplicate) {
      return duplicateTemplateNameResponse(res, templateName);
    }

    const result = await query(
      'INSERT INTO templates (user_id, name, category, description, slide_count, accent, preview_url, settings, is_public) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.userId, templateName, category || '其他', description || '', slide_count || 10, accent || '#ef2d2d', preview_url, JSON.stringify(settings || {}), is_public ? 1 : 0]
    );
    const newTemplate = await query(
      'SELECT * FROM templates WHERE id = ?',
      [(result as any).insertId]
    );
    res.status(201).json({ success: true, data: newTemplate[0], message: '模板创建成功' });
  } catch (error) {
    console.error('创建模板失败:', error);
    if (isDuplicateEntryError(error)) {
      return duplicateTemplateNameResponse(res, req.body?.name);
    }
    res.status(500).json({ success: false, message: '创建模板失败' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { name, category, description, slide_count, accent, preview_url, settings, is_public } = req.body;
    const templateName = String(name || '').trim();
    if (!templateName) {
      return res.status(400).json({ success: false, message: '模板名称不能为空' });
    }

    const existing = await query(
      'SELECT id FROM templates WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '模板不存在或无权编辑' });
    }

    const duplicate = await findDuplicateTemplate(req.userId!, templateName, req.params.id);
    if (duplicate) {
      return duplicateTemplateNameResponse(res, templateName);
    }

    await query(
      'UPDATE templates SET name = ?, category = ?, description = ?, slide_count = ?, accent = ?, preview_url = ?, settings = ?, is_public = ? WHERE id = ?',
      [templateName, category || '其他', description || '', slide_count || 10, accent || '#ef2d2d', preview_url, JSON.stringify(settings || {}), is_public ? 1 : 0, req.params.id]
    );
    const updated = await query(
      'SELECT * FROM templates WHERE id = ?',
      [req.params.id]
    );
    res.json({ success: true, data: updated[0], message: '模板更新成功' });
  } catch (error) {
    console.error('更新模板失败:', error);
    if (isDuplicateEntryError(error)) {
      return duplicateTemplateNameResponse(res, req.body?.name);
    }
    res.status(500).json({ success: false, message: '更新模板失败' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await query(
      'SELECT id FROM templates WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '模板不存在或无权删除' });
    }
    await query('DELETE FROM templates WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: '模板删除成功' });
  } catch (error) {
    console.error('删除模板失败:', error);
    res.status(500).json({ success: false, message: '删除模板失败' });
  }
});

export default router;
