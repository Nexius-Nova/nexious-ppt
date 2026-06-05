import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function migrate(): Promise<void> {
  let connection: mysql.Connection | null = null;

  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'nexious-ppt',
      multipleStatements: true,
    });

    console.log('Connected to database, running migrations...');

    const hasTable = async (tableName: string) => {
      const [rows] = await connection!.query(
        'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        [tableName]
      );
      return (rows as any[]).length > 0;
    };

    const hasColumn = async (tableName: string, columnName: string) => {
      const [rows] = await connection!.query(
        'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [tableName, columnName]
      );
      return (rows as any[]).length > 0;
    };

    const ensureColumn = async (tableName: string, columnName: string, ddl: string) => {
      if (await hasColumn(tableName, columnName)) {
        console.log(`${tableName}.${columnName} column exists, skipped`);
        return;
      }
      await connection!.query(ddl);
      console.log(`${tableName}.${columnName} column added`);
    };

    const dropColumnIfExists = async (tableName: string, columnName: string) => {
      if (!(await hasColumn(tableName, columnName))) {
        console.log(`${tableName}.${columnName} column does not exist, skipped`);
        return;
      }
      await connection!.query(`ALTER TABLE \`${tableName}\` DROP COLUMN \`${columnName}\``);
      console.log(`${tableName}.${columnName} column dropped`);
    };

    const ensureIndex = async (tableName: string, indexName: string, ddl: string) => {
      const [rows] = await connection!.query(
        'SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
        [tableName, indexName]
      );
      if ((rows as any[]).length > 0) {
        console.log(`${tableName}.${indexName} index exists, skipped`);
        return;
      }
      await connection!.query(ddl);
      console.log(`${tableName}.${indexName} index added`);
    };

    await ensureColumn(
      'prompts',
      'preview_url',
      "ALTER TABLE `prompts` ADD COLUMN `preview_url` VARCHAR(500) DEFAULT NULL COMMENT '提示词效果图URL' AFTER `content`"
    );

    await ensureColumn(
      'projects',
      'state',
      "ALTER TABLE `projects` ADD COLUMN `state` JSON DEFAULT NULL COMMENT '项目完整状态快照'"
    );

    await connection.query(`
      UPDATE \`projects\`
      SET \`content\` = JSON_UNQUOTE(JSON_EXTRACT(\`state\`, '$.input.content'))
      WHERE \`state\` IS NOT NULL
        AND JSON_EXTRACT(\`state\`, '$.input.content') IS NOT NULL
    `);
    console.log('projects.content synced from projects.state.input.content');

    await dropColumnIfExists('projects', 'settings');

    if (!(await hasTable('version_snapshots'))) {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS \`version_snapshots\` (
          \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`user_id\` BIGINT UNSIGNED NOT NULL,
          \`project_id\` VARCHAR(100) NOT NULL,
          \`label\` VARCHAR(255) DEFAULT NULL,
          \`state\` JSON DEFAULT NULL,
          \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          KEY \`idx_user_project\` (\`user_id\`, \`project_id\`),
          KEY \`idx_created_at\` (\`created_at\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='版本快照表'
      `);
      console.log('version_snapshots table created');
    } else {
      console.log('version_snapshots table exists, skipped');
    }

    await ensureColumn(
      'version_snapshots',
      'state',
      'ALTER TABLE `version_snapshots` ADD COLUMN `state` JSON DEFAULT NULL AFTER `label`'
    );

    const hasVersionOutline = await hasColumn('version_snapshots', 'outline');
    const hasVersionParameters = await hasColumn('version_snapshots', 'parameters');
    const hasVersionSlideCount = await hasColumn('version_snapshots', 'slide_count');

    if (hasVersionOutline || hasVersionParameters || hasVersionSlideCount) {
      const outlineExpression = hasVersionOutline ? '`outline`' : 'JSON_ARRAY()';
      const parametersExpression = hasVersionParameters ? '`parameters`' : 'JSON_OBJECT()';
      const slideCountExpression = hasVersionSlideCount ? '`slide_count`' : '0';
      await connection.query(`
        UPDATE \`version_snapshots\`
        SET \`state\` = CASE
          WHEN \`state\` IS NOT NULL THEN \`state\`
          ELSE JSON_OBJECT(
            'outline', COALESCE(${outlineExpression}, JSON_ARRAY()),
            'parameters', COALESCE(${parametersExpression}, JSON_OBJECT()),
            'slideCount', ${slideCountExpression}
          )
        END
      `);
      console.log('version_snapshots legacy fields merged into state');
    }

    await dropColumnIfExists('version_snapshots', 'outline');
    await dropColumnIfExists('version_snapshots', 'parameters');
    await dropColumnIfExists('version_snapshots', 'slide_count');

    if (!(await hasTable('generation_jobs'))) {
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

    try {
      await ensureIndex(
        'projects',
        'uk_projects_user_title',
        'ALTER TABLE `projects` ADD UNIQUE KEY `uk_projects_user_title` (`user_id`, `title`)'
      );
    } catch {
      console.warn('projects unique title index was not added. Please clean duplicate project names and rerun migration.');
    }

    try {
      await ensureIndex(
        'templates',
        'uk_templates_user_name',
        'ALTER TABLE `templates` ADD UNIQUE KEY `uk_templates_user_name` (`user_id`, `name`)'
      );
    } catch {
      console.warn('templates unique name index was not added. Please clean duplicate template names and rerun migration.');
    }

    await ensureIndex(
      'projects',
      'idx_projects_user_status_updated',
      'ALTER TABLE `projects` ADD INDEX `idx_projects_user_status_updated` (`user_id`, `status`, `updated_at`)'
    );
    await ensureIndex(
      'generation_jobs',
      'idx_generation_jobs_user_project_status_updated',
      'ALTER TABLE `generation_jobs` ADD INDEX `idx_generation_jobs_user_project_status_updated` (`user_id`, `project_id`, `status`, `updated_at`)'
    );

    await connection.query('DROP TABLE IF EXISTS `images`');
    await connection.query('DROP TABLE IF EXISTS `slides`');
    console.log('deprecated slides/images tables dropped');

    console.log('Database migration completed.');
  } catch (error) {
    console.error('Database migration failed:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

migrate();
