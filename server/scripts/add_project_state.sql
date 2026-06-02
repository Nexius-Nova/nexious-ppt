ALTER TABLE `projects` ADD COLUMN `state` JSON DEFAULT NULL COMMENT '项目完整状态快照' AFTER `settings`;
