import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const CURRENT_SCHEMA_VERSION = '202606080001_baseline_workflow_auth_queue';

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

    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
        \`version\` VARCHAR(100) NOT NULL,
        \`description\` VARCHAR(255) DEFAULT NULL,
        \`applied_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`version\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='数据库结构迁移记录'
    `);
    console.log('schema_migrations table ensured');

    await ensureColumn(
      'prompts',
      'preview_url',
      "ALTER TABLE `prompts` ADD COLUMN `preview_url` VARCHAR(500) DEFAULT NULL COMMENT 'Prompt preview image URL' AFTER `content`"
    );

    await ensureColumn(
      'projects',
      'state',
      "ALTER TABLE `projects` ADD COLUMN `state` JSON DEFAULT NULL COMMENT 'Full project state snapshot'"
    );

    await connection.query(`
      UPDATE \`projects\`
      SET \`content\` = JSON_UNQUOTE(JSON_EXTRACT(\`state\`, '$.input.content'))
      WHERE \`state\` IS NOT NULL
        AND JSON_EXTRACT(\`state\`, '$.input.content') IS NOT NULL
    `);
    console.log('projects.content synced from projects.state.input.content');

    await dropColumnIfExists('projects', 'settings');

    await ensureColumn(
      'skills',
      'type',
      "ALTER TABLE `skills` ADD COLUMN `type` VARCHAR(50) NOT NULL DEFAULT 'prompt-only' AFTER `is_enabled`"
    );
    await ensureColumn(
      'skills',
      'runtime',
      "ALTER TABLE `skills` ADD COLUMN `runtime` VARCHAR(50) NOT NULL DEFAULT 'prompt-only' AFTER `type`"
    );
    await ensureColumn(
      'skills',
      'entry',
      'ALTER TABLE `skills` ADD COLUMN `entry` VARCHAR(500) DEFAULT NULL AFTER `runtime`'
    );
    await ensureColumn(
      'skills',
      'package_path',
      'ALTER TABLE `skills` ADD COLUMN `package_path` VARCHAR(1000) DEFAULT NULL AFTER `entry`'
    );
    await ensureColumn(
      'skills',
      'manifest',
      'ALTER TABLE `skills` ADD COLUMN `manifest` JSON DEFAULT NULL AFTER `package_path`'
    );
    await ensureColumn(
      'skills',
      'capabilities',
      'ALTER TABLE `skills` ADD COLUMN `capabilities` JSON DEFAULT NULL AFTER `manifest`'
    );
    await ensureColumn(
      'skills',
      'input_contract',
      'ALTER TABLE `skills` ADD COLUMN `input_contract` JSON DEFAULT NULL AFTER `capabilities`'
    );
    await ensureColumn(
      'skills',
      'output_contract',
      'ALTER TABLE `skills` ADD COLUMN `output_contract` JSON DEFAULT NULL AFTER `input_contract`'
    );
    await ensureColumn(
      'skills',
      'test_sample',
      'ALTER TABLE `skills` ADD COLUMN `test_sample` JSON DEFAULT NULL AFTER `output_contract`'
    );
    await ensureColumn(
      'skills',
      'sandbox_policy',
      'ALTER TABLE `skills` ADD COLUMN `sandbox_policy` JSON DEFAULT NULL AFTER `test_sample`'
    );
    await ensureColumn(
      'skills',
      'dependency_file',
      'ALTER TABLE `skills` ADD COLUMN `dependency_file` VARCHAR(500) DEFAULT NULL AFTER `sandbox_policy`'
    );
    await ensureColumn(
      'skills',
      'install_status',
      "ALTER TABLE `skills` ADD COLUMN `install_status` VARCHAR(50) NOT NULL DEFAULT 'not_required' AFTER `dependency_file`"
    );
    await ensureColumn(
      'skills',
      'install_log',
      'ALTER TABLE `skills` ADD COLUMN `install_log` MEDIUMTEXT DEFAULT NULL AFTER `install_status`'
    );
    await ensureColumn(
      'skills',
      'last_installed_at',
      'ALTER TABLE `skills` ADD COLUMN `last_installed_at` TIMESTAMP NULL DEFAULT NULL AFTER `install_log`'
    );
    await ensureColumn(
      'skills',
      'test_status',
      "ALTER TABLE `skills` ADD COLUMN `test_status` VARCHAR(50) NOT NULL DEFAULT 'not_tested' AFTER `last_installed_at`"
    );
    await ensureColumn(
      'skills',
      'test_log',
      'ALTER TABLE `skills` ADD COLUMN `test_log` MEDIUMTEXT DEFAULT NULL AFTER `test_status`'
    );
    await ensureColumn(
      'skills',
      'last_tested_at',
      'ALTER TABLE `skills` ADD COLUMN `last_tested_at` TIMESTAMP NULL DEFAULT NULL AFTER `test_log`'
    );

    await connection.query(`
      UPDATE \`skills\`
      SET
        \`type\` = COALESCE(NULLIF(\`type\`, ''), 'prompt-only'),
        \`runtime\` = COALESCE(NULLIF(\`runtime\`, ''), 'prompt-only'),
        \`install_status\` = COALESCE(NULLIF(\`install_status\`, ''), 'not_required'),
        \`install_log\` = COALESCE(\`install_log\`, 'No dependency initialization is required.'),
        \`test_status\` = COALESCE(NULLIF(\`test_status\`, ''), 'not_tested')
    `);
    console.log('skills package fields normalized');

    if (!(await hasTable('skill_runs'))) {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS \`skill_runs\` (
          \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`user_id\` BIGINT UNSIGNED NOT NULL,
          \`skill_id\` BIGINT UNSIGNED NOT NULL,
          \`project_id\` VARCHAR(100) DEFAULT NULL,
          \`phase\` VARCHAR(50) NOT NULL DEFAULT 'input',
          \`status\` VARCHAR(50) NOT NULL DEFAULT 'queued',
          \`progress\` INT UNSIGNED NOT NULL DEFAULT 0,
          \`input\` JSON DEFAULT NULL,
          \`output\` JSON DEFAULT NULL,
          \`error_message\` TEXT DEFAULT NULL,
          \`logs\` MEDIUMTEXT DEFAULT NULL,
          \`started_at\` TIMESTAMP NULL DEFAULT NULL,
          \`completed_at\` TIMESTAMP NULL DEFAULT NULL,
          \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          KEY \`idx_skill_runs_user_project\` (\`user_id\`, \`project_id\`),
          KEY \`idx_skill_runs_skill_status\` (\`skill_id\`, \`status\`),
          KEY \`idx_skill_runs_created_at\` (\`created_at\`),
          CONSTRAINT \`fk_skill_runs_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT \`fk_skill_runs_skill_id\` FOREIGN KEY (\`skill_id\`) REFERENCES \`skills\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Skill run records'
      `);
      console.log('skill_runs table created');
    } else {
      console.log('skill_runs table exists, skipped');
    }

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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Version snapshots'
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

    if (!(await hasTable('user_sessions'))) {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS \`user_sessions\` (
          \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`user_id\` BIGINT UNSIGNED NOT NULL,
          \`session_id\` CHAR(36) NOT NULL,
          \`refresh_token_hash\` CHAR(64) NOT NULL,
          \`user_agent\` VARCHAR(500) DEFAULT NULL,
          \`ip_address\` VARCHAR(100) DEFAULT NULL,
          \`expires_at\` DATETIME NOT NULL,
          \`revoked_at\` DATETIME DEFAULT NULL,
          \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`last_seen_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`uk_user_sessions_session_id\` (\`session_id\`),
          UNIQUE KEY \`uk_user_sessions_refresh_token_hash\` (\`refresh_token_hash\`),
          KEY \`idx_user_sessions_user_active\` (\`user_id\`, \`revoked_at\`, \`expires_at\`),
          CONSTRAINT \`fk_user_sessions_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户登录会话表'
      `);
      console.log('user_sessions table created');
    } else {
      console.log('user_sessions table exists, skipped');
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
    await ensureIndex(
      'skills',
      'idx_skills_user_runtime',
      'ALTER TABLE `skills` ADD INDEX `idx_skills_user_runtime` (`user_id`, `runtime`)'
    );
    await ensureIndex(
      'skills',
      'idx_skills_install_status',
      'ALTER TABLE `skills` ADD INDEX `idx_skills_install_status` (`install_status`)'
    );

    await connection.query('DROP TABLE IF EXISTS `images`');
    await connection.query('DROP TABLE IF EXISTS `slides`');
    console.log('deprecated slides/images tables dropped');

    await connection.query(
      'INSERT IGNORE INTO `schema_migrations` (`version`, `description`) VALUES (?, ?)',
      [CURRENT_SCHEMA_VERSION, 'Baseline schema after workflow queue, auth session, storage, skills and export migrations']
    );
    console.log(`schema migration recorded: ${CURRENT_SCHEMA_VERSION}`);

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
