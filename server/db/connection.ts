/**
 * 数据库连接配置
 * 使用 mysql2/promise 支持异步操作和连接池
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// 数据库连接池配置
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'nexious-ppt',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10'),
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT || '0'),
  charset: 'utf8mb4',
  timezone: '+08:00', // 设置时区为东八区
});

/**
 * 测试数据库连接
 */
export async function testConnection(): Promise<boolean> {
  try {
    const connection = await pool.getConnection();
    console.log('✅ 数据库连接成功');
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ 数据库连接失败:', error);
    return false;
  }
}

function sanitizeParams(params?: any[]): any[] | undefined {
  return params?.map(p => (p === undefined ? null : p));
}

/**
 * 执行查询
 * @param sql SQL语句
 * @param params 参数
 * @returns 查询结果
 */
export async function query<T = any>(
  sql: string,
  params?: any[]
): Promise<T[]> {
  const [rows] = await pool.execute(sql, sanitizeParams(params));
  return rows as T[];
}

/**
 * 执行插入操作
 * @param sql SQL语句
 * @param params 参数
 * @returns 插入结果
 */
export async function insert(
  sql: string,
  params?: any[]
): Promise<{ insertId: number; affectedRows: number }> {
  const [result] = await pool.execute(sql, sanitizeParams(params));
  return result as any;
}

/**
 * 执行更新操作
 * @param sql SQL语句
 * @param params 参数
 * @returns 更新结果
 */
export async function update(
  sql: string,
  params?: any[]
): Promise<{ affectedRows: number; changedRows: number }> {
  const [result] = await pool.execute(sql, sanitizeParams(params));
  return result as any;
}

/**
 * 执行删除操作
 * @param sql SQL语句
 * @param params 参数
 * @returns 删除结果
 */
export async function remove(
  sql: string,
  params?: any[]
): Promise<{ affectedRows: number }> {
  const [result] = await pool.execute(sql, sanitizeParams(params));
  return result as any;
}

/**
 * 开始事务
 */
export async function beginTransaction(): Promise<void> {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  (connection as any)._isTransaction = true;
}

/**
 * 提交事务
 */
export async function commit(): Promise<void> {
  const connection = await pool.getConnection();
  if ((connection as any)._isTransaction) {
    await connection.commit();
    connection.release();
  }
}

/**
 * 回滚事务
 */
export async function rollback(): Promise<void> {
  const connection = await pool.getConnection();
  if ((connection as any)._isTransaction) {
    await connection.rollback();
    connection.release();
  }
}

/**
 * 关闭连接池
 */
export async function closePool(): Promise<void> {
  await pool.end();
  console.log('📦 数据库连接池已关闭');
}

export default pool;
