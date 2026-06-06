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
  state?: any;
}

// 更新项目数据
export interface UpdateProjectData {
  title?: string;
  topic?: string;
  content?: string;
  status?: 'draft' | 'generating' | 'completed';
  state?: any;
}

function getProjectContentFromState(state: any): string | undefined {
  if (!state || typeof state !== 'object' || !state.input || typeof state.input !== 'object') return undefined;
  if (!('content' in state.input)) return undefined;
  return String(state.input.content || '');
}

function withSyncedContent<T extends CreateProjectData | UpdateProjectData>(data: T): T {
  const contentFromState = getProjectContentFromState(data.state);
  if (contentFromState === undefined) return data;
  return { ...data, content: contentFromState };
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

export async function getProjectByIdForUser(id: number, userId: number): Promise<Project | null> {
  const projects = await query<Project>(
    'SELECT * FROM projects WHERE id = ? AND user_id = ?',
    [id, userId]
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
  const syncedData = withSyncedContent(data);
  const result = await insert(
    `INSERT INTO projects
     (user_id, title, topic, content, status, state)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      syncedData.user_id,
      syncedData.title,
      syncedData.topic || null,
      syncedData.content ?? null,
      syncedData.status || 'draft',
      syncedData.state ? JSON.stringify(syncedData.state) : null,
    ]
  );
  return result.insertId;
}

/**
 * 更新项目
 */
export async function updateProject(id: number, data: UpdateProjectData): Promise<boolean> {
  const syncedData = withSyncedContent(data);
  const fields: string[] = [];
  const values: any[] = [];

  if (syncedData.title !== undefined) {
    fields.push('title = ?');
    values.push(syncedData.title);
  }
  if (syncedData.topic !== undefined) {
    fields.push('topic = ?');
    values.push(syncedData.topic);
  }
  if (syncedData.content !== undefined) {
    fields.push('content = ?');
    values.push(syncedData.content);
  }
  if (syncedData.status !== undefined) {
    fields.push('status = ?');
    values.push(syncedData.status);
  }
  if (syncedData.state !== undefined) {
    fields.push('state = ?');
    values.push(JSON.stringify(syncedData.state));
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

export async function updateProjectForUser(id: number, userId: number, data: UpdateProjectData): Promise<boolean> {
  const syncedData = withSyncedContent(data);
  const fields: string[] = [];
  const values: any[] = [];

  if (syncedData.title !== undefined) {
    fields.push('title = ?');
    values.push(syncedData.title);
  }
  if (syncedData.topic !== undefined) {
    fields.push('topic = ?');
    values.push(syncedData.topic);
  }
  if (syncedData.content !== undefined) {
    fields.push('content = ?');
    values.push(syncedData.content);
  }
  if (syncedData.status !== undefined) {
    fields.push('status = ?');
    values.push(syncedData.status);
  }
  if (syncedData.state !== undefined) {
    fields.push('state = ?');
    values.push(JSON.stringify(syncedData.state));
  }

  if (fields.length === 0) {
    return false;
  }

  values.push(id, userId);
  const result = await update(
    `UPDATE projects SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
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

export async function cleanupProjectRelations(userId: number, projectId: number): Promise<void> {
  const projectIdText = String(projectId);
  await update(
    `UPDATE generation_jobs
     SET status = 'cancelled',
         phase = 'cancelled',
         completed_at = COALESCE(completed_at, NOW())
     WHERE user_id = ?
       AND project_id = ?
       AND status IN ('queued', 'running')`,
    [userId, projectIdText]
  );
  await remove('DELETE FROM generation_jobs WHERE user_id = ? AND project_id = ?', [userId, projectIdText]);
  await remove('DELETE FROM version_snapshots WHERE user_id = ? AND project_id = ?', [userId, projectId]);
  await remove('DELETE FROM skill_runs WHERE user_id = ? AND project_id = ?', [userId, projectIdText]);
  await remove('DELETE FROM workflow_snapshots WHERE user_id = ?', [userId]);
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
