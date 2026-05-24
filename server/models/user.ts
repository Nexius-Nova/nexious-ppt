/**
 * 用户表模型
 * 提供用户相关的数据库操作
 */

import { query, insert, update, remove } from '../db/connection.js';

// 用户接口定义
export interface User {
  id: number;
  email: string;
  password_hash: string;
  name: string | null;
  avatar: string | null;
  created_at: Date;
  updated_at: Date;
}

// 创建用户数据
export interface CreateUserData {
  email: string;
  password_hash: string;
  name?: string;
  avatar?: string;
}

// 更新用户数据
export interface UpdateUserData {
  name?: string;
  avatar?: string;
  password_hash?: string;
}

/**
 * 根据ID查询用户
 */
export async function getUserById(id: number): Promise<User | null> {
  const users = await query<User>(
    'SELECT * FROM users WHERE id = ?',
    [id]
  );
  return users.length > 0 ? users[0] : null;
}

/**
 * 根据邮箱查询用户
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  const users = await query<User>(
    'SELECT * FROM users WHERE email = ?',
    [email]
  );
  return users.length > 0 ? users[0] : null;
}

/**
 * 创建用户
 */
export async function createUser(data: CreateUserData): Promise<number> {
  const result = await insert(
    'INSERT INTO users (email, password_hash, name, avatar) VALUES (?, ?, ?, ?)',
    [data.email, data.password_hash, data.name || null, data.avatar || null]
  );
  return result.insertId;
}

/**
 * 更新用户
 */
export async function updateUser(id: number, data: UpdateUserData): Promise<boolean> {
  const fields: string[] = [];
  const values: any[] = [];

  if (data.name !== undefined) {
    fields.push('name = ?');
    values.push(data.name);
  }
  if (data.avatar !== undefined) {
    fields.push('avatar = ?');
    values.push(data.avatar);
  }
  if (data.password_hash !== undefined) {
    fields.push('password_hash = ?');
    values.push(data.password_hash);
  }

  if (fields.length === 0) {
    return false;
  }

  values.push(id);
  const result = await update(
    `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
  return result.affectedRows > 0;
}

/**
 * 删除用户
 */
export async function deleteUser(id: number): Promise<boolean> {
  const result = await remove(
    'DELETE FROM users WHERE id = ?',
    [id]
  );
  return result.affectedRows > 0;
}

/**
 * 获取所有用户（分页）
 */
export async function getAllUsers(limit: number = 100, offset: number = 0): Promise<User[]> {
  return await query<User>(
    `SELECT * FROM users ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
  );
}

/**
 * 统计用户总数
 */
export async function getUserCount(): Promise<number> {
  const result = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM users'
  );
  return result[0].count;
}
