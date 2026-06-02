import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function migrate(): Promise<void> {
  let connection: mysql.Connection | null = null;

  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306'),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'nexious-ppt',
      multipleStatements: true,
    });

    console.log('🔗 已连接到数据库，开始迁移...');

    const [columns] = await connection.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'state'"
    );

    if ((columns as any[]).length === 0) {
      await connection.query(
        "ALTER TABLE `projects` ADD COLUMN `state` JSON DEFAULT NULL COMMENT '项目完整状态快照'"
      );
      console.log('✅ projects 表已添加 state 列');
    } else {
      console.log('⏭️ projects.state 列已存在，跳过');
    }

    const [tables] = await connection.query(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'version_snapshots'"
    );

    if ((tables as any[]).length === 0) {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS \`version_snapshots\` (
          \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`user_id\` BIGINT UNSIGNED NOT NULL,
          \`project_id\` VARCHAR(100) NOT NULL,
          \`label\` VARCHAR(255) DEFAULT NULL,
          \`outline\` JSON DEFAULT NULL,
          \`parameters\` JSON DEFAULT NULL,
          \`slide_count\` INT UNSIGNED DEFAULT 0,
          \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          KEY \`idx_user_project\` (\`user_id\`, \`project_id\`),
          KEY \`idx_created_at\` (\`created_at\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='版本快照表'
      `);
      console.log('✅ version_snapshots 表已创建');
    } else {
      console.log('⏭️ version_snapshots 表已存在，跳过');
    }

    console.log('🎉 数据库迁移完成！');
  } catch (error) {
    console.error('❌ 数据库迁移失败:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

migrate();
