import type { AgentParameters, GeneratedImage, SlideOutline } from '@/types/agent';

const templateColors: Record<AgentParameters['template'], { bg: string; panel: string; accent: string; text: string; muted: string }> = {
  business: {
    bg: '070A0E',
    panel: '111820',
    accent: 'D9F26E',
    text: 'F2F5F7',
    muted: 'A8B0B8'
  },
  creative: {
    bg: '0A0B0D',
    panel: '171717',
    accent: 'E5E7EB',
    text: 'FFFFFF',
    muted: 'B7BCC3'
  },
  education: {
    bg: '0D1117',
    panel: '151B23',
    accent: 'BCE1FF',
    text: 'F5F7FA',
    muted: 'AAB6C2'
  }
};

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function getImageSource(originalUrl: string): { path?: string; data?: string } {
  if (originalUrl.startsWith('data:')) {
    return { data: originalUrl };
  }
  return { path: `${API_BASE_URL}/api/ai/proxy-image?url=${encodeURIComponent(originalUrl)}` };
}

export async function exportOutlineToPptx(
  outline: SlideOutline[],
  images: GeneratedImage[],
  parameters: AgentParameters
): Promise<string> {
  const { default: pptxgen } = await import('pptxgenjs');
  const pptx = new pptxgen();
  const colors = templateColors[parameters.template];
  const imageBySlide = new Map(images.map((image) => [image.slideId, image]));

  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Nexious PPT Agent';
  pptx.subject = 'AI PPT 自动生成';
  pptx.title = outline[0]?.title ?? 'Nexious Agent Deck';
  pptx.company = 'Nexious';
  pptx.theme = {
    headFontFace: 'Microsoft YaHei',
    bodyFontFace: 'Microsoft YaHei'
  };

  // Layout coord definitions
  interface LayoutConfig {
    titleX: number; titleY: number; titleW: number;
    bulletsX: number; bulletsY: number; bulletsW: number;
    hasImage: boolean;
    imgX?: number; imgY?: number; imgW?: number; imgH?: number;
    isFullBg?: boolean;
    isCenter?: boolean;
    isTwoColumn?: boolean;
  }
  const LAYOUT: Record<string, LayoutConfig> = {
    'text-only': {
      titleX: 0.72, titleY: 1.4, titleW: 11.2,
      bulletsX: 0.82, bulletsY: 2.5, bulletsW: 10.8,
      hasImage: false
    },
    'text-image': {
      titleX: 0.72, titleY: 1.08, titleW: 6.8,
      bulletsX: 0.82, bulletsY: 2.15, bulletsW: 6.3,
      hasImage: true,
      imgX: 7.8, imgY: 1.1, imgW: 4.7, imgH: 3.2
    },
    'image-text': {
      titleX: 5.8, titleY: 1.08, titleW: 6.8,
      bulletsX: 5.9, bulletsY: 2.15, bulletsW: 6.3,
      hasImage: true,
      imgX: 0.72, imgY: 1.1, imgW: 4.7, imgH: 3.2
    },
    'full-image': {
      titleX: 0.72, titleY: 5.2, titleW: 11.2,
      bulletsX: 0.82, bulletsY: 5.8, bulletsW: 0,
      hasImage: true,
      imgX: 0.35, imgY: 0.3, imgW: 12.6, imgH: 6.9,
      isFullBg: true
    },
    'title-center': {
      titleX: 1.2, titleY: 2.2, titleW: 10.9,
      bulletsX: 1.5, bulletsY: 3.3, bulletsW: 10.3,
      hasImage: false,
      isCenter: true
    },
    'two-column': {
      titleX: 0.72, titleY: 0.95, titleW: 11.2,
      bulletsX: 0.82, bulletsY: 2.0, bulletsW: 11.0,
      hasImage: false,
      isTwoColumn: true
    }
  };

  outline.forEach((slideItem, index) => {
    const slide = pptx.addSlide();
    const image = imageBySlide.get(slideItem.id);
    const layoutKey = slideItem.layout || 'text-only';
    const cfg = LAYOUT[layoutKey] || LAYOUT['text-only'];

    slide.background = { color: colors.bg };
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.35,
      y: 0.3,
      w: 12.6,
      h: 6.9,
      fill: { color: colors.panel },
      line: { color: '2A333D', transparency: 5 }
    });
    slide.addText(`NEXIOUS AGENT / ${String(index + 1).padStart(2, '0')}`, {
      x: 0.72,
      y: 0.62,
      w: 4.8,
      h: 0.26,
      color: colors.accent,
      fontFace: 'Cascadia Code',
      fontSize: 9,
      bold: true
    });
    const titleSz = slideItem.layoutParams?.titleSize ?? (layoutKey === 'full-image' ? 22 : 26);
    const bulletSz = slideItem.layoutParams?.bulletSize ?? (layoutKey === 'text-only' ? 14 : 13);
    const imgRatio = slideItem.layoutParams?.imageRatio ?? 0.45;

    slide.addText(slideItem.title, {
      x: cfg.titleX,
      y: cfg.titleY,
      w: cfg.titleW,
      h: 0.86,
      color: colors.text,
      fontSize: titleSz,
      bold: true,
      breakLine: false,
      fit: 'shrink'
    });

    // Bullets (skip for full-image when no space)
    if (cfg.bulletsW !== 0 && slideItem.bullets.length > 0) {
      slide.addText(
        slideItem.bullets.map((bullet) => ({ text: bullet, options: { bullet: { type: 'bullet' } } })),
        {
          x: cfg.bulletsX,
          y: cfg.bulletsY,
          w: cfg.bulletsW,
          h: 2.25,
          color: colors.muted,
          fontSize: bulletSz,
          breakLine: false,
          fit: 'shrink'
        }
      );
    }

    if (cfg.hasImage) {
      const ix = cfg.imgX ?? 0;
      const iy = cfg.imgY ?? 0;
      const iw = cfg.isFullBg ? (cfg.imgW ?? 0) : Math.max(3.5, 12.6 * imgRatio);
      const ih = cfg.imgH ?? 0;

      if (image?.url) {
        slide.addImage({
          ...getImageSource(image.url),
          x: ix, y: iy, w: iw, h: ih,
          sizing: { type: 'cover', w: iw, h: ih }
        });
        if (!cfg.isFullBg) {
          slide.addText(image.prompt || slideItem.visualPrompt, {
            x: ix + 0.25,
            y: iy + ih + 0.15,
            w: iw - 0.5,
            h: 0.4,
            color: colors.muted,
            fontSize: 9,
            fit: 'shrink'
          });
        } else {
          slide.addText(image.prompt || slideItem.visualPrompt, {
            x: 0.72,
            y: 6.2,
            w: 5,
            h: 0.35,
            color: colors.muted,
            fontSize: 8,
            fit: 'shrink'
          });
        }
      } else {
        // Placeholder
        slide.addShape(pptx.ShapeType.roundRect, {
          x: ix, y: iy, w: iw, h: ih,
          fill: { color: '0B1117' },
          line: { color: '303A45' }
        });
        slide.addText(image?.style ?? parameters.imageStyle, {
          x: ix + 0.4,
          y: iy + ih / 2 - 0.25,
          w: iw - 0.8,
          h: 0.42,
        color: colors.accent,
        fontFace: 'Cascadia Code',
        fontSize: 16,
        align: 'center'
      });
      }
    }

    slide.addNotes(slideItem.speakerNotes);
  });

  const fileName = `nexious-agent-deck-${Date.now()}.pptx`;
  await pptx.writeFile({ fileName });
  return fileName;
}
