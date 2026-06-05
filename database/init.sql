-- ============================================
-- Nexious-PPT 数据库完整初始化脚本
-- 数据库: nexious-ppt | 用户: root
-- 包含: 10 张表 + 详细真实种子数据
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

INSERT INTO `users` (`email`, `password_hash`, `name`, `avatar`) VALUES
('admin@nexious.com', '$2b$10$Xf3kL8mN9pQrS2tUvWxYzOaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456', '王小明', NULL),
('zhangli@nexious.com', '$2b$10$Xf3kL8mN9pQrS2tUvWxYzOaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456', '张丽', NULL);

INSERT INTO `api_keys` (`user_id`, `name`, `type`, `provider`, `api_key`, `base_url`, `model`, `is_default`, `is_active`) VALUES
(1, 'OpenAI GPT-4o', 'text', 'openai', 'sk-encrypted-demo-key-openai-text-001', 'https://api.openai.com/v1', 'gpt-4o', 1, 1),
(1, 'Claude Sonnet 4', 'text', 'anthropic', 'sk-ant-encrypted-demo-key-claude-001', 'https://api.anthropic.com/v1', 'claude-sonnet-4-20250514', 0, 1),
(1, 'DALL-E 3', 'image', 'openai', 'sk-encrypted-demo-key-openai-image-001', 'https://api.openai.com/v1', 'dall-e-3', 1, 1),
(1, 'Stable Diffusion XL', 'image', 'stability', 'sk-encrypted-demo-key-stability-001', 'https://api.stability.ai/v1', 'stable-diffusion-xl-1024-v1-0', 0, 0);

INSERT INTO `projects` (`user_id`, `title`, `topic`, `content`, `status`) VALUES
(1, '2026年度战略规划', '制定公司2026年度战略目标、关键举措与资源分配方案', NULL, 'draft'),
(1, '智能客服产品发布', '新一代AI智能客服系统产品发布会演示文稿', NULL, 'draft'),
(1, 'Q3经营分析报告', '2026年第三季度经营数据分析与经营策略复盘', NULL, 'completed'),
(1, '微服务架构升级方案', '公司核心系统从单体架构向微服务架构迁移的技术方案', NULL, 'generating'),
(1, '新员工入职培训', '2026年新员工入职培训课件', NULL, 'draft'),
(1, 'A轮融资商业计划书', '面向投资机构的A轮融资商业计划书', NULL, 'draft'),
(1, '产品路线图 2027', '2027年产品规划路线图与版本迭代计划', NULL, 'draft'),
(2, '用户体验研究报告', '2026年用户满意度调研与体验优化建议', NULL, 'draft');

-- 提示词
INSERT INTO `prompts` (`user_id`, `title`, `scene`, `content`) VALUES
(1,'战略汇报提示词','年度规划 / 经营复盘','请将资料整理为适合管理层汇报的 PPT：先总结关键结论，再展开机会、策略、里程碑和风险。语言保持克制、明确、可执行。每页不超过 5 个要点，标题控制在 15 字以内。'),
(1,'产品发布提示词','新品发布 / 路演','请围绕用户痛点、产品价值、核心能力、应用场景和行动号召生成演示结构。每页保持一个清晰主张。使用故事化叙事，开头设置悬念，结尾给出明确的下一步行动。'),
(1,'培训课程提示词','内部培训 / 知识分享','请按照「引入-讲解-练习-总结」的结构组织内容。知识点清晰，案例生动，互动性强。每章结尾设置 2-3 个思考题。'),
(1,'融资路演提示词','投资人路演 / Pitch Deck','遵循 Guy Kawasaki 的 10/20/30 法则。核心回答：问题是什么？解决方案？为什么是我们？市场规模？商业模式？团队优势？财务预测？'),
(1,'技术方案提示词','技术评审 / 架构设计','按照「背景-现状-方案-对比-风险-计划」的结构组织。重点说明技术选型的理由和 Trade-off。对架构图、时序图等可视化元素给出明确的生成建议。'),
(1,'季度复盘提示词','季度总结 / OKR 复盘','按照「目标回顾-关键成果-数据分析-问题反思-下季规划」的结构组织。每个结论必须有数据支撑，避免空泛描述。OKR 达成率需精确到百分比。');

-- 技能
INSERT INTO `skills` (`user_id`, `name`, `description`, `icon`, `category`, `parameters`, `is_enabled`) VALUES
(1,'讲稿生成','自动生成每页演讲稿，补充自然转场和演讲提示','Mic','内容处理',JSON_OBJECT('style','professional','length','medium'),1),
(1,'数据图表','识别数据表达机会，自动生成适合演示的图表建议','BarChart3','数据可视化',JSON_OBJECT('type','auto','theme','default'),0),
(1,'设计优化','优化标题层级、页面节奏和视觉重点','Palette','设计',JSON_OBJECT('level','medium','preserveStyle',true),0),
(1,'智能摘要','自动提取关键信息，生成每页核心摘要','FileText','内容处理',JSON_OBJECT('maxLength',200),1),
(1,'翻译助手','支持多语言翻译和本地化','Languages','内容处理',JSON_OBJECT('targetLang','en'),0),
(1,'动画效果','为幻灯片添加动画和过渡效果','Sparkles','视觉效果',JSON_OBJECT('intensity','medium'),0),
(1,'配色优化','根据内容智能优化 PPT 配色方案','Droplets','设计',JSON_OBJECT('style','professional'),1),
(1,'图标推荐','根据内容语义自动推荐合适的图标','Shapes','内容处理',JSON_OBJECT('style','outline'),0),
(1,'表格美化','优化表格样式和排版布局','Table','排版',JSON_OBJECT('theme','modern'),0),
(1,'思维导图','将结构化内容转换为思维导图','GitBranch','内容处理',JSON_OBJECT('layout','radial'),0);

-- 模版
INSERT INTO `templates` (`user_id`, `name`, `category`, `description`, `slide_count`, `accent`, `is_public`) VALUES
(1,'商务复盘','商务','适合季度复盘、经营分析和增长策略汇报。深色背景 + 金色点缀，专业而克制。',10,'#D9F26E',1),
(1,'产品路演','产品','适合产品发布、融资路演和解决方案介绍。极简深色，突出内容。',10,'#E5E7EB',1),
(1,'培训课程','教育','适合课程讲义、内部培训和知识分享。清新蓝色，结构清晰。',12,'#60a5fa',1),
(1,'融资计划书','商务','适合创业公司融资、投资人路演。紫色调传递创新与专业。',12,'#6366f1',1),
(1,'月度总结','商务','适合月度工作总结、团队汇报。简洁高效，绿色点缀。',6,'#14b8a6',1),
(1,'竞品分析','产品','适合竞品调研、市场分析报告。红色强调对比与差异化。',10,'#f43f5e',1),
(1,'技术架构','技术','适合系统架构设计、技术方案讲解。蓝色传递技术感。',10,'#3b82f6',1),
(1,'新人培训','教育','适合新员工入职培训、制度介绍。绿色舒适，信息密度适中。',15,'#22c55e',1),
(1,'品牌故事','营销','适合品牌传播、企业故事讲述。橙色热情而有感染力。',12,'#f97316',1),
(1,'活动策划','营销','适合营销活动策划、执行方案。黄色活力醒目。',10,'#eab308',1),
(1,'项目启动会','商务','适合项目启动、团队对齐和目标设定。天蓝清爽。',8,'#0ea5e9',1),
(1,'招聘宣讲','企业','适合校园招聘、企业宣讲会。绿色代表成长。',8,'#84cc16',1);

-- 运行配置
INSERT INTO `run_configs` (`user_id`, `name`, `key`, `type`, `value`, `options`, `min_value`, `max_value`, `description`) VALUES
(1,'PPT 页数','slideCount','number','6',NULL,3,25,'生成 PPT 的总页数'),
(1,'内容长度','summaryLength','select','balanced',JSON_ARRAY(JSON_OBJECT('value','concise','label','简洁（3-4 要点/页）'),JSON_OBJECT('value','balanced','label','均衡（4-5 要点/页）'),JSON_OBJECT('value','detailed','label','详细（5-7 要点/页）')),NULL,NULL,'每页内容的详细程度'),
(1,'语言风格','tone','select','professional',JSON_ARRAY(JSON_OBJECT('value','professional','label','专业严谨'),JSON_OBJECT('value','storytelling','label','故事化'),JSON_OBJECT('value','teaching','label','教学讲解')),NULL,NULL,'PPT 的语言和表达风格'),
(1,'图像风格','imageStyle','select','flat',JSON_ARRAY(JSON_OBJECT('value','flat','label','扁平化'),JSON_OBJECT('value','realistic','label','写实摄影'),JSON_OBJECT('value','illustration','label','插画风格'),JSON_OBJECT('value','3d','label','3D 立体')),NULL,NULL,'生成插图的视觉风格'),
(1,'PPT 模板','template','select','business',JSON_ARRAY(JSON_OBJECT('value','business','label','商务模板'),JSON_OBJECT('value','creative','label','创意模板'),JSON_OBJECT('value','education','label','教育模板')),NULL,NULL,'PPT 整体风格模板'),
(1,'Skill 强度','skillIntensity','number','70',NULL,0,100,'控制 Skill 扩展功能的处理深度（0=最小，100=最大）'),
(1,'字体大小','fontSize','select','medium',JSON_ARRAY(JSON_OBJECT('value','small','label','小号（内容较多）'),JSON_OBJECT('value','medium','label','中号（默认）'),JSON_OBJECT('value','large','label','大号（演示）')),NULL,NULL,'PPT 正文基准字体大小'),
(1,'动画效果','animation','boolean','true',NULL,NULL,NULL,'是否启用幻灯片过渡动画'),
(1,'页码显示','showPageNumber','boolean','true',NULL,NULL,NULL,'是否在页脚显示页码'),
(1,'生成速度','generationSpeed','select','balanced',JSON_ARRAY(JSON_OBJECT('value','fast','label','快速（质量略低）'),JSON_OBJECT('value','balanced','label','均衡（推荐）'),JSON_OBJECT('value','quality','label','高质量（较慢）')),NULL,NULL,'内容生成速度与质量平衡'),
(1,'图片数量','imageCount','number','3',NULL,0,10,'每页最多生成的候选图片数量'),
(1,'标题长度','titleLength','select','medium',JSON_ARRAY(JSON_OBJECT('value','short','label','简短（≤8字）'),JSON_OBJECT('value','medium','label','适中（≤15字）'),JSON_OBJECT('value','long','label','详细（≤25字）')),NULL,NULL,'幻灯片标题长度偏好');

-- ============================================
-- 验证
-- ============================================
SELECT TABLE_NAME AS '表名', TABLE_COMMENT AS '说明', TABLE_ROWS AS '行数'
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'nexious-ppt'
ORDER BY TABLE_NAME;
