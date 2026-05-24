-- ============================================
-- 添加自定义服务商和模型名称字段到 api_keys 表
-- 执行时间: 2026-05-06
-- ============================================

USE `nexious-ppt`;

-- 添加 custom_provider_name 字段
ALTER TABLE `api_keys`
ADD COLUMN `custom_provider_name` VARCHAR(100) DEFAULT NULL COMMENT '自定义服务商名称'
AFTER `model`;

-- 添加 custom_model_name 字段
ALTER TABLE `api_keys`
ADD COLUMN `custom_model_name` VARCHAR(100) DEFAULT NULL COMMENT '自定义模型名称'
AFTER `custom_provider_name`;
