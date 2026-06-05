import mysql from 'mysql2/promise';
import type { PoolConnection } from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'nexious-ppt',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT || '0', 10),
  charset: 'utf8mb4',
  timezone: '+08:00',
});

function sanitizeParams(params?: any[]): any[] | undefined {
  return params?.map((param) => (param === undefined ? null : param));
}

export async function testConnection(): Promise<boolean> {
  try {
    const connection = await pool.getConnection();
    connection.release();
    console.log('数据库连接成功');
    return true;
  } catch (error) {
    console.error('数据库连接失败', error);
    return false;
  }
}

export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const [rows] = await pool.execute(sql, sanitizeParams(params));
  return rows as T[];
}

export async function insert(
  sql: string,
  params?: any[]
): Promise<{ insertId: number; affectedRows: number }> {
  const [result] = await pool.execute(sql, sanitizeParams(params));
  return result as any;
}

export async function update(
  sql: string,
  params?: any[]
): Promise<{ affectedRows: number; changedRows: number }> {
  const [result] = await pool.execute(sql, sanitizeParams(params));
  return result as any;
}

export async function remove(
  sql: string,
  params?: any[]
): Promise<{ affectedRows: number }> {
  const [result] = await pool.execute(sql, sanitizeParams(params));
  return result as any;
}

export interface TransactionContext {
  connection: PoolConnection;
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  insert(sql: string, params?: any[]): Promise<{ insertId: number; affectedRows: number }>;
  update(sql: string, params?: any[]): Promise<{ affectedRows: number; changedRows: number }>;
  remove(sql: string, params?: any[]): Promise<{ affectedRows: number }>;
}

export async function withTransaction<T>(
  handler: (transaction: TransactionContext) => Promise<T>
): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const transaction: TransactionContext = {
      connection,
      async query<T = any>(sql: string, params?: any[]) {
        const [rows] = await connection.execute(sql, sanitizeParams(params));
        return rows as T[];
      },
      async insert(sql: string, params?: any[]) {
        const [result] = await connection.execute(sql, sanitizeParams(params));
        return result as any;
      },
      async update(sql: string, params?: any[]) {
        const [result] = await connection.execute(sql, sanitizeParams(params));
        return result as any;
      },
      async remove(sql: string, params?: any[]) {
        const [result] = await connection.execute(sql, sanitizeParams(params));
        return result as any;
      },
    };

    const result = await handler(transaction);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

let activeTransactionConnection: PoolConnection | null = null;

/**
 * @deprecated Use withTransaction instead. A process-wide transaction handle is
 * unsafe when concurrent requests are active.
 */
export async function beginTransaction(): Promise<PoolConnection> {
  if (activeTransactionConnection) {
    throw new Error('A transaction is already active. Use withTransaction for nested work.');
  }
  activeTransactionConnection = await pool.getConnection();
  await activeTransactionConnection.beginTransaction();
  return activeTransactionConnection;
}

/**
 * @deprecated Use withTransaction instead.
 */
export async function commit(): Promise<void> {
  if (!activeTransactionConnection) return;
  const connection = activeTransactionConnection;
  activeTransactionConnection = null;
  await connection.commit();
  connection.release();
}

/**
 * @deprecated Use withTransaction instead.
 */
export async function rollback(): Promise<void> {
  if (!activeTransactionConnection) return;
  const connection = activeTransactionConnection;
  activeTransactionConnection = null;
  await connection.rollback();
  connection.release();
}

export async function closePool(): Promise<void> {
  await pool.end();
  console.log('数据库连接池已关闭');
}

export default pool;
