import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from './auth.js';
import { parseInputFile } from '../services/inputFileParser.js';
import { convertWebUrlToMarkdown } from '../services/sourceToMarkdown.js';
import { analyzeImagesDirectory, renderLatexManifest } from '../services/pptTools.js';
import { buildInputEnhancementSummary, renderInputEnhancementMarkdown } from '../services/pptMasterAdapter.js';

const router = Router();

router.post('/parse', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { filename, dataBase64, mimeType, textModelId } = req.body || {};
    const parsed = await parseInputFile({
      userId: req.userId!,
      filename: String(filename || ''),
      dataBase64: String(dataBase64 || ''),
      mimeType: typeof mimeType === 'string' ? mimeType : undefined,
      textModelId,
    });

    res.json({ success: true, data: parsed });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : '文件解析失败',
    });
  }
});

router.post('/parse-url', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { url } = req.body || {};
    const parsed = await convertWebUrlToMarkdown(String(url || ''));

    res.json({ success: parsed.ok, data: parsed, message: parsed.ok ? undefined : parsed.warnings[0] || '网页解析失败' });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : '网页解析失败',
    });
  }
});

router.post('/analyze-images', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { imagesDir, canvas } = req.body || {};
    const result = await analyzeImagesDirectory(String(imagesDir || ''), typeof canvas === 'string' ? canvas : 'ppt169');

    res.json({ success: result.ok, data: result, message: result.ok ? undefined : result.stderr || result.stdout || '图片分析失败' });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : '图片分析失败',
    });
  }
});

router.post('/render-latex', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { projectPath, manifest, dpi, providers, dryRun } = req.body || {};
    const result = await renderLatexManifest(String(projectPath || ''), {
      manifest: typeof manifest === 'string' ? manifest : undefined,
      dpi: dpi === undefined ? undefined : Number(dpi),
      providers: typeof providers === 'string' ? providers : undefined,
      dryRun: dryRun === true,
    });

    res.json({ success: result.ok, data: result, message: result.ok ? undefined : result.stderr || result.stdout || '公式渲染失败' });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : '公式渲染失败',
    });
  }
});

router.post('/enhance-context', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { content, files, skillChunks } = req.body || {};
    const summary = buildInputEnhancementSummary({
      content: typeof content === 'string' ? content : '',
      files: Array.isArray(files) ? files : [],
      skillChunks: Array.isArray(skillChunks) ? skillChunks.map(String) : [],
    });

    res.json({
      success: true,
      data: {
        summary,
        markdown: renderInputEnhancementMarkdown(summary),
      },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : '输入资料增强失败',
    });
  }
});

export default router;
