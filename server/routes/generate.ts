import { Router, Response, Request } from 'express';
import { decrypt } from '../utils/crypto.js';
import { resolveGenerationApiKey } from '../services/modelSelection.js';
import {
  buildStrategistPrompt,
  parseStrategistOutput,
  buildSpecLock,
  buildExecutorSystemPrompt,
  buildExecutorPagePrompt,
  buildSvgQualityRepairPrompt,
  cleanSvgOutput,
  ensureImageUsedInSvg,
  finalizeSvgQuality
} from '../engine/index.js';
import { DEFAULT_FORBIDDEN, normalizeTypography } from '../engine/spec.js';
import type { StrategistInput, DesignSpec, SpecLock, SpecSlide } from '../engine/index.js';
import { inlineRemoteImages, sanitizeSvgForResvg } from '../engine/svg-to-pptx.js';
import { exportWithNexiousPpt } from '../engine/ppt-exporter.js';
import { authMiddleware, AuthRequest } from './auth.js';
import { streamText, type Message } from '../services/textModel.js';
import {
  cancelQueuedJob,
  enqueueExportJob,
  enqueueGenerateJob,
  getExportArtifact,
  getQueuedJob,
  subscribeQueuedJob,
} from '../services/generationQueue.js';
import {
  getChartCatalog,
  getChartSvg,
  getIconGuide,
} from '../services/pptEnhancements.js';

const router = Router();

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/+$/, '');
}

function normalizeExecutorImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const imageUrl = value.trim();
  if (!imageUrl || imageUrl.length > 4000) return undefined;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  if (imageUrl.startsWith('/generated-images/')) return `${publicBaseUrl()}${imageUrl}`;
  return undefined;
}

function normalizeExecutorImageAssets(value: unknown, legacyImageUrl?: unknown) {
  const rawItems = Array.isArray(value) ? value : [];
  const assets = rawItems
    .map((item: any, index) => {
      const url = normalizeExecutorImageUrl(item?.url);
      if (!url) return null;
      return {
        id: String(item?.assetId || item?.id || `img-${index + 1}`).slice(0, 80),
        url,
        title: item?.title ? String(item.title).slice(0, 120) : undefined,
        prompt: item?.prompt ? String(item.prompt).slice(0, 360) : undefined,
        purpose: item?.purpose ? String(item.purpose).slice(0, 80) : undefined,
        style: item?.style ? String(item.style).slice(0, 80) : undefined,
      };
    })
    .filter(Boolean);

  if (assets.length) return assets;
  const url = normalizeExecutorImageUrl(legacyImageUrl);
  return url ? [{ id: 'img-1', url }] : [];
}

function buildAttachmentDisposition(fileName: string): string {
  const safeName = fileName.trim() || `nexious-deck-${Date.now()}.pptx`;
  const asciiName = safeName
    .replace(/[^\x20-\x7E]+/g, '_')
    .replace(/["\\]/g, '_')
    .replace(/[;]+/g, '_')
    || `nexious-deck-${Date.now()}.pptx`;
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

function normalizeExportOptions(value: any) {
  const animation = value?.animation;
  const animationEnabled = animation?.enabled === true;
  const animationEffect = normalizeAnimationEffect(animation?.effect);
  const transitionEffect = normalizeTransitionEffect(animation?.transitionEffect);
  return {
    animation: {
      enabled: animationEnabled,
      effect: animationEnabled ? animationEffect : 'none',
      duration: clampNumber(animation?.duration, 0.1, 3, 0.62),
      stagger: clampNumber(animation?.stagger, 0, 3, 0.2),
      trigger: animation?.trigger === 'with-previous' || animation?.trigger === 'on-click'
        ? animation.trigger
        : 'after-previous',
      transitionEffect: animationEnabled ? transitionEffect : 'none',
      transitionDuration: clampNumber(animation?.transitionDuration, 0.1, 3, 0.55),
    },
  };
}

function normalizeAnimationEffect(value: unknown) {
  const effect = String(value || 'auto');
  return [
    'appear',
    'fade',
    'fly',
    'cut',
    'zoom',
    'wipe',
    'split',
    'blinds',
    'checkerboard',
    'dissolve',
    'random_bars',
    'peek',
    'wheel',
    'box',
    'circle',
    'diamond',
    'plus',
    'strips',
    'wedge',
    'stretch',
    'expand',
    'swivel',
    'auto',
    'mixed',
    'random',
  ].includes(effect) ? effect : 'auto';
}

function normalizeTransitionEffect(value: unknown) {
  const effect = String(value || 'push');
  return ['fade', 'push', 'wipe', 'split', 'strips', 'cover', 'random'].includes(effect) ? effect : 'push';
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function isFallbackSvgPage(svg?: string) {
  return Boolean(svg && svg.includes('本页待重试'));
}

function validateExportPagesComplete(pages: any[], spec: DesignSpec) {
  const expected = Array.isArray(spec?.outline) ? spec.outline.length : 0;
  if (expected <= 0) throw new Error('缺少完整大纲，无法导出 PPTX');
  const pagesByNumber = new Map<number, any>();
  for (const page of pages) {
    const pageNumber = Number(page?.pageNumber);
    if (Number.isInteger(pageNumber) && pageNumber > 0) pagesByNumber.set(pageNumber, page);
  }
  const missing: number[] = [];
  for (let pageNumber = 1; pageNumber <= expected; pageNumber += 1) {
    const page = pagesByNumber.get(pageNumber);
    if (!page?.svg || isFallbackSvgPage(String(page.svg))) missing.push(pageNumber);
  }
  if (missing.length) {
    throw new Error(`页面尚未全部生成完成，缺少或待重试页面：${missing.slice(0, 12).join('、')}`);
  }
}

function extractStreamingOutlineSlides(raw: string): SpecSlide[] {
  const outlineStart = raw.search(/"outline"\s*:\s*\[/);
  if (outlineStart < 0) return [];

  const arrayStart = raw.indexOf('[', outlineStart);
  if (arrayStart < 0) return [];

  const slides: SpecSlide[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objectStart = -1;

  for (let i = arrayStart + 1; i < raw.length; i += 1) {
    const char = raw[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) objectStart = i;
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        try {
          slides.push(normalizeStreamingSpecSlide(JSON.parse(raw.slice(objectStart, i + 1)), slides.length));
        } catch {
          // The current slide object may still be streaming.
        }
        objectStart = -1;
      }
    }

    if (char === ']' && depth === 0) break;
  }

  return slides;
}

function normalizeStreamingSpecSlide(item: any, index: number): SpecSlide {
  const pageNumber = Number(item?.pageNumber || index + 1);
  return {
    id: String(item?.id || `slide-${pageNumber}`),
    pageNumber,
    title: String(item?.title || `第 ${pageNumber} 页`),
    bullets: Array.isArray(item?.bullets)
      ? item.bullets.map((bullet: unknown) => String(bullet || '').trim()).filter(Boolean)
      : [],
    speakerNotes: String(item?.speakerNotes || ''),
    visualPrompt: String(item?.visualPrompt || ''),
    imagePlan: Array.isArray(item?.imagePlan)
      ? item.imagePlan
          .map((plan: any, planIndex: number) => ({
            id: String(plan?.id || `img-${planIndex + 1}`),
            prompt: String(plan?.prompt || '').trim(),
            purpose: plan?.purpose ? String(plan.purpose) : undefined,
            style: plan?.style ? String(plan.style) : undefined,
          }))
          .filter((plan: any) => plan.prompt)
      : undefined,
    layout: String(item?.layout || 'content'),
    rhythm: item?.rhythm === 'anchor' || item?.rhythm === 'dense' || item?.rhythm === 'breathing'
      ? item.rhythm
      : 'breathing',
    chartHint: item?.chartHint ? String(item.chartHint) : undefined,
  };
}

router.post('/strategist', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const input: StrategistInput = req.body;

    const defaultKey = await resolveGenerationApiKey(req.userId!, 'text', input.textModelId);
    if (!defaultKey) {
      return res.status(400).json({ success: false, message: '未配置文本模型' });
    }

    const apiKey = decrypt(defaultKey.api_key);
    const provider = defaultKey.provider;
    const baseUrl = defaultKey.base_url || '';
    const model = defaultKey.model || 'gpt-4o';

    const chartCatalog = await getChartCatalog();
    const { system, user } = buildStrategistPrompt(input, { chartCatalog });
    const estimatedTokens = Math.ceil((system.length + user.length) / 3);
    console.log(`[Strategist] systemPrompt=${system.length}chars, userPrompt=${user.length}chars, ~${estimatedTokens}tokens`);
    const messages: Message[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write(`data: ${JSON.stringify({ status: 'start', phase: 'strategist', message: 'Strategist 正在分析内容...' })}\n\n`);

    const streamedSlideIds = new Set<string>();
    const fullContent = await streamText(provider, apiKey, baseUrl, model, messages, res, {
      onContent: (_content, currentFullContent) => {
        const slides = extractStreamingOutlineSlides(currentFullContent);
        for (const slide of slides) {
          const key = slide.id || String(slide.pageNumber);
          if (streamedSlideIds.has(key)) continue;
          streamedSlideIds.add(key);
          res.write(`data: ${JSON.stringify({ status: 'outline-slide', phase: 'strategist', data: slide })}\n\n`);
        }
      },
    });

    const spec = parseStrategistOutput(fullContent, input);
    const lock = buildSpecLock(spec);

    res.write(`data: ${JSON.stringify({ status: 'complete', phase: 'strategist', data: { spec, lock } })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Strategist error:', error);
    res.write(`data: ${JSON.stringify({ status: 'error', phase: 'strategist', message: error instanceof Error ? error.message : '策略分析失败' })}\n\n`);
    res.end();
  }
});

router.post('/executor-page', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { spec, lock, slide, imageUrl, imageAssets, textModelId } = req.body;

    const defaultKey = await resolveGenerationApiKey(req.userId!, 'text', textModelId);
    if (!defaultKey) {
      return res.status(400).json({ success: false, message: '未配置文本模型' });
    }

    const apiKey = decrypt(defaultKey.api_key);
    const provider = defaultKey.provider;
    const baseUrl = defaultKey.base_url || '';
    const model = defaultKey.model || 'gpt-4o';

    const effectiveLock = {
      ...lock,
      typography: normalizeTypography(lock?.typography || spec?.typography),
      colors: {
        ...(spec?.visualTheme?.colors || {}),
        ...(lock?.colors || {}),
        border: lock?.colors?.border || spec?.visualTheme?.colors?.border || lock?.colors?.muted || '#D8DED9',
      },
      forbidden: lock?.forbidden || DEFAULT_FORBIDDEN,
      skillExtensions: lock?.skillExtensions || [],
      pageRhythm: lock?.pageRhythm || {},
      pageLayouts: lock?.pageLayouts || {},
      pageCharts: lock?.pageCharts || {},
    };

    let messages: Message[];
    const safeImageAssets = normalizeExecutorImageAssets(imageAssets, imageUrl);
    const pageKey = `P${String(slide.pageNumber).padStart(2, '0')}`;
    const iconGuide = await getIconGuide(effectiveLock.iconStyle);
    const chartTemplateSvg = await getChartSvg(effectiveLock.pageCharts?.[pageKey] || slide.chartHint);
    const executorContext = { iconGuide, chartTemplateSvg };
    const systemPrompt = buildExecutorSystemPrompt(spec, effectiveLock, executorContext);
    const userPrompt = buildExecutorPagePrompt(slide, spec, effectiveLock, safeImageAssets, undefined, executorContext);

    const estimatedTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 3);
    console.log(`[Executor] Page ${slide.pageNumber}: systemPrompt=${systemPrompt.length}chars, userPrompt=${userPrompt.length}chars, ~${estimatedTokens}tokens`);

    if (estimatedTokens > 500000) {
      console.warn(`[Executor] Page ${slide.pageNumber}: prompt too large (~${estimatedTokens}tokens), using simplified prompt`);
      const simplifiedSystem = `你是PPT SVG执行器。画布: ${spec.canvas.width}x${spec.canvas.height}。颜色: primary=${lock.colors.primary}, accent=${lock.colors.accent}, bg=${lock.colors.background}, text=${lock.colors.text}, surface=${lock.colors.surface}, muted=${lock.colors.muted}。字体: ${spec.typography.titleFamily}。输出纯SVG代码，viewBox="0 0 ${spec.canvas.width} ${spec.canvas.height}"。禁止<style>,class,<foreignObject>,rgba()。`;
      const simplifiedImageText = safeImageAssets.length
        ? `可用图片素材：${safeImageAssets.map((asset: any) => `${asset.id}:${asset.url}`).join('；')}。是否使用、使用几张、位置、尺寸、裁切、旋转、缩放都由你按内容自主决定，只能使用清单 URL，不能遮挡标题、正文、图表或关键组件。`
        : '不要写 <image>。';
      const simplifiedUser = `生成第 ${slide.pageNumber} 页 SVG。标题：${slide.title}。要点：${slide.bullets.slice(0, 5).join(' | ')}。布局：${slide.layout}。${simplifiedImageText} 输出纯 SVG。`;
      messages = [
        { role: 'system', content: simplifiedSystem },
        { role: 'user', content: simplifiedUser },
      ];
    } else {
      messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write(`data: ${JSON.stringify({ status: 'start', phase: 'executor', pageNumber: slide.pageNumber, message: `正在生成第${slide.pageNumber}页...` })}\n\n`);

    const fullContent = await streamText(provider, apiKey, baseUrl, model, messages, res);

    let svg = ensureImageUsedInSvg(cleanSvgOutput(fullContent), slide, spec, safeImageAssets);
    let quality = finalizeSvgQuality(svg, spec, slide, undefined, safeImageAssets);
    if (quality.blockingIssues.length) {
      res.write(`data: ${JSON.stringify({ status: 'quality-check', phase: 'executor', pageNumber: slide.pageNumber, message: '正在修复页面布局质量问题' })}\n\n`);
      const repairContent = await streamText(provider, apiKey, baseUrl, model, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildSvgQualityRepairPrompt(quality.svg, spec, slide, undefined, quality.blockingIssues, safeImageAssets) },
      ]);
      svg = ensureImageUsedInSvg(cleanSvgOutput(repairContent), slide, spec, safeImageAssets);
      quality = finalizeSvgQuality(svg || quality.svg, spec, slide, undefined, safeImageAssets);
    }
    svg = quality.svg;

    res.write(`data: ${JSON.stringify({ status: 'complete', phase: 'executor', pageNumber: slide.pageNumber, data: { svg } })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Executor error:', error);
    res.write(`data: ${JSON.stringify({ status: 'error', phase: 'executor', message: error instanceof Error ? error.message : '页面生成失败' })}\n\n`);
    res.end();
  }
});

router.post('/export-pptx', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { pages, spec, lock, exportOptions } = req.body;

    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ success: false, message: '没有可导出的页面' });
    }

    const effectiveLock = lock
      ? {
          ...lock,
          typography: normalizeTypography(lock.typography || spec?.typography),
          colors: {
            ...(spec?.visualTheme?.colors || {}),
            ...(lock.colors || {}),
            border: lock.colors?.border || spec?.visualTheme?.colors?.border || lock.colors?.muted || '#D8DED9',
          },
          forbidden: lock.forbidden || DEFAULT_FORBIDDEN,
        }
      : buildSpecLock(spec);

    const result = await exportWithNexiousPpt(
      pages.map((page: any, index: number) => ({
        pageNumber: page.pageNumber || index + 1,
        svg: page.svg,
        speakerNotes: page.speakerNotes || ''
      })),
      spec,
      effectiveLock,
      normalizeExportOptions(exportOptions)
    );

    const fileName = result.fileName || `nexious-deck-${Date.now()}.pptx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', buildAttachmentDisposition(fileName));
    res.send(result.buffer);
  } catch (error) {
    console.error('Export PPTX error:', error);
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : '导出失败' });
  }
});

router.post('/jobs/generate', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId, title, input, projectState, includeImages, resumeStage } = req.body || {};
    if (!projectId || !input || typeof input !== 'object') {
      return res.status(400).json({ success: false, message: '缺少生成任务参数' });
    }

    const job = await enqueueGenerateJob(req.userId!, {
      projectId: String(projectId),
      title: typeof title === 'string' ? title : undefined,
      input,
      projectState,
      includeImages,
      resumeStage: resumeStage === 'images' || resumeStage === 'layout' ? resumeStage : 'outline',
    });

    res.status(202).json({ success: true, data: job });
  } catch (error) {
    console.error('Create generate job error:', error);
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : '创建生成任务失败' });
  }
});

router.post('/jobs/export-pptx', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId, title, pages, spec, lock, exportOptions } = req.body || {};
    if (!projectId || !spec || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ success: false, message: '缺少导出任务参数' });
    }

    try {
      validateExportPagesComplete(pages, spec);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : '页面尚未全部生成完成',
      });
    }

    const job = await enqueueExportJob(req.userId!, {
      projectId: String(projectId),
      title: typeof title === 'string' ? title : undefined,
      pages: pages.map((page: any, index: number) => ({
        pageNumber: page.pageNumber || index + 1,
        svg: page.svg,
        speakerNotes: page.speakerNotes || '',
      })),
      spec,
      lock,
      exportOptions: normalizeExportOptions(exportOptions),
    });

    res.status(202).json({ success: true, data: job });
  } catch (error) {
    console.error('Create export job error:', error);
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : '创建导出任务失败' });
  }
});

router.get('/jobs/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const job = await getQueuedJob(req.params.id, req.userId!);
  if (!job) {
    return res.status(404).json({ success: false, message: '任务不存在' });
  }
  res.json({ success: true, data: job });
});

router.get('/jobs/:id/events', authMiddleware, async (req: AuthRequest, res: Response) => {
  const ok = await subscribeQueuedJob(req.params.id, req.userId!, res);
  if (!ok) {
    return res.status(404).json({ success: false, message: '任务不存在' });
  }
});

router.post('/jobs/:id/cancel', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const job = await cancelQueuedJob(req.params.id, req.userId!);
    if (!job) {
      return res.status(404).json({ success: false, message: '任务不存在' });
    }
    res.json({ success: true, data: job, message: '任务已暂停' });
  } catch (error) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : '暂停任务失败' });
  }
});

router.get('/jobs/:id/download', authMiddleware, async (req: AuthRequest, res: Response) => {
  const artifact = await getExportArtifact(req.params.id, req.userId!);
  if (!artifact) {
    return res.status(404).json({ success: false, message: '导出文件不存在或尚未完成' });
  }
  res.setHeader('Content-Type', artifact.contentType);
  res.setHeader('Content-Disposition', buildAttachmentDisposition(artifact.fileName));
  res.send(artifact.buffer);
});

router.post('/render-png', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { svg, width } = req.body;
    if (!svg) {
      return res.status(400).json({ success: false, message: '缺少 SVG 内容' });
    }

    const { Resvg } = await import('@resvg/resvg-js');

    let processedSvg = await inlineRemoteImages(svg);
    processedSvg = sanitizeSvgForResvg(processedSvg);

    const renderWidth = (width || 1280) * 2;

    const resvg = new Resvg(processedSvg, {
      fitTo: { mode: 'width', value: renderWidth },
      font: { fontFiles: [], defaultFontFamily: 'sans-serif' },
    });

    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(pngBuffer);
  } catch (error) {
    console.error('Render PNG error:', error);
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : '渲染失败' });
  }
});

export default router;
