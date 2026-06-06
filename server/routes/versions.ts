import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from './auth.js';
import { query, insert, remove } from '../db/connection.js';
import { getProjectByIdForUser } from '../models/project.js';

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

function getOutlineFromState(state: any) {
  if (Array.isArray(state?.outline)) return state.outline;
  if (Array.isArray(state?.designSpec?.outline)) return state.designSpec.outline;
  return [];
}

function getParametersFromState(state: any) {
  return state && typeof state.parameters === 'object' && state.parameters ? state.parameters : {};
}

function getSlideCountFromState(state: any) {
  const designSpecCount = Array.isArray(state?.designSpec?.outline) ? state.designSpec.outline.length : 0;
  const outlineCount = Array.isArray(state?.outline) ? state.outline.length : 0;
  const parameterCount = Number(state?.parameters?.slideCount || 0);
  const stateCount = Number(state?.slideCount || 0);
  return designSpecCount || outlineCount || parameterCount || stateCount || 0;
}

function buildSnapshotState(input: { outline?: any[]; parameters?: any; slideCount?: number; state?: any }) {
  if (input.state && typeof input.state === 'object') return input.state;

  const parameters = input.parameters && typeof input.parameters === 'object' ? { ...input.parameters } : {};
  if (input.slideCount && !parameters.slideCount) {
    parameters.slideCount = input.slideCount;
  }

  return {
    outline: Array.isArray(input.outline) ? input.outline : [],
    parameters,
    slideCount: input.slideCount || parameters.slideCount || 0,
  };
}

async function ensureOwnedProject(userId: number, projectId: string) {
  const id = Number(projectId);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  return Boolean(await getProjectByIdForUser(id, userId));
}

router.get('/:projectId', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { projectId } = req.params;
    if (!(await ensureOwnedProject(userId, projectId))) {
      return res.status(404).json({ success: false, message: '项目不存在或无权访问' });
    }

    const rows = await query(
      `SELECT id, project_id, label, state, created_at FROM version_snapshots WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT ${MAX_VERSIONS}`,
      [userId, projectId]
    );

    const versions = rows.map((row: any) => {
      const state = parseJsonValue(row.state, null);
      return {
        id: `v-${row.id}`,
        projectId: row.project_id,
        label: row.label || `版本 ${row.id}`,
        outline: getOutlineFromState(state),
        parameters: getParametersFromState(state),
        state,
        slideCount: getSlideCountFromState(state),
        timestamp: new Date(row.created_at).getTime()
      };
    });

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
    if (!(await ensureOwnedProject(userId, projectId))) {
      return res.status(404).json({ success: false, message: '项目不存在或无权访问' });
    }
    const snapshotState = buildSnapshotState({ outline, parameters, slideCount, state });

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
      'INSERT INTO version_snapshots (user_id, project_id, label, state) VALUES (?, ?, ?, ?)',
      [
        userId,
        projectId,
        label || null,
        JSON.stringify(snapshotState)
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
    if (!(await ensureOwnedProject(userId, projectId))) {
      return res.status(404).json({ success: false, message: '项目不存在或无权访问' });
    }
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
