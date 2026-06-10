export interface TemplateColorScheme {
  bg: string;
  panel: string;
  accent: string;
  text: string;
  muted: string;
  /** Layout params applied per-slide */
  titleSize?: number;   // px, default 28
  bulletSize?: number;  // px, default 14
  imageRatio?: number;  // 0.4 ~ 0.7, default 0.5
  padding?: number;     // px, default 40
  preferredLayout?: string; // e.g. 'mixed-media'
}

/**
 * Expanded template configs — colors + layout parameters.
 */
export const TEMPLATE_COLORS: Record<string, TemplateColorScheme> = {
  auto: {
    bg: '#F7F8F5',
    panel: '#FFFFFF',
    accent: '#C9A227',
    text: '#172026',
    muted: '#66757F',
    titleSize: 28,
    bulletSize: 14,
    imageRatio: 0.5,
    padding: 40,
    preferredLayout: 'text-only'
  },
  business: {
    bg: '#070A0E',
    panel: '#111820',
    accent: '#D9F26E',
    text: '#F2F5F7',
    muted: '#A8B0B8',
    titleSize: 28,
    bulletSize: 13,
    imageRatio: 0.45,
    padding: 40,
    preferredLayout: 'mixed-media'
  },
  creative: {
    bg: '#1a0a2e',
    panel: '#2d1b4e',
    accent: '#c084fc',
    text: '#faf5ff',
    muted: '#c4b5d4',
    titleSize: 32,
    bulletSize: 14,
    imageRatio: 0.55,
    padding: 48,
    preferredLayout: 'visual-focus'
  },
  education: {
    bg: '#0c1929',
    panel: '#152238',
    accent: '#60a5fa',
    text: '#eff6ff',
    muted: '#93a9c2',
    titleSize: 26,
    bulletSize: 14,
    imageRatio: 0.40,
    padding: 36,
    preferredLayout: 'text-only'
  },
  dark: {
    bg: '#0a0a0a',
    panel: '#1a1a1a',
    accent: '#f87171',
    text: '#f5f5f5',
    muted: '#a3a3a3',
    titleSize: 30,
    bulletSize: 13,
    imageRatio: 0.5,
    padding: 44,
    preferredLayout: 'mixed-media'
  },
  nature: {
    bg: '#0a1a0f',
    panel: '#122a19',
    accent: '#4ade80',
    text: '#f0fdf4',
    muted: '#86b899',
    titleSize: 26,
    bulletSize: 13,
    imageRatio: 0.5,
    padding: 40,
    preferredLayout: 'mixed-media'
  },
  ocean: {
    bg: '#08101a',
    panel: '#0f1d30',
    accent: '#22d3ee',
    text: '#ecfeff',
    muted: '#8db4c4',
    titleSize: 28,
    bulletSize: 13,
    imageRatio: 0.5,
    padding: 40,
    preferredLayout: 'mixed-media'
  }
};

/**
 * Get a color scheme for a given template style, falling back to business.
 */
export function getTemplateColors(template?: string): TemplateColorScheme {
  return TEMPLATE_COLORS[template || 'auto'] || TEMPLATE_COLORS.auto;
}

/**
 * Apply template layout params onto slide outline items.
 */
export function applyTemplateLayoutParams(
  template: string,
  defaultLayout: string = 'text-only'
): { titleSize: number; bulletSize: number; imageRatio: number; padding: number; preferredLayout: string } {
  const cfg = getTemplateColors(template);
  return {
    titleSize: cfg.titleSize ?? 28,
    bulletSize: cfg.bulletSize ?? 14,
    imageRatio: cfg.imageRatio ?? 0.5,
    padding: cfg.padding ?? 40,
    preferredLayout: cfg.preferredLayout ?? defaultLayout
  };
}

/**
 * Get a color scheme based on a hex accent color, for custom templates.
 */
export function accentToTemplateColors(accent: string): TemplateColorScheme {
  return {
    bg: '#0D0D0D',
    panel: '#1A1A1A',
    accent: accent,
    text: '#F0F0F0',
    muted: '#999999'
  };
}
