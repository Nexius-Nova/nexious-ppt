export type WorkflowStepId = 'input' | 'outline' | 'images' | 'layout' | 'preview' | 'my-ppt' | 'prompts' | 'skills' | 'models' | 'templates' | 'config' | 'profile';

export type StepStatus = 'idle' | 'running' | 'done';

export type ImageStyle = string;

export type TemplateStyle = 'auto' | 'business' | 'creative' | 'education' | 'tech' | 'finance';

export interface WorkflowStep {
  id: WorkflowStepId;
  title: string;
  description: string;
  status: StepStatus;
  progress: number;
}

export interface DeckInput {
  topic: string;
  content: string;
  files: string[];
}

export interface AgentParameters {
  summaryLength: string;
  slideCount: number;
  tone: string;
  imageStyle: ImageStyle;
  template: TemplateStyle;
  skillIntensity: number;
}

export type ConfigOptionKey = 'slideCount' | 'summaryLength' | 'tone' | 'imageStyle' | 'skillIntensity';

export interface ConfigOption {
  value: string;
  label: string;
}

export type ConfigOptionGroups = Record<ConfigOptionKey, ConfigOption[]>;

export type SlideLayout = 'text-only' | 'text-image' | 'image-text' | 'full-image' | 'title-center' | 'two-column';

export interface SlideLayoutParams {
  titleSize?: number;
  bulletSize?: number;
  imageRatio?: number; // 0.4 ~ 0.9, image width ratio
}

export interface SlideOutline {
  id: string;
  title: string;
  bullets: string[];
  speakerNotes: string;
  visualPrompt: string;
  chartHint?: string;
  layout?: SlideLayout;
  layoutParams?: SlideLayoutParams;
}

export interface GeneratedImage {
  id: string;
  slideId: string;
  title: string;
  prompt: string;
  style: ImageStyle | string;
  url: string;
  selected: boolean;
  error?: boolean;
  errorMessage?: string;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  order: number;
  params: Record<string, string | number | boolean>;
  instruction?: string;
}

export interface PromptDefinition {
  id: string;
  title: string;
  scene: string;
  content: string;
  updatedAt: number;
}

export interface PptProjectState {
  input: DeckInput;
  parameters: AgentParameters;
  selectedTemplate: TemplateAsset | null;
  outline: SlideOutline[];
  images: GeneratedImage[];
  exportArtifacts: ExportArtifact[];
  enabledSkillIds: string[];
  selectedPromptId: string;
  activityLog: string[];
  steps: WorkflowStep[];
  designSpec: DesignSpec | null;
  specLock: SpecLock | null;
  svgPages: Array<{ pageNumber: number; svg: string; speakerNotes: string }>;
  configOptions?: ConfigOptionGroups;
  paused?: boolean;
  resumeStage?: WorkflowStepId | null;
  executorCursor?: number;
  workflowActive?: boolean;
  lastActiveStep?: WorkflowStepId | null;
}

export interface PptProject {
  id: string;
  title: string;
  topic: string;
  description: string;
  templateId: string;
  createdAt: number;
  updatedAt: number;
  state: PptProjectState;
}

export interface PptTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  slideCount: number;
  accent: string;
  settings?: TemplateAssetSettings;
}

export interface TemplateAssetSettings {
  sourceProjectId?: string;
  sourceProjectTitle?: string;
  styleGuide?: {
    visualTone?: string;
    colorPalette?: string[];
    typography?: string;
    iconStyle?: string;
  };
  layoutGuide?: {
    cover?: string;
    section?: string;
    contentLayouts?: string[];
    dataLayouts?: string[];
    summary?: string;
  };
  outlinePattern?: string[];
  previewSlides?: Array<{
    title: string;
    layout: string;
    description?: string;
    svg?: string;
    pageNumber?: number;
  }>;
  constraints?: {
    preferredSlideCount?: number;
    suitableFor?: string[];
    avoid?: string[];
  };
}

export interface TemplateAsset {
  id: string;
  name: string;
  category: string;
  description: string;
  slideCount: number;
  accent: string;
  settings: TemplateAssetSettings;
}

export interface ExportArtifact {
  format: 'pptx' | 'pdf';
  name: string;
  status: 'ready' | 'queued';
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface VersionSnapshot {
  id: string;
  projectId: string;
  timestamp: number;
  label?: string;
  outline: SlideOutline[];
  parameters: AgentParameters;
  slideCount: number;
}

export type TextModelProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'moonshot'
  | 'zhipu'
  | 'qwen'
  | 'baichuan'
  | 'minimax'
  | 'yi'
  | 'cohere'
  | 'mistral'
  | 'replicate'
  | 'together'
  | 'groq'
  | 'perplexity'
  | 'custom';

export type ImageModelProvider =
  | 'openai'
  | 'stability'
  | 'midjourney'
  | 'dalle'
  | 'flux'
  | 'ideogram'
  | 'leonardo'
  | 'replicate-img'
  | 'fal'
  | 'qwen'
  | 'zhipu'
  | 'baidu'
  | 'tencent'
  | 'volcengine'
  | 'custom';

export interface TextModelConfig {
  id: string;
  name: string;
  provider: TextModelProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  customProviderName?: string;
  customModelName?: string;
  enabled: boolean;
  hasKey?: boolean;
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ImageModelConfig {
  id: string;
  name: string;
  provider: ImageModelProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  customProviderName?: string;
  customModelName?: string;
  enabled: boolean;
  hasKey?: boolean;
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ApiKeyConfig {
  textModels: TextModelConfig[];
  imageModels: ImageModelConfig[];
  activeTextModelId: string | null;
  activeImageModelId: string | null;
}

export const TEXT_MODEL_PROVIDERS: Array<{ label: string; value: TextModelProvider; description?: string }> = [
  { label: 'OpenAI', value: 'openai', description: 'GPT、o 系列模型' },
  { label: 'Anthropic', value: 'anthropic', description: 'Claude 系列模型' },
  { label: 'Google AI', value: 'google', description: 'Gemini 系列模型' },
  { label: 'DeepSeek', value: 'deepseek', description: 'DeepSeek Chat / Reasoner' },
  { label: 'Moonshot', value: 'moonshot', description: 'Kimi 系列模型' },
  { label: '智谱 AI', value: 'zhipu', description: 'GLM 系列模型' },
  { label: '通义千问', value: 'qwen', description: 'Qwen 系列模型' },
  { label: '百川智能', value: 'baichuan', description: 'Baichuan 系列模型' },
  { label: 'MiniMax', value: 'minimax', description: 'abab 系列模型' },
  { label: '零一万物', value: 'yi', description: 'Yi 系列模型' },
  { label: 'Cohere', value: 'cohere', description: 'Command 系列模型' },
  { label: 'Mistral AI', value: 'mistral', description: 'Mistral / Mixtral' },
  { label: 'Replicate', value: 'replicate', description: '开源模型托管' },
  { label: 'Together AI', value: 'together', description: 'Llama / Mixtral 等' },
  { label: 'Groq', value: 'groq', description: '高速推理服务' },
  { label: 'Perplexity', value: 'perplexity', description: '在线搜索增强' },
  { label: '自定义', value: 'custom', description: '兼容 OpenAI 格式的接口' }
];

export const IMAGE_MODEL_PROVIDERS: Array<{ label: string; value: ImageModelProvider; description?: string }> = [
  { label: 'OpenAI DALL-E', value: 'openai', description: 'DALL-E 系列' },
  { label: 'Stability AI', value: 'stability', description: 'Stable Diffusion 系列' },
  { label: 'Midjourney', value: 'midjourney', description: 'Midjourney 系列' },
  { label: 'DALL-E 3', value: 'dalle', description: 'OpenAI 图像生成' },
  { label: 'Flux', value: 'flux', description: 'Flux Pro / Dev / Schnell' },
  { label: 'Ideogram', value: 'ideogram', description: '文字渲染能力' },
  { label: 'Leonardo AI', value: 'leonardo', description: '设计与艺术风格' },
  { label: 'Replicate', value: 'replicate-img', description: '多种图像模型' },
  { label: 'Fal.ai', value: 'fal', description: '高速图像推理' },
  { label: '通义万相', value: 'qwen', description: '阿里云图像生成' },
  { label: '智谱 CogView', value: 'zhipu', description: '智谱 AI 图像生成' },
  { label: '百度文心一格', value: 'baidu', description: '百度图像生成' },
  { label: '腾讯混元', value: 'tencent', description: '腾讯图像生成' },
  { label: '火山引擎', value: 'volcengine', description: '字节跳动图像生成' },
  { label: '自定义', value: 'custom', description: '自定义图像接口' }
];

export const TEXT_MODELS: Record<TextModelProvider, Array<{ label: string; value: string; description?: string }>> = {
  openai: [
    { label: 'GPT-4o', value: 'gpt-4o', description: '通用多模态' },
    { label: 'GPT-4o Mini', value: 'gpt-4o-mini', description: '轻量快速' },
    { label: 'GPT-4 Turbo', value: 'gpt-4-turbo', description: '增强 GPT-4' },
    { label: 'GPT-4', value: 'gpt-4', description: '标准 GPT-4' },
    { label: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo', description: '经济快速' }
  ],
  anthropic: [
    { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-latest', description: '均衡能力' },
    { label: 'Claude 3.5 Haiku', value: 'claude-3-5-haiku-latest', description: '快速轻量' },
    { label: 'Claude 3 Opus', value: 'claude-3-opus-latest', description: '强推理' }
  ],
  google: [
    { label: 'Gemini 2.0 Flash', value: 'gemini-2.0-flash-exp', description: '快速响应' },
    { label: 'Gemini 1.5 Pro', value: 'gemini-1.5-pro', description: '长上下文' },
    { label: 'Gemini 1.5 Flash', value: 'gemini-1.5-flash', description: '轻量快速' }
  ],
  deepseek: [
    { label: 'DeepSeek Chat', value: 'deepseek-chat', description: '通用对话' },
    { label: 'DeepSeek Reasoner', value: 'deepseek-reasoner', description: '推理增强' },
    { label: 'DeepSeek Coder', value: 'deepseek-coder', description: '代码能力' }
  ],
  moonshot: [
    { label: 'Kimi 8K', value: 'moonshot-v1-8k', description: '8K 上下文' },
    { label: 'Kimi 32K', value: 'moonshot-v1-32k', description: '32K 上下文' },
    { label: 'Kimi 128K', value: 'moonshot-v1-128k', description: '128K 上下文' }
  ],
  zhipu: [
    { label: 'GLM-4-Plus', value: 'glm-4-plus', description: '旗舰版本' },
    { label: 'GLM-4', value: 'glm-4', description: '标准版本' },
    { label: 'GLM-4-Flash', value: 'glm-4-flash', description: '快速版本' }
  ],
  qwen: [
    { label: 'Qwen-Max', value: 'qwen-max', description: '旗舰版本' },
    { label: 'Qwen-Plus', value: 'qwen-plus', description: '均衡版本' },
    { label: 'Qwen-Turbo', value: 'qwen-turbo', description: '快速版本' }
  ],
  baichuan: [
    { label: 'Baichuan 4', value: 'Baichuan4', description: '旗舰版本' },
    { label: 'Baichuan 3 Turbo', value: 'Baichuan3-Turbo', description: '快速版本' }
  ],
  minimax: [
    { label: 'abab 6.5s', value: 'abab6.5s-chat', description: '快速版本' },
    { label: 'abab 6.5g', value: 'abab6.5g-chat', description: '均衡版本' }
  ],
  yi: [
    { label: 'Yi-Large', value: 'yi-large', description: '大参数模型' },
    { label: 'Yi-Medium', value: 'yi-medium', description: '均衡版本' }
  ],
  cohere: [
    { label: 'Command R+', value: 'command-r-plus', description: '增强版本' },
    { label: 'Command R', value: 'command-r', description: '标准版本' }
  ],
  mistral: [
    { label: 'Mistral Large', value: 'mistral-large-latest', description: '大参数模型' },
    { label: 'Mistral Small', value: 'mistral-small-latest', description: '轻量模型' },
    { label: 'Mixtral 8x7B', value: 'open-mixtral-8x7b', description: '开源 MoE' }
  ],
  replicate: [
    { label: 'Llama 3.1 70B', value: 'meta/llama-3.1-70b-instruct', description: '开源模型' },
    { label: 'Mixtral 8x7B', value: 'mistralai/mixtral-8x7b-instruct-v0.1', description: 'MoE 架构' }
  ],
  together: [
    { label: 'Llama 3.1 70B', value: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', description: '开源模型' },
    { label: 'Qwen 2 72B', value: 'Qwen/Qwen2-72B-Instruct', description: '通义千问' }
  ],
  groq: [
    { label: 'Llama 3.3 70B', value: 'llama-3.3-70b-versatile', description: '高速推理' },
    { label: 'Gemma 2 9B', value: 'gemma2-9b-it', description: '轻量模型' }
  ],
  perplexity: [
    { label: 'Sonar Pro', value: 'llama-3.1-sonar-large-128k-pro', description: '搜索增强' },
    { label: 'Sonar', value: 'llama-3.1-sonar-large-128k-online', description: '在线搜索' }
  ],
  custom: [{ label: '自定义模型', value: 'custom', description: '输入模型名称' }]
};

export const IMAGE_MODELS: Record<ImageModelProvider, Array<{ label: string; value: string; description?: string }>> = {
  openai: [
    { label: 'DALL-E 3', value: 'dall-e-3', description: '标准质量' },
    { label: 'DALL-E 3 HD', value: 'dall-e-3-hd', description: '高清质量' },
    { label: 'DALL-E 2', value: 'dall-e-2', description: '经典版本' }
  ],
  stability: [
    { label: 'Stable Diffusion 3', value: 'stable-diffusion-3', description: '新版本' },
    { label: 'Stable Diffusion XL', value: 'stable-diffusion-xl-1024-v1-0', description: '高清版本' }
  ],
  midjourney: [
    { label: 'Midjourney V6.1', value: 'midjourney-v6.1', description: '新版本' },
    { label: 'Midjourney V6', value: 'midjourney-v6', description: 'V6 版本' }
  ],
  dalle: [
    { label: 'DALL-E 3 Standard', value: 'dall-e-3', description: '标准质量' },
    { label: 'DALL-E 3 HD', value: 'dall-e-3-hd', description: '高清质量' }
  ],
  flux: [
    { label: 'Flux Pro', value: 'flux-pro', description: '专业版本' },
    { label: 'Flux Dev', value: 'flux-dev', description: '开发版本' },
    { label: 'Flux Schnell', value: 'flux-schnell', description: '极速版本' }
  ],
  ideogram: [
    { label: 'Ideogram V2', value: 'ideogram-v2', description: '新版本' },
    { label: 'Ideogram V2 Turbo', value: 'ideogram-v2-turbo', description: '快速版本' }
  ],
  leonardo: [
    { label: 'Leonardo Phoenix', value: 'phoenix', description: '新模型' },
    { label: 'Leonardo PhotoReal', value: 'photoreal-v2', description: '写实风格' }
  ],
  'replicate-img': [
    { label: 'Flux Pro', value: 'black-forest-labs/flux-pro', description: '专业版本' },
    { label: 'SDXL', value: 'stability-ai/sdxl', description: 'Stable Diffusion XL' }
  ],
  fal: [
    { label: 'Flux Pro', value: 'fal-ai/flux-pro', description: '专业版本' },
    { label: 'SDXL', value: 'fal-ai/sdxl', description: 'SDXL' }
  ],
  qwen: [
    { label: '通义万相 V2', value: 'wanx-v2', description: '新版本' },
    { label: '通义万相 V1', value: 'wanx-v1', description: '标准版本' }
  ],
  zhipu: [
    { label: 'CogView-3', value: 'cogview-3', description: '新版本' },
    { label: 'CogView-3-Plus', value: 'cogview-3-plus', description: '增强版本' }
  ],
  baidu: [
    { label: '文心一格', value: 'wenxin-yige', description: '标准版本' }
  ],
  tencent: [
    { label: '混元生图', value: 'hunyuan-image', description: '标准版本' }
  ],
  volcengine: [
    { label: '火山方舟', value: 'volcengine-image', description: '标准版本' }
  ],
  custom: [{ label: '自定义模型', value: 'custom', description: '输入模型名称' }]
};

export interface DesignSpec {
  projectInfo: {
    title: string;
    topic: string;
    audience: string;
    occasion: string;
  };
  canvas: { format: 'ppt169' | 'ppt43'; width: number; height: number };
  visualTheme: {
    mode: 'versatile' | 'consulting' | 'top-consulting';
    style: string;
    colors: {
      primary: string; secondary: string; accent: string;
      background: string; surface: string; text: string; muted: string; border: string;
    };
  };
  typography: {
    fontFamily: string; titleFamily: string; bodyFamily: string;
    emphasisFamily: string; codeFamily: string;
    bodySize: number; titleSize: number; subtitleSize: number; annotationSize: number;
  };
  iconStyle: string;
  imageUsage: string;
  outline: SpecSlide[];
  skillExtensions: SkillExtension[];
}

export interface SpecSlide {
  id: string;
  pageNumber: number;
  title: string;
  bullets: string[];
  speakerNotes: string;
  visualPrompt: string;
  layout: string;
  rhythm: 'anchor' | 'dense' | 'breathing';
  chartHint?: string;
}

export interface SkillExtension {
  skillId: string;
  skillName: string;
  strategistPrompt?: string;
  executorTemplate?: string;
  executorRules?: string[];
}

export interface SpecLock {
  colors: DesignSpec['visualTheme']['colors'];
  typography: DesignSpec['typography'];
  iconStyle: string;
  imageStyle: string;
  canvas: DesignSpec['canvas'];
  pageRhythm: Record<string, 'anchor' | 'dense' | 'breathing'>;
  pageLayouts: Record<string, string>;
  pageCharts: Record<string, string>;
  skillExtensions: SkillExtension[];
  forbidden: string[];
}
