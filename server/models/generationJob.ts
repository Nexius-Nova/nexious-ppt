import { insert, query, update } from '../db/connection.js';

export type GenerationJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface GenerationJob {
  id: number;
  user_id: number;
  project_id: string;
  title: string | null;
  status: GenerationJobStatus;
  phase: string;
  progress: number;
  error_message: string | null;
  metadata: any;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

export interface CreateGenerationJobData {
  userId: number;
  projectId: string;
  title?: string;
  metadata?: any;
}

export interface UpdateGenerationJobData {
  status?: GenerationJobStatus;
  phase?: string;
  progress?: number;
  errorMessage?: string | null;
  metadata?: any;
}

export async function createGenerationJob(data: CreateGenerationJobData): Promise<number> {
  const result = await insert(
    `INSERT INTO generation_jobs
     (user_id, project_id, title, status, phase, progress, metadata)
     VALUES (?, ?, ?, 'queued', 'queued', 0, ?)`,
    [
      data.userId,
      data.projectId,
      data.title || null,
      JSON.stringify(data.metadata || {})
    ]
  );
  return result.insertId;
}

export async function getGenerationJobById(id: number): Promise<GenerationJob | null> {
  const rows = await query<GenerationJob>(
    'SELECT * FROM generation_jobs WHERE id = ?',
    [id]
  );
  return rows[0] || null;
}

export async function getGenerationJobsByProject(
  userId: number,
  projectId: string,
  limit = 20
): Promise<GenerationJob[]> {
  return query<GenerationJob>(
    `SELECT * FROM generation_jobs
     WHERE user_id = ? AND project_id = ?
     ORDER BY created_at DESC
     LIMIT ${Math.max(1, Math.min(100, limit))}`,
    [userId, projectId]
  );
}

export async function getRecentGenerationJobs(userId: number, limit = 20): Promise<GenerationJob[]> {
  return query<GenerationJob>(
    `SELECT * FROM generation_jobs
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ${Math.max(1, Math.min(100, limit))}`,
    [userId]
  );
}

export async function updateGenerationJob(
  id: number,
  userId: number,
  data: UpdateGenerationJobData
): Promise<boolean> {
  const fields: string[] = [];
  const values: any[] = [];

  if (data.status !== undefined) {
    fields.push('status = ?');
    values.push(data.status);
    if (['completed', 'failed', 'cancelled'].includes(data.status)) {
      fields.push('completed_at = NOW()');
    }
  }
  if (data.phase !== undefined) {
    fields.push('phase = ?');
    values.push(data.phase);
  }
  if (data.progress !== undefined) {
    fields.push('progress = ?');
    values.push(Math.max(0, Math.min(100, Math.round(data.progress))));
  }
  if (data.errorMessage !== undefined) {
    fields.push('error_message = ?');
    values.push(data.errorMessage);
  }
  if (data.metadata !== undefined) {
    fields.push('metadata = ?');
    values.push(JSON.stringify(data.metadata || {}));
  }

  if (fields.length === 0) return false;

  values.push(id, userId);
  const result = await update(
    `UPDATE generation_jobs SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
    values
  );
  return result.affectedRows > 0;
}
