import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { getDefaultApiKey } from '../models/apiKey.js';
import { updateProject } from '../models/project.js';
import { createGenerationJob, updateGenerationJob, type GenerationJobStatus } from '../models/generationJob.js';
import { decrypt } from '../utils/crypto.js';
import {
  buildExecutorPagePrompt,
  buildExecutorSystemPrompt,
  buildSpecLock,
  buildStrategistPrompt,
  cleanSvgOutput,
  ensureImageUsedInSvg,
  parseStrategistOutput,
} from '../engine/index.js';
import { streamText } from './textModel.js';
import { generateImage, persistDataImage } from '../routes/ai.js';
import { DEFAULT_FORBIDDEN, normalizeTypography } from '../engine/spec.js';
import type { DesignSpec, SpecLock, SpecSlide, StrategistInput } from '../engine/index.js';
import { exportWithNexiousPpt, type PptExportPage } from '../engine/ppt-exporter.js';

type QueuedJobKind = 'generate' | 'export';
type QueuedJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface QueuedJobSnapshot {
  id: string;
  kind: QueuedJobKind;
  dbJobId?: number;
  userId: number;
  projectId: string;
  title?: string;
  status: QueuedJobStatus;
  phase: string;
  progress: number;
  message?: string;
  errorMessage?: string;
  result?: any;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

interface GenerateJobPayload {
  projectId: string;
  title?: string;
  input: StrategistInput;
  projectState?: any;
  includeImages?: boolean;
}

interface ExportJobPayload {
  projectId: string;
  title?: string;
  pages: PptExportPage[];
  spec: DesignSpec;
  lock?: SpecLock;
}

interface QueuedJobBase {
  id: string;
  kind: QueuedJobKind;
  userId: number;
  projectId: string;
  title?: string;
  dbJobId?: number;
  status: QueuedJobStatus;
  phase: string;
  progress: number;
  message?: string;
  errorMessage?: string;
  result?: any;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

interface GenerateQueuedJob extends QueuedJobBase {
  kind: 'generate';
  payload: GenerateJobPayload;
}

interface ExportQueuedJob extends QueuedJobBase {
  kind: 'export';
  payload: ExportJobPayload;
}

type QueuedJob = GenerateQueuedJob | ExportQueuedJob;

const MAX_CONCURRENT_GENERATION_JOBS = Math.max(1, Number(process.env.GENERATION_QUEUE_CONCURRENCY || 1));
const MAX_CONCURRENT_EXPORT_JOBS = Math.max(1, Number(process.env.EXPORT_QUEUE_CONCURRENCY || 1));
const EXECUTOR_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.EXECUTOR_PAGE_CONCURRENCY || 3)));
const IMAGE_CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.IMAGE_GENERATION_CONCURRENCY || 3)));
const IMAGE_GENERATION_ATTEMPTS = 2;
const MAX_JOB_HISTORY = 300;

interface ImageModelConfig {
  apiKey: string;
  provider: string;
  model: string;
  baseUrl: string;
}

const jobs = new Map<string, QueuedJob>();
const queue: string[] = [];
const subscribers = new Map<string, Set<Response>>();
const exportArtifacts = new Map<string, { buffer: Buffer; fileName: string; contentType: string }>();
let activeGenerationJobs = 0;
let activeExportJobs = 0;

function snapshotJob(job: QueuedJob): QueuedJobSnapshot {
  const { payload: _payload, ...rest } = job as any;
  return { ...rest };
}

function rememberJob(job: QueuedJob) {
  jobs.set(job.id, job);
  if (jobs.size <= MAX_JOB_HISTORY) return;
  const removable = [...jobs.values()].find((item) => item.status !== 'running' && item.status !== 'queued');
  if (removable) {
    jobs.delete(removable.id);
    exportArtifacts.delete(removable.id);
  }
}

function publishJob(job: QueuedJob) {
  const payload = `data: ${JSON.stringify(snapshotJob(job))}\n\n`;
  const set = subscribers.get(job.id);
  if (!set) return;
  for (const res of set) {
    res.write(payload);
  }
}

async function updateJob(
  job: QueuedJob,
  patch: Partial<Pick<QueuedJob, 'status' | 'phase' | 'progress' | 'message' | 'errorMessage' | 'result' | 'completedAt'>>
) {
  Object.assign(job, patch, { updatedAt: Date.now() });
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    job.completedAt = job.completedAt || Date.now();
  }

  if (job.dbJobId) {
    const status = toGenerationJobStatus(job.status);
    await updateGenerationJob(job.dbJobId, job.userId, {
      status,
      phase: job.phase,
      progress: job.progress,
      errorMessage: job.errorMessage,
      metadata: {
        queueJobId: job.id,
        kind: job.kind,
        message: job.message,
        result: job.result,
      },
    }).catch((error) => console.warn('更新队列任务状态失败:', error));
  }

  publishJob(job);
}

function toGenerationJobStatus(status: QueuedJobStatus): GenerationJobStatus {
  if (status === 'completed' || status === 'failed' || status === 'cancelled') return status;
  return status === 'queued' ? 'queued' : 'running';
}

function enqueue(job: QueuedJob) {
  rememberJob(job);
  queue.push(job.id);
  publishJob(job);
  void drainQueue();
}

async function drainQueue() {
  for (const jobId of [...queue]) {
    const job = jobs.get(jobId);
    if (!job || job.status !== 'queued') {
      queue.splice(queue.indexOf(jobId), 1);
      continue;
    }
    if (job.kind === 'generate' && activeGenerationJobs >= MAX_CONCURRENT_GENERATION_JOBS) continue;
    if (job.kind === 'export' && activeExportJobs >= MAX_CONCURRENT_EXPORT_JOBS) continue;

    queue.splice(queue.indexOf(jobId), 1);
    if (job.kind === 'generate') activeGenerationJobs += 1;
    else activeExportJobs += 1;

    void runJob(job).finally(() => {
      if (job.kind === 'generate') activeGenerationJobs -= 1;
      else activeExportJobs -= 1;
      void drainQueue();
    });
  }
}

async function runJob(job: QueuedJob) {
  try {
    await updateJob(job, { status: 'running', phase: 'starting', progress: 1, message: '任务已开始' });
    if (job.kind === 'generate') {
      await runGenerateJob(job);
    } else {
      await runExportJob(job);
    }
  } catch (error) {
    await updateJob(job, {
      status: 'failed',
      phase: job.phase || 'failed',
      progress: job.progress,
      errorMessage: error instanceof Error ? error.message : '任务执行失败',
      message: '任务执行失败',
    });
  }
}

async function runGenerateJob(job: GenerateQueuedJob) {
  const { input } = job.payload;
  const defaultTextKey = await getDefaultApiKey(job.userId, 'text');
  if (!defaultTextKey) throw new Error('未配置文本模型');

  const textApiKey = decrypt(defaultTextKey.api_key);
  const textProvider = defaultTextKey.provider;
  const textBaseUrl = defaultTextKey.base_url || '';
  const textModel = defaultTextKey.model || 'gpt-4o';

  await updateJob(job, { phase: 'outline', progress: 8, message: '正在生成大纲' });
  const { system, user } = buildStrategistPrompt(input);
  const strategistOutput = await streamText(textProvider, textApiKey, textBaseUrl, textModel, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);
  const spec = parseStrategistOutput(strategistOutput, input);
  const lock = buildSpecLock(spec);
  await updateJob(job, {
    phase: 'outline',
    progress: 28,
    message: `大纲生成完成，共 ${spec.outline.length} 页`,
    result: { spec, lock, outline: spec.outline, images: [], svgPages: [] },
  });

  const images = await maybeGenerateImages(job, spec, lock);
  await updateJob(job, {
    phase: 'images',
    progress: 45,
    message: images.length ? `图片处理完成，共 ${images.filter((img) => img.url && !img.error).length} 张可用` : '本次无需图片',
    result: { spec, lock, outline: spec.outline, images, svgPages: [] },
  });

  const svgPages = await generateSvgPages(job, spec, lock, images, textProvider, textApiKey, textBaseUrl, textModel);
  const result = { spec, lock, outline: spec.outline, images, svgPages };
  await updateProject(Number(job.projectId), {
    status: 'completed',
    state: mergeProjectState(job.payload.projectState, result),
  }).catch((error) => console.warn('保存生成结果到项目失败:', error));

  await updateJob(job, {
    status: 'completed',
    phase: 'completed',
    progress: 100,
    message: 'PPT 生成完成',
    result,
  });
}

function slideNeedsImageServer(slide: SpecSlide) {
  return Boolean(slide.visualPrompt && ['cover', 'content-image'].includes(String(slide.layout || '')));
}

function imagePromptForSlide(slide: SpecSlide) {
  return slide.visualPrompt || [slide.title, ...(slide.bullets || [])].filter(Boolean).join('，');
}

function findReadyServerImage(images: any[], slideId: string) {
  return images.find((item) => item.slideId === slideId && item.selected && item.url && !item.error);
}

function findMissingRequiredImageSlides(spec: DesignSpec, images: any[]) {
  return spec.outline.filter((slide) => slideNeedsImageServer(slide) && !findReadyServerImage(images, slide.id));
}

function sortImagesByOutline(images: any[], spec: DesignSpec) {
  return images.sort((a, b) => spec.outline.findIndex((s) => s.id === a.slideId) - spec.outline.findIndex((s) => s.id === b.slideId));
}

function upsertServerImage(images: any[], image: any) {
  const existingIndex = images.findIndex((item) => item.slideId === image.slideId);
  if (existingIndex >= 0) {
    images[existingIndex] = image;
  } else {
    images.push(image);
  }
}

async function loadImageModelConfig(job: GenerateQueuedJob): Promise<ImageModelConfig> {
  const defaultImageKey = await getDefaultApiKey(job.userId, 'image');
  if (!defaultImageKey) {
    throw new Error('图像模型未配置，无法生成所需图片');
  }

  return {
    apiKey: decrypt(defaultImageKey.api_key),
    provider: defaultImageKey.provider,
    model: defaultImageKey.model || 'dall-e-3',
    baseUrl: defaultImageKey.base_url || '',
  };
}

async function generateSlideImageForQueue(
  job: GenerateQueuedJob,
  slide: SpecSlide,
  config: ImageModelConfig,
  attempt: number
) {
  const prompt = imagePromptForSlide(slide);
  const rawImageUrl = await generateImage(config.provider, config.apiKey, config.model, prompt, job.payload.input.imageStyle, config.baseUrl);
  const url = await persistDataImage(rawImageUrl, slide.id);

  return {
    id: `${slide.id}-image-1`,
    slideId: slide.id,
    title: slide.title,
    prompt,
    style: job.payload.input.imageStyle,
    url,
    selected: true,
    attempt,
  };
}

async function generateSlideImageWithAutoRetry(
  job: GenerateQueuedJob,
  slide: SpecSlide,
  config: ImageModelConfig,
  progress: number
) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= IMAGE_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      await updateJob(job, {
        phase: 'images',
        progress,
        message: attempt === 1 ? `正在生成图片：${slide.title}` : `正在自动重试图片：${slide.title}`,
      });
      return await generateSlideImageForQueue(job, slide, config, attempt);
    } catch (error) {
      lastError = error;
      if (attempt < IMAGE_GENERATION_ATTEMPTS) {
        await updateJob(job, {
          phase: 'images',
          progress,
          message: `图片生成失败，正在自动重试：${slide.title}`,
        });
      }
    }
  }

  return {
    id: `${slide.id}-image-1`,
    slideId: slide.id,
    title: slide.title,
    prompt: imagePromptForSlide(slide),
    style: job.payload.input.imageStyle,
    url: '',
    selected: true,
    error: true,
    errorMessage: lastError instanceof Error ? lastError.message : '图片生成失败',
  };
}

async function maybeGenerateImages(job: GenerateQueuedJob, spec: DesignSpec, lock: SpecLock) {
  if (job.payload.includeImages === false) return [];
  const slides = spec.outline.filter(slideNeedsImageServer);
  if (!slides.length) return [];

  const imageConfig = await loadImageModelConfig(job);
  const results: any[] = [];
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (cursor < slides.length) {
      const slide = slides[cursor++];
      const progress = 30 + Math.round((completed / Math.max(1, slides.length)) * 12);
      const image = await generateSlideImageWithAutoRetry(job, slide, imageConfig, progress);
      upsertServerImage(results, image);
      completed += 1;
    }
  }

  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, slides.length) }, () => worker()));
  const missingSlides = findMissingRequiredImageSlides(spec, results);
  if (missingSlides.length) {
    await updateJob(job, {
      phase: 'images',
      progress: 45,
      message: `图片自动重试后仍未完成：${missingSlides.map((slide) => slide.title).join('、')}`,
      result: { spec, lock, outline: spec.outline, images: sortImagesByOutline(results, spec), svgPages: [] },
    });
    throw new Error(`图片自动重试后仍未完成：${missingSlides.map((slide) => slide.title).join('、')}。请手动重试图片后再继续。`);
  }
  return sortImagesByOutline(results, spec);
}

async function ensureRequiredImagesBeforeLayout(job: GenerateQueuedJob, spec: DesignSpec, lock: SpecLock, images: any[]) {
  if (job.payload.includeImages === false) return;

  let missingSlides = findMissingRequiredImageSlides(spec, images);
  if (!missingSlides.length) return;

  const imageConfig = await loadImageModelConfig(job);
  for (const slide of missingSlides) {
    await updateJob(job, {
      phase: 'images',
      progress: 45,
      message: `第 ${slide.pageNumber} 页缺少可用图片，正在自动重试：${slide.title}`,
      result: { spec, lock, outline: spec.outline, images, svgPages: [] },
    });
    const image = await generateSlideImageWithAutoRetry(job, slide, imageConfig, 45);
    upsertServerImage(images, image);
  }

  missingSlides = findMissingRequiredImageSlides(spec, images);
  if (missingSlides.length) {
    await updateJob(job, {
      phase: 'images',
      progress: 45,
      message: `图片自动重试后仍未完成：${missingSlides.map((slide) => slide.title).join('、')}`,
      result: { spec, lock, outline: spec.outline, images: sortImagesByOutline(images, spec), svgPages: [] },
    });
    throw new Error(`图片自动重试后仍未完成：${missingSlides.map((slide) => slide.title).join('、')}。请手动重试图片后再继续。`);
  }
}

async function ensureServerImageForLayout(
  job: GenerateQueuedJob,
  spec: DesignSpec,
  lock: SpecLock,
  slide: SpecSlide,
  images: any[],
  pages: Array<{ pageNumber: number; svg: string; speakerNotes: string }>
) {
  if (job.payload.includeImages === false || !slideNeedsImageServer(slide)) {
    return undefined;
  }

  const existingImage = findReadyServerImage(images, slide.id);
  if (existingImage) return existingImage;

  const imageConfig = await loadImageModelConfig(job);
  await updateJob(job, {
    phase: 'images',
    progress: 45,
    message: `第 ${slide.pageNumber} 页缺少可用图片，正在自动重试：${slide.title}`,
    result: { spec, lock, outline: spec.outline, images: sortImagesByOutline(images, spec), svgPages: pages.slice().sort((a, b) => a.pageNumber - b.pageNumber) },
  });

  const retryImage = await generateSlideImageWithAutoRetry(job, slide, imageConfig, 45);
  upsertServerImage(images, retryImage);
  const readyImage = findReadyServerImage(images, slide.id);
  if (readyImage) return readyImage;

  await updateJob(job, {
    phase: 'images',
    progress: 45,
    message: `第 ${slide.pageNumber} 页图片自动重试后仍未完成：${slide.title}`,
    result: { spec, lock, outline: spec.outline, images: sortImagesByOutline(images, spec), svgPages: pages.slice().sort((a, b) => a.pageNumber - b.pageNumber) },
  });
  throw new Error(`第 ${slide.pageNumber} 页需要图片，但图片自动重试后仍未生成：${slide.title}`);
}

async function generateSvgPages(
  job: GenerateQueuedJob,
  spec: DesignSpec,
  lock: SpecLock,
  images: any[],
  provider: string,
  apiKey: string,
  baseUrl: string,
  model: string
) {
  const pages: Array<{ pageNumber: number; svg: string; speakerNotes: string }> = [];
  let cursor = 0;
  let completed = 0;

  await ensureRequiredImagesBeforeLayout(job, spec, lock, images);

  async function worker() {
    while (cursor < spec.outline.length) {
      const slide = spec.outline[cursor++];
      await updateJob(job, {
        phase: 'layout',
        progress: 50 + Math.round((completed / Math.max(1, spec.outline.length)) * 45),
        message: `正在生成第 ${slide.pageNumber} 页：${slide.title}`,
      });

      const image = await ensureServerImageForLayout(job, spec, lock, slide, images, pages);
      const svg = await generatePageSvg(spec, lock, slide, image?.url, provider, apiKey, baseUrl, model);
      pages.push({ pageNumber: slide.pageNumber, svg, speakerNotes: slide.speakerNotes || '' });
      completed += 1;
      await updateJob(job, {
        phase: 'layout',
        progress: 50 + Math.round((completed / Math.max(1, spec.outline.length)) * 45),
        message: `第 ${slide.pageNumber} 页生成完成`,
        result: { spec, lock, outline: spec.outline, images, svgPages: pages.slice().sort((a, b) => a.pageNumber - b.pageNumber) },
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(EXECUTOR_CONCURRENCY, spec.outline.length) }, () => worker()));
  return pages.sort((a, b) => a.pageNumber - b.pageNumber);
}

async function generatePageSvg(
  spec: DesignSpec,
  lock: SpecLock,
  slide: SpecSlide,
  imageUrl: string | undefined,
  provider: string,
  apiKey: string,
  baseUrl: string,
  model: string
) {
  const pageKey = `P${String(slide.pageNumber).padStart(2, '0')}`;
  const slimSpec = {
    projectInfo: spec.projectInfo,
    canvas: spec.canvas,
    visualTheme: spec.visualTheme,
    typography: spec.typography,
    iconStyle: spec.iconStyle,
    imageUsage: spec.imageUsage,
    outline: [],
    skillExtensions: [],
  } as any;
  const slimLock = {
    colors: lock.colors,
    typography: normalizeTypography(lock.typography || spec.typography),
    iconStyle: lock.iconStyle,
    imageStyle: lock.imageStyle,
    canvas: lock.canvas,
    pageRhythm: { [pageKey]: lock.pageRhythm[pageKey] },
    pageLayouts: { [pageKey]: lock.pageLayouts[pageKey] },
    pageCharts: lock.pageCharts[pageKey] ? { [pageKey]: lock.pageCharts[pageKey] } : {},
    skillExtensions: [],
    forbidden: (lock as any).forbidden || DEFAULT_FORBIDDEN,
  } as any;

  const systemPrompt = buildExecutorSystemPrompt(slimSpec, slimLock);
  const userPrompt = buildExecutorPagePrompt(slide, slimSpec, slimLock, imageUrl);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const output = await streamText(provider, apiKey, baseUrl, model, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);
      const svg = ensureImageUsedInSvg(cleanSvgOutput(output), slide, spec, imageUrl);
      if (!svg || !svg.includes('<svg') || !svg.includes('</svg>')) {
        throw new Error('AI 返回的 SVG 内容不完整');
      }
      return svg;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('页面 SVG 生成失败');
}

async function runExportJob(job: ExportQueuedJob) {
  if (!job.payload.pages.length) throw new Error('没有可导出的页面');
  await updateJob(job, { phase: 'exporting', progress: 20, message: '正在导出 PPTX' });
  const lock = job.payload.lock || buildSpecLock(job.payload.spec);
  const result = await exportWithNexiousPpt(job.payload.pages, job.payload.spec, lock);
  exportArtifacts.set(job.id, {
    buffer: result.buffer,
    fileName: result.fileName,
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
  await updateJob(job, {
    status: 'completed',
    phase: 'completed',
    progress: 100,
    message: 'PPTX 导出完成',
    result: {
      fileName: result.fileName,
      downloadUrl: `/api/generate/jobs/${job.id}/download`,
      logs: result.logs,
    },
  });
}

function mergeProjectState(base: any, result: { spec: DesignSpec; lock: SpecLock; outline: SpecSlide[]; images: any[]; svgPages: any[] }) {
  return {
    ...(base || {}),
    outline: result.outline.map((slide) => ({
      id: slide.id,
      title: slide.title,
      bullets: slide.bullets,
      speakerNotes: slide.speakerNotes,
      visualPrompt: slide.visualPrompt,
      chartHint: slide.chartHint,
      layout: slide.layout,
    })),
    images: result.images,
    designSpec: result.spec,
    specLock: result.lock,
    svgPages: result.svgPages,
    workflowActive: false,
    paused: false,
    resumeStage: null,
    waitingForImageRetry: false,
  };
}

export async function enqueueGenerateJob(userId: number, payload: GenerateJobPayload) {
  const dbJobId = await createGenerationJob({
    userId,
    projectId: payload.projectId,
    title: payload.title,
    metadata: { kind: 'generate', queuedAt: new Date().toISOString() },
  });
  const job: GenerateQueuedJob = {
    id: randomUUID(),
    kind: 'generate',
    userId,
    projectId: payload.projectId,
    title: payload.title,
    dbJobId,
    status: 'queued',
    phase: 'queued',
    progress: 0,
    message: '任务已排队',
    payload,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  enqueue(job);
  await updateJob(job, { status: 'queued', phase: 'queued', progress: 0, message: '任务已排队' });
  return snapshotJob(job);
}

export function enqueueExportJob(userId: number, payload: ExportJobPayload) {
  const job: ExportQueuedJob = {
    id: randomUUID(),
    kind: 'export',
    userId,
    projectId: payload.projectId,
    title: payload.title,
    status: 'queued',
    phase: 'queued',
    progress: 0,
    message: '导出任务已排队',
    payload,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  enqueue(job);
  return snapshotJob(job);
}

export function getQueuedJob(id: string, userId: number) {
  const job = jobs.get(id);
  if (!job || job.userId !== userId) return null;
  return snapshotJob(job);
}

export function getExportArtifact(id: string, userId: number) {
  const job = jobs.get(id);
  if (!job || job.userId !== userId || job.kind !== 'export' || job.status !== 'completed') return null;
  return exportArtifacts.get(id) || null;
}

export function subscribeQueuedJob(id: string, userId: number, res: Response) {
  const job = jobs.get(id);
  if (!job || job.userId !== userId) return false;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.write(`data: ${JSON.stringify(snapshotJob(job))}\n\n`);

  const set = subscribers.get(id) || new Set<Response>();
  set.add(res);
  subscribers.set(id, set);
  res.on('close', () => {
    set.delete(res);
    if (set.size === 0) subscribers.delete(id);
  });
  return true;
}
