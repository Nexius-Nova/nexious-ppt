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
  `settings` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  UNIQUE KEY `uk_projects_user_title` (`user_id`, `title`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `fk_projects_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='PPT项目表';

-- ============================================
-- 4. 幻灯片表
-- ============================================
CREATE TABLE IF NOT EXISTS `slides` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `order_index` INT UNSIGNED NOT NULL DEFAULT 0,
  `title` VARCHAR(255) DEFAULT NULL,
  `bullets` JSON DEFAULT NULL,
  `speaker_notes` TEXT DEFAULT NULL,
  `visual_prompt` TEXT DEFAULT NULL,
  `image_url` VARCHAR(500) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_order_index` (`order_index`),
  CONSTRAINT `fk_slides_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='幻灯片表';

-- ============================================
-- 5. 图片表
-- ============================================
CREATE TABLE IF NOT EXISTS `images` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slide_id` BIGINT UNSIGNED NOT NULL,
  `prompt` TEXT NOT NULL,
  `style` VARCHAR(50) DEFAULT NULL,
  `url` VARCHAR(500) NOT NULL,
  `is_selected` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_slide_id` (`slide_id`),
  KEY `idx_is_selected` (`is_selected`),
  CONSTRAINT `fk_images_slide_id` FOREIGN KEY (`slide_id`) REFERENCES `slides`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生成的图片表';

-- ============================================
-- 6. 提示词表
-- ============================================
CREATE TABLE IF NOT EXISTS `prompts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `scene` VARCHAR(255) DEFAULT NULL,
  `content` TEXT NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `fk_prompts_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='提示词表';

-- ============================================
-- 7. 技能表
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
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_is_enabled` (`is_enabled`),
  CONSTRAINT `fk_skills_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='技能表';

-- ============================================
-- 8. 模版表
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
-- 9. 运行配置表
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
-- 10. 工作流快照表
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
-- ██████  种子数据  ██████
-- ============================================

INSERT INTO `users` (`email`, `password_hash`, `name`, `avatar`) VALUES
('admin@nexious.com', '$2b$10$Xf3kL8mN9pQrS2tUvWxYzOaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456', '王小明', NULL),
('zhangli@nexious.com', '$2b$10$Xf3kL8mN9pQrS2tUvWxYzOaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456', '张丽', NULL);

INSERT INTO `api_keys` (`user_id`, `name`, `type`, `provider`, `api_key`, `base_url`, `model`, `is_default`, `is_active`) VALUES
(1, 'OpenAI GPT-4o', 'text', 'openai', 'sk-encrypted-demo-key-openai-text-001', 'https://api.openai.com/v1', 'gpt-4o', 1, 1),
(1, 'Claude Sonnet 4', 'text', 'anthropic', 'sk-ant-encrypted-demo-key-claude-001', 'https://api.anthropic.com/v1', 'claude-sonnet-4-20250514', 0, 1),
(1, 'DALL-E 3', 'image', 'openai', 'sk-encrypted-demo-key-openai-image-001', 'https://api.openai.com/v1', 'dall-e-3', 1, 1),
(1, 'Stable Diffusion XL', 'image', 'stability', 'sk-encrypted-demo-key-stability-001', 'https://api.stability.ai/v1', 'stable-diffusion-xl-1024-v1-0', 0, 0);

INSERT INTO `projects` (`user_id`, `title`, `topic`, `content`, `status`, `settings`) VALUES
(1, '2026年度战略规划', '制定公司2026年度战略目标、关键举措与资源分配方案', NULL, 'draft', JSON_OBJECT('template','business','language','zh-CN','pageCount',12)),
(1, '智能客服产品发布', '新一代AI智能客服系统产品发布会演示文稿', NULL, 'draft', JSON_OBJECT('template','creative','language','zh-CN','pageCount',8)),
(1, 'Q3经营分析报告', '2026年第三季度经营数据分析与经营策略复盘', NULL, 'completed', JSON_OBJECT('template','business','language','zh-CN','pageCount',10)),
(1, '微服务架构升级方案', '公司核心系统从单体架构向微服务架构迁移的技术方案', NULL, 'generating', JSON_OBJECT('template','tech','language','zh-CN','pageCount',15)),
(1, '新员工入职培训', '2026年新员工入职培训课件', NULL, 'draft', JSON_OBJECT('template','education','language','zh-CN','pageCount',20)),
(1, 'A轮融资商业计划书', '面向投资机构的A轮融资商业计划书', NULL, 'draft', JSON_OBJECT('template','business','language','zh-CN','pageCount',15)),
(1, '产品路线图 2027', '2027年产品规划路线图与版本迭代计划', NULL, 'draft', JSON_OBJECT('template','creative','language','zh-CN','pageCount',8)),
(2, '用户体验研究报告', '2026年用户满意度调研与体验优化建议', NULL, 'draft', JSON_OBJECT('template','minimal','language','zh-CN','pageCount',10));

-- 项目 1: 战略规划 (12页)
INSERT INTO `slides` (`project_id`, `order_index`, `title`, `bullets`, `speaker_notes`, `visual_prompt`) VALUES
(1,1,'封面 — 2026年度战略规划', JSON_ARRAY('制定单位：战略发展部','汇报时间：2026年1月','密级：内部'), '各位领导、同事，上午好。今天由我代表战略发展部汇报公司2026年度战略规划。', 'Corporate strategy cover slide with modern geometric design'),
(1,2,'目录', JSON_ARRAY('一、2025年回顾与复盘','二、市场环境与竞争格局','三、2026年战略目标','四、关键举措与里程碑','五、资源需求与预算','六、风险与应对预案'), '本次汇报共分为六个部分，预计用时45分钟。', 'Clean table of contents with numbered sections'),
(1,3,'2025年关键成果回顾', JSON_ARRAY('营收突破 8.6 亿元，同比增长 47%','付费客户数达 1,200 家，净增 380 家','团队规模扩充至 450 人','完成 B 轮 2 亿元融资','产品 NPS 得分提升至 72 分'), '2025年在营收增长、客户拓展、团队建设和资本层面都取得了超预期的成绩。', 'Year in review with key metrics and growth charts'),
(1,4,'2025年不足与反思', JSON_ARRAY('海外市场拓展不及预期（仅完成目标的 60%）','核心产品迭代速度放缓，Q3-Q4延迟交付 3 个版本','中层管理能力短板明显，3 位总监离职','客户续费率下降 5 个百分点至 82%'), '坦诚面对不足是进步的前提。海外市场和中层管理是2026年必须突破的瓶颈。', 'Challenges and lessons learned analysis'),
(1,5,'市场环境分析', JSON_ARRAY('行业市场规模预计达 500 亿元，年增速 28%','政策利好：《数字中国建设整体布局规划》落地','AI 原生应用成为新战场，竞争加剧','客户预算向"效果可量化"方向倾斜'), '外部环境总体利好，但竞争格局正在快速变化。必须抓住AI原生的窗口期。', 'Market landscape with competitive analysis framework'),
(1,6,'竞争格局分析', JSON_ARRAY('头部厂商 A：融资 5 亿美元，重点布局政企','新锐厂商 B：12 个月内增长 10 倍，主打中小企业','海外竞品 C：宣布进入中国市场','我们的差异化：垂直行业 Know-how + AI Agent 能力'), '竞对在资本和速度上给压力，但我们在行业深度和AI能力上有独特壁垒。', 'Competitive positioning matrix with quadrant chart'),
(1,7,'2026年战略目标', JSON_ARRAY('营收目标：15 亿元（同比增长 74%）','付费客户：2,000 家（净增 800 家）','海外营收占比：≥ 10%','产品 NPS：≥ 75 分，团队规模：600 人'), '2026年核心主题是"规模化增长 + 国际化破局"。', 'Strategic objectives with ambitious targets'),
(1,8,'四大关键战役', JSON_ARRAY('战役一：AI Copilot 产品化 — Q2 发布，全年贡献 3 亿元 ARR','战役二：出海东南亚 — 新加坡设立区域总部','战役三：大客户攻坚 — 签约 20 家标杆客户','战役四：生态建设 — 发展 100 家渠道合作伙伴'), '四大战役是支撑全年目标的支柱，每场战役都有明确的指挥员和KPI。', 'Four strategic battles with roadmap timeline'),
(1,9,'关键里程碑时间线', JSON_ARRAY('Q1：AI Copilot 内测 + 新加坡办公室开业','Q2：AI Copilot 正式发布 + 进入印尼/泰国市场','Q3：大客户签约达 10 家 + 渠道合作伙伴 50 家','Q4：全年目标冲刺 + 2027年战略预备'), '按季度设定清晰里程碑，每月召开战略复盘会。', 'Quarterly milestone timeline with key deliverables'),
(1,10,'组织架构调整', JSON_ARRAY('新设 AI 产品事业部（30人）','新设国际业务部（20人，base 新加坡）','大客户部升格为一级部门','技术中台整合 AI/数据/安全三大方向'), '战略落地需要组织保障。Q1完成组织架构调整。', 'Organization structure chart with new departments'),
(1,11,'预算与资源需求', JSON_ARRAY('全年预算：3.2 亿元','研发投入：1.2 亿元（38%）— AI Copilot + 平台升级','市场销售：1.0 亿元（31%）— 出海 + 大客户','管理及其他：1.0 亿元（31%）— 组织建设 + 合规'), '预算分配与战略优先级高度对齐，确保好钢用在刀刃上。', 'Budget allocation pie chart and breakdown'),
(1,12,'风险与应对', JSON_ARRAY('风险1：AI Copilot 交付延期 → 预案：模块化发布，MVP先行','风险2：海外合规风险 → 预案：聘请当地法务顾问','风险3：核心人才流失 → 预案：股权激励 + 关键人备份','风险4：现金流压力 → 预案：预留 6 个月运营资金'), '风险不可消除但可管理。每项风险都有清晰的预警指标和应对方案。', 'Risk matrix with probability and impact assessment');

-- 项目 2: 智能客服 (8页)
INSERT INTO `slides` (`project_id`, `order_index`, `title`, `bullets`, `speaker_notes`, `visual_prompt`) VALUES
(2,1,'封面 — Nexious 智能客服 3.0', JSON_ARRAY('让每一次对话都创造价值','2026年6月 · 产品发布会'), '欢迎大家来到 Nexious 智能客服 3.0 的产品发布会。', 'Futuristic AI customer service product launch cover'),
(2,2,'我们为什么做智能客服？', JSON_ARRAY('中国客服市场规模 1,200 亿元','85% 的企业认为客服体验直接影响品牌忠诚度','传统人工客服成本年均上涨 15%','用户期望：7×24 即时响应 + 个性化服务'), '客服是企业和客户之间最高频的触点，传统模式已无法满足需求。', 'Problem statement with market statistics'),
(2,3,'核心能力一览', JSON_ARRAY('多轮对话理解：上下文记忆 20 轮以上','情绪感知：实时识别客户情绪并调整策略','知识库自学习：上传文档即可自动构建知识图谱','人机协同：复杂问题无缝转接人工坐席','全渠道接入：Web/App/微信/钉钉/飞书'), '3.0 版本在对话理解、情绪感知和知识管理三个维度实现了质变。', 'Product capability highlights with icon cards'),
(2,4,'技术架构亮点', JSON_ARRAY('自研对话引擎 Nexious Core — 延迟 < 200ms','混合模型架构：大模型 + 领域小模型协同','私有化部署：数据不出企业内网','弹性扩容：支持 10 万 QPS 并发'), '在工程层面做了大量优化，确保产品既智能又可靠。', 'Technical architecture diagram with layered design'),
(2,5,'客户案例：某头部电商', JSON_ARRAY('日处理咨询量：12 万次','自动解决率：78%（上线 3 个月提升至 85%）','人工坐席减少：60 人 → 18 人','客户满意度：4.7/5.0，年节省成本：约 800 万元'), '目前最大的标杆客户案例，用数据说话。', 'Customer case study with before/after metrics'),
(2,6,'定价与商业模式', JSON_ARRAY('标准版：¥9,800/月（适合 50 人以下团队）','专业版：¥29,800/月（适合 200 人以下团队）','企业版：定制报价（不限坐席 + 私有化部署）','免费试用：14 天全功能体验'), '灵活的定价方案，从小团队到大型企业都能找到合适的选择。', 'Pricing tiers comparison table'),
(2,7,'Roadmap & 未来规划', JSON_ARRAY('2026 Q3：多语言支持（英/日/韩/泰）','2026 Q4：语音通话能力 + 主动外呼','2027 Q1：视频客服 + AR 远程协助','2027 Q2：行业解决方案包（金融/医疗/教育）'), '今天的发布只是起点，有一个清晰的演进路线。', 'Product roadmap with quarterly milestones'),
(2,8,'感谢 & 立即体验', JSON_ARRAY('官网：nexious.com','扫码领取 14 天免费试用','销售咨询：sales@nexious.com','期待与您携手，让每一次对话都创造价值'), '感谢各位的聆听，欢迎大家扫码体验，现场交流！', 'Thank you slide with QR code and contact info');

-- 项目 3: 经营分析 (10页)
INSERT INTO `slides` (`project_id`, `order_index`, `title`, `bullets`, `speaker_notes`, `visual_prompt`) VALUES
(3,1,'Q3 经营分析报告', JSON_ARRAY('2026年7月-9月','经营分析部'), '大家好，现在向大家汇报2026年Q3的经营分析情况。', 'Q3 business review cover with data visualization theme'),
(3,2,'核心指标概览', JSON_ARRAY('营收：2.8 亿元（季度目标达成率 108%）','毛利率：62%（同比 +3pp）','经营利润：4,200 万元','现金流：净流入 6,800 万元'), '整体来看，Q3各项核心指标均超预期，经营质量持续改善。', 'Executive dashboard with KPI cards and trend arrows'),
(3,3,'分产品线收入分析', JSON_ARRAY('智能客服产品线：1.2 亿元（占比 43%，增长 35%）','数据分析产品线：8,500 万元（占比 30%，增长 22%）','定制开发服务：4,500 万元（占比 16%，增长 12%）','其他收入：3,000 万元（占比 11%）'), '智能客服产品线已成为核心增长引擎，贡献了超过40%的收入。', 'Revenue breakdown by product line with bar chart'),
(3,4,'客户增长分析', JSON_ARRAY('新增付费客户：210 家（季度目标 180 家）','客户流失率：3.2%（较 Q2 下降 0.8pp）','NDR（净收入留存率）：118%','ARR：11.2 亿元（同比增长 52%）'), '客户增长质量显著提升，NDR 118% 说明存量客户在持续扩大使用。', 'Customer growth metrics with cohort analysis chart'),
(3,5,'成本与费用分析', JSON_ARRAY('营业成本：1.06 亿元（占收入 38%）','研发费用：5,600 万元（占收入 20%）','销售费用：4,200 万元（占收入 15%）','管理费用：2,800 万元（占收入 10%）'), '成本结构持续优化，研发投入占比提升至20%，为Q4产品升级蓄力。', 'Cost structure waterfall chart'),
(3,6,'人效分析', JSON_ARRAY('全员 480 人','人均营收：58.3 万元/季度','人均利润：8.75 万元/季度','研发人效同比提升 18%'), '团队效率持续提升，人均营收和利润均创新高。', 'Team efficiency metrics with comparison to previous quarters'),
(3,7,'现金流状况', JSON_ARRAY('经营活动现金流：+8,200 万元','投资活动现金流：-3,500 万元（新加坡办公室 + 服务器扩容）','融资活动现金流：+2,100 万元（期权行权）','期末现金余额：2.8 亿元'), '现金储备充裕，足以支撑未来 12 个月的运营和扩张需求。', 'Cash flow statement with waterfall chart'),
(3,8,'Q4 展望与目标', JSON_ARRAY('营收目标：3.2 亿元','发布 AI Copilot 1.0 正式版','新加坡团队到位并开始运营','签约 5 家大客户，全年营收目标 12 亿元冲刺'), 'Q4是全年收官之战，有信心超额完成全年目标。', 'Q4 outlook with target milestones'),
(3,9,'风险预警', JSON_ARRAY('大客户回款周期延长至 90 天（正常 60 天）','东南亚市场汇率波动风险','竞对在价格层面加大压力','应对：加强应收账款管理 + 外汇对冲'), '已识别主要风险并制定应对措施，经营团队将密切跟踪。', 'Risk dashboard with traffic light indicators'),
(3,10,'总结与建议', JSON_ARRAY('Q3 经营表现优秀，各项指标超预期','建议 Q4 加大 AI Copilot 市场投入','建议提前启动 2027 年预算编制','感谢经营管理团队的努力！'), '总体而言，Q3交出了一份令人满意的答卷。全力以赴冲刺Q4！', 'Summary slide with key takeaways and recommendations');

-- 项目 4: 微服务架构 (12页)
INSERT INTO `slides` (`project_id`, `order_index`, `title`, `bullets`, `speaker_notes`, `visual_prompt`) VALUES
(4,1,'微服务架构升级方案', JSON_ARRAY('技术架构部 · 2026年8月'), '今天向大家汇报核心系统微服务架构升级的技术方案。', 'Microservices architecture proposal cover'),
(4,2,'现状与痛点', JSON_ARRAY('当前单体架构：200 万行代码，部署耗时 45 分钟','耦合严重：一个模块故障可能导致全站宕机','扩展困难：只能整体扩容，无法按模块弹性伸缩','技术栈锁定：Java 8 + Spring Boot 2.x，升级困难'), '单体架构已到必须重构的临界点。每次部署提心吊胆，故障隔离几乎不可能。', 'Monolithic architecture pain points illustration'),
(4,3,'目标架构蓝图', JSON_ARRAY('拆分 12 个核心微服务','API Gateway 统一入口（Kong）','服务网格：Istio + Envoy','消息队列：Apache Pulsar','容器编排：Kubernetes + Helm','可观测性：Prometheus + Grafana + Jaeger'), '目标架构蓝图遵循云原生最佳实践。', 'Target microservices architecture diagram with service mesh'),
(4,4,'服务拆分方案', JSON_ARRAY('用户/订单/产品/支付/通知/分析/文件/搜索/AI/网关/配置/定时任务 共12个微服务'), '按业务边界拆分为12个微服务，每个服务拥有独立数据库。', 'Service decomposition diagram with domain boundaries'),
(4,5,'数据库拆分策略', JSON_ARRAY('Database per Service 原则','核心服务 MySQL 8.0 / 分析 ClickHouse / 搜索 ES 8.x','缓存：Redis Cluster','分布式事务：Saga 模式 + 本地消息表'), '数据层面的拆分最复杂。采用最终一致性方案而非强一致性。', 'Database splitting strategy with data flow diagram'),
(4,6,'迁移策略：绞杀者模式', JSON_ARRAY('Phase 1（Q4）：搭建基础设施（K8s + Istio + Pulsar）','Phase 2（Q1-Q2 2027）：拆分非核心服务','Phase 3（Q3 2027）：拆分核心服务（用户/订单/支付）','Phase 4（Q4 2027）：下线单体应用'), '采用绞杀者模式逐步替换而非一次性重写，最大限度降低风险。', 'Strangler Fig migration pattern with phased timeline'),
(4,7,'CI/CD 流水线升级', JSON_ARRAY('代码仓库：GitHub Actions','镜像仓库：Harbor','持续部署：ArgoCD（GitOps）','灰度发布：Istio 流量管理（Canary Release）','自动化测试覆盖率目标：≥ 80%'), '微服务对CI/CD的要求更高。将全面升级流水线，实现全自动化。', 'CI/CD pipeline architecture with build and deploy stages'),
(4,8,'团队与人员配置', JSON_ARRAY('技术架构组 5人 + 基础服务组 4人','业务服务组 8人×2 组 + 质量保障组 3人','总计 28 人，预计周期 12 个月'), '需组建专门的微服务迁移团队，部分抽调，部分外招。', 'Team structure and resource allocation chart'),
(4,9,'预算估算', JSON_ARRAY('基础设施：¥80 万/年','工具链：¥20 万/年','人力成本：¥560 万/年','外部咨询：¥50 万','总计：¥710 万（约占研发预算 15%）'), '整体预算可控。ROI 将在迁移完成后 18 个月内体现。', 'Budget breakdown with cost-benefit analysis'),
(4,10,'风险与应对', JSON_ARRAY('数据一致性 → Saga + 补偿事务','服务间通信延迟 → 异步消息 + 本地缓存','运维复杂度 → 标准化 + 自动化 + On-Call 轮值','团队学习曲线 → 提前培训 + Pair Programming + 外部顾问'), '每个风险都有对应的缓解策略。建议先做 2 个非核心服务 POC。', 'Risk matrix with detailed mitigation strategies'),
(4,11,'POC 验证结果', JSON_ARRAY('已将"通知服务"和"文件服务"迁移至微服务','部署时间：45 分钟 → 3 分钟','故障隔离验证通过','API 响应 P99：从 800ms 降至 120ms','POC 结论：方案可行，建议正式启动'), '已在非核心服务上完成概念验证，各项指标均超预期。建议正式立项。', 'POC results with before/after performance comparison'),
(4,12,'下一步行动', JSON_ARRAY('本周：提交立项申请','下周：组建微服务迁移团队','2 周内：完成 Phase 1 基础设施搭建方案评审','本月：启动非核心服务迁移','目标：12 个月内完成全部迁移'), '方案已就绪，只待审批。建议尽快启动，抢占技术红利。', 'Next steps action plan with timeline');

-- 图片
INSERT INTO `images` (`slide_id`, `prompt`, `style`, `url`, `is_selected`) VALUES
(1,'Corporate strategy cover slide with modern geometric design','flat','https://images.unsplash.com/photo-1552664730-d307ca884978?w=800',1),
(3,'Year in review with key metrics and growth charts','flat','https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800',1),
(5,'Market landscape with competitive analysis framework','flat','https://images.unsplash.com/photo-1543286386-713bdd548da4?w=800',1),
(6,'Competitive positioning matrix with quadrant chart','illustration','https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800',1),
(7,'Strategic objectives with ambitious targets','3d','https://images.unsplash.com/photo-1535320903710-d993d3d77d29?w=800',1),
(11,'Budget allocation pie chart and breakdown','flat','https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=800',1),
(13,'Futuristic AI customer service product launch cover','3d','https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800',1),
(15,'Product capability highlights with icon cards','illustration','https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800',1),
(17,'Customer case study with before/after metrics','flat','https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800',1),
(25,'Cost structure waterfall chart','flat','https://images.unsplash.com/photo-1543286386-2e659306cd6c?w=800',1),
(31,'Target microservices architecture diagram with service mesh','illustration','https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800',1),
(33,'Service decomposition diagram with domain boundaries','illustration','https://images.unsplash.com/photo-1518432031352-d6fc5c10da5a?w=800',1),
(38,'CI/CD pipeline architecture with build and deploy stages','illustration','https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?w=800',1);

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
