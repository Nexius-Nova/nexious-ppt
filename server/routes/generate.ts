import { Router, Response, Request } from 'express';
import { getDefaultApiKey } from '../models/apiKey.js';
import { decrypt } from '../utils/crypto.js';
import {
  buildStrategistPrompt,
  parseStrategistOutput,
  buildSpecLock,
  buildExecutorSystemPrompt,
  buildExecutorPagePrompt,
  cleanSvgOutput,
  ensureImageUsedInSvg
} from '../engine/index.js';
import { DEFAULT_FORBIDDEN, normalizeTypography } from '../engine/spec.js';
import type { StrategistInput, DesignSpec, SpecLock } from '../engine/index.js';
import { inlineRemoteImages, sanitizeSvgForResvg } from '../engine/svg-to-pptx.js';
import { exportWithNexiousPpt } from '../engine/ppt-exporter.js';
import { authMiddleware, AuthRequest } from './auth.js';
import { streamText, type Message } from '../services/textModel.js';
import {
  enqueueExportJob,
  enqueueGenerateJob,
  getExportArtifact,
  getQueuedJob,
  subscribeQueuedJob,
} from '../services/generationQueue.js';

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

function buildAttachmentDisposition(fileName: string): string {
  const safeName = fileName.trim() || `nexious-deck-${Date.now()}.pptx`;
  const asciiName = safeName
    .replace(/[^\x20-\x7E]+/g, '_')
    .replace(/["\\]/g, '_')
    .replace(/[;]+/g, '_')
    || `nexious-deck-${Date.now()}.pptx`;
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

router.post('/strategist', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const input: StrategistInput = req.body;

    const defaultKey = await getDefaultApiKey(req.userId!, 'text');
    if (!defaultKey) {
      return res.status(400).json({ success: false, message: '未配置文本模型' });
    }

    const apiKey = decrypt(defaultKey.api_key);
    const provider = defaultKey.provider;
    const baseUrl = defaultKey.base_url || '';
    const model = defaultKey.model || 'gpt-4o';

    const { system, user } = buildStrategistPrompt(input);
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

    const fullContent = await streamText(provider, apiKey, baseUrl, model, messages, res);

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
    const { spec, lock, slide, imageUrl } = req.body;

    const defaultKey = await getDefaultApiKey(req.userId!, 'text');
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
    const safeImageUrl = normalizeExecutorImageUrl(imageUrl);
    const systemPrompt = buildExecutorSystemPrompt(spec, effectiveLock);
    const userPrompt = buildExecutorPagePrompt(slide, spec, effectiveLock, safeImageUrl);

    const estimatedTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 3);
    console.log(`[Executor] Page ${slide.pageNumber}: systemPrompt=${systemPrompt.length}chars, userPrompt=${userPrompt.length}chars, ~${estimatedTokens}tokens`);

    if (estimatedTokens > 500000) {
      console.warn(`[Executor] Page ${slide.pageNumber}: prompt too large (~${estimatedTokens}tokens), using simplified prompt`);
      const simplifiedSystem = `你是PPT SVG执行器。画布: ${spec.canvas.width}x${spec.canvas.height}。颜色: primary=${lock.colors.primary}, accent=${lock.colors.accent}, bg=${lock.colors.background}, text=${lock.colors.text}, surface=${lock.colors.surface}, muted=${lock.colors.muted}。字体: ${spec.typography.titleFamily}。输出纯SVG代码，viewBox="0 0 ${spec.canvas.width} ${spec.canvas.height}"。禁止<style>,class,<foreignObject>,rgba()。`;
      const simplifiedUser = `生成第${slide.pageNumber}页SVG。标题: ${slide.title}。要点: ${slide.bullets.slice(0, 5).join(' | ')}。布局: ${slide.layout}。${safeImageUrl ? `必须使用图片：${safeImageUrl}，写入 <image href="${safeImageUrl}" x="..." y="..." width="..." height="..." preserveAspectRatio="xMidYMid slice"/>。` : ''}输出纯SVG：`;
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

    const svg = ensureImageUsedInSvg(cleanSvgOutput(fullContent), slide, spec, safeImageUrl);

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
    const { pages, spec, lock } = req.body;

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
      effectiveLock
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
    const { projectId, title, input, projectState, includeImages } = req.body || {};
    if (!projectId || !input || typeof input !== 'object') {
      return res.status(400).json({ success: false, message: '缺少生成任务参数' });
    }

    const job = await enqueueGenerateJob(req.userId!, {
      projectId: String(projectId),
      title: typeof title === 'string' ? title : undefined,
      input,
      projectState,
      includeImages,
    });

    res.status(202).json({ success: true, data: job });
  } catch (error) {
    console.error('Create generate job error:', error);
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : '创建生成任务失败' });
  }
});

router.post('/jobs/export-pptx', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId, title, pages, spec, lock } = req.body || {};
    if (!projectId || !spec || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ success: false, message: '缺少导出任务参数' });
    }

    const job = enqueueExportJob(req.userId!, {
      projectId: String(projectId),
      title: typeof title === 'string' ? title : undefined,
      pages: pages.map((page: any, index: number) => ({
        pageNumber: page.pageNumber || index + 1,
        svg: page.svg,
        speakerNotes: page.speakerNotes || '',
      })),
      spec,
      lock,
    });

    res.status(202).json({ success: true, data: job });
  } catch (error) {
    console.error('Create export job error:', error);
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : '创建导出任务失败' });
  }
});

router.get('/jobs/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const job = getQueuedJob(req.params.id, req.userId!);
  if (!job) {
    return res.status(404).json({ success: false, message: '任务不存在' });
  }
  res.json({ success: true, data: job });
});

router.get('/jobs/:id/events', authMiddleware, async (req: AuthRequest, res: Response) => {
  const ok = subscribeQueuedJob(req.params.id, req.userId!, res);
  if (!ok) {
    return res.status(404).json({ success: false, message: '任务不存在' });
  }
});

router.get('/jobs/:id/download', authMiddleware, async (req: AuthRequest, res: Response) => {
  const artifact = getExportArtifact(req.params.id, req.userId!);
  if (!artifact) {
    return res.status(404).json({ success: false, message: '导出文件不存在或尚未完成' });
  }
  res.setHeader('Content-Type', artifact.contentType);
  res.setHeader('Content-Disposition', buildAttachmentDisposition(artifact.fileName));
  res.send(artifact.buffer);
});

router.post('/render-png', async (req: Request, res: Response) => {
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
