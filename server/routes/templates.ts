import { Router, Response } from 'express';
import crypto from 'crypto';
import path from 'path';
import { authMiddleware, AuthRequest } from './auth.js';
import { query } from '../db/connection.js';
import { convertPptxToSvg } from '../vendor/pptx_to_svg/pptxToSvg.js';
import { renderPptxWithPowerPoint, svgFromPreviewImage } from '../vendor/pptx_to_svg/powerpointPreview.js';
import {
  collectGeneratedAssetUrls,
  deleteGeneratedAssetUrls,
  deletePptxPreviewImport,
} from '../utils/generatedAssets.js';
import { generatedImagesRoot } from '../utils/storage.js';

const router = Router();

router.use(authMiddleware);

function normalizeName(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isDuplicateEntryError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (error as { code?: string }).code === 'ER_DUP_ENTRY'
  );
}

function duplicateTemplateNameResponse(res: Response, name: unknown) {
  const templateName = String(name || '').trim() || '当前名称';
  return res.status(409).json({
    success: false,
    code: 'TEMPLATE_NAME_DUPLICATED',
    message: `模板名称「${templateName}」已存在，请换一个名称`,
  });
}

type ImportedTemplatePreviewSlide = {
  title: string;
  layout: string;
  description?: string;
  svg?: string;
  pageNumber?: number;
  visualSummary?: string;
};

type ImportedTemplateSettings = {
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
  previewSlides?: ImportedTemplatePreviewSlide[];
  constraints?: {
    preferredSlideCount?: number;
    suitableFor?: string[];
    avoid?: string[];
  };
};

function parseTemplateSettings(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? value as Record<string, any> : {};
}

function collectTemplateGeneratedUrls(template: any) {
  return collectGeneratedAssetUrls({
    preview_url: template?.preview_url,
    settings: parseTemplateSettings(template?.settings),
  });
}

function collectUnusedOldTemplateUrls(existing: any, next: { preview_url?: unknown; settings?: unknown }) {
  const oldUrls = new Set(collectTemplateGeneratedUrls(existing));
  const nextUrls = new Set(collectGeneratedAssetUrls({
    preview_url: next.preview_url,
    settings: next.settings,
  }));
  return Array.from(oldUrls).filter((url) => !nextUrls.has(url));
}

async function collectOtherTemplateGeneratedUrls(userId: number, excludeId: string | number) {
  const rows = await query(
    'SELECT preview_url, settings FROM templates WHERE user_id = ? AND id <> ?',
    [userId, excludeId]
  );
  const urls = new Set<string>();
  rows.forEach((row: any) => {
    collectTemplateGeneratedUrls(row).forEach((url) => urls.add(url));
  });
  return urls;
}

async function deleteTemplateGeneratedUrlsForUser(
  userId: number,
  excludeId: string | number,
  urls: string[]
) {
  if (!urls.length) return;
  const stillUsedUrls = await collectOtherTemplateGeneratedUrls(userId, excludeId);
  await deleteGeneratedAssetUrls(urls.filter((url) => !stillUsedUrls.has(url)));
}

const FALLBACK_TEMPLATE_COLORS = ['#334155', '#172026', '#C9A227', '#F8FAFC'];

function normalizeHexColor(value: string) {
  const raw = String(value || '').trim();
  const short = raw.match(/^#([0-9a-fA-F]{3})$/);
  if (short) {
    return `#${short[1].split('').map((char) => `${char}${char}`).join('')}`.toUpperCase();
  }
  const full = raw.match(/^#([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?$/);
  return full ? `#${full[1]}`.toUpperCase() : '';
}

function colorDistance(a: string, b: string) {
  const left = normalizeHexColor(a).slice(1);
  const right = normalizeHexColor(b).slice(1);
  if (left.length !== 6 || right.length !== 6) return 999;
  const ar = Number.parseInt(left.slice(0, 2), 16);
  const ag = Number.parseInt(left.slice(2, 4), 16);
  const ab = Number.parseInt(left.slice(4, 6), 16);
  const br = Number.parseInt(right.slice(0, 2), 16);
  const bg = Number.parseInt(right.slice(2, 4), 16);
  const bb = Number.parseInt(right.slice(4, 6), 16);
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

function isNeutralNoise(color: string) {
  return colorDistance(color, '#FFFFFF') < 24 || colorDistance(color, '#000000') < 24;
}

function isGrayish(color: string) {
  const hex = normalizeHexColor(color).slice(1);
  if (hex.length !== 6) return true;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return Math.max(r, g, b) - Math.min(r, g, b) < 22;
}

function extractPaletteFromSlides(slides: Array<{ svg?: string }>) {
  const counts = new Map<string, number>();
  for (const slide of slides) {
    const matches = String(slide.svg || '').match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    for (const match of matches) {
      const color = normalizeHexColor(match);
      if (!color || isNeutralNoise(color)) continue;
      counts.set(color, (counts.get(color) || 0) + 1);
    }
  }

  const palette = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([color]) => color)
    .filter((color, index, list) => list.findIndex((item) => colorDistance(item, color) < 12) === index)
    .slice(0, 6);

  return palette.length >= 3
    ? palette
    : Array.from(new Set([...palette, ...FALLBACK_TEMPLATE_COLORS])).slice(0, 6);
}

function pickAccentColor(palette: string[]) {
  return palette.find((color) => !isGrayish(color) && !isNeutralNoise(color)) || palette[0] || '#334155';
}

function sampleIndexes(total: number, maxCount = 6) {
  if (total <= maxCount) return Array.from({ length: total }, (_, index) => index);
  const indexes = new Set<number>([0, total - 1]);
  const slots = Math.max(0, maxCount - 2);
  for (let index = 1; index <= slots; index += 1) {
    indexes.add(Math.round((index * (total - 1)) / (slots + 1)));
  }
  return Array.from(indexes).sort((a, b) => a - b).slice(0, maxCount);
}

function samplePreviewSlides(slides: Array<any>): ImportedTemplatePreviewSlide[] {
  const indexes = sampleIndexes(slides.length, 6);
  return Array.from(indexes)
    .map((index) => toImportedPreviewSlide(slides[index]))
    .filter(Boolean);
}

function toImportedPreviewSlide(slide: any): ImportedTemplatePreviewSlide {
  return {
    title: clampPlainText(slide?.title || `第 ${slide?.pageNumber || ''} 页`, 48),
    layout: String(slide?.layout || 'content'),
    description: clampPlainText(slide?.description || slide?.visualSummary || '从导入 PPT 提取的版式参考页', 120),
    svg: typeof slide?.svg === 'string' ? slide.svg : undefined,
    pageNumber: Number(slide?.pageNumber) || undefined,
    visualSummary: clampPlainText(slide?.visualSummary || '', 220) || undefined,
  };
}

function clampPlainText(value: unknown, maxLength: number) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(1, maxLength - 1))}…` : text;
}

function uniqueStrings(values: unknown[], limit = 8) {
  const output: string[] = [];
  for (const value of values) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text || output.includes(text)) continue;
    output.push(text);
    if (output.length >= limit) break;
  }
  return output;
}

function classifyDensity(slides: Array<{ bullets?: string[]; description?: string; visualSummary?: string }>) {
  const score = slides.reduce((total, slide) => {
    return total + (slide.bullets?.length || 0) + String(slide.description || '').length / 80 + String(slide.visualSummary || '').length / 220;
  }, 0) / Math.max(1, slides.length);
  if (score >= 5) return '信息密度较高';
  if (score >= 2.5) return '信息密度适中';
  return '留白较多';
}

function classifyVisualFocus(slides: Array<{ svg?: string; layout?: string }>) {
  const imageSlides = slides.filter((slide) => /<image\b/i.test(String(slide.svg || '')) || /image/i.test(String(slide.layout || ''))).length;
  const chartSlides = slides.filter((slide) => /chart|matrix|table|data/i.test(String(slide.layout || slide.svg || ''))).length;
  if (chartSlides >= Math.max(2, slides.length * 0.25)) return '偏数据图表表达';
  if (imageSlides >= Math.max(2, slides.length * 0.35)) return '偏图文和视觉占位表达';
  return '偏文本层级和模块化表达';
}

function buildImportedTemplateDraft(filename: string, result: Awaited<ReturnType<typeof convertPptxToSvg>>) {
  const baseName = path.basename(filename, path.extname(filename)).trim() || '导入 PPT 模板';
  const slides = Array.isArray(result.slides) ? result.slides : [];
  const palette = extractPaletteFromSlides(slides);
  const accent = pickAccentColor(palette);
  const layouts = uniqueStrings(slides.map((slide) => slide.layout), 10);
  const contentLayouts = layouts.filter((layout) => !['cover', 'ending', 'summary'].includes(layout));
  const dataLayouts = layouts.filter((layout) => /chart|matrix|table|data|indicator/i.test(layout));
  const outlinePattern = uniqueStrings(
    slides
      .map((slide) => slide.title)
      .filter((title) => title && !/^page\s+\d+$/i.test(String(title))),
    Math.min(12, Math.max(5, slides.length)),
  );
  const previewSlides = samplePreviewSlides(slides);
  const density = classifyDensity(slides);
  const focus = classifyVisualFocus(slides);
  const visualTone = `从导入 PPT 提取的设计 DNA：${density}，${focus}，主色 ${accent}，适合复用版式节奏、色彩层级、组件比例和页面结构。`;

  const settings: ImportedTemplateSettings = {
    sourceProjectTitle: filename,
    styleGuide: {
      visualTone,
      colorPalette: palette,
      typography: '沿用导入 PPT 的标题层级、字号对比和中文无衬线阅读节奏',
      iconStyle: '参考原 PPT 的图标、线条、形状和装饰语言，不复用原业务文本',
    },
    layoutGuide: {
      cover: slides[0]?.visualSummary || '封面参考首屏构图、标题层级和主视觉区域',
      section: '章节页沿用原 PPT 的转场节奏、留白和视觉锚点',
      contentLayouts: contentLayouts.length ? contentLayouts : ['content', 'content-image', 'two-column'],
      dataLayouts: dataLayouts.length ? dataLayouts : ['content-chart', 'matrix_2x2'],
      summary: slides[slides.length - 1]?.visualSummary || '总结页参考收束结构、关键结论区和行动建议区',
    },
    outlinePattern: outlinePattern.length ? outlinePattern : ['背景与目标', '核心洞察', '方案设计', '执行路径', '总结展望'],
    previewSlides,
    constraints: {
      preferredSlideCount: result.slideCount || slides.length || 10,
      suitableFor: [baseName, '导入 PPT 同类场景', focus],
      avoid: ['不要照搬原 PPT 文案', '不要复用原 PPT 的具体业务数据', '只复用版式、色彩、视觉层级和组件节奏'],
    },
  };

  return {
    name: baseName,
    category: '导入模板',
    description: `由 ${filename} 提取设计 DNA 生成的模板草稿，确认后可在 PPT 输入页作为参考模板使用。`,
    slide_count: result.slideCount || slides.length || 10,
    accent,
    settings,
  };
}

async function attachNativePreviewSlides(
  filename: string,
  dataBase64: string,
  mediaOutputDir: string,
  mediaUrlPrefix: string,
  result: Awaited<ReturnType<typeof convertPptxToSvg>>,
  draft: ReturnType<typeof buildImportedTemplateDraft>,
) {
  const nativeDir = path.join(mediaOutputDir, 'native');
  const nativePrefix = `${mediaUrlPrefix}/native`;
  const nativePreview = await renderPptxWithPowerPoint(filename, dataBase64, nativeDir, nativePrefix);
  if (!nativePreview?.slides.length) {
    return { draft, previewMode: 'lightweight' as const };
  }

  const slideByPage = new Map(result.slides.map((slide) => [slide.pageNumber, slide]));
  const sampledNativeSlides = sampleIndexes(nativePreview.slides.length, 6).map((index) => nativePreview.slides[index]).filter(Boolean);
  const nativeSlides = sampledNativeSlides.map((slide) => {
    const parsedSlide = slideByPage.get(slide.pageNumber);
    return {
      title: parsedSlide?.title || `第 ${slide.pageNumber} 页`,
      layout: parsedSlide?.layout || (slide.pageNumber === 1 ? 'cover' : slide.pageNumber === nativePreview.slides.length ? 'ending' : 'content'),
      description: parsedSlide?.description || '由 PowerPoint 原生导出的高保真预览页',
      svg: svgFromPreviewImage(slide, nativePreview.width, nativePreview.height, parsedSlide?.title),
      pageNumber: slide.pageNumber,
      visualSummary: parsedSlide?.visualSummary || 'PowerPoint 原生预览图，优先用于还原原 PPT 的版式、装饰、图片和视觉比例',
    };
  });

  draft.settings.previewSlides = nativeSlides;
  draft.settings.styleGuide = {
    ...draft.settings.styleGuide,
    visualTone: `${draft.settings.styleGuide?.visualTone || '从导入 PPT 提取的设计 DNA'} 高保真预览已使用 PowerPoint 原生导出，模板确认页会尽量接近原 PPT 外观。`,
  };
  draft.settings.layoutGuide = {
    ...draft.settings.layoutGuide,
    cover: nativeSlides[0]?.visualSummary || draft.settings.layoutGuide?.cover,
    summary: nativeSlides[nativeSlides.length - 1]?.visualSummary || draft.settings.layoutGuide?.summary,
  };
  return {
    draft,
    previewMode: 'powerpoint' as const,
    nativePreview: {
      width: nativePreview.width,
      height: nativePreview.height,
      slideCount: nativePreview.slides.length,
    },
  };
}

async function findDuplicateTemplate(
  userId: number,
  name: unknown,
  excludeId?: string | number
): Promise<any | null> {
  const normalized = normalizeName(name);
  if (!normalized) return null;

  const templates = await query(
    'SELECT id, name FROM templates WHERE user_id = ?',
    [userId]
  );
  return templates.find((template: any) =>
    normalizeName(template.name) === normalized && String(template.id) !== String(excludeId || '')
  ) || null;
}

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { category } = req.query;
    let sql = 'SELECT id, name, category, description, slide_count, accent, preview_url, settings, is_public, created_at, updated_at FROM templates WHERE (user_id = ? OR is_public = 1)';
    const params: any[] = [req.userId];

    if (category && category !== '全部') {
      sql += ' AND category = ?';
      params.push(category);
    }

    sql += ' ORDER BY is_public DESC, updated_at DESC';

    const templates = await query(sql, params);
    res.json({ success: true, data: templates });
  } catch (error) {
    console.error('获取模板列表失败:', error);
    res.status(500).json({ success: false, message: '获取模板列表失败' });
  }
});

router.get('/categories', async (_req: AuthRequest, res: Response) => {
  try {
    const categories = await query(
      'SELECT DISTINCT category FROM templates WHERE category IS NOT NULL ORDER BY category'
    );
    res.json({ success: true, data: categories.map((c: any) => c.category) });
  } catch (error) {
    console.error('获取模板分类失败:', error);
    res.status(500).json({ success: false, message: '获取模板分类失败' });
  }
});

router.post('/import-pptx/preview', async (req: AuthRequest, res: Response) => {
  let importId = '';
  try {
    const { filename, dataBase64 } = req.body || {};
    if (!filename || !dataBase64) {
      return res.status(400).json({ success: false, message: '请上传 PPTX 文件' });
    }

    const safeUserId = String(req.userId || 'anonymous');
    importId = `${Date.now()}-${crypto.randomUUID()}`;
    const mediaOutputDir = path.join(generatedImagesRoot, 'pptx-previews', safeUserId, importId);
    const mediaUrlPrefix = `/generated-images/pptx-previews/${safeUserId}/${importId}`;
    const result = await convertPptxToSvg(String(filename), String(dataBase64), {
      mediaOutputDir,
      mediaUrlPrefix,
    });
    const draft = buildImportedTemplateDraft(String(filename), result);
    const previewResult = await attachNativePreviewSlides(
      String(filename),
      String(dataBase64),
      mediaOutputDir,
      mediaUrlPrefix,
      result,
      draft,
    );
    res.json({
      success: true,
      data: {
        ...result,
        importId,
        draft: previewResult.draft,
        diagnostics: {
          importId,
          slideCount: result.slideCount,
          previewSlideCount: previewResult.draft.settings.previewSlides?.length || 0,
          colorCount: previewResult.draft.settings.styleGuide?.colorPalette?.length || 0,
          layoutCount: new Set(result.slides.map((slide) => slide.layout)).size,
          previewMode: previewResult.previewMode,
          nativePreview: previewResult.previewMode === 'powerpoint' ? previewResult.nativePreview : undefined,
        },
      },
      message: 'PPTX 已提取为模板草稿',
    });
  } catch (error) {
    if (importId) {
      await deletePptxPreviewImport(req.userId!, importId).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : 'PPTX 转 SVG 失败';
    console.error('PPTX 转 SVG 失败:', error);
    res.status(400).json({ success: false, message });
  }
});

router.delete('/import-pptx/preview/:importId', async (req: AuthRequest, res: Response) => {
  try {
    await deletePptxPreviewImport(req.userId!, req.params.importId);
    res.json({ success: true, message: '导入预览已清理' });
  } catch (error) {
    console.error('清理 PPTX 导入预览失败:', error);
    res.status(500).json({ success: false, message: '清理 PPTX 导入预览失败' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const templates = await query(
      'SELECT * FROM templates WHERE id = ? AND (user_id = ? OR is_public = 1)',
      [req.params.id, req.userId]
    );
    if (templates.length === 0) {
      return res.status(404).json({ success: false, message: '模板不存在' });
    }
    res.json({ success: true, data: templates[0] });
  } catch (error) {
    console.error('获取模板详情失败:', error);
    res.status(500).json({ success: false, message: '获取模板详情失败' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, category, description, slide_count, accent, preview_url, settings, is_public } = req.body;
    const templateName = String(name || '').trim();
    if (!templateName) {
      return res.status(400).json({ success: false, message: '模板名称不能为空' });
    }

    const duplicate = await findDuplicateTemplate(req.userId!, templateName);
    if (duplicate) {
      return duplicateTemplateNameResponse(res, templateName);
    }

    const result = await query(
      'INSERT INTO templates (user_id, name, category, description, slide_count, accent, preview_url, settings, is_public) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.userId, templateName, category || '其他', description || '', slide_count || 10, accent || '#ef2d2d', preview_url, JSON.stringify(settings || {}), is_public ? 1 : 0]
    );
    const newTemplate = await query(
      'SELECT * FROM templates WHERE id = ?',
      [(result as any).insertId]
    );
    res.status(201).json({ success: true, data: newTemplate[0], message: '模板创建成功' });
  } catch (error) {
    console.error('创建模板失败:', error);
    if (isDuplicateEntryError(error)) {
      return duplicateTemplateNameResponse(res, req.body?.name);
    }
    res.status(500).json({ success: false, message: '创建模板失败' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { name, category, description, slide_count, accent, preview_url, settings, is_public } = req.body;
    const templateName = String(name || '').trim();
    if (!templateName) {
      return res.status(400).json({ success: false, message: '模板名称不能为空' });
    }

    const existing = await query(
      'SELECT id, preview_url, settings FROM templates WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '模板不存在或无权编辑' });
    }

    const duplicate = await findDuplicateTemplate(req.userId!, templateName, req.params.id);
    if (duplicate) {
      return duplicateTemplateNameResponse(res, templateName);
    }

    await query(
      'UPDATE templates SET name = ?, category = ?, description = ?, slide_count = ?, accent = ?, preview_url = ?, settings = ?, is_public = ? WHERE id = ?',
      [templateName, category || '其他', description || '', slide_count || 10, accent || '#ef2d2d', preview_url, JSON.stringify(settings || {}), is_public ? 1 : 0, req.params.id]
    );
    const updated = await query(
      'SELECT * FROM templates WHERE id = ?',
      [req.params.id]
    );
    await deleteTemplateGeneratedUrlsForUser(
      req.userId!,
      req.params.id,
      collectUnusedOldTemplateUrls(existing[0], { preview_url, settings })
    ).catch(() => undefined);
    res.json({ success: true, data: updated[0], message: '模板更新成功' });
  } catch (error) {
    console.error('更新模板失败:', error);
    if (isDuplicateEntryError(error)) {
      return duplicateTemplateNameResponse(res, req.body?.name);
    }
    res.status(500).json({ success: false, message: '更新模板失败' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await query(
      'SELECT id, preview_url, settings FROM templates WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '模板不存在或无权删除' });
    }
    await query('DELETE FROM templates WHERE id = ?', [req.params.id]);
    await deleteTemplateGeneratedUrlsForUser(
      req.userId!,
      req.params.id,
      collectTemplateGeneratedUrls(existing[0])
    ).catch(() => undefined);
    res.json({ success: true, message: '模板删除成功' });
  } catch (error) {
    console.error('删除模板失败:', error);
    res.status(500).json({ success: false, message: '删除模板失败' });
  }
});

export default router;
