-- ============================================
-- 新增表：提示词、技能、模版、运行配置
-- ============================================

USE `nexious-ppt`;

-- ============================================
-- 1. 提示词表 (prompts)
-- ============================================
CREATE TABLE IF NOT EXISTS `prompts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '提示词ID',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  `title` VARCHAR(255) NOT NULL COMMENT '提示词标题',
  `scene` VARCHAR(255) DEFAULT NULL COMMENT '适用场景',
  `content` TEXT NOT NULL COMMENT '提示词内容',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `fk_prompts_user_id` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='提示词表';

-- ============================================
-- 2. 技能表 (skills)
-- ============================================
CREATE TABLE IF NOT EXISTS `skills` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '技能ID',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  `name` VARCHAR(255) NOT NULL COMMENT '技能名称',
  `description` TEXT DEFAULT NULL COMMENT '技能描述',
  `icon` VARCHAR(100) DEFAULT NULL COMMENT '图标名称',
  `category` VARCHAR(100) DEFAULT NULL COMMENT '技能分类',
  `parameters` JSON DEFAULT NULL COMMENT '参数配置(JSON格式)',
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用: 0-禁用, 1-启用',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_is_enabled` (`is_enabled`),
  CONSTRAINT `fk_skills_user_id` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='技能表';

-- ============================================
-- 3. 模版表 (templates)
-- ============================================
CREATE TABLE IF NOT EXISTS `templates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '模版ID',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  `name` VARCHAR(255) NOT NULL COMMENT '模版名称',
  `category` VARCHAR(100) DEFAULT NULL COMMENT '模版分类',
  `description` TEXT DEFAULT NULL COMMENT '模版描述',
  `slide_count` INT UNSIGNED DEFAULT 10 COMMENT '幻灯片数量',
  `accent` VARCHAR(20) DEFAULT '#ef2d2d' COMMENT '主题色',
  `preview_url` VARCHAR(500) DEFAULT NULL COMMENT '预览图URL',
  `settings` JSON DEFAULT NULL COMMENT '模版设置(JSON格式)',
  `is_public` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否公开: 0-私有, 1-公开',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  UNIQUE KEY `uk_templates_user_name` (`user_id`, `name`),
  KEY `idx_category` (`category`),
  KEY `idx_is_public` (`is_public`),
  CONSTRAINT `fk_templates_user_id` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='模版表';

-- ============================================
-- 4. 运行配置表 (run_configs)
-- ============================================
CREATE TABLE IF NOT EXISTS `run_configs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '配置ID',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  `name` VARCHAR(255) NOT NULL COMMENT '参数名称',
  `key` VARCHAR(100) NOT NULL COMMENT '参数键名',
  `type` ENUM('string', 'number', 'select', 'boolean') NOT NULL DEFAULT 'string' COMMENT '参数类型',
  `value` TEXT COMMENT '参数值',
  `options` JSON DEFAULT NULL COMMENT '选项列表(JSON格式)',
  `min_value` INT DEFAULT NULL COMMENT '最小值(数字类型)',
  `max_value` INT DEFAULT NULL COMMENT '最大值(数字类型)',
  `description` TEXT DEFAULT NULL COMMENT '参数描述',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_key` (`key`),
  UNIQUE KEY `uk_user_key` (`user_id`, `key`),
  CONSTRAINT `fk_run_configs_user_id` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='运行配置表';

-- ============================================
-- 插入默认数据
-- ============================================

-- 插入默认提示词
INSERT INTO `prompts` (`user_id`, `title`, `scene`, `content`) VALUES
(1, '战略汇报提示词', '年度规划 / 经营复盘', '请将资料整理为适合管理层汇报的 PPT：先总结关键结论，再展开机会、策略、里程碑和风险。语言保持克制、明确、可执行。'),
(1, '产品发布提示词', '新品发布 / 路演', '请围绕用户痛点、产品价值、核心能力、应用场景和行动号召生成演示结构。每页保持一个清晰主张。'),
(1, '培训课程提示词', '内部培训 / 知识分享', '请按照「引入-讲解-练习-总结」的结构组织内容，确保知识点清晰、案例生动、互动性强。');

-- 插入默认技能
INSERT INTO `skills` (`user_id`, `name`, `description`, `icon`, `category`, `parameters`, `is_enabled`) VALUES
(1, '智能排版', '自动优化幻灯片布局和排版', 'Layout', '排版', '{"intensity": 70}', 1),
(1, '图表生成', '根据数据自动生成图表', 'BarChart3', '数据可视化', '{"style": "modern"}', 1),
(1, '内容润色', '优化文字表达和语言风格', 'Sparkles', '内容优化', '{"tone": "professional"}', 1),
(1, '图片增强', '智能调整图片效果和风格', 'Image', '图像处理', '{"style": "flat"}', 0);

-- 插入默认模版
INSERT INTO `templates` (`user_id`, `name`, `category`, `description`, `slide_count`, `accent`, `is_public`) VALUES
(1, '商务复盘', '商务', '适合季度复盘、经营分析和增长策略汇报。', 8, '#ef2d2d', 1),
(1, '产品路演', '产品', '适合产品发布、融资路演和解决方案介绍。', 10, '#334155', 1),
(1, '培训课程', '教育', '适合课程讲义、内部培训和知识分享。', 12, '#2563eb', 1),
(1, '创业路演', '商务', '适合创业项目展示、投资人路演和商业计划。', 10, '#7c3aed', 1),
(1, '年度报告', '商务', '适合年度总结、业绩汇报和战略规划。', 15, '#059669', 1),
(1, '技术分享', '技术', '适合技术方案讲解、架构设计和技术分享。', 12, '#0891b2', 1),
(1, '营销方案', '营销', '适合市场推广、品牌策划和营销活动方案。', 10, '#db2777', 1),
(1, '团队介绍', '企业', '适合团队展示、公司介绍和组织架构。', 8, '#ea580c', 1);

-- 插入默认运行配置
INSERT INTO `run_configs` (`user_id`, `name`, `key`, `type`, `value`, `options`, `min_value`, `max_value`, `description`) VALUES
(1, 'PPT 页数', 'slideCount', 'number', '6', NULL, 3, 20, '生成 PPT 的总页数'),
(1, '内容长度', 'summaryLength', 'select', 'balanced', '[{"value":"concise","label":"简洁（每页 3-4 个要点）"},{"value":"balanced","label":"均衡（每页 4-5 个要点）"},{"value":"detailed","label":"详细（每页 5-7 个要点）"}]', NULL, NULL, '每页内容的详细程度'),
(1, '语言风格', 'tone', 'select', 'professional', '[{"value":"professional","label":"专业严谨"},{"value":"creative","label":"创意活泼"},{"value":"casual","label":"通俗易懂"}]', NULL, NULL, 'PPT 的语言风格'),
(1, '图像风格', 'imageStyle', 'select', 'flat', '[{"value":"flat","label":"扁平化"},{"value":"3d","label":"3D 立体"},{"value":"illustration","label":"插画风格"},{"value":"photo","label":"摄影风格"}]', NULL, NULL, '生成图像的风格'),
(1, 'PPT 模板', 'template', 'select', 'business', '[{"value":"business","label":"商务模板"},{"value":"creative","label":"创意模板"},{"value":"minimal","label":"极简模板"},{"value":"tech","label":"科技模板"}]', NULL, NULL, 'PPT 整体风格模板'),
(1, 'Skill 强度', 'skillIntensity', 'number', '70', NULL, 0, 100, '控制 Skill 扩展功能的强度');
