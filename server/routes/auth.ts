import express, { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { promises as fs } from 'fs';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { Redis } from 'ioredis';
import {
  getUserById,
  getUserByEmail,
  createUser,
  updateUser,
  deleteUser
} from '../models/user.js';
import {
  createExclusiveUserSession,
  extendSession,
  getActiveSession,
  getActiveSessionByRefreshToken,
  hashRefreshToken,
  revokeSession,
  revokeUserSessions,
  touchSession,
} from '../models/userSession.js';
import { deleteGeneratedAssetUrl } from '../utils/generatedAssets.js';
import { generatedAvatarsRoot } from '../utils/storage.js';
import { assertImageUploadSafe, normalizeContentType } from '../utils/uploadSecurity.js';

const router = Router();
const DEFAULT_JWT_SECRET = 'your-secret-key-change-in-production';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
const SALT_ROUNDS = 10;
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '1h';
const ACCESS_TOKEN_EXPIRES_SECONDS = Math.max(60, Number(process.env.ACCESS_TOKEN_EXPIRES_SECONDS || 60 * 60));
const REFRESH_TOKEN_EXPIRES_DAYS = Math.max(1, Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS || 7));

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 8);
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_REQUESTS = Number(process.env.AUTH_MAX_REQUESTS || 80);
const CAPTCHA_WINDOW_MS = 10 * 60 * 1000;
const CAPTCHA_MAX_REQUESTS = Number(process.env.CAPTCHA_MAX_REQUESTS || 30);
const CAPTCHA_MAX_REQUESTS_PER_USER_IP = Number(process.env.CAPTCHA_MAX_REQUESTS_PER_USER_IP || 12);
const CAPTCHA_MAX_REQUESTS_PER_IP = Number(process.env.CAPTCHA_MAX_REQUESTS_PER_IP || 120);
const CAPTCHA_EXPIRES_MS = 2 * 60 * 1000;
const CAPTCHA_TOKEN_EXPIRES_MS = 3 * 60 * 1000;
const CAPTCHA_MAX_ATTEMPTS = 4;
const EMAIL_CODE_TTL_SECONDS = Math.max(60, Number(process.env.EMAIL_CODE_TTL_SECONDS || 5 * 60));
const EMAIL_CODE_COOLDOWN_SECONDS = Math.max(30, Number(process.env.EMAIL_CODE_COOLDOWN_SECONDS || 60));
const EMAIL_CODE_MAX_PER_HOUR = Math.max(1, Number(process.env.EMAIL_CODE_MAX_PER_HOUR || 6));
const EMAIL_CODE_MAX_VERIFY_ATTEMPTS = Math.max(1, Number(process.env.EMAIL_CODE_MAX_VERIFY_ATTEMPTS || 5));
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'Nexious API <noreply@nexious-api.com>';
const REDIS_URL = process.env.REDIS_URL || process.env.BULLMQ_REDIS_URL || '';
const AUTH_REDIS_PREFIX = process.env.AUTH_REDIS_PREFIX || 'nexious:auth';
const EMAIL_CODE_SECRET = process.env.EMAIL_CODE_SECRET || JWT_SECRET;

const AVATAR_MAX_BYTES = Math.max(256 * 1024, Number(process.env.AVATAR_MAX_BYTES || 2 * 1024 * 1024));

const loginAttempts = new Map<string, { count: number; firstAt: number }>();
const authRequests = new Map<string, { count: number; firstAt: number }>();
const captchaRequests = new Map<string, { count: number; firstAt: number }>();
const captchaChallenges = new Map<string, {
  key: string;
  type: 'click' | 'slider';
  expiresAt: number;
  attempts: number;
  target: { x: number; y?: number; width?: number; height?: number; tolerance?: number };
}>();
const captchaTokens = new Map<string, { key: string; expiresAt: number; used: boolean }>();
let authRedis: Redis | null = null;

type EmailCodePurpose = 'register' | 'reset-password' | 'change-password';

type CaptchaVerifyResult =
  | { ok: true; captchaToken: string; expiresIn: number }
  | { ok: false; message: string };

if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEFAULT_JWT_SECRET) {
  throw new Error('JWT_SECRET must be configured in production');
}

export interface AuthRequest extends Request {
  userId?: number;
  sessionId?: string;
}

type AccessTokenPayload = {
  userId: number;
  sessionId: string;
  type: 'access';
};

type TokenVerifyResult =
  | { ok: true; payload: AccessTokenPayload }
  | { ok: false; code: 'TOKEN_EXPIRED' | 'TOKEN_INVALID'; message: string };

function refreshTokenExpiresAt(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
}

function generateAccessToken(userId: number, sessionId: string): string {
  return jwt.sign({ userId, sessionId, type: 'access' }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES_IN });
}

function verifyAccessToken(token: string): TokenVerifyResult {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as Partial<AccessTokenPayload>;
    if (
      payload.type !== 'access'
      || typeof payload.userId !== 'number'
      || typeof payload.sessionId !== 'string'
      || !payload.sessionId
    ) {
      return { ok: false, code: 'TOKEN_INVALID', message: '登录状态无效，请重新登录' };
    }
    return { ok: true, payload: payload as AccessTokenPayload };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return { ok: false, code: 'TOKEN_EXPIRED', message: '登录已过期，正在尝试自动续期' };
    }
    return { ok: false, code: 'TOKEN_INVALID', message: '登录状态已失效，请重新登录' };
  }
}

function createRefreshToken(): string {
  return `${randomUUID()}.${randomUUID()}`;
}

function authTokenPayload(userId: number, sessionId: string, refreshToken: string) {
  return {
    token: generateAccessToken(userId, sessionId),
    refreshToken,
    expiresIn: ACCESS_TOKEN_EXPIRES_SECONDS,
    tokenExpiresAt: Date.now() + ACCESS_TOKEN_EXPIRES_SECONDS * 1000,
  };
}

async function issueUserSession(req: Request, userId: number) {
  const sessionId = randomUUID();
  const refreshToken = createRefreshToken();
  await createExclusiveUserSession({
    userId,
    sessionId,
    refreshTokenHash: hashRefreshToken(refreshToken),
    userAgent: req.headers['user-agent']?.slice(0, 500) || null,
    ipAddress: clientIp(req).slice(0, 100),
    expiresAt: refreshTokenExpiresAt(),
  });
  return authTokenPayload(userId, sessionId, refreshToken);
}

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function isStrongPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 128 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

function redisRetryStrategy(times: number) {
  return Math.min(Math.max(times, 1) * 500, 5000);
}

function getAuthRedis(): Redis {
  if (!REDIS_URL) {
    throw new Error('邮件验证码服务未配置 Redis，请设置 REDIS_URL');
  }
  if (!authRedis) {
    authRedis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: false,
      connectTimeout: 5000,
      retryStrategy: redisRetryStrategy,
    });
    authRedis.on('error', (error) => {
      console.error('邮件验证码 Redis 连接错误:', error.message);
    });
    authRedis.on('end', () => {
      authRedis = null;
    });
  }
  return authRedis;
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function emailCodeKey(email: string, purpose: EmailCodePurpose): string {
  return `${AUTH_REDIS_PREFIX}:email-code:${purpose}:${hashValue(email)}`;
}

function emailCodeAttemptsKey(email: string, purpose: EmailCodePurpose): string {
  return `${AUTH_REDIS_PREFIX}:email-code-attempts:${purpose}:${hashValue(email)}`;
}

function emailCodeCooldownKey(req: Request, email: string, purpose: EmailCodePurpose): string {
  return `${AUTH_REDIS_PREFIX}:email-code-cooldown:${purpose}:${hashValue(email)}:${hashValue(clientIp(req))}`;
}

function emailCodeHourlyKey(req: Request, email: string, purpose: EmailCodePurpose): string {
  return `${AUTH_REDIS_PREFIX}:email-code-hour:${purpose}:${hashValue(email)}:${hashValue(clientIp(req))}`;
}

function hashEmailCode(email: string, purpose: EmailCodePurpose, code: string): string {
  return createHash('sha256')
    .update(`${EMAIL_CODE_SECRET}:${purpose}:${email}:${code}`)
    .digest('hex');
}

function safeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function emailCodePurposeLabel(purpose: EmailCodePurpose): string {
  if (purpose === 'register') return '注册账号';
  if (purpose === 'reset-password') return '重置密码';
  return '修改密码';
}

function normalizeEmailCode(value: unknown): string {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

async function enforceEmailCodeRateLimit(req: Request, email: string, purpose: EmailCodePurpose) {
  const redis = getAuthRedis();
  const cooldownKey = emailCodeCooldownKey(req, email, purpose);
  const cooldownTtl = await redis.ttl(cooldownKey);
  if (cooldownTtl > 0) {
    return { ok: false as const, retryAfter: cooldownTtl, message: `验证码发送太频繁，请 ${cooldownTtl} 秒后再试` };
  }

  const hourlyKey = emailCodeHourlyKey(req, email, purpose);
  const hourlyCount = await redis.incr(hourlyKey);
  if (hourlyCount === 1) await redis.expire(hourlyKey, 3600);
  if (hourlyCount > EMAIL_CODE_MAX_PER_HOUR) {
    return { ok: false as const, retryAfter: await redis.ttl(hourlyKey), message: '验证码请求过于频繁，请稍后再试' };
  }

  await redis.set(cooldownKey, '1', 'EX', EMAIL_CODE_COOLDOWN_SECONDS);
  return { ok: true as const };
}

async function sendEmailCode(email: string, purpose: EmailCodePurpose, code: string) {
  if (!RESEND_API_KEY) {
    throw new Error('邮件发送服务未配置 RESEND_API_KEY');
  }

  const label = emailCodePurposeLabel(purpose);
  const subject = `Nexious PPT ${label}验证码`;
  const text = `你的 Nexious PPT ${label}验证码是：${code}。验证码 ${Math.floor(EMAIL_CODE_TTL_SECONDS / 60)} 分钟内有效，请勿转发给他人。`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.7;color:#111827;">
      <h2 style="margin:0 0 12px;font-size:18px;">Nexious PPT ${label}</h2>
      <p style="margin:0 0 12px;">你的邮箱验证码是：</p>
      <p style="margin:0 0 16px;font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p>
      <p style="margin:0;color:#6B7280;">验证码 ${Math.floor(EMAIL_CODE_TTL_SECONDS / 60)} 分钟内有效。如非本人操作，请忽略此邮件。</p>
    </div>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [email],
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message = typeof data?.message === 'string' ? data.message : `HTTP ${response.status}`;
    throw new Error(`Resend 邮件发送失败：${message}`);
  }
}

async function createAndSendEmailCode(req: Request, email: string, purpose: EmailCodePurpose) {
  const rateLimit = await enforceEmailCodeRateLimit(req, email, purpose);
  if (!rateLimit.ok) return rateLimit;

  const redis = getAuthRedis();
  const code = String(randomInt(100000, 1000000));
  await redis.set(
    emailCodeKey(email, purpose),
    JSON.stringify({ hash: hashEmailCode(email, purpose, code), createdAt: Date.now() }),
    'EX',
    EMAIL_CODE_TTL_SECONDS
  );
  await redis.del(emailCodeAttemptsKey(email, purpose));
  await sendEmailCode(email, purpose, code);
  return { ok: true as const };
}

async function consumeEmailCode(email: string, purpose: EmailCodePurpose, rawCode: unknown) {
  const code = normalizeEmailCode(rawCode);
  if (!code || code.length !== 6) {
    return { ok: false as const, message: '请输入 6 位邮箱验证码' };
  }

  const redis = getAuthRedis();
  const key = emailCodeKey(email, purpose);
  const attemptsKey = emailCodeAttemptsKey(email, purpose);
  const stored = await redis.get(key);
  if (!stored) {
    return { ok: false as const, message: '邮箱验证码已过期，请重新获取' };
  }

  const attempts = await redis.incr(attemptsKey);
  if (attempts === 1) await redis.expire(attemptsKey, EMAIL_CODE_TTL_SECONDS);
  if (attempts > EMAIL_CODE_MAX_VERIFY_ATTEMPTS) {
    await redis.del(key, attemptsKey);
    return { ok: false as const, message: '验证码错误次数过多，请重新获取' };
  }

  const payload = JSON.parse(stored) as { hash?: string };
  if (!payload.hash || !safeEqualHex(payload.hash, hashEmailCode(email, purpose, code))) {
    return { ok: false as const, message: '邮箱验证码不正确' };
  }

  await redis.del(key, attemptsKey);
  return { ok: true as const };
}

function rateKey(req: Request, scope: string): string {
  return `${scope}:${clientIp(req)}`;
}

function emailScopedRateKey(req: Request, scope: string, email: unknown): string {
  const hash = createHash('sha256').update(normalizeEmail(email)).digest('hex').slice(0, 16);
  return `${scope}:${clientIp(req)}:${hash}`;
}

function isRateLimited(bucket: Map<string, { count: number; firstAt: number }>, key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = bucket.get(key);
  if (!entry || now - entry.firstAt > windowMs) {
    bucket.set(key, { count: 1, firstAt: now });
    return false;
  }
  entry.count += 1;
  return entry.count > maxRequests;
}

function checkCaptchaRateLimit(req: Request, email: unknown, action: 'request' | 'verify') {
  const ipLimited = isRateLimited(
    captchaRequests,
    rateKey(req, `captcha-${action}-ip`),
    CAPTCHA_MAX_REQUESTS_PER_IP,
    CAPTCHA_WINDOW_MS
  );
  if (ipLimited) {
    return {
      limited: true,
      message: '该 IP 验证码请求过于频繁，请稍后再试'
    };
  }

  const userIpLimited = isRateLimited(
    captchaRequests,
    emailScopedRateKey(req, `captcha-${action}-user-ip`, email),
    CAPTCHA_MAX_REQUESTS_PER_USER_IP,
    CAPTCHA_WINDOW_MS
  );
  if (userIpLimited) {
    return {
      limited: true,
      message: '该邮箱验证码请求过于频繁，请稍后再试'
    };
  }

  const actionLimited = isRateLimited(
    captchaRequests,
    emailScopedRateKey(req, `captcha-${action}`, email),
    CAPTCHA_MAX_REQUESTS,
    CAPTCHA_WINDOW_MS
  );
  return {
    limited: actionLimited,
    message: action === 'request' ? '验证码请求过于频繁，请稍后再试' : '验证码校验过于频繁，请稍后再试'
  };
}

function loginAttemptKey(req: Request, email: unknown): string {
  return `${clientIp(req)}:${normalizeEmail(email)}`;
}

function isLoginRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 0, firstAt: now });
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function recordLoginFailure(key: string) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
}

function clearLoginFailures(key: string) {
  loginAttempts.delete(key);
}

function cleanupCaptchaState() {
  const now = Date.now();
  for (const [id, challenge] of captchaChallenges) {
    if (challenge.expiresAt <= now) captchaChallenges.delete(id);
  }
  for (const [token, entry] of captchaTokens) {
    if (entry.expiresAt <= now || entry.used) captchaTokens.delete(token);
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildShapePath(kind: string, x: number, y: number) {
  if (kind === 'circle') return `<circle cx="${x}" cy="${y}" r="18" />`;
  if (kind === 'diamond') return `<path d="M${x} ${y - 22}L${x + 22} ${y}L${x} ${y + 22}L${x - 22} ${y}Z" />`;
  if (kind === 'shield') return `<path d="M${x - 18} ${y - 20}H${x + 18}V${y + 2}C${x + 18} ${y + 18} ${x + 5} ${y + 27} ${x} ${y + 30}C${x - 5} ${y + 27} ${x - 18} ${y + 18} ${x - 18} ${y + 2}Z" />`;
  if (kind === 'flag') return `<path d="M${x - 17} ${y + 22}V${y - 22}H${x + 17}L${x + 7} ${y - 6}L${x + 17} ${y + 10}H${x - 17}Z" />`;
  if (kind === 'triangle') return `<path d="M${x} ${y - 25}L${x + 25} ${y + 20}H${x - 25}Z" />`;
  if (kind === 'hexagon') return `<path d="M${x - 20} ${y - 12}L${x} ${y - 25}L${x + 20} ${y - 12}V${y + 12}L${x} ${y + 25}L${x - 20} ${y + 12}Z" />`;
  return `<path d="M${x} ${y - 23}L${x + 7} ${y - 7}L${x + 24} ${y - 6}L${x + 10} ${y + 5}L${x + 15} ${y + 22}L${x} ${y + 12}L${x - 15} ${y + 22}L${x - 10} ${y + 5}L${x - 24} ${y - 6}L${x - 7} ${y - 7}Z" />`;
}

function randomFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pickOne<T>(items: T[]): T {
  return items[randomInt(0, items.length)];
}

function shuffled<T>(items: T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1);
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function createRandomPositions(count: number) {
  const positions: Array<{ x: number; y: number }> = [];
  let guard = 0;
  while (positions.length < count && guard < 120) {
    guard += 1;
    const candidate = { x: randomInt(48, 273), y: randomInt(58, 134) };
    const farEnough = positions.every(pos => Math.hypot(pos.x - candidate.x, pos.y - candidate.y) >= 62);
    if (farEnough) positions.push(candidate);
  }
  while (positions.length < count) {
    positions.push({ x: randomInt(48, 273), y: randomInt(58, 134) });
  }
  return positions;
}

function createBackgroundMarks(count: number) {
  const colors = ['#E2E8F0', '#CBD5E1', '#D9E6E2', '#E8E0D4', '#DBE7F3'];
  return Array.from({ length: count }, () => {
    const x = randomInt(18, 292);
    const y = randomInt(40, 138);
    const w = randomInt(12, 42);
    const h = randomInt(5, 18);
    const rx = randomInt(3, 8);
    const opacity = randomFloat(0.38, 0.74).toFixed(2);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${pickOne(colors)}" opacity="${opacity}" />`;
  }).join('');
}

function createClickCaptcha(email: unknown, req: Request) {
  cleanupCaptchaState();
  const challengeId = randomUUID();
  const key = emailScopedRateKey(req, 'captcha', email);
  const palette = shuffled(['#334155', '#0F766E', '#B45309', '#7F1D1D', '#1D4ED8', '#166534', '#92400E', '#4338CA']);
  const shapes = shuffled([
    { kind: 'shield', label: '盾牌' },
    { kind: 'star', label: '星形' },
    { kind: 'diamond', label: '菱形' },
    { kind: 'flag', label: '旗帜' },
    { kind: 'circle', label: '圆形' },
    { kind: 'triangle', label: '三角形' },
    { kind: 'hexagon', label: '六边形' }
  ]).slice(0, randomInt(5, 8));
  const targetIndex = randomInt(0, shapes.length);
  const positions = createRandomPositions(shapes.length);
  const backgroundMarks = createBackgroundMarks(randomInt(6, 12));

  const elements = shapes.map((shape, index) => {
    const pos = positions[index];
    const scale = randomFloat(0.82, 1.22).toFixed(2);
    const rotation = randomInt(-22, 23);
    const opacity = index === targetIndex ? '0.96' : '0.72';
    return `<g transform="translate(${pos.x} ${pos.y}) rotate(${rotation}) scale(${scale}) translate(${-pos.x} ${-pos.y})" fill="${palette[index]}" stroke="#0F172A" stroke-width="2" opacity="${opacity}">
      ${buildShapePath(shape.kind, pos.x, pos.y)}
    </g>`;
  }).join('');

  const targetPos = positions[targetIndex];
  const targetSize = 64;
  captchaChallenges.set(challengeId, {
    key,
    type: 'click',
    expiresAt: Date.now() + CAPTCHA_EXPIRES_MS,
    attempts: 0,
    target: { x: targetPos.x - targetSize / 2, y: targetPos.y - targetSize / 2 + 10, width: targetSize, height: targetSize }
  });

  const prompt = `请点击图中的${shapes[targetIndex].label}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 170" role="img" aria-label="${escapeXml(prompt)}">
    <rect width="320" height="170" rx="10" fill="#F8FAFC" />
    <rect x="1" y="1" width="318" height="168" rx="9" fill="none" stroke="#CBD5E1" />
    <text x="18" y="26" font-size="15" font-weight="700" fill="#0F172A">${escapeXml(prompt)}</text>
    <g>${backgroundMarks}</g>
    <g transform="translate(0 10)">${elements}</g>
    <path d="M18 146H302" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="4 5" />
  </svg>`;

  return { challengeId, type: 'click' as const, prompt, imageSvg: svg, expiresIn: Math.floor(CAPTCHA_EXPIRES_MS / 1000) };
}

function buildPuzzlePath(size: number, variant: number) {
  const notch = Math.round(size * 0.22);
  const mid = Math.round(size * 0.5);
  if (variant === 1) {
    return [
      `M4 4H${size - 4}V${mid - notch}`,
      `C${size - 2} ${mid - notch} ${size - 2} ${mid + notch} ${size - 4} ${mid + notch}`,
      `V${size - 4}H${mid + notch}`,
      `C${mid + notch} ${size} ${mid - notch} ${size} ${mid - notch} ${size - 4}`,
      'H4V4Z'
    ].join('');
  }
  if (variant === 2) {
    return [
      `M5 5H${mid - notch}`,
      `C${mid - notch} 1 ${mid + notch} 1 ${mid + notch} 5`,
      `H${size - 5}V${size - 5}H5V${mid + notch}`,
      `C1 ${mid + notch} 1 ${mid - notch} 5 ${mid - notch}`,
      'Z'
    ].join('');
  }
  if (variant === 3) {
    return [
      `M5 5H${size - 5}V${mid - notch}`,
      `C${size - 1} ${mid - notch} ${size - 1} ${mid + notch} ${size - 5} ${mid + notch}`,
      `V${size - 5}H${mid - notch}`,
      `C${mid - notch} ${size - 1} ${mid + notch} ${size - 1} ${mid + notch} ${size - 5}`,
      'H5Z'
    ].join('');
  }
  return [
    `M4 4H${mid - notch}`,
    `C${mid - notch} 0 ${mid + notch} 0 ${mid + notch} 4`,
    `H${size - 4}V${mid - notch}`,
    `C${size} ${mid - notch} ${size} ${mid + notch} ${size - 4} ${mid + notch}`,
    `V${size - 4}H4V${mid + notch}`,
    `C0 ${mid + notch} 0 ${mid - notch} 4 ${mid - notch}`,
    'Z'
  ].join('');
}

function createSliderCaptcha(email: unknown, req: Request) {
  cleanupCaptchaState();
  const challengeId = randomUUID();
  const key = emailScopedRateKey(req, 'captcha', email);
  const pieceSize = randomInt(42, 57);
  const targetX = randomInt(118, 292 - pieceSize);
  const pieceY = randomInt(52, 122 - pieceSize);
  const initialX = randomInt(8, 37);
  const prompt = '拖动滑块完成拼图';
  const puzzlePath = buildPuzzlePath(pieceSize, randomInt(0, 4));
  const fill = pickOne(['#E2E8F0', '#D9E6E2', '#E8E0D4', '#DBE7F3', '#E7E5E4']);
  const accent = pickOne(['#0F766E', '#334155', '#B45309', '#1D4ED8', '#7F1D1D']);
  const backgroundFill = pickOne(['#F8FAFC', '#F6F8F5', '#FAF8F4', '#F7F9FB']);
  const backgroundMarks = createBackgroundMarks(randomInt(9, 17));
  const guideY = randomInt(140, 150);

  captchaChallenges.set(challengeId, {
    key,
    type: 'slider',
    expiresAt: Date.now() + CAPTCHA_EXPIRES_MS,
    attempts: 0,
    target: { x: targetX, tolerance: Math.max(6, Math.round(pieceSize * 0.16)) }
  });

  const imageSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 170" role="img" aria-label="${escapeXml(prompt)}">
    <rect width="320" height="170" rx="10" fill="${backgroundFill}" />
    <rect x="1" y="1" width="318" height="168" rx="9" fill="none" stroke="#CBD5E1" />
    <text x="18" y="26" font-size="15" font-weight="700" fill="#0F172A">${escapeXml(prompt)}</text>
    <g>${backgroundMarks}</g>
    <g transform="translate(${targetX} ${pieceY})">
      <path d="${puzzlePath}" fill="#FFFFFF" stroke="#64748B" stroke-width="2" opacity="0.88" />
      <path d="${puzzlePath}" fill="none" stroke="#0F172A" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.45" />
    </g>
    <path d="M18 ${guideY}H302" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="4 5" />
  </svg>`;

  const pieceSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pieceSize} ${pieceSize}" role="img" aria-label="滑块拼图块">
    <path d="${puzzlePath}" fill="${fill}" stroke="#0F172A" stroke-width="2" />
    <path d="M10 12H34M10 24H30M10 36H26" stroke="${accent}" stroke-width="3" stroke-linecap="round" opacity="0.85" />
  </svg>`;

  return {
    challengeId,
    type: 'slider' as const,
    prompt,
    imageSvg,
    pieceSvg,
    initialX,
    pieceY,
    pieceSize,
    trackWidth: 320,
    expiresIn: Math.floor(CAPTCHA_EXPIRES_MS / 1000)
  };
}

function createCaptcha(email: unknown, req: Request) {
  return randomInt(0, 2) === 0 ? createClickCaptcha(email, req) : createSliderCaptcha(email, req);
}

function issueCaptchaToken(req: Request, email: unknown, challengeId: unknown): CaptchaVerifyResult {
  captchaChallenges.delete(String(challengeId || ''));
  const captchaToken = randomUUID();
  captchaTokens.set(captchaToken, {
    key: emailScopedRateKey(req, 'captcha', email),
    expiresAt: Date.now() + CAPTCHA_TOKEN_EXPIRES_MS,
    used: false
  });
  return { ok: true, captchaToken, expiresIn: Math.floor(CAPTCHA_TOKEN_EXPIRES_MS / 1000) };
}

function verifyCaptchaChallenge(req: Request, email: unknown, challengeId: unknown, x: unknown, y: unknown): CaptchaVerifyResult {
  cleanupCaptchaState();
  const challenge = captchaChallenges.get(String(challengeId || ''));
  if (!challenge) return { ok: false, message: '验证码已过期，请刷新后重试' };
  if (challenge.key !== emailScopedRateKey(req, 'captcha', email)) {
    captchaChallenges.delete(String(challengeId || ''));
    return { ok: false, message: '验证码与当前邮箱不匹配，请重新获取' };
  }

  challenge.attempts += 1;
  if (challenge.attempts > CAPTCHA_MAX_ATTEMPTS) {
    captchaChallenges.delete(String(challengeId || ''));
    return { ok: false, message: '验证码尝试次数过多，请刷新后重试' };
  }

  const px = Number(x);
  const target = challenge.target;
  let matched = false;
  if (challenge.type === 'click') {
    const py = Number(y);
    matched = Number.isFinite(px) && Number.isFinite(py)
      && target.y !== undefined
      && target.width !== undefined
      && target.height !== undefined
      && px >= target.x
      && px <= target.x + target.width
      && py >= target.y
      && py <= target.y + target.height;
  } else {
    matched = Number.isFinite(px) && Math.abs(px - target.x) <= (target.tolerance ?? 6);
  }

  if (!matched) {
    return {
      ok: false,
      message: challenge.type === 'slider' ? '滑块位置不正确，请再试一次' : '点击位置不正确，请再试一次'
    };
  }

  return issueCaptchaToken(req, email, challengeId);
}

function consumeCaptchaToken(req: Request, email: unknown, captchaToken: unknown): boolean {
  cleanupCaptchaState();
  const token = String(captchaToken || '');
  const entry = captchaTokens.get(token);
  if (!entry || entry.used || entry.expiresAt <= Date.now()) {
    captchaTokens.delete(token);
    return false;
  }
  if (entry.key !== emailScopedRateKey(req, 'captcha', email)) return false;
  entry.used = true;
  captchaTokens.delete(token);
  return true;
}

async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: '请先登录后再操作'
      });
    }

    const token = authHeader.substring(7);
    const decoded = verifyAccessToken(token);

    if (!decoded.ok) {
      return res.status(401).json({
        success: false,
        code: decoded.code,
        message: decoded.message
      });
    }

    const session = await getActiveSession(decoded.payload.userId, decoded.payload.sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        code: 'SESSION_REPLACED',
        message: '账号已在另一台设备登录，当前设备已下线'
      });
    }

    void touchSession(decoded.payload.userId, decoded.payload.sessionId).catch((error) => {
      console.warn('更新会话活跃时间失败:', error);
    });
    req.userId = decoded.payload.userId;
    req.sessionId = decoded.payload.sessionId;
    next();
  } catch (error) {
    console.error('认证会话校验错误:', error);
    res.status(500).json({
      success: false,
      code: 'AUTH_SESSION_CHECK_FAILED',
      message: '登录状态校验失败，请稍后再试'
    });
  }
}

router.post('/captcha', async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: '请先输入有效邮箱'
      });
    }
    const captchaRateLimit = checkCaptchaRateLimit(req, email, 'request');
    if (captchaRateLimit.limited) {
      return res.status(429).json({
        success: false,
        code: 'CAPTCHA_RATE_LIMITED',
        message: captchaRateLimit.message
      });
    }

    res.json({
      success: true,
      data: createCaptcha(email, req)
    });
  } catch (error) {
    console.error('创建验证码错误:', error);
    res.status(500).json({
      success: false,
      message: '验证码创建失败'
    });
  }
});

router.post('/captcha/verify', async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const { challengeId, x, y } = req.body || {};
    if (!isValidEmail(email) || !challengeId) {
      return res.status(400).json({
        success: false,
        message: '验证码参数不完整'
      });
    }
    const captchaRateLimit = checkCaptchaRateLimit(req, email, 'verify');
    if (captchaRateLimit.limited) {
      return res.status(429).json({
        success: false,
        code: 'CAPTCHA_RATE_LIMITED',
        message: captchaRateLimit.message
      });
    }

    const result = verifyCaptchaChallenge(req, email, challengeId, x, y);
    if (result.ok === false) {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }

    res.json({
      success: true,
      data: {
        captchaToken: result.captchaToken,
        expiresIn: result.expiresIn
      },
      message: '验证码通过'
    });
  } catch (error) {
    console.error('校验验证码错误:', error);
    res.status(500).json({
      success: false,
      message: '验证码校验失败'
    });
  }
});

router.post('/email-code', async (req: Request, res: Response) => {
  try {
    if (isRateLimited(authRequests, rateKey(req, 'email-code'), AUTH_MAX_REQUESTS, AUTH_WINDOW_MS)) {
      return res.status(429).json({
        success: false,
        code: 'AUTH_RATE_LIMITED',
        message: '请求过于频繁，请稍后再试'
      });
    }

    const email = normalizeEmail(req.body?.email);
    const purpose = String(req.body?.purpose || '') as EmailCodePurpose;
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: '请输入有效邮箱'
      });
    }
    if (purpose !== 'register' && purpose !== 'reset-password') {
      return res.status(400).json({
        success: false,
        message: '验证码用途不正确'
      });
    }

    const existingUser = await getUserByEmail(email);
    if (purpose === 'register' && existingUser) {
      return res.status(400).json({
        success: false,
        message: '该邮箱已被注册'
      });
    }

    if (purpose === 'reset-password' && !existingUser) {
      return res.json({
        success: true,
        data: { expiresIn: EMAIL_CODE_TTL_SECONDS, cooldown: EMAIL_CODE_COOLDOWN_SECONDS },
        message: '如果邮箱存在，验证码已发送'
      });
    }

    const result = await createAndSendEmailCode(req, email, purpose);
    if (!result.ok) {
      return res.status(429).json({
        success: false,
        code: 'EMAIL_CODE_RATE_LIMITED',
        data: { retryAfter: result.retryAfter },
        message: result.message
      });
    }

    res.json({
      success: true,
      data: { expiresIn: EMAIL_CODE_TTL_SECONDS, cooldown: EMAIL_CODE_COOLDOWN_SECONDS },
      message: '邮箱验证码已发送'
    });
  } catch (error) {
    console.error('发送邮箱验证码错误:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error && /Redis|RESEND_API_KEY/.test(error.message)
        ? error.message
        : '邮箱验证码发送失败'
    });
  }
});

router.post('/me/email-code', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      });
    }
    if (isRateLimited(authRequests, rateKey(req, 'me-email-code'), AUTH_MAX_REQUESTS, AUTH_WINDOW_MS)) {
      return res.status(429).json({
        success: false,
        code: 'AUTH_RATE_LIMITED',
        message: '请求过于频繁，请稍后再试'
      });
    }

    const user = await getUserById(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    const result = await createAndSendEmailCode(req, user.email, 'change-password');
    if (!result.ok) {
      return res.status(429).json({
        success: false,
        code: 'EMAIL_CODE_RATE_LIMITED',
        data: { retryAfter: result.retryAfter },
        message: result.message
      });
    }

    res.json({
      success: true,
      data: { expiresIn: EMAIL_CODE_TTL_SECONDS, cooldown: EMAIL_CODE_COOLDOWN_SECONDS },
      message: '邮箱验证码已发送'
    });
  } catch (error) {
    console.error('发送修改密码邮箱验证码错误:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error && /Redis|RESEND_API_KEY/.test(error.message)
        ? error.message
        : '邮箱验证码发送失败'
    });
  }
});

router.post('/register', async (req: Request, res: Response) => {
  try {
    if (isRateLimited(authRequests, rateKey(req, 'register'), AUTH_MAX_REQUESTS, AUTH_WINDOW_MS)) {
      return res.status(429).json({
        success: false,
        code: 'AUTH_RATE_LIMITED',
        message: '请求过于频繁，请稍后再试'
      });
    }

    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const emailCode = req.body?.emailCode ?? req.body?.code;

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: '请输入有效邮箱'
      });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        success: false,
        message: '密码至少 8 位，且需要包含字母和数字'
      });
    }

    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: '该邮箱已被注册'
      });
    }

    const emailCodeResult = await consumeEmailCode(email, 'register', emailCode);
    if (!emailCodeResult.ok) {
      return res.status(400).json({
        success: false,
        code: 'EMAIL_CODE_INVALID',
        message: emailCodeResult.message
      });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const userId = await createUser({
      email,
      password_hash: passwordHash,
      name
    });

    const authTokens = await issueUserSession(req, userId);

    res.status(201).json({
      success: true,
      data: {
        userId,
        email,
        name,
        ...authTokens
      },
      message: '注册成功'
    });
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({
      success: false,
      message: '注册失败',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    if (isRateLimited(authRequests, rateKey(req, 'reset-password'), AUTH_MAX_REQUESTS, AUTH_WINDOW_MS)) {
      return res.status(429).json({
        success: false,
        code: 'AUTH_RATE_LIMITED',
        message: '请求过于频繁，请稍后再试'
      });
    }

    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const emailCode = req.body?.emailCode ?? req.body?.code;

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: '请输入有效邮箱'
      });
    }
    if (!isStrongPassword(password)) {
      return res.status(400).json({
        success: false,
        message: '新密码至少 8 位，且需要包含字母和数字'
      });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(400).json({
        success: false,
        message: '邮箱验证码不正确或已过期'
      });
    }

    const emailCodeResult = await consumeEmailCode(email, 'reset-password', emailCode);
    if (!emailCodeResult.ok) {
      return res.status(400).json({
        success: false,
        code: 'EMAIL_CODE_INVALID',
        message: emailCodeResult.message
      });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const success = await updateUser(user.id, { password_hash: passwordHash });
    if (!success) {
      return res.status(400).json({
        success: false,
        message: '重置密码失败'
      });
    }

    await revokeUserSessions(user.id);
    clearLoginFailures(loginAttemptKey(req, email));
    res.json({
      success: true,
      message: '密码已重置，请使用新密码登录'
    });
  } catch (error) {
    console.error('重置密码错误:', error);
    res.status(500).json({
      success: false,
      message: '重置密码失败'
    });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    if (isRateLimited(authRequests, rateKey(req, 'login'), AUTH_MAX_REQUESTS, AUTH_WINDOW_MS)) {
      return res.status(429).json({
        success: false,
        code: 'AUTH_RATE_LIMITED',
        message: '请求过于频繁，请稍后再试'
      });
    }

    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const captchaToken = req.body?.captchaToken;
    const attemptKey = loginAttemptKey(req, email);

    if (!isValidEmail(email) || !password) {
      return res.status(400).json({
        success: false,
        message: '邮箱或密码格式不正确'
      });
    }

    if (isLoginRateLimited(attemptKey)) {
      return res.status(429).json({
        success: false,
        code: 'LOGIN_RATE_LIMITED',
        message: '登录失败次数过多，请稍后再试'
      });
    }

    if (!consumeCaptchaToken(req, email, captchaToken)) {
      recordLoginFailure(attemptKey);
      return res.status(400).json({
        success: false,
        code: 'CAPTCHA_REQUIRED',
        message: '请先完成图片验证码'
      });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      recordLoginFailure(attemptKey);
      return res.status(401).json({
        success: false,
        message: '邮箱或密码错误'
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      recordLoginFailure(attemptKey);
      return res.status(401).json({
        success: false,
        message: '邮箱或密码错误'
      });
    }

    clearLoginFailures(attemptKey);
    const authTokens = await issueUserSession(req, user.id);

    res.json({
      success: true,
      data: {
        userId: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        ...authTokens
      },
      message: '登录成功'
    });
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({
      success: false,
      message: '登录失败',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

router.post('/refresh', async (req: Request, res: Response) => {
  try {
    if (isRateLimited(authRequests, rateKey(req, 'refresh'), AUTH_MAX_REQUESTS, AUTH_WINDOW_MS)) {
      return res.status(429).json({
        success: false,
        code: 'AUTH_RATE_LIMITED',
        message: '请求过于频繁，请稍后再试'
      });
    }

    const refreshToken = String(req.body?.refreshToken || '').trim();
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        code: 'REFRESH_TOKEN_REQUIRED',
        message: '请重新登录'
      });
    }

    const oldRefreshTokenHash = hashRefreshToken(refreshToken);
    const session = await getActiveSessionByRefreshToken(oldRefreshTokenHash);
    if (!session) {
      return res.status(401).json({
        success: false,
        code: 'SESSION_REPLACED',
        message: '账号已在另一台设备登录，当前设备已下线'
      });
    }

    const user = await getUserById(session.user_id);
    if (!user) {
      await revokeSession(session.user_id, session.session_id);
      return res.status(401).json({
        success: false,
        code: 'USER_NOT_FOUND',
        message: '用户不存在，请重新登录'
      });
    }

    const extended = await extendSession({
      userId: session.user_id,
      sessionId: session.session_id,
      refreshTokenHash: oldRefreshTokenHash,
      expiresAt: refreshTokenExpiresAt(),
      userAgent: req.headers['user-agent']?.slice(0, 500) || null,
      ipAddress: clientIp(req).slice(0, 100),
    });

    if (!extended) {
      return res.status(401).json({
        success: false,
        code: 'SESSION_REPLACED',
        message: '登录状态已更新，请重新登录'
      });
    }

    res.json({
      success: true,
      data: {
        userId: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        ...authTokenPayload(user.id, session.session_id, refreshToken)
      },
      message: '登录状态已续期'
    });
  } catch (error) {
    console.error('刷新登录状态错误:', error);
    res.status(500).json({
      success: false,
      message: '刷新登录状态失败'
    });
  }
});

router.post('/logout', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (req.userId && req.sessionId) {
      await revokeSession(req.userId, req.sessionId);
    }
    res.json({
      success: true,
      message: '已退出登录'
    });
  } catch (error) {
    console.error('退出登录错误:', error);
    res.status(500).json({
      success: false,
      message: '退出登录失败'
    });
  }
});

router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      });
    }

    const user = await getUserById(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    res.json({
      success: true,
      data: {
        userId: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(500).json({
      success: false,
      message: '获取用户信息失败'
    });
  }
});

router.put('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      });
    }

    const { name, avatar, currentPassword, password } = req.body;
    const emailCode = req.body?.emailCode ?? req.body?.code;
    const updateData: any = {};
    const oldUser = await getUserById(req.userId);
    if (!oldUser) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    if (name !== undefined) updateData.name = String(name || '').trim().slice(0, 80);
    if (avatar !== undefined) {
      const avatarValue = String(avatar || '');
      if (avatarValue.startsWith('data:')) {
        return res.status(400).json({
          success: false,
          message: '头像请通过上传接口保存，不能写入 base64 数据'
        });
      }
      if (avatarValue.length > 500) {
        return res.status(400).json({
          success: false,
          message: '头像地址过长'
        });
      }
      updateData.avatar = avatarValue || null;
    }
    if (password) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: '请输入当前密码'
        });
      }
      if (!isStrongPassword(String(password))) {
        return res.status(400).json({
          success: false,
          message: '新密码至少 8 位，且需要包含字母和数字'
        });
      }
      if (!(await bcrypt.compare(currentPassword, oldUser.password_hash))) {
        return res.status(400).json({
          success: false,
          message: '当前密码不正确'
        });
      }
      const emailCodeResult = await consumeEmailCode(oldUser.email, 'change-password', emailCode);
      if (!emailCodeResult.ok) {
        return res.status(400).json({
          success: false,
          code: 'EMAIL_CODE_INVALID',
          message: emailCodeResult.message
        });
      }
      updateData.password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有提供要更新的数据'
      });
    }

    const success = await updateUser(req.userId, updateData);
    if (!success) {
      return res.status(400).json({
        success: false,
        message: '更新失败'
      });
    }

    const user = await getUserById(req.userId);
    if (avatar !== undefined && oldUser.avatar && oldUser.avatar !== (updateData.avatar || null)) {
      await deleteGeneratedAssetUrl(oldUser.avatar).catch(() => undefined);
    }
    if (updateData.password_hash) {
      await revokeUserSessions(req.userId);
    }
    res.json({
      success: true,
      data: {
        userId: user?.id,
        email: user?.email,
        name: user?.name,
        avatar: user?.avatar
      },
      message: updateData.password_hash ? '密码已更新，请重新登录' : '更新成功'
    });
  } catch (error) {
    console.error('更新用户信息错误:', error);
    res.status(500).json({
      success: false,
      message: '更新用户信息失败'
    });
  }
});

router.put(
  '/me/avatar',
  authMiddleware,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], limit: AVATAR_MAX_BYTES }),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.userId) {
        return res.status(401).json({
          success: false,
          message: '未授权'
        });
      }

      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({
          success: false,
          message: '请选择头像图片'
        });
      }

      let uploadInfo: { extension: string };
      try {
        uploadInfo = assertImageUploadSafe(req.body, {
          label: '头像图片',
          maxBytes: AVATAR_MAX_BYTES,
          declaredMime: normalizeContentType(req.headers['content-type']),
          allowSvg: false,
        });
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: error instanceof Error ? error.message : '头像图片格式不正确'
        });
      }

      const oldUser = await getUserById(req.userId);
      const avatarDir = generatedAvatarsRoot;
      await fs.mkdir(avatarDir, { recursive: true });
      const fileName = `${req.userId}-${Date.now()}-${randomUUID()}.${uploadInfo.extension}`;
      const filePath = path.join(avatarDir, fileName);
      await fs.writeFile(filePath, req.body);

      const avatarUrl = `/avatars/${fileName}`;
      const success = await updateUser(req.userId, { avatar: avatarUrl });
      if (!success) {
        await deleteGeneratedAssetUrl(avatarUrl).catch(() => undefined);
        return res.status(400).json({
          success: false,
          message: '头像保存失败'
        });
      }

      const user = await getUserById(req.userId);
      if (oldUser?.avatar && oldUser.avatar !== avatarUrl) {
        await deleteGeneratedAssetUrl(oldUser.avatar).catch(() => undefined);
      }
      res.json({
        success: true,
        data: {
          userId: user?.id,
          email: user?.email,
          name: user?.name,
          avatar: user?.avatar
        },
        message: '头像已更新'
      });
    } catch (error) {
      console.error('上传头像错误:', error);
      res.status(500).json({
        success: false,
        message: '上传头像失败'
      });
    }
  }
);

router.delete('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: '未授权'
      });
    }

    const oldUser = await getUserById(req.userId);
    const success = await deleteUser(req.userId);
    if (!success) {
      return res.status(400).json({
        success: false,
        message: '删除失败'
      });
    }

    await deleteGeneratedAssetUrl(oldUser?.avatar).catch(() => undefined);
    res.json({
      success: true,
      message: '账户已删除'
    });
  } catch (error) {
    console.error('删除用户错误:', error);
    res.status(500).json({
      success: false,
      message: '删除用户失败'
    });
  }
});

export default router;
export { authMiddleware };
