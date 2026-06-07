import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  calculateImageSlot,
  cleanSvgOutput,
  ensureImageUsedInSvg,
  parseStrategistOutput,
} from '../engine/index.js';
import { streamText } from './textModel.js';
import { generateImage, persistDataImage } from '../routes/ai.js';
import { DEFAULT_FORBIDDEN, normalizeTypography } from '../engine/spec.js';
import type { DesignSpec, ImageSlot, SpecLock, SpecSlide, StrategistInput } from '../engine/index.js';
import { exportWithNexiousPpt, type PptExportOptions, type PptExportPage } from '../engine/ppt-exporter.js';
import { generatedExportsRoot } from '../utils/storage.js';
import { deriveWorkflowTransition, workflowStepProgress, workflowStepStatus } from './workflowStateMachine.js';

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
  title: string;
  prompt: string;
  style: string;
  url: string;
  selected: boolean;
  attempt?: number;
  error?: boolean;
  errorMessage?: string;
  imageSlot?: ImageSlot;
}

const jobs = new Map<string, QueuedJob>();
const queue: string[] = [];
const subscribers = new Map<string, Set<Response>>();
const exportArtifacts = new Map<string, { buffer?: Buffer; filePath?: string; fileName: string; contentType: string }>();
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
const activeRedisJobs = new Map<string, QueuedJob>();
const projectStateQueueSyncAt = new Map<string, number>();

function redisRetryStrategy(times: number) {
  return Math.min(Math.max(times, 1) * 500, 5000);
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

function createRedisConnection() {
  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 5000,
    retryStrategy: redisRetryStrategy,
  });
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

  const probe = createRedisConnection();
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
    console.warn('Redis 队列预检失败，已降级到内存队列，30 秒后会自动重试。', error);
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

    redisConnection = createRedisConnection();

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

    generateWorker.on('error', (error) => console.warn('BullMQ generation worker error', error));
    exportWorker.on('error', (error) => console.warn('BullMQ export worker error', error));

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
    console.warn('Redis 队列不可用，已回退到内存队列。', error);
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
      res.write(payload);
    }
  }
}

async function updateJob(
  job: QueuedJob,
  patch: Partial<Pick<QueuedJob, 'status' | 'phase' | 'progress' | 'message' | 'errorMessage' | 'result' | 'completedAt'>>
) {
  if (job.status === 'cancelled' && patch.status !== 'cancelled') return;
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

function assertResumableGenerationState(state: any): { spec: DesignSpec; lock: SpecLock; images: any[]; svgPages: Array<{ pageNumber: number; svg: string; speakerNotes: string }> } {
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
  let existingSvgPages: Array<{ pageNumber: number; svg: string; speakerNotes: string }> = [];

  if (resumeStage === 'outline') {
    await updateJob(job, { phase: 'outline', progress: 8, message: '正在生成大纲' });
    await assertJobActive(job);
    const { system, user } = buildStrategistPrompt(input);
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

const IMAGE_LAYOUTS = new Set(['content-image', 'text-image', 'image-text', 'full-image']);
const IMAGE_INTENT_PATTERN =
  /(配图|图片|插图|图示|示意图|视觉|场景图|海报|照片|封面图|背景图|产品图|架构图|流程图|路线图|信息图|生成图|image|illustration|visual|photo|poster|diagram|infographic)/i;

function slideNeedsImageServer(slide: SpecSlide) {
  if (String(slide.visualPrompt || '').trim()) return true;
  if (IMAGE_LAYOUTS.has(String(slide.layout || ''))) return true;

  const text = [
    slide.title,
    ...(slide.bullets || []),
    slide.speakerNotes,
    slide.chartHint,
  ].filter(Boolean).join(' ');

  return IMAGE_INTENT_PATTERN.test(text);
}

function imagePromptForSlide(slide: SpecSlide, spec?: DesignSpec) {
  const basePrompt = slide.visualPrompt || [slide.title, ...(slide.bullets || [])].filter(Boolean).join('，');
  if (!spec) return basePrompt;
  const slot = calculateImageSlot(slide, spec);
  return [
    basePrompt,
    `最终用于第 ${slide.pageNumber} 页 PPT 图片槽位，槽位坐标 x=${slot.x}, y=${slot.y}, width=${slot.width}, height=${slot.height}, 比例 ${slot.aspectRatio.toFixed(2)}:1，位置 ${slot.placement}`,
    '请按该槽位比例构图，主体居中并填满画面，避免大面积留白、边缘裁切重要内容、文字水印和截图边框'
  ].join('。');
}

function findReadyServerImage(images: any[], slideId: string) {
  return images.find((item) => item.slideId === slideId && item.selected && item.url && !item.error);
}

function findMissingRequiredImageSlides(spec: DesignSpec, images: any[]) {
  return spec.outline.filter((slide) => slideNeedsImageServer(slide) && !findReadyServerImage(images, slide.id));
}

function sortImagesByOutline(images: any[], spec: DesignSpec) {
  return images.slice().sort((a, b) => spec.outline.findIndex((s) => s.id === a.slideId) - spec.outline.findIndex((s) => s.id === b.slideId));
}

function upsertServerImage(images: any[], image: any) {
  const existingIndex = images.findIndex((item) => item.slideId === image.slideId);
  if (existingIndex >= 0) {
    images[existingIndex] = image;
  } else {
    images.push(image);
  }
}

function isFallbackSvgPage(svg?: string) {
  return Boolean(svg && svg.includes('本页待重试'));
}

function upsertServerSvgPage(
  pages: Array<{ pageNumber: number; svg: string; speakerNotes: string }>,
  page: { pageNumber: number; svg: string; speakerNotes: string }
) {
  const existingIndex = pages.findIndex((item) => item.pageNumber === page.pageNumber);
  if (existingIndex >= 0) {
    pages[existingIndex] = page;
  } else {
    pages.push(page);
  }
}

function sortServerSvgPages(pages: Array<{ pageNumber: number; svg: string; speakerNotes: string }>) {
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
  spec: DesignSpec,
  slide: SpecSlide,
  config: ImageModelConfig,
  attempt: number
): Promise<ServerImage> {
  await assertJobActive(job);
  const imageSlot = calculateImageSlot(slide, spec);
  const prompt = imagePromptForSlide(slide, spec);
  const rawImageUrl = await generateImage(config.provider, config.apiKey, config.model, prompt, job.payload.input.imageStyle, config.baseUrl, imageSlot);
  await assertJobActive(job);
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
    imageSlot,
  };
}

async function generateSlideImageWithAutoRetry(
  job: GenerateQueuedJob,
  spec: DesignSpec,
  slide: SpecSlide,
  config: ImageModelConfig,
  progress: number
): Promise<ServerImage> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= IMAGE_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      await assertJobActive(job);
      await updateJob(job, {
        phase: 'images',
        progress,
        message: attempt === 1 ? `正在生成图片：${slide.title}` : `正在自动重试图片：${slide.title}`,
      });
      return await generateSlideImageForQueue(job, spec, slide, config, attempt);
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
    prompt: imagePromptForSlide(slide, spec),
    style: job.payload.input.imageStyle,
    url: '',
    selected: true,
    error: true,
    errorMessage: lastError instanceof Error ? lastError.message : '图片生成失败',
    imageSlot: calculateImageSlot(slide, spec),
  };
}

async function maybeGenerateImages(
  job: GenerateQueuedJob,
  spec: DesignSpec,
  lock: SpecLock,
  existingImages: any[] = [],
  existingPages: Array<{ pageNumber: number; svg: string; speakerNotes: string }> = []
) {
  const results: any[] = sortImagesByOutline(existingImages, spec);
  if (job.payload.includeImages === false) return results;
  const slides = spec.outline
    .filter(slideNeedsImageServer)
    .filter((slide) => !findReadyServerImage(results, slide.id));
  if (!slides.length) return results;

  const imageConfig = await loadImageModelConfig(job);
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (cursor < slides.length) {
      await assertJobActive(job);
      const slide = slides[cursor++];
      const progress = 30 + Math.round((completed / Math.max(1, slides.length)) * 12);
      const image = await generateSlideImageWithAutoRetry(job, spec, slide, imageConfig, progress);
      await assertJobActive(job);
      upsertServerImage(results, image);
      completed += 1;
      const nextProgress = 30 + Math.round((completed / Math.max(1, slides.length)) * 12);
      await updateJob(job, {
        phase: 'images',
        progress: Math.min(44, nextProgress),
        message: image.error
          ? `图片未生成：${slide.title}`
          : `图片完成：${slide.title}，${completed}/${slides.length}`,
        result: { spec, lock, outline: spec.outline, images: sortImagesByOutline(results, spec), svgPages: sortServerSvgPages(existingPages) },
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, slides.length) }, () => worker()));
  const missingSlides = findMissingRequiredImageSlides(spec, results);
  if (missingSlides.length) {
    await updateJob(job, {
      phase: 'images',
      progress: 45,
      message: `图片自动重试后仍未完成：${missingSlides.map((slide) => slide.title).join('、')}`,
      result: { spec, lock, outline: spec.outline, images: sortImagesByOutline(results, spec), svgPages: sortServerSvgPages(existingPages) },
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
    await assertJobActive(job);
    await updateJob(job, {
      phase: 'images',
      progress: 45,
      message: `第 ${slide.pageNumber} 页缺少可用图片，正在自动重试：${slide.title}`,
      result: { spec, lock, outline: spec.outline, images, svgPages: [] },
    });
    const image = await generateSlideImageWithAutoRetry(job, spec, slide, imageConfig, 45);
    await assertJobActive(job);
    upsertServerImage(images, image);
    await updateJob(job, {
      phase: 'images',
      progress: 45,
      message: image.error ? `图片未生成：${slide.title}` : `图片完成：${slide.title}`,
      result: { spec, lock, outline: spec.outline, images: sortImagesByOutline(images, spec), svgPages: [] },
    });
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

  await assertJobActive(job);
  const imageConfig = await loadImageModelConfig(job);
  await updateJob(job, {
    phase: 'images',
    progress: 45,
    message: `第 ${slide.pageNumber} 页缺少可用图片，正在自动重试：${slide.title}`,
    result: { spec, lock, outline: spec.outline, images: sortImagesByOutline(images, spec), svgPages: pages.slice().sort((a, b) => a.pageNumber - b.pageNumber) },
  });

  const retryImage = await generateSlideImageWithAutoRetry(job, spec, slide, imageConfig, 45);
  await assertJobActive(job);
  upsertServerImage(images, retryImage);
  await updateJob(job, {
    phase: 'images',
    progress: 45,
    message: retryImage.error ? `图片未生成：${slide.title}` : `图片完成：${slide.title}`,
    result: { spec, lock, outline: spec.outline, images: sortImagesByOutline(images, spec), svgPages: pages.slice().sort((a, b) => a.pageNumber - b.pageNumber) },
  });
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
  model: string,
  existingPages: Array<{ pageNumber: number; svg: string; speakerNotes: string }> = []
) {
  const pages: Array<{ pageNumber: number; svg: string; speakerNotes: string }> = sortServerSvgPages(existingPages)
    .filter((page) => page.svg && !isFallbackSvgPage(page.svg));
  const existingPageNumbers = new Set(pages.map((page) => page.pageNumber));
  const slidesToGenerate = spec.outline.filter((slide) => !existingPageNumbers.has(slide.pageNumber));
  let cursor = 0;
  let completed = pages.length;

  await ensureRequiredImagesBeforeLayout(job, spec, lock, images);
  if (!slidesToGenerate.length) return sortServerSvgPages(pages);

  async function worker() {
    while (cursor < slidesToGenerate.length) {
      await assertJobActive(job);
      const slide = slidesToGenerate[cursor++];
      await updateJob(job, {
        phase: 'layout',
        progress: 50 + Math.round((completed / Math.max(1, spec.outline.length)) * 45),
        message: `正在生成第 ${slide.pageNumber} 页：${slide.title}`,
      });

      const image = await ensureServerImageForLayout(job, spec, lock, slide, images, pages);
      await assertJobActive(job);
      const svg = await generatePageSvg(spec, lock, slide, image?.url, provider, apiKey, baseUrl, model);
      await assertJobActive(job);
      upsertServerSvgPage(pages, { pageNumber: slide.pageNumber, svg, speakerNotes: slide.speakerNotes || '' });
      completed += 1;
      await updateJob(job, {
        phase: 'layout',
        progress: 50 + Math.round((completed / Math.max(1, spec.outline.length)) * 45),
        message: `第 ${slide.pageNumber} 页生成完成`,
        result: { spec, lock, outline: spec.outline, images, svgPages: sortServerSvgPages(pages) },
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

  const imageSlot = calculateImageSlot(slide, spec);
  const systemPrompt = buildExecutorSystemPrompt(slimSpec, slimLock);
  const userPrompt = buildExecutorPagePrompt(slide, slimSpec, slimLock, imageUrl, imageSlot);
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
    res.write(`data: ${JSON.stringify(snapshot)}\n\n`);

    if (snapshot.status === 'completed' || snapshot.status === 'failed' || snapshot.status === 'cancelled') {
      res.end();
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
      res.write(`data: ${payload}\n\n`);
      try {
        const next = JSON.parse(payload) as QueuedJobSnapshot;
        if (next.status === 'completed' || next.status === 'failed' || next.status === 'cancelled') {
          subscriber.disconnect();
          res.end();
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
