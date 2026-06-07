import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from './auth.js';
import { query } from '../db/connection.js';
import { getProjectByIdForUser } from '../models/project.js';
import {
  createSkillFromPackage,
  getSkillPackageView,
  initializeAndTestSkill,
  previewSkillPackage,
  removeSkillPackage,
  runSkillPackage,
  testSkillPackage,
} from '../services/skillPackages.js';

const router = Router();

router.use(authMiddleware);

let skillSchemaReady: Promise<void> | null = null;

async function ensureSkillSchema() {
  if (!skillSchemaReady) {
    skillSchemaReady = (async () => {
      const ensureColumn = async (columnName: string, ddl: string) => {
        const rows = await query<any>(
          `SELECT COLUMN_NAME
           FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = 'skills'
             AND COLUMN_NAME = ?`,
          [columnName]
        );
        if (rows.length === 0) {
          await query(ddl);
        }
      };

      await ensureColumn(
        'last_installed_at',
        'ALTER TABLE `skills` ADD COLUMN `last_installed_at` TIMESTAMP NULL DEFAULT NULL AFTER `install_log`'
      );
      await ensureColumn(
        'test_status',
        "ALTER TABLE `skills` ADD COLUMN `test_status` VARCHAR(50) NOT NULL DEFAULT 'not_tested' AFTER `last_installed_at`"
      );
      await ensureColumn(
        'test_log',
        'ALTER TABLE `skills` ADD COLUMN `test_log` MEDIUMTEXT DEFAULT NULL AFTER `test_status`'
      );
      await ensureColumn(
        'last_tested_at',
        'ALTER TABLE `skills` ADD COLUMN `last_tested_at` TIMESTAMP NULL DEFAULT NULL AFTER `test_log`'
      );
      await query(
        "UPDATE `skills` SET `test_status` = COALESCE(NULLIF(`test_status`, ''), 'not_tested') WHERE `test_status` IS NULL OR `test_status` = ''"
      );
    })().catch((error) => {
      skillSchemaReady = null;
      throw error;
    });
  }
  await skillSchemaReady;
}

router.use(async (_req, _res, next) => {
  try {
    await ensureSkillSchema();
    next();
  } catch (error) {
    next(error);
  }
});

const SKILL_SELECT = `
  SELECT
    id, name, description, icon, category, parameters, is_enabled,
    type, runtime, entry, package_path, manifest, dependency_file,
    install_status, install_log, last_installed_at,
    test_status, test_log, last_tested_at,
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

async function ensureOwnedProject(userId: number, projectId: string) {
  const id = Number(projectId);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  return Boolean(await getProjectByIdForUser(id, userId));
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
    res.status(500).json({ success: false, message: '获取 Skill 列表失败' });
  }
});

router.get('/runs', async (req: AuthRequest, res: Response) => {
  try {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';
    const params: unknown[] = [req.userId];
    let where = 'WHERE sr.user_id = ?';
    if (!projectId) {
      where += ' AND (sr.project_id IS NULL OR sr.project_id <> ?)';
      params.push('__skill_health_check__');
    }
    if (projectId) {
      if (!(await ensureOwnedProject(req.userId!, projectId))) {
        return res.status(404).json({ success: false, message: '项目不存在或无权访问' });
      }
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
    res.status(500).json({ success: false, message: '获取 Skill 运行记录失败' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const skill = await fetchSkill(Number(req.params.id), req.userId!);
    if (!skill) return res.status(404).json({ success: false, message: 'Skill 不存在或无权访问' });
    res.json({ success: true, data: skill });
  } catch (error) {
    console.error('Failed to fetch skill', error);
    res.status(500).json({ success: false, message: '获取 Skill 失败' });
  }
});

router.get('/:id/package', async (req: AuthRequest, res: Response) => {
  try {
    const packageView = await getSkillPackageView(req.userId!, Number(req.params.id));
    res.json({ success: true, data: packageView, message: 'Skill 包已加载' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载 Skill 包失败';
    console.error('Failed to load skill package', error);
    res.status(message === 'Skill not found.' ? 404 : 400).json({ success: false, message });
  }
});

router.post('/preview-package', async (req: AuthRequest, res: Response) => {
  try {
    const { filename, dataBase64, category } = req.body || {};
    if (!filename || !dataBase64) {
      return res.status(400).json({ success: false, message: '请上传 Skill 包' });
    }
    const preview = await previewSkillPackage(String(filename), String(dataBase64));
    res.json({ success: true, data: preview, message: 'Skill 包解析完成' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '解析 Skill 包失败';
    console.error('Failed to parse skill package', error);
    res.status(400).json({ success: false, message });
  }
});

router.post('/upload-package', async (req: AuthRequest, res: Response) => {
  try {
    const { filename, dataBase64, category } = req.body || {};
    if (!filename || !dataBase64) {
      return res.status(400).json({ success: false, message: '请上传 Skill 包' });
    }
    const skillId = await createSkillFromPackage(req.userId!, String(filename), String(dataBase64), {
      category: category ? String(category) : undefined,
    });
    const skill = await fetchSkill(skillId, req.userId!);
    res.status(201).json({ success: true, data: skill, message: 'Skill 包上传成功' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '上传 Skill 包失败';
    console.error('Failed to upload skill package', error);
    res.status(400).json({ success: false, message });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, icon, category, parameters, is_enabled } = req.body;
    if (!String(name || '').trim()) {
      return res.status(400).json({ success: false, message: 'Skill 名称不能为空' });
    }
    const result = await query<any>(
      `INSERT INTO skills
        (user_id, name, description, icon, category, parameters, is_enabled, type, runtime, install_status, install_log, test_status, test_log, last_tested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'prompt-only', 'prompt-only', 'not_required', ?, 'passed', ?, CURRENT_TIMESTAMP)`,
      [
        req.userId,
        String(name).trim(),
        description || '',
        icon || 'Zap',
        category || 'prompt',
        JSON.stringify(parameters || {}),
        is_enabled === false ? 0 : 1,
        'No dependency initialization is required.',
        '提示词型 Skill 已通过基础检查。',
      ]
    );
    const skill = await fetchSkill(Number((result as any).insertId), req.userId!);
    res.status(201).json({ success: true, data: skill, message: 'Skill 已创建' });
  } catch (error) {
    console.error('Failed to create skill', error);
    res.status(500).json({ success: false, message: '创建 Skill 失败' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await fetchSkill(id, req.userId!);
    if (!existing) return res.status(404).json({ success: false, message: 'Skill 不存在或无权访问' });

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
    res.json({ success: true, data: skill, message: 'Skill 已更新' });
  } catch (error) {
    console.error('Failed to update skill', error);
    res.status(500).json({ success: false, message: '更新 Skill 失败' });
  }
});

router.post('/:id/reinstall', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await fetchSkill(id, req.userId!);
    if (!existing) return res.status(404).json({ success: false, message: 'Skill 不存在或无权访问' });
    await query(
      `UPDATE skills
       SET install_status = 'pending',
           install_log = '等待自动适配、初始化依赖并执行健康测试。',
           test_status = 'testing',
           test_log = '已加入自动测试队列。'
       WHERE id = ? AND user_id = ?`,
      [id, req.userId]
    );
    void initializeAndTestSkill(req.userId!, id).catch((error) => console.error('Failed to reinstall skill', error));
    res.json({ success: true, message: 'Skill 运行环境初始化已开始' });
  } catch (error) {
    console.error('Failed to reinstall skill', error);
    res.status(500).json({ success: false, message: '重新初始化 Skill 失败' });
  }
});

router.post('/:id/test', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await fetchSkill(id, req.userId!);
    if (!existing) return res.status(404).json({ success: false, message: 'Skill 不存在或无权访问' });
    await query(
      `UPDATE skills
       SET test_status = 'testing',
           test_log = '已加入健康测试队列。'
       WHERE id = ? AND user_id = ?`,
      [id, req.userId]
    );
    void testSkillPackage(req.userId!, id).catch((error) => console.error('Failed to test skill', error));
    res.json({ success: true, message: 'Skill 健康测试已开始' });
  } catch (error) {
    console.error('Failed to test skill', error);
    res.status(500).json({ success: false, message: '测试 Skill 失败' });
  }
});

router.post('/:id/run', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const projectId = req.body?.projectId ? String(req.body.projectId) : undefined;
    if (projectId && !(await ensureOwnedProject(req.userId!, projectId))) {
      return res.status(404).json({ success: false, message: '项目不存在或无权访问' });
    }
    const runId = await runSkillPackage(req.userId!, id, {
      projectId,
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
      message: run.status === 'failed' ? 'Skill 运行失败' : 'Skill 运行完成',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '运行 Skill 失败';
    console.error('Failed to run skill', error);
    res.status(400).json({ success: false, message });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await fetchSkill(id, req.userId!);
    if (!existing) return res.status(404).json({ success: false, message: 'Skill 不存在或无权访问' });
    await query('DELETE FROM skills WHERE id = ? AND user_id = ?', [id, req.userId]);
    await removeSkillPackage(req.userId!, id);
    res.json({ success: true, message: 'Skill 已删除' });
  } catch (error) {
    console.error('Failed to delete skill', error);
    res.status(500).json({ success: false, message: '删除 Skill 失败' });
  }
});

router.post('/:id/toggle', async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = await fetchSkill(id, req.userId!);
    if (!existing) return res.status(404).json({ success: false, message: 'Skill 不存在或无权访问' });
    const newStatus = existing.is_enabled ? 0 : 1;
    await query('UPDATE skills SET is_enabled = ? WHERE id = ? AND user_id = ?', [newStatus, id, req.userId]);
    res.json({ success: true, message: newStatus ? 'Skill 已启用' : 'Skill 已停用' });
  } catch (error) {
    console.error('Failed to toggle skill', error);
    res.status(500).json({ success: false, message: '切换 Skill 状态失败' });
  }
});

export default router;
