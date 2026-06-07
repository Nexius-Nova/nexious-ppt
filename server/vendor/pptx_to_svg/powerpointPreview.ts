import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface PowerPointPreviewSlide {
  pageNumber: number;
  filename: string;
  url: string;
  width: number;
  height: number;
}

export interface PowerPointPreviewResult {
  width: number;
  height: number;
  slides: PowerPointPreviewSlide[];
}

function stripDataUrl(value: string) {
  const commaIndex = value.indexOf(',');
  return value.startsWith('data:') && commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
}

function normalizeUrlPath(value: string) {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

function psString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function encodePowerShell(script: string) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export function svgFromPreviewImage(slide: PowerPointPreviewSlide, width: number, height: number, title = '') {
  const label = title || `Slide ${slide.pageNumber}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(label)}">`,
    `<image x="0" y="0" width="${width}" height="${height}" href="${escapeXml(slide.url)}" xlink:href="${escapeXml(slide.url)}" preserveAspectRatio="none" />`,
    '</svg>',
  ].join('\n');
}

function escapeXml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function renderPptxWithPowerPoint(
  filename: string,
  dataBase64: string,
  outputDir: string,
  urlPrefix: string,
): Promise<PowerPointPreviewResult | null> {
  if (process.platform !== 'win32') return null;
  if (!filename.toLowerCase().endsWith('.pptx')) return null;

  await fs.mkdir(outputDir, { recursive: true });
  const sourcePath = path.join(outputDir, 'source.pptx');
  await fs.writeFile(sourcePath, Buffer.from(stripDataUrl(dataBase64), 'base64'));

  const normalizedPrefix = normalizeUrlPath(urlPrefix);
  const script = `
$ErrorActionPreference = "Stop"
$sourcePath = ${psString(sourcePath)}
$outputDir = ${psString(outputDir)}
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$app = $null
$presentation = $null
try {
  $app = New-Object -ComObject PowerPoint.Application
  $presentation = $app.Presentations.Open($sourcePath, $true, $false, $false)
  $slideWidth = [double]$presentation.PageSetup.SlideWidth
  $slideHeight = [double]$presentation.PageSetup.SlideHeight
  $exportWidth = 1600
  $exportHeight = [int][Math]::Round($exportWidth * $slideHeight / $slideWidth)
  $slides = @()
  foreach ($slide in $presentation.Slides) {
    $filename = "slide-{0:D3}.png" -f [int]$slide.SlideIndex
    $filePath = Join-Path $outputDir $filename
    $slide.Export($filePath, "PNG", $exportWidth, $exportHeight)
    $slides += [pscustomobject]@{
      pageNumber = [int]$slide.SlideIndex
      filename = $filename
      width = $exportWidth
      height = $exportHeight
    }
  }
  [pscustomobject]@{
    ok = $true
    width = $exportWidth
    height = $exportHeight
    slides = $slides
  } | ConvertTo-Json -Depth 6 -Compress
} finally {
  if ($presentation -ne $null) { $presentation.Close() | Out-Null }
  if ($app -ne $null) { $app.Quit() | Out-Null }
  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()
}
`;

  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodePowerShell(script),
    ], {
      timeout: 120000,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4,
    });
    const parsed = JSON.parse(stdout.trim());
    if (!parsed?.ok || !Array.isArray(parsed.slides) || parsed.slides.length === 0) return null;
    const slides = parsed.slides.map((slide: any) => ({
      pageNumber: Number(slide.pageNumber) || 1,
      filename: String(slide.filename || ''),
      url: `${normalizedPrefix}/${String(slide.filename || '')}`,
      width: Number(slide.width) || Number(parsed.width) || 1600,
      height: Number(slide.height) || Number(parsed.height) || 900,
    })).filter((slide: PowerPointPreviewSlide) => slide.filename);
    return {
      width: Number(parsed.width) || slides[0]?.width || 1600,
      height: Number(parsed.height) || slides[0]?.height || 900,
      slides,
    };
  } catch (error) {
    console.warn('PowerPoint 原生预览导出失败，已回退轻量 PPTX 转换:', error instanceof Error ? error.message : error);
    return null;
  } finally {
    await fs.unlink(sourcePath).catch(() => undefined);
  }
}
