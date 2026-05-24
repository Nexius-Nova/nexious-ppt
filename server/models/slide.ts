/**
 * 幻灯片表模型
 * 提供幻灯片相关的数据库操作
 */

import { query, insert, update, remove } from '../db/connection.js';

// 幻灯片接口定义
export interface Slide {
  id: number;
  project_id: number;
  order_index: number;
  title: string | null;
  bullets: any;
  speaker_notes: string | null;
  visual_prompt: string | null;
  image_url: string | null;
  created_at: Date;
  updated_at: Date;
}

// 创建幻灯片数据
export interface CreateSlideData {
  project_id: number;
  order_index: number;
  title?: string;
  bullets?: any;
  speaker_notes?: string;
  visual_prompt?: string;
  image_url?: string;
}

// 更新幻灯片数据
export interface UpdateSlideData {
  order_index?: number;
  title?: string;
  bullets?: any;
  speaker_notes?: string;
  visual_prompt?: string;
  image_url?: string;
}

/**
 * 根据ID查询幻灯片
 */
export async function getSlideById(id: number): Promise<Slide | null> {
  const slides = await query<Slide>(
    'SELECT * FROM slides WHERE id = ?',
    [id]
  );
  return slides.length > 0 ? slides[0] : null;
}

/**
 * 根据项目ID查询所有幻灯片
 */
export async function getSlidesByProjectId(projectId: number): Promise<Slide[]> {
  return await query<Slide>(
    'SELECT * FROM slides WHERE project_id = ? ORDER BY order_index ASC',
    [projectId]
  );
}

/**
 * 创建幻灯片
 */
export async function createSlide(data: CreateSlideData): Promise<number> {
  const result = await insert(
    `INSERT INTO slides 
     (project_id, order_index, title, bullets, speaker_notes, visual_prompt, image_url) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      data.project_id,
      data.order_index,
      data.title || null,
      data.bullets ? JSON.stringify(data.bullets) : null,
      data.speaker_notes || null,
      data.visual_prompt || null,
      data.image_url || null,
    ]
  );
  return result.insertId;
}

/**
 * 批量创建幻灯片
 */
export async function createSlides(slides: CreateSlideData[]): Promise<number[]> {
  const insertIds: number[] = [];

  for (const slide of slides) {
    const id = await createSlide(slide);
    insertIds.push(id);
  }

  return insertIds;
}

/**
 * 更新幻灯片
 */
export async function updateSlide(id: number, data: UpdateSlideData): Promise<boolean> {
  const fields: string[] = [];
  const values: any[] = [];

  if (data.order_index !== undefined) {
    fields.push('order_index = ?');
    values.push(data.order_index);
  }
  if (data.title !== undefined) {
    fields.push('title = ?');
    values.push(data.title);
  }
  if (data.bullets !== undefined) {
    fields.push('bullets = ?');
    values.push(JSON.stringify(data.bullets));
  }
  if (data.speaker_notes !== undefined) {
    fields.push('speaker_notes = ?');
    values.push(data.speaker_notes);
  }
  if (data.visual_prompt !== undefined) {
    fields.push('visual_prompt = ?');
    values.push(data.visual_prompt);
  }
  if (data.image_url !== undefined) {
    fields.push('image_url = ?');
    values.push(data.image_url);
  }

  if (fields.length === 0) {
    return false;
  }

  values.push(id);
  const result = await update(
    `UPDATE slides SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
  return result.affectedRows > 0;
}

/**
 * 删除幻灯片
 */
export async function deleteSlide(id: number): Promise<boolean> {
  const result = await remove(
    'DELETE FROM slides WHERE id = ?',
    [id]
  );
  return result.affectedRows > 0;
}

/**
 * 删除项目的所有幻灯片
 */
export async function deleteSlidesByProjectId(projectId: number): Promise<boolean> {
  const result = await remove(
    'DELETE FROM slides WHERE project_id = ?',
    [projectId]
  );
  return result.affectedRows > 0;
}

/**
 * 更新幻灯片顺序
 */
export async function updateSlideOrder(projectId: number, slideOrders: { id: number; order_index: number }[]): Promise<boolean> {
  for (const slideOrder of slideOrders) {
    await update(
      'UPDATE slides SET order_index = ? WHERE id = ? AND project_id = ?',
      [slideOrder.order_index, slideOrder.id, projectId]
    );
  }
  return true;
}

/**
 * 获取项目幻灯片数量
 */
export async function getSlideCount(projectId: number): Promise<number> {
  const result = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM slides WHERE project_id = ?',
    [projectId]
  );
  return result[0].count;
}
