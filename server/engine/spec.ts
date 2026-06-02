export interface DesignSpec {
  projectInfo: {
    title: string;
    topic: string;
    audience: string;
    occasion: string;
  };
  canvas: {
    format: 'ppt169' | 'ppt43';
    width: number;
    height: number;
  };
  visualTheme: {
    mode: 'versatile' | 'consulting' | 'top-consulting';
    style: string;
    colors: {
      primary: string;
      secondary: string;
      accent: string;
      background: string;
      surface: string;
      text: string;
      muted: string;
      border: string;
    };
  };
  typography: {
    fontFamily: string;
    titleFamily: string;
    bodyFamily: string;
    emphasisFamily: string;
    codeFamily: string;
    bodySize: number;
    titleSize: number;
    subtitleSize: number;
    annotationSize: number;
  };
  iconStyle: 'chunk-filled' | 'tabler-filled' | 'tabler-outline' | 'phosphor-duotone' | 'none';
  imageUsage: 'none' | 'ai-generated' | 'user-provided' | 'placeholder';
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
  layout: 'cover' | 'chapter' | 'content' | 'content-image' | 'content-chart' | 'ending' | 'toc' | string;
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
  iconStyle: DesignSpec['iconStyle'];
  imageStyle: string;
  canvas: DesignSpec['canvas'];
  pageRhythm: Record<string, 'anchor' | 'dense' | 'breathing'>;
  pageLayouts: Record<string, string>;
  pageCharts: Record<string, string>;
  skillExtensions: SkillExtension[];
  forbidden: string[];
}

export const CANVAS_FORMATS = {
  ppt169: { format: 'ppt169' as const, width: 1280, height: 720 },
  ppt43: { format: 'ppt43' as const, width: 960, height: 720 },
};

export const INDUSTRY_COLORS: Record<string, DesignSpec['visualTheme']['colors']> = {
  auto: {
    primary: '#1F4E5F',
    secondary: '#6F8E7D',
    accent: '#C9A227',
    background: '#F7F8F5',
    surface: '#FFFFFF',
    text: '#172026',
    muted: '#66757F',
    border: '#D8DED9',
  },
  business: {
    primary: '#1F4E5F',
    secondary: '#6F8E7D',
    accent: '#C9A227',
    background: '#F7F8F5',
    surface: '#FFFFFF',
    text: '#172026',
    muted: '#66757F',
    border: '#D8DED9',
  },
  creative: {
    primary: '#314E52',
    secondary: '#B36A5E',
    accent: '#D7B46A',
    background: '#FBFAF6',
    surface: '#FFFFFF',
    text: '#202124',
    muted: '#6B7177',
    border: '#DFD8CD',
  },
  education: {
    primary: '#28527A',
    secondary: '#5F8D7E',
    accent: '#D19A3C',
    background: '#F6F8FA',
    surface: '#FFFFFF',
    text: '#1B2630',
    muted: '#61707D',
    border: '#D6DEE6',
  },
  tech: {
    primary: '#24505A',
    secondary: '#426B69',
    accent: '#C28B2C',
    background: '#F4F7F7',
    surface: '#FFFFFF',
    text: '#172326',
    muted: '#607176',
    border: '#D3DEDF',
  },
  finance: {
    primary: '#7A2E2E',
    secondary: '#576A5D',
    accent: '#B08A32',
    background: '#F8F6F1',
    surface: '#FFFFFF',
    text: '#211F1B',
    muted: '#6F6B63',
    border: '#DED6C8',
  },
};

export const DEFAULT_FORBIDDEN = [
  '<style>',
  'class',
  '<foreignObject>',
  '<mask>',
  'rgba()',
  '@font-face',
  '<animate>',
  '<script>',
  '<textPath>',
  '<g opacity>',
  '<image opacity>',
  'gradient',
];

const DEFAULT_TYPOGRAPHY: DesignSpec['typography'] = {
  fontFamily: 'Microsoft YaHei, PingFang SC, Arial, sans-serif',
  titleFamily: 'Microsoft YaHei, PingFang SC, Arial, sans-serif',
  bodyFamily: 'Microsoft YaHei, PingFang SC, Arial, sans-serif',
  emphasisFamily: 'Georgia, SimSun, serif',
  codeFamily: 'Consolas, "Courier New", monospace',
  bodySize: 20,
  titleSize: 36,
  subtitleSize: 26,
  annotationSize: 14,
};

export function normalizeTypography(value: Partial<DesignSpec['typography']> | undefined): DesignSpec['typography'] {
  return {
    ...DEFAULT_TYPOGRAPHY,
    ...(value || {}),
  };
}

export function normalizeColors(value: Partial<DesignSpec['visualTheme']['colors']> | undefined, fallbackKey = 'auto') {
  const fallback = INDUSTRY_COLORS[fallbackKey] || INDUSTRY_COLORS.auto;
  return {
    ...fallback,
    ...(value || {}),
    border: value?.border || value?.muted || fallback.border,
  };
}

export function buildSpecLock(spec: DesignSpec): SpecLock {
  const pageRhythm: Record<string, 'anchor' | 'dense' | 'breathing'> = {};
  const pageLayouts: Record<string, string> = {};
  const pageCharts: Record<string, string> = {};

  spec.outline.forEach((slide) => {
    const key = `P${String(slide.pageNumber).padStart(2, '0')}`;
    pageRhythm[key] = slide.rhythm;
    pageLayouts[key] = slide.layout;
    if (slide.chartHint) {
      pageCharts[key] = slide.chartHint;
    }
  });

  return {
    colors: spec.visualTheme.colors,
    typography: spec.typography,
    iconStyle: spec.iconStyle,
    imageStyle: spec.imageUsage === 'ai-generated' ? 'vector-illustration' : 'none',
    canvas: spec.canvas,
    pageRhythm,
    pageLayouts,
    pageCharts,
    skillExtensions: spec.skillExtensions,
    forbidden: DEFAULT_FORBIDDEN,
  };
}
