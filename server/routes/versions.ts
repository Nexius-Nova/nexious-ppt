import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from './auth.js';
import { query, insert, remove } from '../db/connection.js';

const router = Router();
const MAX_VERSIONS = 30;

router.use(authMiddleware);

function parseJsonValue(value: unknown, fallback: any) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

router.get('/:projectId', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { projectId } = req.params;

    const rows = await query(
      `SELECT id, project_id, label, outline, parameters, state, slide_count, created_at FROM version_snapshots WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT ${MAX_VERSIONS}`,
      [userId, projectId]
    );

    const versions = rows.map((row: any) => ({
      id: `v-${row.id}`,
      projectId: row.project_id,
      label: row.label || `版本 ${row.id}`,
      outline: parseJsonValue(row.outline, []),
      parameters: parseJsonValue(row.parameters, {}),
      state: parseJsonValue(row.state, null),
      slideCount: row.slide_count,
      timestamp: new Date(row.created_at).getTime()
    }));

    res.json({ success: true, data: versions });
  } catch (error) {
    console.error('获取版本快照失败:', error);
    res.status(500).json({ success: false, message: '获取版本快照失败' });
  }
});

router.post('/:projectId', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { projectId } = req.params;
    const { label, outline, parameters, slideCount, state } = req.body;

    const countResult = await query(
      'SELECT COUNT(*) as cnt FROM version_snapshots WHERE user_id = ? AND project_id = ?',
      [userId, projectId]
    );
    const count = (countResult as any[])[0]?.cnt || 0;

    if (count >= MAX_VERSIONS) {
      const deleteCount = count - MAX_VERSIONS + 1;
      await remove(
        `DELETE FROM version_snapshots WHERE user_id = ? AND project_id = ? ORDER BY created_at ASC LIMIT ${deleteCount}`,
        [userId, projectId]
      );
    }

    await insert(
      'INSERT INTO version_snapshots (user_id, project_id, label, outline, parameters, state, slide_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        userId,
        projectId,
        label || null,
        JSON.stringify(outline || state?.outline || []),
        JSON.stringify(parameters || state?.parameters || {}),
        state ? JSON.stringify(state) : null,
        slideCount || state?.designSpec?.outline?.length || state?.outline?.length || 0
      ]
    );

    res.json({ success: true, message: '版本快照已保存' });
  } catch (error) {
    console.error('保存版本快照失败:', error);
    res.status(500).json({ success: false, message: '保存版本快照失败' });
  }
});

router.delete('/:projectId/:versionId', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { projectId, versionId } = req.params;
    const numericId = versionId.replace('v-', '');

    await remove(
      'DELETE FROM version_snapshots WHERE user_id = ? AND project_id = ? AND id = ?',
      [userId, projectId, numericId]
    );

    res.json({ success: true, message: '版本快照已删除' });
  } catch (error) {
    console.error('删除版本快照失败:', error);
    res.status(500).json({ success: false, message: '删除版本快照失败' });
  }
});

export default router;
