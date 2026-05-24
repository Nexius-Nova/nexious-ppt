import type { PromptDefinition, PptTemplate, SkillDefinition, WorkflowStep } from '@/types/agent';

export const workflowSteps: WorkflowStep[] = [
  {
    id: 'input',
    title: '输入',
    description: '填写主题和内容，选择提示词与技能',
    status: 'idle',
    progress: 0
  },
  {
    id: 'outline',
    title: '文本分析',
    description: 'AI 自动生成 PPT 大纲',
    status: 'idle',
    progress: 0
  },
  {
    id: 'images',
    title: '图像生成',
    description: '根据每页内容生成插图',
    status: 'idle',
    progress: 0
  },
  {
    id: 'layout',
    title: '排版 & Skill',
    description: '选择模板、版式，运行 Skill 处理',
    status: 'idle',
    progress: 0
  },
  {
    id: 'preview',
    title: '预览 & 导出',
    description: '实时查看微调 PPT，一键导出',
    status: 'idle',
    progress: 0
  }
];

export const defaultSkills: SkillDefinition[] = [
  {
    id: 'speaker-notes',
    name: '讲稿生成',
    description: '自动生成每页演讲稿，并补充自然转场。',
    enabled: true,
    order: 1,
    params: {
      style: 'professional',
      length: 'medium'
    }
  },
  {
    id: 'data-chart',
    name: '数据图表',
    description: '识别数据表达机会，生成适合演示的图表建议。',
    enabled: false,
    order: 2,
    params: {
      type: 'auto',
      theme: 'default'
    }
  },
  {
    id: 'design-polish',
    name: '设计优化',
    description: '优化标题层级、页面节奏和视觉重点。',
    enabled: false,
    order: 3,
    params: {
      level: 'medium',
      preserveStyle: true
    }
  }
];

export const defaultPrompts: PromptDefinition[] = [
  {
    id: 'strategy-report',
    title: '战略汇报提示词',
    scene: '年度规划 / 经营复盘',
    content: '请将资料整理为适合管理层汇报的 PPT：先总结关键结论，再展开机会、策略、里程碑和风险。语言保持克制、明确、可执行。',
    updatedAt: Date.now()
  },
  {
    id: 'product-launch',
    title: '产品发布提示词',
    scene: '新品发布 / 路演',
    content: '请围绕用户痛点、产品价值、核心能力、应用场景和行动号召生成演示结构。每页保持一个清晰主张。',
    updatedAt: Date.now()
  }
];

export const exampleTemplates: PptTemplate[] = [
  {
    id: 'business-review',
    name: '商务复盘',
    category: '商务',
    description: '适合季度复盘、经营分析和增长策略汇报。',
    slideCount: 8,
    accent: '#ef2d2d'
  },
  {
    id: 'product-roadshow',
    name: '产品路演',
    category: '产品',
    description: '适合产品发布、融资路演和解决方案介绍。',
    slideCount: 10,
    accent: '#334155'
  },
  {
    id: 'training-course',
    name: '培训课程',
    category: '教育',
    description: '适合课程讲义、内部培训和知识分享。',
    slideCount: 12,
    accent: '#2563eb'
  }
];
