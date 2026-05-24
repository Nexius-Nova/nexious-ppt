/**
 * 数据库初始化脚本
 * 读取并执行 SQL 初始化文件
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// 获取当前文件的目录路径（ES 模块）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 初始化数据库
 */
async function initializeDatabase(): Promise<void> {
  let connection: mysql.Connection | null = null;

  try {
    // 首先连接到 MySQL 服务器（不指定数据库）
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306'),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      multipleStatements: true, // 允许执行多条 SQL 语句
    });

    console.log('🔗 正在连接到 MySQL 服务器...');

    // 读取 SQL 文件
    const sqlFilePath = path.join(__dirname, '../../database/init.sql');
    const sqlContent = fs.readFileSync(sqlFilePath, 'utf-8');

    console.log('📄 正在读取 SQL 初始化文件...');

    // 执行 SQL 文件
    await connection.query(sqlContent);

    console.log('✅ 数据库初始化成功！');
    console.log('📊 数据库名称: nexious-ppt');
    console.log('📋 已创建表: users, api_keys, projects, slides, images');
    console.log('✨ 已插入测试数据');

    // 验证表是否创建成功
    const [tables] = await connection.query(
      "SHOW TABLES FROM `nexious-ppt`"
    );

    console.log('\n📊 数据库表列表:');
    (tables as any[]).forEach((table: any) => {
      const tableName = Object.values(table)[0];
      console.log(`  - ${tableName}`);
    });

    // 显示每个表的行数
    console.log('\n📈 表数据统计:');
    const tableNames = ['users', 'api_keys', 'projects', 'slides', 'images'];

    for (const tableName of tableNames) {
      const [rows] = await connection.query(
        `SELECT COUNT(*) as count FROM \`${tableName}\``
      );
      const count = (rows as any[])[0].count;
      console.log(`  - ${tableName}: ${count} 行`);
    }

  } catch (error) {
    console.error('❌ 数据库初始化失败:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// 执行初始化
initializeDatabase();
