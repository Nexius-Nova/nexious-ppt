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

    const [promptPreviewColumns] = await connection.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prompts' AND COLUMN_NAME = 'preview_url'"
    );

    if ((promptPreviewColumns as any[]).length === 0) {
      await connection.query(
        "ALTER TABLE `prompts` ADD COLUMN `preview_url` VARCHAR(500) DEFAULT NULL COMMENT '提示词效果图URL' AFTER `content`"
      );
      console.log('prompts.preview_url column added');
    } else {
      console.log('prompts.preview_url column exists, skipped');
    }

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

    const [projectTitleIndex] = await connection.query(
      "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND INDEX_NAME = 'uk_projects_user_title'"
    );

    if ((projectTitleIndex as any[]).length === 0) {
      try {
        await connection.query(
          "ALTER TABLE `projects` ADD UNIQUE KEY `uk_projects_user_title` (`user_id`, `title`)"
        );
        console.log('✅ projects 表已添加用户项目名称唯一索引');
      } catch (error) {
        console.warn('⚠️ projects 名称唯一索引添加失败，请先清理同用户下的重复项目名称后重试。');
      }
    } else {
      console.log('⏭️ projects 用户项目名称唯一索引已存在，跳过');
    }

    const [templateNameIndex] = await connection.query(
      "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'templates' AND INDEX_NAME = 'uk_templates_user_name'"
    );

    if ((templateNameIndex as any[]).length === 0) {
      try {
        await connection.query(
          "ALTER TABLE `templates` ADD UNIQUE KEY `uk_templates_user_name` (`user_id`, `name`)"
        );
        console.log('✅ templates 表已添加用户模板名称唯一索引');
      } catch (error) {
        console.warn('⚠️ templates 名称唯一索引添加失败，请先清理同用户下的重复模板名称后重试。');
      }
    } else {
      console.log('⏭️ templates 用户模板名称唯一索引已存在，跳过');
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

    const [generationJobTables] = await connection.query(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'generation_jobs'"
    );

    if ((generationJobTables as any[]).length === 0) {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS \`generation_jobs\` (
          \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`user_id\` BIGINT UNSIGNED NOT NULL,
          \`project_id\` VARCHAR(100) NOT NULL,
          \`title\` VARCHAR(255) DEFAULT NULL,
          \`status\` ENUM('queued', 'running', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
          \`phase\` VARCHAR(50) NOT NULL DEFAULT 'queued',
          \`progress\` INT UNSIGNED NOT NULL DEFAULT 0,
          \`error_message\` TEXT DEFAULT NULL,
          \`metadata\` JSON DEFAULT NULL,
          \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          \`completed_at\` TIMESTAMP NULL DEFAULT NULL,
          PRIMARY KEY (\`id\`),
          KEY \`idx_generation_jobs_user_project\` (\`user_id\`, \`project_id\`),
          KEY \`idx_generation_jobs_user_status\` (\`user_id\`, \`status\`),
          KEY \`idx_generation_jobs_updated_at\` (\`updated_at\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('generation_jobs table created');
    } else {
      console.log('generation_jobs table exists, skipped');
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
