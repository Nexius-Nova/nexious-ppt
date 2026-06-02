CREATE TABLE IF NOT EXISTS `version_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `project_id` VARCHAR(100) NOT NULL,
  `label` VARCHAR(255) DEFAULT NULL,
  `outline` JSON DEFAULT NULL,
  `parameters` JSON DEFAULT NULL,
  `slide_count` INT UNSIGNED DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_project` (`user_id`, `project_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='版本快照表';
