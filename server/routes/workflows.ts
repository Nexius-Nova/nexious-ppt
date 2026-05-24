import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from './auth.js';
import { query, insert, update, remove } from '../db/connection.js';

const router = Router();
const DEFAULT_USER_ID = 1;

router.use(authMiddleware);

router.post('/save', async (req: AuthRequest, res: Response) => {
  try {
    const { snapshotData } = req.body;
    if (!snapshotData) {
      return res.status(400).json({ success: false, message: '缺少快照数据' });
    }

    const userId = req.userId || DEFAULT_USER_ID;

    const existing = await query(
      'SELECT id FROM workflow_snapshots WHERE user_id = ?',
      [userId]
    );

    if (existing.length > 0) {
      await update(
        'UPDATE workflow_snapshots SET snapshot_data = ?, updated_at = NOW() WHERE user_id = ?',
        [JSON.stringify(snapshotData), userId]
      );
    } else {
      await insert(
        'INSERT INTO workflow_snapshots (user_id, snapshot_data) VALUES (?, ?)',
        [userId, JSON.stringify(snapshotData)]
      );
    }

    res.json({ success: true, message: '工作流数据已保存' });
  } catch (error) {
    console.error('保存工作流快照失败:', error);
    res.status(500).json({ success: false, message: '保存工作流数据失败' });
  }
});

router.get('/restore', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId || DEFAULT_USER_ID;

    const rows = await query(
      'SELECT snapshot_data, updated_at FROM workflow_snapshots WHERE user_id = ?',
      [userId]
    );

    if (rows.length === 0) {
      return res.json({ success: true, data: null, message: '无已保存的工作流数据' });
    }

    const snapshotData = typeof rows[0].snapshot_data === 'string'
      ? JSON.parse(rows[0].snapshot_data)
      : rows[0].snapshot_data;

    res.json({
      success: true,
      data: {
        snapshotData,
        savedAt: rows[0].updated_at
      }
    });
  } catch (error) {
    console.error('恢复工作流快照失败:', error);
    res.status(500).json({ success: false, message: '恢复工作流数据失败' });
  }
});

router.delete('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId || DEFAULT_USER_ID;

    await remove(
      'DELETE FROM workflow_snapshots WHERE user_id = ?',
      [userId]
    );

    res.json({ success: true, message: '工作流数据已清除' });
  } catch (error) {
    console.error('清除工作流快照失败:', error);
    res.status(500).json({ success: false, message: '清除工作流数据失败' });
  }
});

export default router;
