/**
 * PPT项目表模型
 * 提供项目相关的数据库操作
 */

import { query, insert, update, remove } from '../db/connection.js';

// 项目接口定义
export interface Project {
  id: number;
  user_id: number;
  title: string;
  topic: string | null;
  content: string | null;
  status: 'draft' | 'generating' | 'completed';
  settings: any;
  state?: any;
  created_at: Date;
  updated_at: Date;
}

// 创建项目数据
export interface CreateProjectData {
  user_id: number;
  title: string;
  topic?: string;
  content?: string;
  status?: 'draft' | 'generating' | 'completed';
  settings?: any;
  state?: any;
}

// 更新项目数据
export interface UpdateProjectData {
  title?: string;
  topic?: string;
  content?: string;
  status?: 'draft' | 'generating' | 'completed';
  settings?: any;
  state?: any;
}

/**
 * 根据ID查询项目
 */
export async function getProjectById(id: number): Promise<Project | null> {
  const projects = await query<Project>(
    'SELECT * FROM projects WHERE id = ?',
    [id]
  );
  return projects.length > 0 ? projects[0] : null;
}

/**
 * 根据用户ID查询所有项目
 */
export async function getProjectsByUserId(userId: number): Promise<Project[]> {
  return await query<Project>(
    'SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  );
}

/**
 * 根据状态查询项目
 */
export async function getProjectsByStatus(
  userId: number,
  status: 'draft' | 'generating' | 'completed'
): Promise<Project[]> {
  return await query<Project>(
    'SELECT * FROM projects WHERE user_id = ? AND status = ? ORDER BY created_at DESC',
    [userId, status]
  );
}

/**
 * 创建项目
 */
export async function createProject(data: CreateProjectData): Promise<number> {
  const result = await insert(
    `INSERT INTO projects 
     (user_id, title, topic, content, status, settings, state) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      data.user_id,
      data.title,
      data.topic || null,
      data.content || null,
      data.status || 'draft',
      data.settings ? JSON.stringify(data.settings) : null,
      data.state ? JSON.stringify(data.state) : null,
    ]
  );
  return result.insertId;
}

/**
 * 更新项目
 */
export async function updateProject(id: number, data: UpdateProjectData): Promise<boolean> {
  const fields: string[] = [];
  const values: any[] = [];

  if (data.title !== undefined) {
    fields.push('title = ?');
    values.push(data.title);
  }
  if (data.topic !== undefined) {
    fields.push('topic = ?');
    values.push(data.topic);
  }
  if (data.content !== undefined) {
    fields.push('content = ?');
    values.push(data.content);
  }
  if (data.status !== undefined) {
    fields.push('status = ?');
    values.push(data.status);
  }
  if (data.settings !== undefined) {
    fields.push('settings = ?');
    values.push(JSON.stringify(data.settings));
  }
  if (data.state !== undefined) {
    fields.push('state = ?');
    values.push(JSON.stringify(data.state));
  }

  if (fields.length === 0) {
    return false;
  }

  values.push(id);
  const result = await update(
    `UPDATE projects SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
  return result.affectedRows > 0;
}

/**
 * 删除项目
 */
export async function deleteProject(id: number): Promise<boolean> {
  const result = await remove(
    'DELETE FROM projects WHERE id = ?',
    [id]
  );
  return result.affectedRows > 0;
}

/**
 * 获取用户项目统计
 */
export async function getProjectStats(userId: number): Promise<{
  total: number;
  draft: number;
  generating: number;
  completed: number;
}> {
  const total = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM projects WHERE user_id = ?',
    [userId]
  );

  const draft = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM projects WHERE user_id = ? AND status = ?',
    [userId, 'draft']
  );

  const generating = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM projects WHERE user_id = ? AND status = ?',
    [userId, 'generating']
  );

  const completed = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM projects WHERE user_id = ? AND status = ?',
    [userId, 'completed']
  );

  return {
    total: total[0].count,
    draft: draft[0].count,
    generating: generating[0].count,
    completed: completed[0].count,
  };
}
