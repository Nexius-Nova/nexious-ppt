import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { authMiddleware, AuthRequest } from './auth.js';
import { query } from '../db/connection.js';
import { deleteGeneratedAssetUrl } from '../utils/generatedAssets.js';
import { generatedImagesRoot, publicBaseUrl } from '../utils/storage.js';
import { assertImageUploadSafe, decodeBase64Upload } from '../utils/uploadSecurity.js';

const router = Router();
const PROMPT_PREVIEW_DIR = path.join(generatedImagesRoot, 'prompt-previews');
const MAX_PREVIEW_IMAGE_BYTES = Math.max(512 * 1024, Number(process.env.PROMPT_PREVIEW_IMAGE_MAX_BYTES || 8 * 1024 * 1024));

function publicGeneratedImageUrl(pathname: string) {
  return `${publicBaseUrl()}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

router.use(authMiddleware);

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const prompts = await query(
      'SELECT id, title, scene, content, preview_url, created_at, updated_at FROM prompts WHERE user_id = ? ORDER BY updated_at DESC',
      [req.userId]
    );
    res.json({ success: true, data: prompts });
  } catch (error) {
    console.error('获取提示词列表失败:', error);
    res.status(500).json({ success: false, message: '获取提示词列表失败' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const prompts = await query(
      'SELECT id, title, scene, content, preview_url, created_at, updated_at FROM prompts WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (prompts.length === 0) {
      return res.status(404).json({ success: false, message: '提示词不存在' });
    }
    res.json({ success: true, data: prompts[0] });
  } catch (error) {
    console.error('获取提示词详情失败:', error);
    res.status(500).json({ success: false, message: '获取提示词详情失败' });
  }
});

router.post('/preview-image', async (req: AuthRequest, res: Response) => {
  try {
    const { filename, dataUrl } = req.body as { filename?: string; dataUrl?: string };
    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ success: false, message: '请上传有效的预览图' });
    }

    const match = dataUrl.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,/);
    if (!match) {
      return res.status(400).json({ success: false, message: '预览图仅支持 PNG、JPG、WEBP 或 GIF 格式' });
    }

    let buffer: Buffer;
    let uploadInfo: { extension: string };
    try {
      buffer = decodeBase64Upload(dataUrl, '预览图');
      uploadInfo = assertImageUploadSafe(buffer, {
        label: '预览图',
        maxBytes: MAX_PREVIEW_IMAGE_BYTES,
        declaredMime: match[1],
        filename,
        allowSvg: false,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : '预览图格式不正确'
      });
    }

    await fs.mkdir(PROMPT_PREVIEW_DIR, { recursive: true });
    const fileName = `${req.userId || 'user'}-${Date.now()}-${randomUUID()}.${uploadInfo.extension}`;
    await fs.writeFile(path.join(PROMPT_PREVIEW_DIR, fileName), buffer);

    const previewPath = `/generated-images/prompt-previews/${fileName}`;
    res.json({
      success: true,
      data: { url: publicGeneratedImageUrl(previewPath) },
      message: '预览图上传成功',
    });
  } catch (error) {
    console.error('上传提示词预览图失败', error);
    res.status(500).json({ success: false, message: '上传提示词预览图失败' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { title, scene, content, preview_url } = req.body;
    if (!title || !content) {
      return res.status(400).json({ success: false, message: '标题和内容不能为空' });
    }
    const result = await query(
      'INSERT INTO prompts (user_id, title, scene, content, preview_url) VALUES (?, ?, ?, ?, ?)',
      [req.userId, title, scene || '', content, preview_url || null]
    );
    const newPrompt = await query(
      'SELECT id, title, scene, content, preview_url, created_at, updated_at FROM prompts WHERE id = ?',
      [(result as any).insertId]
    );
    res.status(201).json({ success: true, data: newPrompt[0], message: '提示词创建成功' });
  } catch (error) {
    console.error('创建提示词失败:', error);
    res.status(500).json({ success: false, message: '创建提示词失败' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { title, scene, content, preview_url } = req.body;
    const existing = await query(
      'SELECT id, preview_url FROM prompts WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '提示词不存在' });
    }
    await query(
      'UPDATE prompts SET title = ?, scene = ?, content = ?, preview_url = ? WHERE id = ?',
      [title, scene || '', content, preview_url || null, req.params.id]
    );
    const updated = await query(
      'SELECT id, title, scene, content, preview_url, created_at, updated_at FROM prompts WHERE id = ?',
      [req.params.id]
    );
    const oldPreviewUrl = existing[0]?.preview_url;
    const nextPreviewUrl = preview_url || null;
    if (oldPreviewUrl && oldPreviewUrl !== nextPreviewUrl) {
      await deleteGeneratedAssetUrl(oldPreviewUrl).catch(() => undefined);
    }
    res.json({ success: true, data: updated[0], message: '提示词更新成功' });
  } catch (error) {
    console.error('更新提示词失败:', error);
    res.status(500).json({ success: false, message: '更新提示词失败' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await query(
      'SELECT id, preview_url FROM prompts WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '提示词不存在' });
    }
    await query('DELETE FROM prompts WHERE id = ?', [req.params.id]);
    await deleteGeneratedAssetUrl(existing[0]?.preview_url).catch(() => undefined);
    res.json({ success: true, message: '提示词删除成功' });
  } catch (error) {
    console.error('删除提示词失败:', error);
    res.status(500).json({ success: false, message: '删除提示词失败' });
  }
});

export default router;
