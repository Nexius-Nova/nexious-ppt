/**
 * 图片表模型
 * 提供图片相关的数据库操作
 */

import { query, insert, update, remove } from '../db/connection.js';

// 图片接口定义
export interface Image {
  id: number;
  slide_id: number;
  prompt: string;
  style: string | null;
  url: string;
  is_selected: boolean;
  created_at: Date;
}

// 创建图片数据
export interface CreateImageData {
  slide_id: number;
  prompt: string;
  style?: string;
  url: string;
  is_selected?: boolean;
}

// 更新图片数据
export interface UpdateImageData {
  prompt?: string;
  style?: string;
  url?: string;
  is_selected?: boolean;
}

/**
 * 根据ID查询图片
 */
export async function getImageById(id: number): Promise<Image | null> {
  const images = await query<Image>(
    'SELECT * FROM images WHERE id = ?',
    [id]
  );
  return images.length > 0 ? images[0] : null;
}

/**
 * 根据幻灯片ID查询所有图片
 */
export async function getImagesBySlideId(slideId: number): Promise<Image[]> {
  return await query<Image>(
    'SELECT * FROM images WHERE slide_id = ? ORDER BY created_at DESC',
    [slideId]
  );
}

/**
 * 获取幻灯片的选中图片
 */
export async function getSelectedImage(slideId: number): Promise<Image | null> {
  const images = await query<Image>(
    'SELECT * FROM images WHERE slide_id = ? AND is_selected = 1 LIMIT 1',
    [slideId]
  );
  return images.length > 0 ? images[0] : null;
}

/**
 * 创建图片
 */
export async function createImage(data: CreateImageData): Promise<number> {
  const result = await insert(
    `INSERT INTO images 
     (slide_id, prompt, style, url, is_selected) 
     VALUES (?, ?, ?, ?, ?)`,
    [
      data.slide_id,
      data.prompt,
      data.style || null,
      data.url,
      data.is_selected ? 1 : 0,
    ]
  );
  return result.insertId;
}

/**
 * 批量创建图片
 */
export async function createImages(images: CreateImageData[]): Promise<number[]> {
  const insertIds: number[] = [];

  for (const image of images) {
    const id = await createImage(image);
    insertIds.push(id);
  }

  return insertIds;
}

/**
 * 更新图片
 */
export async function updateImage(id: number, data: UpdateImageData): Promise<boolean> {
  const fields: string[] = [];
  const values: any[] = [];

  if (data.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(data.prompt);
  }
  if (data.style !== undefined) {
    fields.push('style = ?');
    values.push(data.style);
  }
  if (data.url !== undefined) {
    fields.push('url = ?');
    values.push(data.url);
  }
  if (data.is_selected !== undefined) {
    fields.push('is_selected = ?');
    values.push(data.is_selected ? 1 : 0);
  }

  if (fields.length === 0) {
    return false;
  }

  values.push(id);
  const result = await update(
    `UPDATE images SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
  return result.affectedRows > 0;
}

/**
 * 删除图片
 */
export async function deleteImage(id: number): Promise<boolean> {
  const result = await remove(
    'DELETE FROM images WHERE id = ?',
    [id]
  );
  return result.affectedRows > 0;
}

/**
 * 删除幻灯片的所有图片
 */
export async function deleteImagesBySlideId(slideId: number): Promise<boolean> {
  const result = await remove(
    'DELETE FROM images WHERE slide_id = ?',
    [slideId]
  );
  return result.affectedRows > 0;
}

/**
 * 选择图片（会先取消该幻灯片其他图片的选中状态）
 */
export async function selectImage(slideId: number, imageId: number): Promise<boolean> {
  // 先取消该幻灯片其他图片的选中状态
  await update(
    'UPDATE images SET is_selected = 0 WHERE slide_id = ?',
    [slideId]
  );

  // 设置新的选中图片
  const result = await update(
    'UPDATE images SET is_selected = 1 WHERE id = ? AND slide_id = ?',
    [imageId, slideId]
  );
  return result.affectedRows > 0;
}

/**
 * 获取幻灯片图片数量
 */
export async function getImageCount(slideId: number): Promise<number> {
  const result = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM images WHERE slide_id = ?',
    [slideId]
  );
  return result[0].count;
}
