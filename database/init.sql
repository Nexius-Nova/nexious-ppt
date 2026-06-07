-- ============================================
-- Nexious-PPT 数据库完整初始化脚本
-- 数据库: nexious-ppt
-- 说明: 只创建表结构，并为已有用户补充运行配置默认值
-- ============================================

CREATE DATABASE IF NOT EXISTS `nexious-ppt`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `nexious-ppt`;

-- ============================================
-- 1. 用户表
-- ============================================
CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `name` VARCHAR(100) DEFAULT NULL,
  `avatar` VARCHAR(500) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_email` (`email`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- ============================================
-- 2. API 密钥表
-- ============================================
CREATE TABLE IF NOT EXISTS `api_keys` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `type` ENUM('text','image') NOT NULL DEFAULT 'text',
  `provider` VARCHAR(50) NOT NULL,
  `api_key` TEXT NOT NULL,
  `base_url` VARCHAR(255) DEFAULT NULL,
  `model` VARCHAR(100) DEFAULT NULL,
  `custom_provider_name` VARCHAR(100) DEFAULT NULL,
  `custom_model_name` VARCHAR(100) DEFAULT NULL,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_type_provider` (`type`,`provider`),
  KEY `idx_is_default` (`is_default`),
  KEY `idx_is_active` (`is_active`),
  CONSTRAINT `fk_api_keys_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='API密钥表';

-- ============================================
-- 3. PPT 项目表
-- ============================================
CREATE TABLE IF NOT EXISTS `projects` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `topic` TEXT DEFAULT NULL,
  `content` LONGTEXT DEFAULT NULL,
  `status` ENUM('draft','generating','completed') NOT NULL DEFAULT 'draft',
  `state` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  UNIQUE KEY `uk_projects_user_title` (`user_id`, `title`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_projects_user_status_updated` (`user_id`, `status`, `updated_at`),
  CONSTRAINT `fk_projects_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='PPT项目表';

-- ============================================
-- 4. 提示词表
-- ============================================
CREATE TABLE IF NOT EXISTS `prompts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `scene` VARCHAR(255) DEFAULT NULL,
  `content` TEXT NOT NULL,
  `preview_url` VARCHAR(500) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `fk_prompts_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='提示词表';

-- ============================================
-- 5. 技能表
-- ============================================
CREATE TABLE IF NOT EXISTS `skills` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `icon` VARCHAR(100) DEFAULT NULL,
  `category` VARCHAR(100) DEFAULT NULL,
  `parameters` JSON DEFAULT NULL,
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `type` VARCHAR(50) NOT NULL DEFAULT 'prompt-only',
  `runtime` VARCHAR(50) NOT NULL DEFAULT 'prompt-only',
  `entry` VARCHAR(500) DEFAULT NULL,
  `package_path` VARCHAR(1000) DEFAULT NULL,
  `manifest` JSON DEFAULT NULL,
  `dependency_file` VARCHAR(500) DEFAULT NULL,
  `install_status` VARCHAR(50) NOT NULL DEFAULT 'not_required',
  `install_log` MEDIUMTEXT DEFAULT NULL,
  `last_installed_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_is_enabled` (`is_enabled`),
  KEY `idx_skills_user_runtime` (`user_id`, `runtime`),
  KEY `idx_skills_install_status` (`install_status`),
  CONSTRAINT `fk_skills_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='技能表';

CREATE TABLE IF NOT EXISTS `skill_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `skill_id` BIGINT UNSIGNED NOT NULL,
  `project_id` VARCHAR(100) DEFAULT NULL,
  `phase` VARCHAR(50) NOT NULL DEFAULT 'input',
  `status` VARCHAR(50) NOT NULL DEFAULT 'queued',
  `progress` INT UNSIGNED NOT NULL DEFAULT 0,
  `input` JSON DEFAULT NULL,
  `output` JSON DEFAULT NULL,
  `error_message` TEXT DEFAULT NULL,
  `logs` MEDIUMTEXT DEFAULT NULL,
  `started_at` TIMESTAMP NULL DEFAULT NULL,
  `completed_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_skill_runs_user_project` (`user_id`, `project_id`),
  KEY `idx_skill_runs_skill_status` (`skill_id`, `status`),
  KEY `idx_skill_runs_created_at` (`created_at`),
  CONSTRAINT `fk_skill_runs_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_skill_runs_skill_id` FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Skill运行记录表';

-- ============================================
-- 6. 模版表
-- ============================================
CREATE TABLE IF NOT EXISTS `templates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `category` VARCHAR(100) DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  `slide_count` INT UNSIGNED DEFAULT 10,
  `accent` VARCHAR(20) DEFAULT '#ef2d2d',
  `preview_url` VARCHAR(500) DEFAULT NULL,
  `settings` JSON DEFAULT NULL,
  `is_public` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  UNIQUE KEY `uk_templates_user_name` (`user_id`, `name`),
  KEY `idx_category` (`category`),
  KEY `idx_is_public` (`is_public`),
  CONSTRAINT `fk_templates_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='模版表';

-- ============================================
-- 7. 运行配置表
-- ============================================
CREATE TABLE IF NOT EXISTS `run_configs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `key` VARCHAR(100) NOT NULL,
  `type` ENUM('string','number','select','boolean') NOT NULL DEFAULT 'string',
  `value` TEXT,
  `options` JSON DEFAULT NULL,
  `min_value` INT DEFAULT NULL,
  `max_value` INT DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_key` (`user_id`,`key`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `fk_run_configs_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='运行配置表';

-- ============================================
-- 8. 工作流快照表
-- ============================================
CREATE TABLE IF NOT EXISTS `workflow_snapshots` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL DEFAULT 1,
  `snapshot_data` JSON NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工作流快照表';

-- ============================================
-- 9. 版本快照表
-- ============================================
CREATE TABLE IF NOT EXISTS `version_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `project_id` VARCHAR(100) NOT NULL,
  `label` VARCHAR(255) DEFAULT NULL,
  `state` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_project` (`user_id`, `project_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='版本快照表';

-- ============================================
-- 10. Generation jobs
-- ============================================
CREATE TABLE IF NOT EXISTS `generation_jobs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `project_id` VARCHAR(100) NOT NULL,
  `title` VARCHAR(255) DEFAULT NULL,
  `status` ENUM('queued', 'running', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
  `phase` VARCHAR(50) NOT NULL DEFAULT 'queued',
  `progress` INT UNSIGNED NOT NULL DEFAULT 0,
  `error_message` TEXT DEFAULT NULL,
  `metadata` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_generation_jobs_user_project` (`user_id`, `project_id`),
  KEY `idx_generation_jobs_user_status` (`user_id`, `status`),
  KEY `idx_generation_jobs_updated_at` (`updated_at`),
  KEY `idx_generation_jobs_user_project_status_updated` (`user_id`, `project_id`, `status`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 11. 用户登录会话表
-- ============================================
CREATE TABLE IF NOT EXISTS `user_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `session_id` CHAR(36) NOT NULL,
  `refresh_token_hash` CHAR(64) NOT NULL,
  `user_agent` VARCHAR(500) DEFAULT NULL,
  `ip_address` VARCHAR(100) DEFAULT NULL,
  `expires_at` DATETIME NOT NULL,
  `revoked_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_sessions_session_id` (`session_id`),
  UNIQUE KEY `uk_user_sessions_refresh_token_hash` (`refresh_token_hash`),
  KEY `idx_user_sessions_user_active` (`user_id`, `revoked_at`, `expires_at`),
  CONSTRAINT `fk_user_sessions_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户登录会话表';

-- 运行配置默认值
-- 只为已存在用户补充缺失配置；不会创建用户，也不会覆盖用户已修改的配置。
INSERT INTO `run_configs` (`user_id`, `name`, `key`, `type`, `value`, `options`, `min_value`, `max_value`, `description`)
SELECT u.`id`, defaults.`name`, defaults.`key`, defaults.`type`, defaults.`value`, defaults.`options`, defaults.`min_value`, defaults.`max_value`, defaults.`description`
FROM `users` u
JOIN (
  SELECT
    'PPT 页数' AS `name`,
    'slideCount' AS `key`,
    'number' AS `type`,
    '0' AS `value`,
    JSON_ARRAY(
      JSON_OBJECT('value','0','label','AI 自动'),
      JSON_OBJECT('value','6','label','6 页'),
      JSON_OBJECT('value','8','label','8 页'),
      JSON_OBJECT('value','10','label','10 页'),
      JSON_OBJECT('value','12','label','12 页'),
      JSON_OBJECT('value','15','label','15 页')
    ) AS `options`,
    0 AS `min_value`,
    60 AS `max_value`,
    'PPT 输入页可选择的目标页数，0 表示由 AI 根据内容自动决定。' AS `description`
  UNION ALL
  SELECT
    '摘要长度',
    'summaryLength',
    'select',
    'auto',
    JSON_ARRAY(
      JSON_OBJECT('value','auto','label','AI 自动'),
      JSON_OBJECT('value','brief','label','简洁'),
      JSON_OBJECT('value','balanced','label','均衡'),
      JSON_OBJECT('value','detailed','label','详细')
    ),
    NULL,
    NULL,
    '控制内容提炼的详略程度。'
  UNION ALL
  SELECT
    '语言风格',
    'tone',
    'select',
    'professional',
    JSON_ARRAY(
      JSON_OBJECT('value','professional','label','专业严谨'),
      JSON_OBJECT('value','storytelling','label','故事化'),
      JSON_OBJECT('value','teaching','label','教学讲解'),
      JSON_OBJECT('value','concise','label','简洁直达')
    ),
    NULL,
    NULL,
    'PPT 的语言和表达风格。'
  UNION ALL
  SELECT
    '图像风格',
    'imageStyle',
    'select',
    'auto',
    JSON_ARRAY(
      JSON_OBJECT('value','auto','label','AI 自动'),
      JSON_OBJECT('value','none','label','不生成图片'),
      JSON_OBJECT('value','flat','label','扁平化'),
      JSON_OBJECT('value','illustration','label','插画风格'),
      JSON_OBJECT('value','photo','label','摄影风格'),
      JSON_OBJECT('value','3d','label','3D 立体')
    ),
    NULL,
    NULL,
    '控制需要配图时的画面方向。'
  UNION ALL
  SELECT
    'Skill 强度',
    'skillIntensity',
    'number',
    '0',
    JSON_ARRAY(
      JSON_OBJECT('value','0','label','AI 自动'),
      JSON_OBJECT('value','40','label','轻量增强'),
      JSON_OBJECT('value','70','label','标准增强'),
      JSON_OBJECT('value','100','label','深度增强')
    ),
    0,
    100,
    '控制 Skill 扩展功能的处理深度，0 表示由 AI 自动判断。'
  UNION ALL
  SELECT
    '动画开关',
    'animationEnabled',
    'select',
    'auto',
    JSON_ARRAY(
      JSON_OBJECT('value','auto','label','默认关闭'),
      JSON_OBJECT('value','enabled','label','启用'),
      JSON_OBJECT('value','disabled','label','关闭')
    ),
    NULL,
    NULL,
    '导出 PPTX 时是否添加元素入场动画；未明确选择时默认不添加动画。'
  UNION ALL
  SELECT
    '动画效果',
    'animationEffect',
    'select',
    'auto',
    JSON_ARRAY(
      JSON_OBJECT('value','auto','label','默认无动画'),
      JSON_OBJECT('value','fade','label','柔和淡入'),
      JSON_OBJECT('value','wipe','label','逐步展开'),
      JSON_OBJECT('value','zoom','label','重点聚焦')
    ),
    NULL,
    NULL,
    '启用动画后使用的元素入场动画方式。'
) defaults
LEFT JOIN `run_configs` existing
  ON existing.`user_id` = u.`id`
 AND existing.`key` = defaults.`key`
WHERE existing.`id` IS NULL;

-- ============================================
-- 验证
-- ============================================
SELECT TABLE_NAME AS '表名', TABLE_COMMENT AS '说明', TABLE_ROWS AS '行数'
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'nexious-ppt'
ORDER BY TABLE_NAME;
