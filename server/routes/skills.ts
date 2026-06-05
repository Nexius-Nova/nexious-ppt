import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from './auth.js';
import { query } from '../db/connection.js';
import {
  createSkillFromPackage,
  initializeSkillEnvironment,
  previewSkillPackage,
  removeSkillPackage,
  runSkillPackage,
} from '../services/skillPackages.js';

const router = Router();

router.use(authMiddleware);

const SKILL_SELECT = `
  SELECT
    id, name, description, icon, category, parameters, is_enabled,
    type, runtime, entry, package_path, manifest, dependency_file,
    install_status, install_log, last_installed_at,
    created_at, updated_at
  FROM skills
`;

function normalizeJson(value: unknown, fallback: unknown) {
  if (!value) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function normalizeSkill(row: any) {
  return {
    ...row,
    is_enabled: Boolean(row.is_enabled),
    parameters: normalizeJson(row.parameters, {}),
    manifest: normalizeJson(row.manifest, null),
  };
}

async function fetchSkill(id: number, userId: number) {
  const rows = await query<any>(`${SKILL_SELECT} WHERE id = ? AND user_id = ?`, [id, userId]);
  return rows[0] ? normalizeSkill(rows[0]) : null;
}

function normalizeRun(row: any) {
  return {
    ...row,
    input: normalizeJson(row.input, {}),
    output: normalizeJson(row.output, row.output || null),
  };
}

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const skills = await query<any>(`${SKILL_SELECT} WHERE user_id = ? ORDER BY created_at DESC`, [req.userId]);
    res.json({ success: true, data: skills.map(normalizeSkill) });
  } catch (error) {
    console.error('Failed to fetch skills', error);
    res.status(500).json({ success: false, message: 'Failed to fetch skills' });
  }
});

router.get('/runs', async (req: AuthRequest, res: Response) => {
  try {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';
    const params: unknown[] = [req.userId];
    let where = 'WHERE sr.user_id = ?';
    if (projectId) {
      where += ' AND sr.project_id = ?';
      params.push(projectId);
    }
    const runs = await query<any>(
      `SELECT sr.*, s.name AS skill_name
       FROM skill_runs sr
       LEFT JOIN skills s ON s.id = sr.skill_id
       ${where}
       ORDER BY sr.created_at DESC
       LIMIT 50`,
      params
    );
    res.json({ success: true, data: runs.map(normalizeRun) });
  } catch (error) {
    console.error('Failed to fetch skill runs', error);
    res.status(500).json({ success: false, message: 'Failed to fetch skill runs' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const skill = await fetchSkill(Number(req.params.id), req.userId!);
    if (!skill) return res.status(404).json({ success: false, message: 'Skill not found' });
    res.json({ success: true, data: skill });
  } catch (error) {
    console.error('Failed to fetch skill', error);
    res.status(500).json({ success: false, message: 'Failed to fetch skill' });
  }
});

router.post('/preview-package', async (req: AuthRequest, res: Response) => {
  try {
    const { filename, dataBase64 } = req.body || {};
    if (!filename || !dataBase64) {
      return res.status(400).json({ success: false, message: 'Skill package is required' });
    }
    const preview = await previewSkillPackage(String(filename), String(dataBase64));
    res.json({ success: true, data: preview, message: 'Skill package parsed' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse skill package';
    console.error('Failed to parse skill package', error);
    res.status(400).json({ success: false, message });
  }
});

router.post('/upload-package', async (req: AuthRequest, res: Response) => {
  try {
    const { filename, dataBase64 } = req.body || {};
    if (!filename || !dataBase64) {
      return res.status(400).json({ success: false, message: 'Skill package is required' });
    }
    const skillId = await createSkillFromPackage(req.userId!, String(filename), String(dataBase64));
    const skill = await fetchSkill(skillId, req.userId!);
    res.status(201).json({ success: true, data: skill, message: 'Skill package uploaded' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to upload skill package';
    console.error('Failed to upload skill package', error);
    res.status(400).json({ success: false, message });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, icon, category, parameters, is_enabled } = req.body;
    if (!String(name || '').trim()) {
      return res.status(400).json({ success: false, message: 'Skill name is required' });
    }
    const result = await query<any>(
      `INSERT INTO skills
        (user_id, name, description, icon, category, parameters, is_enabled, type, runtime, install_status, install_log)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'prompt-only', 'prompt-only', 'not_required', ?)`,
      [
        req.userId,
        String(name).trim(),
        description || '',
        icon || 'Zap',
        category || 'prompt',
        JSON.stringify(parameters || {}),
        is_enabled === false ? 0 : 1,
        'No dependency initialization is required.',
      ]
    );
    const skill = await fetchSkill(Number((result as any).insertId), req.userId!);
    res.status(201).json({ success: true, data: skill, message: 'Skill created' });
  } catch (error) {
    console.error('Failed to create skill', error);
    res.status(500).json({ success: false, message: 'Failed to create skill' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await fetchSkill(id, req.userId!);
    if (!existing) return res.status(404).json({ success: false, message: 'Skill not found' });

    const { name, description, icon, category, parameters, is_enabled } = req.body;
    await query(
      `UPDATE skills
       SET name = ?, description = ?, icon = ?, category = ?, parameters = ?, is_enabled = ?
       WHERE id = ? AND user_id = ?`,
      [
        String(name || existing.name).trim(),
        description || '',
        icon || 'Zap',
        category || 'prompt',
        JSON.stringify(parameters || {}),
        is_enabled === false ? 0 : 1,
        id,
        req.userId,
      ]
    );
    const skill = await fetchSkill(id, req.userId!);
    res.json({ success: true, data: skill, message: 'Skill updated' });
  } catch (error) {
    console.error('Failed to update skill', error);
    res.status(500).json({ success: false, message: 'Failed to update skill' });
  }
});

router.post('/:id/reinstall', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await fetchSkill(id, req.userId!);
    if (!existing) return res.status(404).json({ success: false, message: 'Skill not found' });
    void initializeSkillEnvironment(id).catch((error) => console.error('Failed to reinstall skill', error));
    res.json({ success: true, message: 'Skill runtime initialization started' });
  } catch (error) {
    console.error('Failed to reinstall skill', error);
    res.status(500).json({ success: false, message: 'Failed to reinstall skill' });
  }
});

router.post('/:id/run', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const runId = await runSkillPackage(req.userId!, id, {
      projectId: req.body?.projectId ? String(req.body.projectId) : undefined,
      phase: req.body?.phase ? String(req.body.phase) : 'input',
      input: req.body?.input || {},
    });
    const runs = await query<any>(
      `SELECT sr.*, s.name AS skill_name
       FROM skill_runs sr
       LEFT JOIN skills s ON s.id = sr.skill_id
       WHERE sr.id = ? AND sr.user_id = ?`,
      [runId, req.userId]
    );
    const run = normalizeRun(runs[0]);
    res.json({
      success: true,
      data: run,
      message: run.status === 'failed' ? 'Skill run failed' : 'Skill run completed',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run skill';
    console.error('Failed to run skill', error);
    res.status(400).json({ success: false, message });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await fetchSkill(id, req.userId!);
    if (!existing) return res.status(404).json({ success: false, message: 'Skill not found' });
    await query('DELETE FROM skills WHERE id = ? AND user_id = ?', [id, req.userId]);
    await removeSkillPackage(req.userId!, id);
    res.json({ success: true, message: 'Skill deleted' });
  } catch (error) {
    console.error('Failed to delete skill', error);
    res.status(500).json({ success: false, message: 'Failed to delete skill' });
  }
});

router.post('/:id/toggle', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await fetchSkill(id, req.userId!);
    if (!existing) return res.status(404).json({ success: false, message: 'Skill not found' });
    const newStatus = existing.is_enabled ? 0 : 1;
    await query('UPDATE skills SET is_enabled = ? WHERE id = ? AND user_id = ?', [newStatus, id, req.userId]);
    res.json({ success: true, message: newStatus ? 'Skill enabled' : 'Skill disabled' });
  } catch (error) {
    console.error('Failed to toggle skill', error);
    res.status(500).json({ success: false, message: 'Failed to toggle skill' });
  }
});

export default router;
