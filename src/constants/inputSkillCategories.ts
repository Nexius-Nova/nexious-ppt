export const INPUT_SKILL_CATEGORIES = [
  '资料收集',
  '文件解析',
  '主题提炼',
  '生成约束'
] as const;

export type InputSkillCategory = (typeof INPUT_SKILL_CATEGORIES)[number];

export function normalizeInputSkillCategory(value?: string | null): InputSkillCategory {
  if (value && INPUT_SKILL_CATEGORIES.includes(value as InputSkillCategory)) {
    return value as InputSkillCategory;
  }
  return '资料收集';
}
