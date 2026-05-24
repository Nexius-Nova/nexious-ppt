-- ============================================
-- 项目和幻灯片示例数据
-- ============================================

USE `nexious-ppt`;

-- 插入示例项目
INSERT INTO `projects` (`user_id`, `title`, `topic`, `content`, `status`, `settings`) VALUES
(1, 'AI 技术发展趋势报告', '探讨人工智能在 2026 年的最新发展趋势', NULL, 'draft', JSON_OBJECT('template', 'business', 'language', 'zh-CN', 'pageCount', 10)),
(1, '产品年度规划', '2026 年产品路线图与战略规划', NULL, 'draft', JSON_OBJECT('template', 'creative', 'language', 'zh-CN', 'pageCount', 12)),
(1, '市场调研分析', '用户需求调研与市场机会分析', NULL, 'draft', JSON_OBJECT('template', 'minimal', 'language', 'zh-CN', 'pageCount', 8)),
(1, '技术架构设计', '微服务架构升级方案', NULL, 'generating', JSON_OBJECT('template', 'tech', 'language', 'zh-CN', 'pageCount', 15)),
(1, '团队季度总结', '2026 Q1 团队工作总结', NULL, 'completed', JSON_OBJECT('template', 'business', 'language', 'zh-CN', 'pageCount', 6)),
(1, '新产品发布会', 'AI 助手产品发布演示', NULL, 'draft', JSON_OBJECT('template', 'creative', 'language', 'zh-CN', 'pageCount', 10)),
(1, '投资路演 PPT', 'A 轮融资商业计划书', NULL, 'draft', JSON_OBJECT('template', 'business', 'language', 'zh-CN', 'pageCount', 12)),
(1, '技术分享会', '大语言模型应用实践', NULL, 'draft', JSON_OBJECT('template', 'tech', 'language', 'zh-CN', 'pageCount', 8));

-- 为第一个项目插入幻灯片
INSERT INTO `slides` (`project_id`, `order_index`, `title`, `bullets`, `speaker_notes`, `visual_prompt`) VALUES
(1, 1, '人工智能概述', JSON_ARRAY('AI 的定义与发展历程', '当前 AI 技术的主要应用领域', '未来发展趋势预测', '行业投资规模分析'), '欢迎各位参加本次演讲，今天我们将探讨 AI 技术的最新发展。', 'A modern AI brain visualization with neural networks'),
(1, 2, '机器学习技术', JSON_ARRAY('监督学习与非监督学习', '深度学习的突破性进展', '强化学习的实际应用', 'AutoML 技术趋势'), '机器学习是 AI 的核心技术之一，让我们深入了解。', 'Machine learning algorithm visualization'),
(1, 3, '自然语言处理', JSON_ARRAY('大语言模型的崛起', '多模态理解能力', '代码生成与辅助开发', '对话系统的进步'), 'NLP 领域在 2026 年取得了重大突破。', 'Natural language processing concept illustration'),
(1, 4, '计算机视觉', JSON_ARRAY('图像识别与分类', '目标检测技术', '视频理解与分析', '3D 视觉重建'), '计算机视觉让机器能够"看见"世界。', 'Computer vision technology visualization'),
(1, 5, 'AI 应用场景', JSON_ARRAY('智能客服与对话机器人', '内容创作与辅助设计', '数据分析与商业智能', '自动驾驶与机器人'), 'AI 正在改变各个行业的工作方式。', 'AI applications in different industries'),
(1, 6, '技术挑战', JSON_ARRAY('模型可解释性', '数据隐私与安全', '计算资源需求', '伦理与偏见问题'), '在享受 AI 带来便利的同时，我们也面临挑战。', 'AI challenges and solutions'),
(1, 7, '未来展望', JSON_ARRAY('通用人工智能的探索', 'AI 与人类协作', '行业标准化进程', '法规与治理框架'), 'AI 的未来充满无限可能。', 'Future of AI technology'),
(1, 8, '投资机会', JSON_ARRAY('基础模型层', '应用层创新', '工具与基础设施', '垂直行业解决方案'), 'AI 领域的投资机会分析。', 'AI investment opportunities chart'),
(1, 9, '实施建议', JSON_ARRAY('技术选型策略', '团队能力建设', '数据资产积累', '生态合作'), '如何在实际业务中应用 AI。', 'AI implementation roadmap'),
(1, 10, '总结与展望', JSON_ARRAY('关键技术回顾', '应用价值总结', '行动建议', 'Q&A 环节'), '感谢大家的聆听，让我们一起拥抱 AI 时代。', 'Summary and future outlook');

-- 为第二个项目插入幻灯片
INSERT INTO `slides` (`project_id`, `order_index`, `title`, `bullets`, `speaker_notes`, `visual_prompt`) VALUES
(2, 1, '产品愿景', JSON_ARRAY('打造智能办公助手', '提升工作效率 10 倍', '让每个人都能高效工作', '成为行业领导者'), '我们的产品愿景是让工作更简单。', 'Product vision illustration'),
(2, 2, '2025 年回顾', JSON_ARRAY('用户增长 300%', '营收突破 1 亿元', '团队扩展至 200 人', '完成 B 轮融资'), '2025 年是我们快速发展的一年。', 'Year in review metrics'),
(2, 3, '市场分析', JSON_ARRAY('市场规模 500 亿', '年增长率 35%', '用户需求升级', '竞争格局分析'), '市场机会巨大，我们处于有利位置。', 'Market analysis charts'),
(2, 4, '产品路线图', JSON_ARRAY('Q1: 核心功能升级', 'Q2: 新产品线发布', 'Q3: 国际化拓展', 'Q4: 生态建设'), '2026 年的产品规划清晰明确。', 'Product roadmap timeline'),
(2, 5, '技术架构', JSON_ARRAY('微服务架构升级', 'AI 能力集成', '性能优化计划', '安全体系完善'), '技术架构是产品的基础。', 'Technical architecture diagram'),
(2, 6, '团队规划', JSON_ARRAY('研发团队扩充', '市场团队建设', '客户成功体系', '组织文化升级'), '优秀的团队是成功的关键。', 'Team structure visualization'),
(2, 7, '市场策略', JSON_ARRAY('品牌升级计划', '内容营销矩阵', '渠道合作伙伴', '用户社区运营'), '市场策略助力产品成功。', 'Marketing strategy framework'),
(2, 8, '财务预测', JSON_ARRAY('营收目标 3 亿元', '毛利率提升至 70%', '研发投入占比 30%', '实现盈亏平衡'), '财务目标清晰可行。', 'Financial projections chart'),
(2, 9, '风险评估', JSON_ARRAY('市场竞争加剧', '技术迭代风险', '人才竞争压力', '政策监管变化'), '我们需要未雨绸缪。', 'Risk assessment matrix'),
(2, 10, '资源需求', JSON_ARRAY('资金需求 5000 万', '人才招聘计划', '技术资源投入', '市场推广预算'), '明确资源需求，确保目标达成。', 'Resource requirements breakdown'),
(2, 11, '关键里程碑', JSON_ARRAY('Q1: 产品发布', 'Q2: 用户破百万', 'Q3: 海外上线', 'Q4: 实现盈利'), '里程碑是我们的指南针。', 'Key milestones timeline'),
(2, 12, '行动号召', JSON_ARRAY('团结一心', '目标一致', '全力以赴', '共创辉煌'), '让我们一起实现目标！', 'Call to action illustration');

-- 为第三个项目插入幻灯片
INSERT INTO `slides` (`project_id`, `order_index`, `title`, `bullets`, `speaker_notes`, `visual_prompt`) VALUES
(3, 1, '调研背景', JSON_ARRAY('市场环境变化', '用户需求升级', '竞争态势分析', '机会识别'), '本次调研的背景和目的。', 'Research background illustration'),
(3, 2, '调研方法', JSON_ARRAY('用户访谈 100 人', '问卷调查 5000 份', '数据分析', '竞品对标'), '我们采用了多种调研方法。', 'Research methodology diagram'),
(3, 3, '用户画像', JSON_ARRAY('年龄分布', '职业特征', '使用场景', '痛点分析'), '深入了解我们的目标用户。', 'User persona visualization'),
(3, 4, '需求分析', JSON_ARRAY('核心需求 Top 5', '需求优先级排序', '需求变化趋势', '未被满足的需求'), '用户需求是产品创新的基础。', 'User needs analysis chart'),
(3, 5, '市场机会', JSON_ARRAY('蓝海市场识别', '差异化定位', '切入点选择', '增长潜力评估'), '市场机会分析结果。', 'Market opportunity matrix'),
(3, 6, '竞品分析', JSON_ARRAY('主要竞品对比', '优劣势分析', '市场份额', '差异化策略'), '了解竞争对手，找到突破点。', 'Competitive analysis framework'),
(3, 7, '建议方案', JSON_ARRAY('产品方向建议', '功能优先级', '资源投入建议', '时间规划'), '基于调研结果的建议。', 'Recommendations summary'),
(3, 8, '下一步计划', JSON_ARRAY('方案验证', '快速迭代', '数据监控', '持续优化'), '后续行动计划。', 'Next steps roadmap');

-- 为已完成的季度总结项目插入幻灯片
INSERT INTO `slides` (`project_id`, `order_index`, `title`, `bullets`, `speaker_notes`, `visual_prompt`) VALUES
(5, 1, 'Q1 工作回顾', JSON_ARRAY('完成产品 V2.0 发布', '用户增长 50%', '团队扩充至 30 人', '营收达成率 110%'), 'Q1 我们取得了不错的成绩。', 'Q1 achievements summary'),
(5, 2, '关键成果', JSON_ARRAY('产品功能完善', '客户满意度提升', '技术架构优化', '市场拓展成功'), '关键成果展示。', 'Key results visualization'),
(5, 3, '团队建设', JSON_ARRAY('新增核心成员', '培训体系建立', '文化建设', '协作效率提升'), '团队是我们的核心资产。', 'Team building highlights'),
(5, 4, '问题与挑战', JSON_ARRAY('市场竞争加剧', '技术债务积累', '人才缺口', '流程优化需求'), '直面问题，持续改进。', 'Challenges and solutions'),
(5, 5, 'Q2 工作计划', JSON_ARRAY('产品国际化', '市场扩张', '团队建设', '技术升级'), 'Q2 的重点方向。', 'Q2 plan overview'),
(5, 6, '总结', JSON_ARRAY('感谢团队付出', '继续保持势头', '迎接新挑战', '共创更好未来'), '感谢大家，一起加油！', 'Summary and appreciation');

-- 为一些幻灯片插入图片
INSERT INTO `images` (`slide_id`, `prompt`, `style`, `url`, `is_selected`) VALUES
(1, 'A modern AI brain visualization with neural networks', 'realistic', 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800', 1),
(1, 'AI technology concept with digital network', 'illustration', 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=800', 0),
(2, 'Machine learning algorithm visualization', 'flat', 'https://images.unsplash.com/photo-1555949963-aa79dcee981c?w=800', 1),
(3, 'Natural language processing concept', '3d', 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800', 1),
(4, 'Computer vision technology', 'illustration', 'https://images.unsplash.com/photo-1555255707-c07966088b7b?w=800', 1),
(5, 'AI applications in business', 'realistic', 'https://images.unsplash.com/photo-1531746790731-6c087fecd65a?w=800', 1),
(10, 'Summary and future outlook', 'minimal', 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800', 1),
(13, 'Product vision illustration', 'creative', 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800', 1),
(14, 'Year in review metrics', 'flat', 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800', 1),
(15, 'Market analysis charts', 'illustration', 'https://images.unsplash.com/photo-1543286386-713bdd548da4?w=800', 1);
