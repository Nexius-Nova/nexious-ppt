import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import type { Response } from 'express';
import { Queue, Worker, type Job as BullJob } from 'bullmq';
import { Redis } from 'ioredis';
import { getProjectByIdForUser, updateProjectForUser } from '../models/project.js';
import { createGenerationJob, updateGenerationJob, type GenerationJobStatus } from '../models/generationJob.js';
import { decrypt } from '../utils/crypto.js';
import { resolveGenerationApiKey } from './modelSelection.js';
import {
  buildExecutorPagePrompt,
  buildExecutorSystemPrompt,
  buildSpecLock,
  buildStrategistPrompt,
  buildSvgQualityPatchPrompt,
  buildSvgQualityRepairPrompt,
  cleanSvgOutput,
  ensureImageUsedInSvg,
  finalizeSvgQuality,
  parseStrategistOutput,
  summarizeSvgQualityIssues,
} from '../engine/index.js';
import { streamText } from './textModel.js';
import { generateImage, persistDataImage } from '../routes/ai.js';
import { DEFAULT_FORBIDDEN, normalizeTypography } from '../engine/spec.js';
import type { DesignSpec, SpecLock, SpecSlide, StrategistInput } from '../engine/index.js';
import { buildSlideImagePrompt } from '../engine/imageComposition.js';
import { exportWithNexiousPpt, type PptExportOptions, type PptExportPage } from '../engine/ppt-exporter.js';
import { generatedExportsRoot, generatedImagesRoot, publicBaseUrl } from '../utils/storage.js';
import { endStream, guardStreamResponse, writeSseData, writeStream } from '../utils/sse.js';
import { deriveWorkflowTransition, workflowStepProgress, workflowStepStatus } from './workflowStateMachine.js';
import {
  getChartCatalog,
  getChartSvg,
  getIconGuide,
} from './pptEnhancements.js';

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
  logMessage?: string;
  errorMessage?: string;
  result?: any;
  projectState?: any;
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
  resumeStage?: 'outline' | 'images' | 'layout';
}

interface ExportJobPayload {
  projectId: string;
  title?: string;
  pages: PptExportPage[];
  spec: DesignSpec;
  lock?: SpecLock;
  exportOptions?: PptExportOptions;
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
  logMessage?: string;
  errorMessage?: string;
  result?: any;
  cancelRequested?: boolean;
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

const DEFAULT_GENERATION_QUEUE_CONCURRENCY = 3;
const DEFAULT_EXPORT_QUEUE_CONCURRENCY = 2;
const MAX_CONCURRENT_GENERATION_JOBS = Math.max(1, Number(process.env.GENERATION_QUEUE_CONCURRENCY || DEFAULT_GENERATION_QUEUE_CONCURRENCY));
const MAX_CONCURRENT_EXPORT_JOBS = Math.max(1, Number(process.env.EXPORT_QUEUE_CONCURRENCY || DEFAULT_EXPORT_QUEUE_CONCURRENCY));
const EXECUTOR_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.EXECUTOR_PAGE_CONCURRENCY || 3)));
const IMAGE_CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.IMAGE_GENERATION_CONCURRENCY || 3)));
const IMAGE_GENERATION_ATTEMPTS = 2;
const MAX_JOB_HISTORY = 300;
const OUTLINE_JOB_UPDATE_INTERVAL_MS = 140;
const PROJECT_STATE_QUEUE_SYNC_INTERVAL_MS = 700;

interface ImageModelConfig {
  apiKey: string;
  provider: string;
  model: string;
  baseUrl: string;
}

interface ServerImage {
  id: string;
  slideId: string;
  assetId?: string;
  title: string;
  prompt: string;
  purpose?: string;
  style: string;
  url: string;
  selected: boolean;
  attempt?: number;
  error?: boolean;
  errorMessage?: string;
  metadata?: ImageMetadata;
}

interface ImageMetadata {
  width?: number;
  height?: number;
  contentType?: string;
  bytes?: number;
  checkedAt: number;
  ok: boolean;
  error?: string;
  proxyUrl?: string;
}

interface ServerSvgPage {
  pageNumber: number;
  svg: string;
  speakerNotes: string;
  visualSummary?: string;
  signature?: string;
  sourceHash?: string;
  generatedAt?: number;
  quality?: {
    repaired?: boolean;
    issues?: number;
    blockingIssues?: number;
    attempts?: number;
    reused?: boolean;
  };
}

const jobs = new Map<string, QueuedJob>();
const queue: string[] = [];
const subscribers = new Map<string, Set<Response>>();
const exportArtifacts = new Map<string, { buffer?: Buffer; filePath?: string; fileName: string; contentType: string }>();
const imageMetadataCache = new Map<string, Promise<ImageMetadata> | ImageMetadata>();
let activeGenerationJobs = 0;
let activeExportJobs = 0;

const QUEUE_DRIVER = String(process.env.QUEUE_DRIVER || '').toLowerCase();
const REDIS_URL = process.env.REDIS_URL || process.env.BULLMQ_REDIS_URL || '';
const USE_REDIS_QUEUE = Boolean(REDIS_URL) && QUEUE_DRIVER !== 'memory';
const REQUIRE_REDIS_QUEUE = process.env.NODE_ENV === 'production' && QUEUE_DRIVER !== 'memory';
const REDIS_KEY_PREFIX = process.env.REDIS_QUEUE_PREFIX || 'nexious:ppt';
const REDIS_SNAPSHOT_TTL_SECONDS = Math.max(3600, Number(process.env.QUEUE_SNAPSHOT_TTL_SECONDS || 60 * 60 * 24));
const REDIS_RECOMMENDED_VERSION = '6.2.0';
const REDIS_STRICT_PRECHECK = ['1', 'true', 'yes'].includes(String(process.env.REDIS_QUEUE_STRICT || '').toLowerCase());
const REDIS_QUEUE_DIAGNOSTICS = ['1', 'true', 'yes'].includes(String(process.env.REDIS_QUEUE_DIAGNOSTICS || '').toLowerCase());
const EXPORT_DIR = generatedExportsRoot;

let redisConnection: Redis | null = null;
let generateQueue: Queue | null = null;
let exportQueue: Queue | null = null;
let generateWorker: Worker | null = null;
let exportWorker: Worker | null = null;
let redisQueueReady = false;
let redisQueueInitPromise: Promise<boolean> | null = null;
let redisQueuePrecheckFailed = false;
let redisQueuePrecheckRetryAt = 0;
let redisQueuePrecheckWarningLogged = false;
const redisConnectionWarningAt = new Map<string, number>();
const activeRedisJobs = new Map<string, QueuedJob>();
const projectStateQueueSyncAt = new Map<string, number>();

function stableJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (input === null || input === undefined) return input ?? null;
    if (typeof input !== 'object') return input;
    if (seen.has(input as object)) return '[Circular]';
    seen.add(input as object);
    if (Array.isArray(input)) return input.map((item) => normalize(item));
    const source = input as Record<string, unknown>;
    const ignoredKeys = new Set(['apiKey', 'key', 'secret', 'createdAt', 'updatedAt', 'generatedAt', 'attempt', 'errorMessage']);
    return Object.keys(source)
      .filter((key) => !ignoredKeys.has(key))
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        const next = normalize(source[key]);
        if (next !== undefined) acc[key] = next;
        return acc;
      }, {});
  };
  return JSON.stringify(normalize(value));
}

function hashValue(value: unknown) {
  return createHash('sha256').update(stableJson(value)).digest('hex').slice(0, 32);
}

function pageKeyForSlide(slide: SpecSlide) {
  return `P${String(slide.pageNumber).padStart(2, '0')}`;
}

function modelSignature(provider: string, baseUrl: string, model: string) {
  return {
    provider: String(provider || ''),
    baseUrl: String(baseUrl || '').replace(/\/+$/, ''),
    model: String(model || ''),
  };
}

function slideSignature(input: {
  job: GenerateQueuedJob;
  spec: DesignSpec;
  lock: SpecLock;
  slide: SpecSlide;
  slideImages: any[];
  provider: string;
  baseUrl: string;
  model: string;
}) {
  const { job, spec, lock, slide, slideImages, provider, baseUrl, model } = input;
  const pageKey = pageKeyForSlide(slide);
  return hashValue({
    slide: {
      id: slide.id,
      pageNumber: slide.pageNumber,
      title: slide.title,
      bullets: slide.bullets,
      speakerNotes: slide.speakerNotes,
      visualPrompt: slide.visualPrompt,
      imagePlan: slide.imagePlan,
      chartHint: slide.chartHint,
      layout: slide.layout,
      layoutParams: (slide as any).layoutParams,
    },
    lock: {
      colors: lock.colors,
      typography: lock.typography,
      iconStyle: lock.iconStyle,
      imageStyle: lock.imageStyle,
      canvas: lock.canvas,
      pageRhythm: lock.pageRhythm?.[pageKey],
      pageLayouts: lock.pageLayouts?.[pageKey],
      pageCharts: lock.pageCharts?.[pageKey],
      forbidden: (lock as any).forbidden,
    },
    project: {
      canvas: spec.canvas,
      visualTheme: spec.visualTheme,
      typography: spec.typography,
      iconStyle: spec.iconStyle,
      imageUsage: spec.imageUsage,
      projectInfo: spec.projectInfo,
      skillExtensions: spec.skillExtensions,
    },
    images: slideImages
      .filter((image) => image?.url && image.selected !== false && !image.error)
      .map((image) => ({
        id: image.id,
        slideId: image.slideId,
        assetId: image.assetId,
        url: image.url,
        prompt: image.prompt,
        purpose: image.purpose,
        style: image.style,
        metadata: image.metadata ? {
          width: image.metadata.width,
          height: image.metadata.height,
          contentType: image.metadata.contentType,
          bytes: image.metadata.bytes,
          ok: image.metadata.ok,
          proxyUrl: image.metadata.proxyUrl,
        } : null,
      })),
    context: {
      templateAsset: job.payload.input.templateAsset,
      template: job.payload.input.template,
      prompt: (job.payload.input as any).prompt,
      promptId: (job.payload.input as any).promptId,
      skills: (job.payload.input as any).skills,
      textModelId: job.payload.input.textModelId,
      imageModelId: job.payload.input.imageModelId,
      model: modelSignature(provider, baseUrl, model),
    },
  });
}

function parsePngSize(buffer: Buffer) {
  if (buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), contentType: 'image/png' };
}

function parseJpegSize(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7), contentType: 'image/jpeg' };
    }
    offset += 2 + length;
  }
  return null;
}

function parseImageSize(buffer: Buffer) {
  return parsePngSize(buffer) || parseJpegSize(buffer);
}

function localGeneratedImagePath(rawUrl: string) {
  const value = String(rawUrl || '').trim();
  if (!value) return null;
  const publicRoot = publicBaseUrl();
  const pathname = (() => {
    if (value.startsWith('/generated-images/')) return value;
    try {
      const url = new URL(value);
      const publicUrl = new URL(publicRoot);
      if (url.origin === publicUrl.origin && url.pathname.startsWith('/generated-images/')) return url.pathname;
    } catch {
      return null;
    }
    return null;
  })();
  if (!pathname) return null;
  const relative = decodeURIComponent(pathname.replace(/^\/generated-images\/?/, ''));
  const resolved = path.resolve(generatedImagesRoot, relative);
  const root = path.resolve(generatedImagesRoot);
  return resolved.startsWith(root) ? resolved : null;
}

async function readLocalImageMetadata(url: string): Promise<ImageMetadata | null> {
  const filePath = localGeneratedImagePath(url);
  if (!filePath) return null;
  const [fileStat, buffer] = await Promise.all([
    stat(filePath),
    readFile(filePath).catch(() => Buffer.alloc(0)),
  ]);
  const size = buffer.length ? parseImageSize(buffer) : null;
  return {
    width: size?.width,
    height: size?.height,
    contentType: size?.contentType,
    bytes: fileStat.size,
    checkedAt: Date.now(),
    ok: true,
    proxyUrl: url,
  };
}

async function readRemoteImageMetadata(url: string): Promise<ImageMetadata> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(url, { method: 'HEAD', signal: controller.signal });
    return {
      contentType: response.headers.get('content-type') || undefined,
      bytes: Number(response.headers.get('content-length')) || undefined,
      checkedAt: Date.now(),
      ok: response.ok,
      error: response.ok ? undefined : `HTTP ${response.status}`,
      proxyUrl: url,
    };
  } catch (error) {
    return {
      checkedAt: Date.now(),
      ok: false,
      error: error instanceof Error ? error.message : '图片探测失败',
      proxyUrl: url,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function getImageMetadata(url: string): Promise<ImageMetadata> {
  const key = String(url || '').trim();
  if (!key) return { checkedAt: Date.now(), ok: false, error: '图片 URL 为空' };
  const cached = imageMetadataCache.get(key);
  if (cached) return cached;
  const promise = (async () => {
    try {
      return await readLocalImageMetadata(key) || await readRemoteImageMetadata(key);
    } catch (error) {
      return {
        checkedAt: Date.now(),
        ok: false,
        error: error instanceof Error ? error.message : '图片元数据读取失败',
        proxyUrl: key,
      };
    }
  })();
  imageMetadataCache.set(key, promise);
  const metadata = await promise;
  imageMetadataCache.set(key, metadata);
  return metadata;
}

async function preloadImageMetadata(images: any[]) {
  const targets = images.filter((image) => image?.url && !image.error);
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const image = targets[cursor++];
      image.metadata = image.metadata?.ok ? image.metadata : await getImageMetadata(image.url);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, targets.length) }, () => worker()));
  return images;
}

function redisRetryStrategy(times: number) {
  return Math.min(Math.max(times, 1) * 500, 5000);
}

function formatRedisError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || error);
  }
  return String(error);
}

function logRedisWarning(label: string, error: unknown, intervalMs = 30 * 1000) {
  const now = Date.now();
  const lastAt = redisConnectionWarningAt.get(label) || 0;
  if (now - lastAt < intervalMs) return;
  redisConnectionWarningAt.set(label, now);
  console.warn(`${label}不可用：${formatRedisError(error)}`);
}

function attachRedisConnectionLogger(client: Redis, label: string) {
  client.on('error', (error) => {
    logRedisWarning(label, error);
  });
  client.on('ready', () => {
    redisConnectionWarningAt.delete(label);
  });
  return client;
}

type ErrorEventTarget = { on(event: 'error', listener: (error: Error) => void): unknown };

function attachBullMqErrorLogger(target: ErrorEventTarget, label: string) {
  target.on('error', (error) => {
    logRedisWarning(label, error);
  });
}

function redisSnapshotKey(id: string) {
  return `${REDIS_KEY_PREFIX}:queue:snapshot:${id}`;
}

function redisCancelKey(id: string) {
  return `${REDIS_KEY_PREFIX}:queue:cancel:${id}`;
}

function redisChannel(id: string) {
  return `${REDIS_KEY_PREFIX}:queue:events:${id}`;
}

function redisProjectJobsKey(userId: number, projectId: string) {
  return `${REDIS_KEY_PREFIX}:queue:project:${userId}:${projectId}:jobs`;
}

function bullQueueName(kind: QueuedJobKind) {
  return kind === 'generate' ? 'generation' : 'export';
}

function exportArtifactPath(userId: number, projectId: string, jobId: string) {
  return path.join(EXPORT_DIR, `${userId}-${projectId}-${jobId}.pptx`);
}

function bullQueueForKind(kind: QueuedJobKind) {
  return kind === 'generate' ? generateQueue : exportQueue;
}

function shouldUseRedisQueue() {
  return Boolean(USE_REDIS_QUEUE && redisQueueReady && redisConnection && generateQueue && exportQueue);
}

function createRedisConnection(label = 'Redis 队列连接') {
  return attachRedisConnectionLogger(new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 5000,
    retryStrategy: redisRetryStrategy,
  }), label);
}

function createBullRedisOptions() {
  return {
    url: REDIS_URL,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 5000,
    retryStrategy: redisRetryStrategy,
  };
}

function compareRedisVersions(current: string, minimum: string) {
  const currentParts = current.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const minimumParts = minimum.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(currentParts.length, minimumParts.length);
  for (let index = 0; index < length; index += 1) {
    const currentPart = currentParts[index] || 0;
    const minimumPart = minimumParts[index] || 0;
    if (currentPart > minimumPart) return 1;
    if (currentPart < minimumPart) return -1;
  }
  return 0;
}

function parseRedisInfo(info: string) {
  const result: { version?: string; maxmemoryPolicy?: string } = {};
  for (const line of info.split(/\r?\n/)) {
    if (line.startsWith('redis_version:')) {
      result.version = line.slice('redis_version:'.length).trim();
    } else if (line.startsWith('maxmemory_policy:')) {
      result.maxmemoryPolicy = line.slice('maxmemory_policy:'.length).trim();
    }
  }
  return result;
}

async function precheckRedisQueue() {
  if (redisQueuePrecheckFailed && Date.now() < redisQueuePrecheckRetryAt) return false;
  redisQueuePrecheckFailed = false;
  redisQueuePrecheckRetryAt = 0;

  const probe = createRedisConnection('Redis 队列预检连接');
  try {
    await probe.ping();
    const info = parseRedisInfo(await probe.info());
    const warnings: string[] = [];

    if (info.version && compareRedisVersions(info.version, REDIS_RECOMMENDED_VERSION) < 0) {
      warnings.push(`当前 Redis 版本为 ${info.version}，BullMQ 推荐使用 ${REDIS_RECOMMENDED_VERSION} 或更高版本`);
    }

    if (info.maxmemoryPolicy && info.maxmemoryPolicy !== 'noeviction') {
      warnings.push(`当前 Redis maxmemory-policy 为 ${info.maxmemoryPolicy}，BullMQ 推荐设置为 noeviction`);
    }

    if (warnings.length) {
      const message = `${warnings.join('；')}。`;
      if (REDIS_STRICT_PRECHECK) {
        redisQueuePrecheckFailed = true;
        redisQueuePrecheckRetryAt = Date.now() + 60 * 1000;
        if (REQUIRE_REDIS_QUEUE) {
          throw new Error(`${message}生产环境必须使用 Redis ${REDIS_RECOMMENDED_VERSION}+ 且 maxmemory-policy=noeviction。`);
        }
        if (!redisQueuePrecheckWarningLogged) {
          redisQueuePrecheckWarningLogged = true;
          console.warn(`${message}已按 REDIS_QUEUE_STRICT=true 降级到内存队列。`);
        }
        return false;
      }
      if (REDIS_QUEUE_DIAGNOSTICS && !redisQueuePrecheckWarningLogged) {
        redisQueuePrecheckWarningLogged = true;
        console.info(`${message}队列已启用兼容模式，建议尽快调整 Redis 配置。`);
      }
    }

    return true;
  } catch (error) {
    redisQueuePrecheckFailed = true;
    redisQueuePrecheckRetryAt = Date.now() + 30 * 1000;
    if (REQUIRE_REDIS_QUEUE) {
      throw error instanceof Error
        ? error
        : new Error('生产环境 Redis 队列预检失败');
    }
    logRedisWarning('Redis 队列预检失败，已降级到内存队列，30 秒后会自动重试。', error);
    return false;
  } finally {
    await probe.quit().catch(() => probe.disconnect());
  }
}

async function persistRedisSnapshot(job: QueuedJob) {
  if (!redisConnection || !redisQueueReady) return;
  await redisConnection.set(redisSnapshotKey(job.id), JSON.stringify(snapshotJob(job)), 'EX', REDIS_SNAPSHOT_TTL_SECONDS);
}

async function publishRedisJob(job: QueuedJob) {
  if (!redisConnection || !redisQueueReady) return;
  await redisConnection.publish(redisChannel(job.id), JSON.stringify(snapshotJob(job)));
}

async function indexRedisProjectJob(job: QueuedJob) {
  if (!redisConnection || !redisQueueReady) return;
  const key = redisProjectJobsKey(job.userId, job.projectId);
  await redisConnection.sadd(key, job.id);
  await redisConnection.expire(key, REDIS_SNAPSHOT_TTL_SECONDS);
}

async function readRedisSnapshot(id: string): Promise<QueuedJobSnapshot | null> {
  if (!redisConnection || !redisQueueReady) return null;
  const raw = await redisConnection.get(redisSnapshotKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as QueuedJobSnapshot;
  } catch {
    return null;
  }
}

async function markRedisJobCancelled(id: string) {
  if (!redisConnection || !redisQueueReady) return;
  await redisConnection.set(redisCancelKey(id), '1', 'EX', REDIS_SNAPSHOT_TTL_SECONDS);
}

async function clearRedisCancel(id: string) {
  if (!redisConnection || !redisQueueReady) return;
  await redisConnection.del(redisCancelKey(id));
}

async function isRedisJobCancelled(id: string) {
  if (!redisConnection || !redisQueueReady) return false;
  return Boolean(await redisConnection.exists(redisCancelKey(id)));
}

async function ensureRedisQueueReady() {
  if (!USE_REDIS_QUEUE) {
    if (REQUIRE_REDIS_QUEUE) {
      throw new Error('生产环境必须配置 REDIS_URL 并启用 Redis 队列，或显式设置 QUEUE_DRIVER=memory 才允许使用内存队列。');
    }
    return false;
  }
  if (redisQueueReady) return true;
  if (redisQueuePrecheckFailed) {
    if (REQUIRE_REDIS_QUEUE) {
      throw new Error('生产环境 Redis 队列预检失败，已阻止任务入队。');
    }
    return false;
  }
  if (redisQueueInitPromise) return redisQueueInitPromise;

  redisQueueInitPromise = initializeRedisQueue().finally(() => {
    redisQueueInitPromise = null;
  });
  return redisQueueInitPromise;
}

async function initializeRedisQueue() {
  try {
    if (!await precheckRedisQueue()) return false;

    redisConnection = createRedisConnection('Redis 队列主连接');

    generateQueue = new Queue(bullQueueName('generate'), {
      connection: createBullRedisOptions(),
      prefix: REDIS_KEY_PREFIX,
      skipVersionCheck: true,
    });
    exportQueue = new Queue(bullQueueName('export'), {
      connection: createBullRedisOptions(),
      prefix: REDIS_KEY_PREFIX,
      skipVersionCheck: true,
    });
    attachBullMqErrorLogger(generateQueue, 'BullMQ 生成队列');
    attachBullMqErrorLogger(exportQueue, 'BullMQ 导出队列');

    generateWorker = new Worker(
      bullQueueName('generate'),
      async (bullJob: BullJob<{ job: GenerateQueuedJob }>) => {
        const job = bullJob.data.job;
        activeRedisJobs.set(job.id, job);
        jobs.set(job.id, job);
        try {
          await runJob(job);
        } finally {
          activeRedisJobs.delete(job.id);
        }
      },
      {
        connection: createBullRedisOptions(),
        prefix: REDIS_KEY_PREFIX,
        concurrency: MAX_CONCURRENT_GENERATION_JOBS,
        skipVersionCheck: true,
      }
    );

    exportWorker = new Worker(
      bullQueueName('export'),
      async (bullJob: BullJob<{ job: ExportQueuedJob }>) => {
        const job = bullJob.data.job;
        activeRedisJobs.set(job.id, job);
        jobs.set(job.id, job);
        try {
          await runJob(job);
        } finally {
          activeRedisJobs.delete(job.id);
        }
      },
      {
        connection: createBullRedisOptions(),
        prefix: REDIS_KEY_PREFIX,
        concurrency: MAX_CONCURRENT_EXPORT_JOBS,
        skipVersionCheck: true,
      }
    );

    attachBullMqErrorLogger(generateWorker, 'BullMQ 生成 worker');
    attachBullMqErrorLogger(exportWorker, 'BullMQ 导出 worker');

    await redisConnection.ping();
    redisQueueReady = true;
    console.log('Redis/BullMQ queue enabled for PPT workflows');
    return true;
  } catch (error) {
    redisQueueReady = false;
    if (REQUIRE_REDIS_QUEUE) {
      await shutdownRedisQueue().catch(() => {});
      throw error instanceof Error
        ? error
        : new Error('生产环境 Redis 队列初始化失败');
    }
    logRedisWarning('Redis 队列不可用，已回退到内存队列。', error);
    await shutdownRedisQueue().catch(() => {});
    return false;
  }
}

export async function shutdownRedisQueue() {
  redisQueueReady = false;
  await Promise.allSettled([
    generateWorker?.close(),
    exportWorker?.close(),
    generateQueue?.close(),
    exportQueue?.close(),
    redisConnection?.quit(),
  ]);
  generateWorker = null;
  exportWorker = null;
  generateQueue = null;
  exportQueue = null;
  redisConnection = null;
}

function parseOwnedProjectId(projectId: string): number {
  const id = Number(projectId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('项目不存在或无权访问');
  }
  return id;
}

async function assertProjectOwnedByUser(userId: number, projectId: string) {
  const id = parseOwnedProjectId(projectId);
  const project = await getProjectByIdForUser(id, userId);
  if (!project) {
    throw new Error('项目不存在或无权访问');
  }
  return project;
}

class QueueJobCancelledError extends Error {
  constructor() {
    super('任务已取消');
    this.name = 'QueueJobCancelledError';
  }
}

function snapshotJob(job: QueuedJob): QueuedJobSnapshot {
  const { payload: _payload, ...rest } = job as any;
  const snapshot: any = { ...rest };
  if (job.kind === 'generate') {
    snapshot.projectState = mergeQueueProjectState((job as GenerateQueuedJob).payload.projectState, job as GenerateQueuedJob);
  }
  return snapshot;
}

function buildQueueJobState(job: QueuedJob) {
  return {
    queueJobId: job.id,
    dbJobId: job.dbJobId || null,
    status: job.status,
    phase: job.phase,
    progress: Math.max(0, Math.min(100, Number(job.progress) || 0)),
    updatedAt: job.updatedAt || Date.now(),
  };
}

function normalizeWorkflowContextValue(value: unknown) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text && text !== 'auto' ? text : null;
}

function buildQueueWorkflowContext(base: any, job: GenerateQueuedJob, currentPhase = job.phase) {
  const existing = base?.workflowContext && typeof base.workflowContext === 'object' ? base.workflowContext : {};
  const input = job.payload.input;
  const selectedSkills = Array.isArray(input.skills)
    ? input.skills
        .map((skill: any) => normalizeWorkflowContextValue(skill?.id || skill?.name))
        .filter((id): id is string => Boolean(id))
    : Array.isArray(existing.selectedSkills)
      ? existing.selectedSkills.map((id: any) => String(id)).filter(Boolean)
      : [];
  const templateId = normalizeWorkflowContextValue(input.templateAsset?.id)
    || normalizeWorkflowContextValue(existing.templateId)
    || null;
  const templateName = normalizeWorkflowContextValue(input.templateAsset?.name)
    || normalizeWorkflowContextValue(input.template)
    || normalizeWorkflowContextValue(existing.templateName)
    || null;

  return {
    ...existing,
    projectId: job.projectId,
    userId: job.userId,
    jobId: job.id,
    currentPhase,
    modelConfig: {
      textModelId: normalizeWorkflowContextValue(input.textModelId) || normalizeWorkflowContextValue(existing.modelConfig?.textModelId),
      imageModelId: normalizeWorkflowContextValue(input.imageModelId) || normalizeWorkflowContextValue(existing.modelConfig?.imageModelId),
    },
    templateId,
    templateName,
    promptId: normalizeWorkflowContextValue((input as any).promptId) || normalizeWorkflowContextValue(existing.promptId),
    selectedSkills,
    startedAt: Number(existing.startedAt || 0) || job.createdAt,
    updatedAt: Date.now(),
  };
}

function mergeQueueProjectState(base: any, job: GenerateQueuedJob) {
  const result = job.result || {};
  const outline = Array.isArray(result.outline)
    ? result.outline.map((slide: any) => ({
        id: slide.id,
        title: slide.title,
        bullets: slide.bullets || [],
        speakerNotes: slide.speakerNotes || '',
        visualPrompt: slide.visualPrompt || '',
        chartHint: slide.chartHint,
        layout: slide.layout,
      }))
    : Array.isArray(base?.outline) ? base.outline : [];
  const svgPages = Array.isArray(result.svgPages)
    ? result.svgPages
    : Array.isArray(base?.svgPages) ? base.svgPages : [];
  const images = Array.isArray(result.images)
    ? result.images
    : Array.isArray(base?.images) ? base.images : [];
  const baseSteps = Array.isArray(base?.steps) ? base.steps : [];
  const steps = baseSteps.map((step: any) => ({
    ...step,
    status: workflowStepStatus(String(step.id || ''), job, result),
    progress: workflowStepProgress(step, job, result),
  }));
  const transition = deriveWorkflowTransition(job);
  const terminal = transition.terminal;
  const workflowContext = buildQueueWorkflowContext(base, job);

  return {
    ...(base || {}),
    outline,
    images,
    designSpec: result.spec || base?.designSpec || null,
    specLock: result.lock || base?.specLock || null,
    workflowContext,
    svgPages,
    steps,
    activeQueueJob: terminal ? null : buildQueueJobState(job),
    workflowActive: transition.active,
    paused: transition.paused,
    resumeStage: transition.paused
      ? (transition.phase === 'layout' || transition.phase === 'images' || transition.phase === 'outline' ? transition.phase : base?.lastActiveStep || base?.resumeStage || null)
      : base?.resumeStage || null,
    lastActiveStep: transition.lastActiveStep,
    waitingForImageRetry: transition.waitingForImageRetry,
  };
}

async function syncProjectStateFromQueueJob(job: QueuedJob, force = false) {
  if (job.kind !== 'generate') return;
  const terminal = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
  const key = `${job.userId}:${job.projectId}`;
  const now = Date.now();
  const lastSyncedAt = projectStateQueueSyncAt.get(key) || 0;
  if (!force && !terminal && now - lastSyncedAt < PROJECT_STATE_QUEUE_SYNC_INTERVAL_MS) return;
  projectStateQueueSyncAt.set(key, now);

  const state = mergeQueueProjectState(job.payload.projectState, job);
  const status = job.status === 'completed'
    ? 'completed'
    : job.status === 'queued' || job.status === 'running'
      ? 'generating'
      : 'draft';

  await updateProjectForUser(parseOwnedProjectId(job.projectId), job.userId, {
    status,
    state,
  });

  if (terminal) projectStateQueueSyncAt.delete(key);
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
  if (set) {
    for (const res of set) {
      if (!writeStream(res, payload)) {
        set.delete(res);
      }
    }
    if (set.size === 0) subscribers.delete(job.id);
  }
}

async function updateJob(
  job: QueuedJob,
  patch: Partial<Pick<QueuedJob, 'status' | 'phase' | 'progress' | 'message' | 'logMessage' | 'errorMessage' | 'result' | 'completedAt'>>
) {
  if (job.status === 'cancelled' && patch.status !== 'cancelled') return;
  const hasLogMessagePatch = Object.prototype.hasOwnProperty.call(patch, 'logMessage');
  Object.assign(job, patch, { updatedAt: Date.now() });
  if (!hasLogMessagePatch) job.logMessage = undefined;
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
        logMessage: job.logMessage,
        result: job.result,
      },
    }).catch((error) => console.warn('更新队列任务状态失败:', error));
  }

  await syncProjectStateFromQueueJob(job, Boolean(patch.status || patch.result)).catch((error) => {
    console.warn('同步队列任务到项目状态失败:', error);
  });

  await persistRedisSnapshot(job);
  publishJob(job);
  await publishRedisJob(job);
}

async function assertJobActive(job: QueuedJob) {
  if (job.cancelRequested || job.status === 'cancelled' || await isRedisJobCancelled(job.id)) {
    throw new QueueJobCancelledError();
  }
}

async function cancelJob(job: QueuedJob, message = '任务已取消') {
  job.cancelRequested = true;
  await markRedisJobCancelled(job.id);
  const queuedIndex = queue.indexOf(job.id);
  if (queuedIndex >= 0) queue.splice(queuedIndex, 1);
  await updateJob(job, {
    status: 'cancelled',
    phase: job.phase || 'queued',
    progress: job.progress,
    message,
  });
}

function toGenerationJobStatus(status: QueuedJobStatus): GenerationJobStatus {
  if (status === 'completed' || status === 'failed' || status === 'cancelled') return status;
  return status === 'queued' ? 'queued' : 'running';
}

async function persistCancelledSnapshot(snapshot: QueuedJobSnapshot, message: string) {
  if (!redisConnection || !redisQueueReady) return snapshot;
  const next: QueuedJobSnapshot = {
    ...snapshot,
    status: 'cancelled',
    phase: snapshot.phase || 'queued',
    message,
    updatedAt: Date.now(),
    completedAt: Date.now(),
  };
  await redisConnection.set(redisSnapshotKey(next.id), JSON.stringify(next), 'EX', REDIS_SNAPSHOT_TTL_SECONDS);
  await redisConnection.publish(redisChannel(next.id), JSON.stringify(next));
  if (next.dbJobId) {
    await updateGenerationJob(next.dbJobId, next.userId, {
      status: 'cancelled',
      phase: next.phase,
      progress: next.progress,
      metadata: {
        queueJobId: next.id,
        kind: next.kind,
        message,
        result: next.result,
      },
    }).catch((error) => console.warn('更新 Redis 队列任务取消状态失败:', error));
  }
  return next;
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
    animationDescription: String(item?.animationDescription || ''),
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
    layout: String(item?.layout || 'content') as SpecSlide['layout'],
    rhythm: item?.rhythm === 'anchor' || item?.rhythm === 'dense' || item?.rhythm === 'breathing'
      ? item.rhythm
      : 'breathing',
    chartHint: item?.chartHint ? String(item.chartHint) : undefined,
  };
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

async function enqueue(job: QueuedJob) {
  rememberJob(job);
  if (shouldUseRedisQueue()) {
    try {
      await persistRedisSnapshot(job);
      await indexRedisProjectJob(job);
      publishJob(job);
      await publishRedisJob(job);

      const targetQueue = bullQueueForKind(job.kind);
      if (!targetQueue) throw new Error('Redis 队列尚未初始化');
      await targetQueue.add(job.id, { job }, {
        jobId: job.id,
        removeOnComplete: { age: REDIS_SNAPSHOT_TTL_SECONDS, count: MAX_JOB_HISTORY },
        removeOnFail: { age: REDIS_SNAPSHOT_TTL_SECONDS, count: MAX_JOB_HISTORY },
      });
      return;
    } catch (error) {
      console.warn('Redis 入队失败，回退到内存队列:', error);
      await shutdownRedisQueue().catch(() => {});
    }
  }

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
    const startingPhase = job.kind === 'generate' ? resolveResumeStage(job.payload.resumeStage) : 'starting';
    await updateJob(job, {
      status: 'running',
      phase: startingPhase,
      progress: startingPhase === 'images' ? 30 : startingPhase === 'layout' ? 50 : 1,
      message: '任务已开始',
    });
    await assertJobActive(job);
    if (job.kind === 'generate') {
      await runGenerateJob(job);
    } else {
      await runExportJob(job);
    }
  } catch (error) {
    if (error instanceof QueueJobCancelledError) {
      await updateJob(job, {
        status: 'cancelled',
        phase: job.phase || 'queued',
        progress: job.progress,
        message: '任务已取消',
      });
      return;
    }
    if (job.kind === 'generate') {
      const errorMessage = error instanceof Error ? error.message : '任务执行失败';
      await updateJob(job, {
        status: 'cancelled',
        phase: job.phase || 'outline',
        progress: Math.max(1, Math.min(99, Number(job.progress) || 1)),
        errorMessage,
        message: `任务异常已暂停，可点击继续从当前阶段恢复：${errorMessage}`,
      });
      return;
    }
    await updateJob(job, {
      status: 'failed',
      phase: job.phase || 'failed',
      progress: job.progress,
      errorMessage: error instanceof Error ? error.message : '任务执行失败',
      message: '任务执行失败',
    });
  }
}

function resolveResumeStage(value: unknown): 'outline' | 'images' | 'layout' {
  return value === 'images' || value === 'layout' ? value : 'outline';
}

function assertResumableGenerationState(state: any): { spec: DesignSpec; lock: SpecLock; images: any[]; svgPages: ServerSvgPage[] } {
  const spec = state?.designSpec;
  const lock = state?.specLock;
  if (!spec?.outline?.length || !lock) {
    throw new Error('项目状态不完整，无法从当前阶段继续。请重新生成大纲。');
  }

  return {
    spec,
    lock,
    images: Array.isArray(state?.images) ? state.images.slice() : [],
    svgPages: Array.isArray(state?.svgPages)
      ? state.svgPages
          .filter((page: any) => page?.svg)
          .map((page: any, index: number) => ({
            pageNumber: Number(page.pageNumber || index + 1),
            svg: String(page.svg || ''),
            speakerNotes: String(page.speakerNotes || ''),
            visualSummary: page.visualSummary ? String(page.visualSummary) : undefined,
            signature: page.signature ? String(page.signature) : undefined,
            sourceHash: page.sourceHash ? String(page.sourceHash) : undefined,
            generatedAt: Number(page.generatedAt || 0) || undefined,
            quality: page.quality && typeof page.quality === 'object' ? page.quality : undefined,
          }))
      : [],
  };
}

async function runGenerateJob(job: GenerateQueuedJob) {
  const { input } = job.payload;
  const resumeStage = resolveResumeStage(job.payload.resumeStage);
  const defaultTextKey = await resolveGenerationApiKey(job.userId, 'text', input.textModelId);
  if (!defaultTextKey) throw new Error('未配置文本模型');

  const textApiKey = decrypt(defaultTextKey.api_key);
  const textProvider = defaultTextKey.provider;
  const textBaseUrl = defaultTextKey.base_url || '';
  const textModel = defaultTextKey.model || 'gpt-4o';

  let spec: DesignSpec;
  let lock: SpecLock;
  let images: any[] = [];
  let existingSvgPages: ServerSvgPage[] = [];

  if (resumeStage === 'outline') {
    await updateJob(job, { phase: 'outline', progress: 8, message: '正在生成大纲', logMessage: '正在生成大纲' });
    await assertJobActive(job);
    const chartCatalog = await getChartCatalog();
    const { system, user } = buildStrategistPrompt(input, { chartCatalog });
    const streamedSlideIds = new Set<string>();
    let partialOutline: SpecSlide[] = [];
    let lastOutlineJobUpdateAt = 0;
    let lastOutlineJobSnapshot = '';
    const publishPartialOutline = async (currentFullContent: string, force = false) => {
      const slides = extractStreamingOutlineSlides(currentFullContent);
      const nextSlides: SpecSlide[] = [];
      let changed = false;

      for (const slide of slides) {
        const key = slide.id || String(slide.pageNumber);
        nextSlides.push(slide);
        if (!streamedSlideIds.has(key)) {
          streamedSlideIds.add(key);
          changed = true;
        }
      }

      if (!changed && nextSlides.length === partialOutline.length && !force) return;
      partialOutline = nextSlides;
      const snapshot = partialOutline.map((slide) => `${slide.id}:${slide.title}:${slide.bullets.length}`).join('|');
      if (!force && snapshot === lastOutlineJobSnapshot) return;
      const now = Date.now();
      if (!force && now - lastOutlineJobUpdateAt < OUTLINE_JOB_UPDATE_INTERVAL_MS) return;
      lastOutlineJobSnapshot = snapshot;
      lastOutlineJobUpdateAt = now;
      const targetCount = Number(input.slideCount) > 0 ? Number(input.slideCount) : Math.max(partialOutline.length + 1, 6);
      const progress = Math.min(27, 8 + Math.round((partialOutline.length / Math.max(1, targetCount)) * 18));
      await updateJob(job, {
        phase: 'outline',
        progress,
        message: partialOutline.length
          ? `正在生成大纲：已输出 ${partialOutline.length} 页`
          : '正在生成大纲',
        logMessage: partialOutline.length
          ? `正在生成大纲：已输出 ${partialOutline.length} 页`
          : '正在生成大纲',
        result: { outline: partialOutline, images: [], svgPages: [] },
      });
    };
    const strategistOutput = await streamText(textProvider, textApiKey, textBaseUrl, textModel, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], undefined, {
      onContent: (_content, currentFullContent) => {
        void publishPartialOutline(currentFullContent);
      },
    });
    await assertJobActive(job);
    await publishPartialOutline(strategistOutput, true);
    spec = parseStrategistOutput(strategistOutput, input);
    lock = buildSpecLock(spec);
    await updateJob(job, {
      phase: 'outline',
      progress: 28,
      message: `大纲生成完成，共 ${spec.outline.length} 页`,
      logMessage: `大纲生成完成，共 ${spec.outline.length} 页`,
      result: { spec, lock, outline: spec.outline, images: [], svgPages: [] },
    });
    await assertJobActive(job);
  } else {
    const resumed = assertResumableGenerationState(job.payload.projectState);
    spec = resumed.spec;
    lock = resumed.lock;
    images = resumed.images;
    existingSvgPages = resumed.svgPages;
    await updateJob(job, {
      phase: resumeStage,
      progress: resumeStage === 'images' ? 30 : 50,
      message: resumeStage === 'images' ? '正在从图片阶段继续生成' : '正在从页面阶段继续生成',
      result: { spec, lock, outline: spec.outline, images, svgPages: existingSvgPages },
    });
    await assertJobActive(job);
  }

  images = resumeStage === 'layout' ? sortImagesByOutline(images, spec) : await maybeGenerateImages(job, spec, lock, images, existingSvgPages);
  await assertJobActive(job);
  await updateJob(job, {
    phase: 'images',
    progress: 45,
    message: images.length ? `图片处理完成，共 ${images.filter((img) => img.url && !img.error).length} 张可用` : '本次无需图片',
    result: { spec, lock, outline: spec.outline, images, svgPages: existingSvgPages },
  });
  await assertJobActive(job);

  const svgPages = await generateSvgPages(job, spec, lock, images, textProvider, textApiKey, textBaseUrl, textModel, existingSvgPages);
  await assertJobActive(job);
  const result = { spec, lock, outline: spec.outline, images, svgPages };
  await updateProjectForUser(parseOwnedProjectId(job.projectId), job.userId, {
    status: 'completed',
    state: mergeProjectState(job.payload.projectState, result, job),
  }).catch((error) => console.warn('保存生成结果到项目失败:', error));

  await updateJob(job, {
    status: 'completed',
    phase: 'completed',
    progress: 100,
    message: 'PPT 生成完成',
    result,
  });
}

type SlideImagePlan = NonNullable<SpecSlide['imagePlan']>[number];

function normalizeServerImagePlans(slide: SpecSlide): SlideImagePlan[] {
  const rawPlans = Array.isArray(slide.imagePlan) ? slide.imagePlan : [];
  const plans = rawPlans
    .slice(0, 4)
    .map((plan: any, index) => {
      const prompt = String(plan?.prompt || '').trim();
      if (!prompt) return null;
      return {
        id: String(plan?.id || `img-${index + 1}`).replace(/[^\w-]/g, '-').slice(0, 40) || `img-${index + 1}`,
        prompt,
        purpose: plan?.purpose ? String(plan.purpose).slice(0, 40) : undefined,
        style: plan?.style ? String(plan.style).slice(0, 80) : undefined,
      };
    })
    .filter(Boolean) as SlideImagePlan[];

  if (plans.length) return plans;

  const legacyVisualPrompt = String(slide.visualPrompt || '').trim();
  if (!legacyVisualPrompt || Array.isArray(slide.imagePlan)) return [];
  return [{ id: 'img-1', prompt: legacyVisualPrompt, purpose: 'supporting' }];
}

function slideNeedsImageServer(slide: SpecSlide) {
  return normalizeServerImagePlans(slide).length > 0;
}

function imagePromptForPlan(slide: SpecSlide, plan: SlideImagePlan) {
  return [
    plan.prompt,
    `用于第 ${slide.pageNumber} 页「${slide.title}」的图片素材`,
    plan.purpose ? `用途：${plan.purpose}` : '',
    plan.style ? `风格：${plan.style}` : '',
    '不要生成文字、水印、截图边框或 UI 外壳；最终由页面生成 AI 自主裁切、缩放、旋转和排版',
  ].filter(Boolean).join('。');
}

function findReadyServerImage(images: any[], slideId: string, assetId = 'img-1') {
  return images.find((item) =>
    item.slideId === slideId &&
    (item.assetId || 'img-1') === assetId &&
    item.selected &&
    item.url &&
    !item.error
  );
}

function findReadyServerImagesForSlide(images: any[], slide: SpecSlide) {
  return normalizeServerImagePlans(slide)
    .map((plan) => findReadyServerImage(images, slide.id, plan.id))
    .filter(Boolean) as ServerImage[];
}

function findMissingRequiredImagePlans(spec: DesignSpec, images: any[]) {
  return spec.outline.flatMap((slide) =>
    normalizeServerImagePlans(slide)
      .filter((plan) => !findReadyServerImage(images, slide.id, plan.id))
      .map((plan) => ({ slide, plan }))
  );
}

function sortImagesByOutline(images: any[], spec: DesignSpec) {
  const slideIndex = new Map(spec.outline.map((slide, index) => [slide.id, index]));
  return images.slice().sort((a, b) => {
    const slideOrder = (slideIndex.get(a.slideId) ?? 9999) - (slideIndex.get(b.slideId) ?? 9999);
    if (slideOrder !== 0) return slideOrder;
    return String(a.assetId || a.id || '').localeCompare(String(b.assetId || b.id || ''));
  });
}

function upsertServerImage(images: any[], image: any) {
  const existingIndex = images.findIndex((item) =>
    item.id === image.id ||
    (item.slideId === image.slideId && (item.assetId || 'img-1') === (image.assetId || 'img-1'))
  );
  if (existingIndex >= 0) {
    images[existingIndex] = image;
  } else {
    images.push(image);
  }
}

function toExecutorImageAssets(images: any[]) {
  return images
    .filter((image) => image?.url && image.selected !== false && !image.error)
    .map((image) => ({
      id: image.assetId || image.id,
      url: image.url,
      title: image.title,
      prompt: image.prompt,
      purpose: image.purpose,
      style: image.style,
      metadata: image.metadata ? {
        width: image.metadata.width,
        height: image.metadata.height,
        contentType: image.metadata.contentType,
        bytes: image.metadata.bytes,
        ok: image.metadata.ok,
      } : undefined,
    }));
}

function isFallbackSvgPage(svg?: string) {
  return Boolean(svg && svg.includes('本页待重试'));
}

function upsertServerSvgPage(pages: ServerSvgPage[], page: ServerSvgPage) {
  const existingIndex = pages.findIndex((item) => item.pageNumber === page.pageNumber);
  if (existingIndex >= 0) {
    pages[existingIndex] = page;
  } else {
    pages.push(page);
  }
}

function sortServerSvgPages(pages: ServerSvgPage[]) {
  return pages.slice().sort((a, b) => a.pageNumber - b.pageNumber);
}

async function loadImageModelConfig(job: GenerateQueuedJob): Promise<ImageModelConfig> {
  const defaultImageKey = await resolveGenerationApiKey(job.userId, 'image', job.payload.input.imageModelId);
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
  plan: SlideImagePlan,
  config: ImageModelConfig,
  attempt: number
): Promise<ServerImage> {
  await assertJobActive(job);
  const prompt = imagePromptForPlan(slide, plan);
  const style = plan.style || job.payload.input.imageStyle;
  const rawImageUrl = await generateImage(config.provider, config.apiKey, config.model, prompt, style, config.baseUrl);
  await assertJobActive(job);
  const url = await persistDataImage(rawImageUrl, `${slide.id}-${plan.id}`);
  const metadata = await getImageMetadata(url);

  return {
    id: `${slide.id}-${plan.id}`,
    slideId: slide.id,
    assetId: plan.id,
    title: `${slide.title} / ${plan.purpose || plan.id}`,
    prompt,
    purpose: plan.purpose,
    style,
    url,
    selected: true,
    attempt,
    metadata,
  };
}

async function generateSlideImageWithAutoRetry(
  job: GenerateQueuedJob,
  slide: SpecSlide,
  plan: SlideImagePlan,
  config: ImageModelConfig,
  progress: number,
  context?: { index?: number; total?: number }
): Promise<ServerImage> {
  let lastError: unknown = null;
  const imageLabel = `${slide.title} / ${plan.purpose || plan.id}`;
  const countText = context?.index && context.total ? `（${context.index}/${context.total}）` : '';

  for (let attempt = 1; attempt <= IMAGE_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      await assertJobActive(job);
      await updateJob(job, {
        phase: 'images',
        progress,
        message: attempt === 1
          ? `正在生成第 ${slide.pageNumber} 页图片：${imageLabel}`
          : `正在重试第 ${slide.pageNumber} 页图片：${imageLabel}`,
        logMessage: attempt === 1
          ? `正在生成图片素材：第 ${slide.pageNumber} 页 ${imageLabel}${countText}`
          : `正在重试图片素材：第 ${slide.pageNumber} 页 ${imageLabel}${countText}`,
      });
      return await generateSlideImageForQueue(job, slide, plan, config, attempt);
    } catch (error) {
      lastError = error;
      if (attempt < IMAGE_GENERATION_ATTEMPTS) {
        await updateJob(job, {
          phase: 'images',
          progress,
          message: `图片生成失败，正在重试第 ${slide.pageNumber} 页图片：${imageLabel}`,
          logMessage: `图片生成失败，准备自动重试：第 ${slide.pageNumber} 页 ${imageLabel}${countText}`,
        });
      }
    }
  }

  return {
    id: `${slide.id}-${plan.id}`,
    slideId: slide.id,
    assetId: plan.id,
    title: `${slide.title} / ${plan.purpose || plan.id}`,
    prompt: imagePromptForPlan(slide, plan),
    purpose: plan.purpose,
    style: plan.style || job.payload.input.imageStyle,
    url: '',
    selected: true,
    error: true,
    errorMessage: lastError instanceof Error ? lastError.message : '图片生成失败',
  };
}

async function maybeGenerateImages(
  job: GenerateQueuedJob,
  spec: DesignSpec,
  lock: SpecLock,
  existingImages: any[] = [],
  existingPages: ServerSvgPage[] = []
) {
  const results: any[] = sortImagesByOutline(existingImages, spec);
  if (job.payload.includeImages === false) return results;
  const tasks = findMissingRequiredImagePlans(spec, results);
  if (!tasks.length) return results;

  const imageConfig = await loadImageModelConfig(job);
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (cursor < tasks.length) {
      await assertJobActive(job);
      const taskIndex = cursor++;
      const { slide, plan } = tasks[taskIndex];
      const progress = 30 + Math.round((completed / Math.max(1, tasks.length)) * 12);
      const image = await generateSlideImageWithAutoRetry(job, slide, plan, imageConfig, progress, {
        index: taskIndex + 1,
        total: tasks.length,
      });
      await assertJobActive(job);
      upsertServerImage(results, image);
      completed += 1;
      const nextProgress = 30 + Math.round((completed / Math.max(1, tasks.length)) * 12);
      await updateJob(job, {
        phase: 'images',
        progress: Math.min(44, nextProgress),
        message: image.error
          ? `图片生成失败："${slide.title}"（${completed}/${tasks.length}）`
          : `图片生成完成："${slide.title}"（${completed}/${tasks.length}）`,
        logMessage: image.error
          ? `图片素材生成失败：第 ${slide.pageNumber} 页 ${slide.title} / ${plan.purpose || plan.id}（${completed}/${tasks.length}）`
          : `图片素材生成完成：第 ${slide.pageNumber} 页 ${slide.title} / ${plan.purpose || plan.id}（${completed}/${tasks.length}）`,
        result: { spec, lock, outline: spec.outline, images: sortImagesByOutline(results, spec), svgPages: sortServerSvgPages(existingPages) },
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, tasks.length) }, () => worker()));
  const missingPlans = findMissingRequiredImagePlans(spec, results);
  if (missingPlans.length) {
    const missingText = missingPlans.map(({ slide, plan }) => `${slide.title}/${plan.purpose || plan.id}`).join('、');
    await updateJob(job, {
      phase: 'images',
      progress: 45,
      message: `图片自动重试后仍未完成：${missingText}`,
      result: { spec, lock, outline: spec.outline, images: sortImagesByOutline(results, spec), svgPages: sortServerSvgPages(existingPages) },
    });
    throw new Error(`图片自动重试后仍未完成：${missingText}。请手动重试图片后再继续。`);
  }
  await preloadImageMetadata(results);
  return sortImagesByOutline(results, spec);
}

async function ensureRequiredImagesBeforeLayout(job: GenerateQueuedJob, spec: DesignSpec, lock: SpecLock, images: any[], pages: ServerSvgPage[] = []) {
  if (job.payload.includeImages === false) return;

  let missingPlans = findMissingRequiredImagePlans(spec, images);
  if (!missingPlans.length) return;

  const imageConfig = await loadImageModelConfig(job);
  for (const { slide, plan } of missingPlans) {
    await assertJobActive(job);
    await updateJob(job, {
      phase: 'images',
      progress: 45,
      message: `第 ${slide.pageNumber} 页缺少可用图片，正在为"${slide.title}"自动重试...`,
      logMessage: `第 ${slide.pageNumber} 页缺少图片素材，正在自动重试：${slide.title} / ${plan.purpose || plan.id}`,
      result: { spec, lock, outline: spec.outline, images, svgPages: sortServerSvgPages(pages) },
    });
    const image = await generateSlideImageWithAutoRetry(job, slide, plan, imageConfig, 45);
    await assertJobActive(job);
    if (image.url && !image.error) image.metadata = await getImageMetadata(image.url);
    upsertServerImage(images, image);
    await updateJob(job, {
      phase: 'images',
      progress: 45,
      message: image.error ? `图片生成失败："${slide.title}"` : `图片生成完成："${slide.title}"`,
      logMessage: image.error
        ? `图片素材生成失败：第 ${slide.pageNumber} 页 ${slide.title} / ${plan.purpose || plan.id}`
        : `图片素材生成完成：第 ${slide.pageNumber} 页 ${slide.title} / ${plan.purpose || plan.id}`,
      result: { spec, lock, outline: spec.outline, images: sortImagesByOutline(images, spec), svgPages: sortServerSvgPages(pages) },
    });
  }

  missingPlans = findMissingRequiredImagePlans(spec, images);
  if (missingPlans.length) {
    const missingText = missingPlans.map(({ slide, plan }) => `${slide.title}/${plan.purpose || plan.id}`).join('、');
    await updateJob(job, {
      phase: 'images',
      progress: 45,
      message: `图片自动重试后仍未完成：${missingText}`,
      result: { spec, lock, outline: spec.outline, images: sortImagesByOutline(images, spec), svgPages: sortServerSvgPages(pages) },
    });
    throw new Error(`图片自动重试后仍未完成：${missingText}。请手动重试图片后再继续。`);
  }
}

async function ensureServerImagesForLayout(
  job: GenerateQueuedJob,
  spec: DesignSpec,
  lock: SpecLock,
  slide: SpecSlide,
  images: any[],
  pages: ServerSvgPage[]
) {
  if (job.payload.includeImages === false || !slideNeedsImageServer(slide)) {
    return [];
  }

  const plans = normalizeServerImagePlans(slide);
  const existingImages = findReadyServerImagesForSlide(images, slide);
  if (existingImages.length >= plans.length) return existingImages;

  await assertJobActive(job);
  const imageConfig = await loadImageModelConfig(job);
  const missingPlans = plans.filter((plan) => !findReadyServerImage(images, slide.id, plan.id));
  for (const plan of missingPlans) {
    await updateJob(job, {
      phase: 'images',
      progress: 45,
      message: `第 ${slide.pageNumber} 页缺少可用图片，正在为"${slide.title}"自动重试...`,
      logMessage: `第 ${slide.pageNumber} 页缺少图片素材，正在自动重试：${slide.title} / ${plan.purpose || plan.id}`,
      result: { spec, lock, outline: spec.outline, images: sortImagesByOutline(images, spec), svgPages: pages.slice().sort((a, b) => a.pageNumber - b.pageNumber) },
    });

    const retryImage = await generateSlideImageWithAutoRetry(job, slide, plan, imageConfig, 45);
    await assertJobActive(job);
    if (retryImage.url && !retryImage.error) retryImage.metadata = await getImageMetadata(retryImage.url);
    upsertServerImage(images, retryImage);
    await updateJob(job, {
      phase: 'images',
      progress: 45,
      message: retryImage.error ? `图片生成失败："${slide.title}"` : `图片生成完成："${slide.title}"`,
      logMessage: retryImage.error
        ? `图片素材生成失败：第 ${slide.pageNumber} 页 ${slide.title} / ${plan.purpose || plan.id}`
        : `图片素材生成完成：第 ${slide.pageNumber} 页 ${slide.title} / ${plan.purpose || plan.id}`,
      result: { spec, lock, outline: spec.outline, images: sortImagesByOutline(images, spec), svgPages: pages.slice().sort((a, b) => a.pageNumber - b.pageNumber) },
    });
  }

  const readyImages = findReadyServerImagesForSlide(images, slide);
  if (readyImages.length >= plans.length) return readyImages;

  await updateJob(job, {
    phase: 'images',
    progress: 45,
    message: `第 ${slide.pageNumber} 页图片自动重试后仍未完成："${slide.title}"`,
    result: { spec, lock, outline: spec.outline, images: sortImagesByOutline(images, spec), svgPages: pages.slice().sort((a, b) => a.pageNumber - b.pageNumber) },
  });
  throw new Error(`第 ${slide.pageNumber} 页需要图片素材，但图片自动重试后仍未生成：${slide.title}`);
}

async function generateSvgPages(
  job: GenerateQueuedJob,
  spec: DesignSpec,
  lock: SpecLock,
  images: any[],
  provider: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  existingPages: ServerSvgPage[] = []
) {
  const pages: ServerSvgPage[] = sortServerSvgPages(existingPages)
    .filter((page) => page.svg && !isFallbackSvgPage(page.svg));
  const existingByPage = new Map(pages.map((page) => [page.pageNumber, page]));
  let cursor = 0;
  let completed = pages.length;

  await ensureRequiredImagesBeforeLayout(job, spec, lock, images, pages);
  await preloadImageMetadata(images);
  await updateJob(job, {
    phase: 'layout',
    progress: 48,
    message: '正在准备页面素材缓存',
    result: { spec, lock, outline: spec.outline, images: sortImagesByOutline(images, spec), svgPages: sortServerSvgPages(pages) },
  });

  const slidesToGenerate: Array<{ slide: SpecSlide; signature: string; slideImages: any[] }> = [];
  for (const slide of spec.outline) {
    const slideImages = findReadyServerImagesForSlide(images, slide);
    const signature = slideSignature({ job, spec, lock, slide, slideImages, provider, baseUrl, model });
    const existing = existingByPage.get(slide.pageNumber);
    if (
      existing?.svg &&
      !isFallbackSvgPage(existing.svg) &&
      (existing.signature === signature || (!existing.signature && job.payload.resumeStage === 'layout'))
    ) {
      existing.signature = existing.signature || signature;
      existing.sourceHash = existing.sourceHash || signature;
      existing.quality = { ...(existing.quality || {}), reused: true };
      continue;
    }
    slidesToGenerate.push({ slide, signature, slideImages });
  }

  completed = spec.outline.length - slidesToGenerate.length;
  if (!slidesToGenerate.length) {
    await updateJob(job, {
      phase: 'layout',
      progress: 95,
      message: '页面内容未变化，已复用现有 SVG',
      result: { spec, lock, outline: spec.outline, images: sortImagesByOutline(images, spec), svgPages: sortServerSvgPages(pages) },
    });
    return sortServerSvgPages(pages);
  }

  async function worker() {
    while (cursor < slidesToGenerate.length) {
      await assertJobActive(job);
      const taskIndex = cursor++;
      const task = slidesToGenerate[taskIndex];
      const { slide, signature } = task;
      const pageCountText = `（${taskIndex + 1}/${slidesToGenerate.length}）`;
      await updateJob(job, {
        phase: 'layout',
        progress: 50 + Math.round((completed / Math.max(1, spec.outline.length)) * 45),
        message: `正在生成第 ${slide.pageNumber} 页：${slide.title}`,
        logMessage: `正在生成第 ${slide.pageNumber} 页：${slide.title}${pageCountText}`,
      });

      const slideImages = await ensureServerImagesForLayout(job, spec, lock, slide, images, pages);
      await preloadImageMetadata(slideImages);
      const currentSignature = slideSignature({ job, spec, lock, slide, slideImages, provider, baseUrl, model }) || signature;
      await assertJobActive(job);
      const pageResult = await generatePageSvg(spec, lock, slide, slideImages, provider, apiKey, baseUrl, model);
      await assertJobActive(job);
      upsertServerSvgPage(pages, {
        pageNumber: slide.pageNumber,
        svg: pageResult.svg,
        speakerNotes: slide.speakerNotes || '',
        signature: currentSignature,
        sourceHash: currentSignature,
        generatedAt: Date.now(),
        quality: pageResult.quality,
      });
      completed += 1;
      await updateJob(job, {
        phase: 'layout',
        progress: 50 + Math.round((completed / Math.max(1, spec.outline.length)) * 45),
        message: `第 ${slide.pageNumber} 页生成完成：${slide.title}`,
        logMessage: `第 ${slide.pageNumber} 页生成完成：${slide.title}（${completed}/${spec.outline.length}）`,
        result: { spec, lock, outline: spec.outline, images: sortImagesByOutline(images, spec), svgPages: sortServerSvgPages(pages) },
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(EXECUTOR_CONCURRENCY, slidesToGenerate.length) }, () => worker()));
  return sortServerSvgPages(pages);
}

async function generatePageSvg(
  spec: DesignSpec,
  lock: SpecLock,
  slide: SpecSlide,
  slideImages: any[],
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
    skillExtensions: spec.skillExtensions || [],
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
    skillExtensions: lock.skillExtensions || spec.skillExtensions || [],
    forbidden: (lock as any).forbidden || DEFAULT_FORBIDDEN,
  } as any;

  const iconGuide = await getIconGuide(slimLock.iconStyle);
  const chartTemplateSvg = await getChartSvg(slimLock.pageCharts[pageKey] || slide.chartHint);
  const executorContext = { iconGuide, chartTemplateSvg };
  const systemPrompt = buildExecutorSystemPrompt(slimSpec, slimLock, executorContext);
  const imageAssets = toExecutorImageAssets(slideImages);
  const userPrompt = buildExecutorPagePrompt(slide, slimSpec, slimLock, imageAssets, undefined, executorContext);
  let lastError: unknown = null;
  let lastQuality: ReturnType<typeof finalizeSvgQuality> | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const output = await streamText(provider, apiKey, baseUrl, model, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);
      const rawSvg = ensureImageUsedInSvg(cleanSvgOutput(output), slide, spec, imageAssets);
      if (!rawSvg || !rawSvg.includes('<svg') || !rawSvg.includes('</svg>')) {
        throw new Error('AI 返回的 SVG 内容不完整');
      }
      let quality = finalizeSvgQuality(rawSvg, spec, slide, undefined, imageAssets);
      lastQuality = quality;
      if (quality.blockingIssues.length) {
        quality = await repairSvgQualityWithFallback({
          provider,
          apiKey,
          baseUrl,
          model,
          systemPrompt,
          spec,
          slide,
          imageAssets,
          quality,
        });
        lastQuality = quality;
      }
      if (quality.blockingIssues.length && attempt < 3) {
        throw new Error(`页面质量检查未通过：${summarizeSvgQualityIssues(quality.blockingIssues, 3)}`);
      }
      return {
        svg: quality.svg,
        quality: {
          repaired: quality.repaired,
          issues: quality.issues.length,
          blockingIssues: quality.blockingIssues.length,
          attempts: attempt,
        },
      };
    } catch (error) {
      lastError = error;
      if (!isRetriablePageGenerationError(error) && attempt >= 2) break;
    }
  }

  if (lastQuality?.blockingIssues?.length) {
    throw new Error(`页面质量检查未通过：${summarizeSvgQualityIssues(lastQuality.blockingIssues, 5)}`);
  }
  throw lastError instanceof Error ? lastError : new Error('页面 SVG 生成失败');
}

function isRetriablePageGenerationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /timeout|timed out|429|rate limit|5\d\d|fetch failed|ECONNRESET|ECONNREFUSED|socket|空|empty|incomplete|不完整|质量检查/i.test(message);
}

async function repairSvgQualityWithFallback(input: {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  spec: DesignSpec;
  slide: SpecSlide;
  imageAssets: ReturnType<typeof toExecutorImageAssets>;
  quality: ReturnType<typeof finalizeSvgQuality>;
}) {
  const { provider, apiKey, baseUrl, model, systemPrompt, spec, slide, imageAssets } = input;
  let quality = input.quality;

  const patchOutput = await streamText(provider, apiKey, baseUrl, model, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: buildSvgQualityPatchPrompt(quality.svg, spec, slide, undefined, quality.blockingIssues, imageAssets) },
  ]).catch(() => '');
  const patchSvg = ensureImageUsedInSvg(cleanSvgOutput(patchOutput), slide, spec, imageAssets);
  if (patchSvg && patchSvg.includes('<svg') && patchSvg.includes('</svg>')) {
    quality = finalizeSvgQuality(patchSvg, spec, slide, undefined, imageAssets);
  }
  if (!quality.blockingIssues.length) return quality;

  const repairOutput = await streamText(provider, apiKey, baseUrl, model, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: buildSvgQualityRepairPrompt(quality.svg, spec, slide, undefined, quality.blockingIssues, imageAssets) },
  ]);
  const repairedSvg = ensureImageUsedInSvg(cleanSvgOutput(repairOutput), slide, spec, imageAssets);
  return finalizeSvgQuality(repairedSvg || quality.svg, spec, slide, undefined, imageAssets);
}

async function runExportJob(job: ExportQueuedJob) {
  if (!job.payload.pages.length) throw new Error('没有可导出的页面');
  await assertJobActive(job);
  await updateJob(job, { phase: 'exporting', progress: 20, message: '正在导出 PPTX' });
  await assertJobActive(job);
  const lock = job.payload.lock || buildSpecLock(job.payload.spec);
  const result = await exportWithNexiousPpt(job.payload.pages, job.payload.spec, lock, job.payload.exportOptions);
  await assertJobActive(job);
  await mkdir(EXPORT_DIR, { recursive: true });
  const filePath = exportArtifactPath(job.userId, job.projectId, job.id);
  await writeFile(filePath, result.buffer);
  exportArtifacts.set(job.id, {
    buffer: result.buffer,
    filePath,
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

function mergeProjectState(
  base: any,
  result: { spec: DesignSpec; lock: SpecLock; outline: SpecSlide[]; images: any[]; svgPages: any[] },
  job?: GenerateQueuedJob
) {
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
    workflowContext: job
      ? buildQueueWorkflowContext(base, job, 'completed')
      : base?.workflowContext || null,
    svgPages: result.svgPages,
    workflowActive: false,
    paused: false,
    resumeStage: null,
    waitingForImageRetry: false,
  };
}

export async function enqueueGenerateJob(userId: number, payload: GenerateJobPayload) {
  await assertProjectOwnedByUser(userId, payload.projectId);
  await ensureRedisQueueReady();
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
  await enqueue(job);
  await updateJob(job, { status: 'queued', phase: 'queued', progress: 0, message: '任务已排队' });
  return snapshotJob(job);
}

export async function enqueueExportJob(userId: number, payload: ExportJobPayload) {
  await assertProjectOwnedByUser(userId, payload.projectId);
  await ensureRedisQueueReady();
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
  await enqueue(job);
  return snapshotJob(job);
}

export async function getQueuedJob(id: string, userId: number) {
  const job = jobs.get(id);
  if (job) return job.userId === userId ? snapshotJob(job) : null;

  await ensureRedisQueueReady();
  const snapshot = await readRedisSnapshot(id);
  if (!snapshot || snapshot.userId !== userId) return null;
  return snapshot;
}

export async function cancelQueuedJob(id: string, userId: number) {
  const job = jobs.get(id);
  const message = '用户已暂停任务';
  if (job) {
    if (job.userId !== userId) return null;
    await cancelJob(job, message);
    return snapshotJob(job);
  }

  await ensureRedisQueueReady();
  const snapshot = await readRedisSnapshot(id);
  if (!snapshot || snapshot.userId !== userId) return null;
  await markRedisJobCancelled(id);
  const targetQueue = bullQueueForKind(snapshot.kind);
  const bullJob = targetQueue ? await targetQueue.getJob(id) : null;
  if (bullJob) {
    try {
      await bullJob.remove();
    } catch {
      // 正在执行的任务无法从 BullMQ 移除，会在下一次取消检查时停止。
    }
  }
  return persistCancelledSnapshot(snapshot, message);
}

export async function cancelQueuedJobsByProject(userId: number, projectId: string) {
  const cancelledJobs: QueuedJobSnapshot[] = [];
  for (const job of jobs.values()) {
    if (job.userId !== userId || job.projectId !== projectId) continue;
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') continue;
    await cancelJob(job, '项目已删除，任务已取消');
    cancelledJobs.push(snapshotJob(job));
  }

  await ensureRedisQueueReady();
  if (redisConnection && redisQueueReady) {
    const ids = await redisConnection.smembers(redisProjectJobsKey(userId, projectId));
    for (const id of ids) {
      if (cancelledJobs.some((item) => item.id === id)) continue;
      const snapshot = await readRedisSnapshot(id);
      if (!snapshot || ['completed', 'failed', 'cancelled'].includes(snapshot.status)) continue;
      const cancelled = await cancelQueuedJob(id, userId);
      if (cancelled) cancelledJobs.push(cancelled);
    }
  }

  return cancelledJobs;
}

export async function getExportArtifact(id: string, userId: number) {
  const job = jobs.get(id);
  if (job && (job.userId !== userId || job.kind !== 'export' || job.status !== 'completed')) return null;
  const memoryArtifact = exportArtifacts.get(id);
  if (memoryArtifact) return memoryArtifact;

  await ensureRedisQueueReady();
  const snapshot = job ? snapshotJob(job) : await readRedisSnapshot(id);
  if (!snapshot || snapshot.userId !== userId || snapshot.kind !== 'export' || snapshot.status !== 'completed') return null;
  const result = snapshot.result || {};
  const filePath = exportArtifactPath(snapshot.userId, snapshot.projectId, snapshot.id);
  const fileName = typeof result.fileName === 'string' ? result.fileName : `nexious-deck-${id}.pptx`;
  try {
    return {
      buffer: await readFile(filePath),
      filePath,
      fileName,
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
  } catch {
    return null;
  }
}

export async function subscribeQueuedJob(id: string, userId: number, res: Response) {
  const job = jobs.get(id);
  if (!job) {
    await ensureRedisQueueReady();
    const snapshot = await readRedisSnapshot(id);
    if (!snapshot || snapshot.userId !== userId) return false;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    guardStreamResponse(res);
    writeSseData(res, snapshot);

    if (snapshot.status === 'completed' || snapshot.status === 'failed' || snapshot.status === 'cancelled') {
      endStream(res);
      return true;
    }

    if (!REDIS_URL) return true;
    const subscriber = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: redisRetryStrategy,
    });
    subscriber.on('error', (error) => {
      console.warn('Redis 队列事件订阅错误:', error.message);
    });
    try {
      await subscriber.subscribe(redisChannel(id));
    } catch (error) {
      console.warn('Redis 队列事件订阅失败:', error);
      subscriber.disconnect();
      return true;
    }
    subscriber.on('message', (_channel, payload) => {
      if (!writeSseData(res, payload)) {
        subscriber.disconnect();
        return;
      }
      try {
        const next = JSON.parse(payload) as QueuedJobSnapshot;
        if (next.status === 'completed' || next.status === 'failed' || next.status === 'cancelled') {
          subscriber.disconnect();
          endStream(res);
        }
      } catch {
        // ignore malformed Redis queue events
      }
    });
    res.on('close', () => {
      subscriber.disconnect();
    });
    return true;
  }

  if (job.userId !== userId) return false;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  guardStreamResponse(res);
  writeSseData(res, snapshotJob(job));

  const set = subscribers.get(id) || new Set<Response>();
  set.add(res);
  subscribers.set(id, set);
  res.on('close', () => {
    set.delete(res);
    if (set.size === 0) subscribers.delete(id);
  });
  return true;
}
