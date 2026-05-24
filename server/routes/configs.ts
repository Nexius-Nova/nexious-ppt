import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from './auth.js';
import { query } from '../db/connection.js';

const router = Router();

router.use(authMiddleware);

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const configs = await query(
      'SELECT id, name, `key`, type, value, options, min_value, max_value, description, created_at, updated_at FROM run_configs WHERE user_id = ? ORDER BY created_at ASC',
      [req.userId]
    );
    res.json({ success: true, data: configs });
  } catch (error) {
    console.error('获取运行配置失败:', error);
    res.status(500).json({ success: false, message: '获取运行配置失败' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const configs = await query(
      'SELECT id, name, `key`, type, value, options, min_value, max_value, description, created_at, updated_at FROM run_configs WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (configs.length === 0) {
      return res.status(404).json({ success: false, message: '配置项不存在' });
    }
    res.json({ success: true, data: configs[0] });
  } catch (error) {
    console.error('获取配置详情失败:', error);
    res.status(500).json({ success: false, message: '获取配置详情失败' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, key, type, value, options, min_value, max_value, description } = req.body;
    if (!name || !key) {
      return res.status(400).json({ success: false, message: '名称和键名不能为空' });
    }
    
    const existing = await query(
      'SELECT id FROM run_configs WHERE user_id = ? AND `key` = ?',
      [req.userId, key]
    );
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: '该键名已存在' });
    }
    
    const result = await query(
      'INSERT INTO run_configs (user_id, name, `key`, type, value, options, min_value, max_value, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.userId, name, key, type || 'string', value, JSON.stringify(options || []), min_value, max_value, description]
    );
    const newConfig = await query(
      'SELECT id, name, `key`, type, value, options, min_value, max_value, description, created_at, updated_at FROM run_configs WHERE id = ?',
      [(result as any).insertId]
    );
    res.status(201).json({ success: true, data: newConfig[0], message: '配置项创建成功' });
  } catch (error) {
    console.error('创建配置项失败:', error);
    res.status(500).json({ success: false, message: '创建配置项失败' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { name, key, type, value, options, min_value, max_value, description } = req.body;
    const existing = await query(
      'SELECT id, `key` FROM run_configs WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '配置项不存在' });
    }
    
    if (key && key !== (existing[0] as any).key) {
      const keyExists = await query(
        'SELECT id FROM run_configs WHERE user_id = ? AND `key` = ? AND id != ?',
        [req.userId, key, req.params.id]
      );
      if (keyExists.length > 0) {
        return res.status(400).json({ success: false, message: '该键名已存在' });
      }
    }
    
    await query(
      'UPDATE run_configs SET name = ?, `key` = ?, type = ?, value = ?, options = ?, min_value = ?, max_value = ?, description = ? WHERE id = ?',
      [name, key, type || 'string', value, JSON.stringify(options || []), min_value, max_value, description, req.params.id]
    );
    const updated = await query(
      'SELECT id, name, `key`, type, value, options, min_value, max_value, description, created_at, updated_at FROM run_configs WHERE id = ?',
      [req.params.id]
    );
    res.json({ success: true, data: updated[0], message: '配置项更新成功' });
  } catch (error) {
    console.error('更新配置项失败:', error);
    res.status(500).json({ success: false, message: '更新配置项失败' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await query(
      'SELECT id FROM run_configs WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '配置项不存在' });
    }
    await query('DELETE FROM run_configs WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: '配置项删除成功' });
  } catch (error) {
    console.error('删除配置项失败:', error);
    res.status(500).json({ success: false, message: '删除配置项失败' });
  }
});

router.post('/reset', async (req: AuthRequest, res: Response) => {
  try {
    await query('DELETE FROM run_configs WHERE user_id = ?', [req.userId]);
    
    const defaultConfigs = [
      { name: 'PPT 页数', key: 'slideCount', type: 'number', value: '6', min: 3, max: 20, description: '生成 PPT 的总页数' },
      { name: '内容长度', key: 'summaryLength', type: 'select', value: 'balanced', options: [{ value: 'concise', label: '简洁' }, { value: 'balanced', label: '均衡' }, { value: 'detailed', label: '详细' }], description: '每页内容的详细程度' },
      { name: '语言风格', key: 'tone', type: 'select', value: 'professional', options: [{ value: 'professional', label: '专业严谨' }, { value: 'creative', label: '创意活泼' }, { value: 'casual', label: '通俗易懂' }], description: 'PPT 的语言风格' },
      { name: '图像风格', key: 'imageStyle', type: 'select', value: 'flat', options: [{ value: 'flat', label: '扁平化' }, { value: '3d', label: '3D 立体' }, { value: 'illustration', label: '插画风格' }, { value: 'photo', label: '摄影风格' }], description: '生成图像的风格' },
      { name: 'PPT 模板', key: 'template', type: 'select', value: 'business', options: [{ value: 'business', label: '商务模板' }, { value: 'creative', label: '创意模板' }, { value: 'minimal', label: '极简模板' }, { value: 'tech', label: '科技模板' }], description: 'PPT 整体风格模板' },
      { name: 'Skill 强度', key: 'skillIntensity', type: 'number', value: '70', min: 0, max: 100, description: '控制 Skill 扩展功能的强度' }
    ];
    
    for (const config of defaultConfigs) {
      await query(
        'INSERT INTO run_configs (user_id, name, `key`, type, value, options, min_value, max_value, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [req.userId, config.name, config.key, config.type, config.value, JSON.stringify(config.options || []), config.min, config.max, config.description]
      );
    }
    
    const configs = await query(
      'SELECT id, name, `key`, type, value, options, min_value, max_value, description, created_at, updated_at FROM run_configs WHERE user_id = ? ORDER BY created_at ASC',
      [req.userId]
    );
    res.json({ success: true, data: configs, message: '配置已重置为默认值' });
  } catch (error) {
    console.error('重置配置失败:', error);
    res.status(500).json({ success: false, message: '重置配置失败' });
  }
});

export default router;
