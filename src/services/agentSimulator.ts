import type { AgentParameters, DeckInput, GeneratedImage, ImageStyle, SlideLayout, SlideOutline } from '@/types/agent';
import { aiApi, type StreamCallbacks } from '@/services/api';
import { useToastStore } from '@/stores/toastStore';

export async function analyzeDeckInput(
  input: DeckInput,
  params: AgentParameters,
  callbacks?: StreamCallbacks,
  promptContent?: string
): Promise<SlideOutline[]> {
  const toastStore = useToastStore();

  try {
    const outline = await aiApi.generateOutlineStream(
      {
        topic: input.topic,
        content: input.content,
        slideCount: params.slideCount,
        tone: params.tone,
        summaryLength: params.summaryLength,
        promptContent: promptContent || ''
      },
      {
        onStart: (message) => {
          callbacks?.onStart?.(message);
          toastStore.info('生成大纲', message);
        },
        onContent: (content) => {
          callbacks?.onContent?.(content);
        },
        onComplete: (data) => {
          callbacks?.onComplete?.(data);
          toastStore.success('大纲生成完成', `共生成 ${data.length} 页`);
        },
        onError: (message) => {
          callbacks?.onError?.(message);
          toastStore.error('生成大纲失败', message);
        }
      }
    );

    return outline.map(item => ({
      id: item.id,
      title: item.title,
      bullets: item.bullets,
      speakerNotes: item.speakerNotes,
      visualPrompt: item.visualPrompt,
      chartHint: item.chartHint,
      layout: item.layout as SlideLayout | undefined,
    }));
  } catch (error) {
    console.error('生成大纲错误:', error);
    toastStore.error('生成大纲失败', error instanceof Error ? error.message : '未知错误');
    throw error;
  }
}

export async function generateSlideImages(
  outline: SlideOutline[],
  style: ImageStyle,
  callbacks?: {
    onStart?: (slideId: string, message: string) => void;
    onComplete?: (slideId: string, image: GeneratedImage) => void;
    onError?: (slideId: string, message: string) => void;
    onAllComplete?: (images: GeneratedImage[]) => void;
  },
  concurrency: number = 3
): Promise<GeneratedImage[]> {
  const toastStore = useToastStore();
  const images: GeneratedImage[] = [];
  const imageCache = new Map<string, GeneratedImage>();
  const pendingImageRequests = new Map<string, Promise<GeneratedImage>>();
  const total = outline.length;
  const safeConcurrency = Math.max(1, Math.min(3, Math.floor(concurrency) || 1));
  let completed = 0;

  async function processSlide(slide: SlideOutline): Promise<GeneratedImage> {
    const cacheKey = `${style}::${slide.visualPrompt || slide.title}`.trim().toLowerCase();
    const cached = imageCache.get(cacheKey);
    if (cached?.url && !cached.error) {
      const reusedImage: GeneratedImage = {
        ...cached,
        id: `${slide.id}-image-1`,
        slideId: slide.id,
        title: slide.title,
        prompt: slide.visualPrompt,
        selected: true,
      };
      completed++;
      setStepProgress(Math.round((completed / total) * 100));
      callbacks?.onComplete?.(slide.id, reusedImage);
      return reusedImage;
    }

    const pendingImage = pendingImageRequests.get(cacheKey);
    if (pendingImage) {
      const sharedImage = await pendingImage;
      const reusedImage: GeneratedImage = {
        ...sharedImage,
        id: `${slide.id}-image-1`,
        slideId: slide.id,
        title: slide.title,
        prompt: slide.visualPrompt,
        selected: true,
      };
      completed++;
      setStepProgress(Math.round((completed / total) * 100));
      callbacks?.onComplete?.(slide.id, reusedImage);
      return reusedImage;
    }

    try {
      callbacks?.onStart?.(slide.id, `正在为"${slide.title}"生成图片...`);

      const imagePromise = aiApi.generateImageStream(
        {
          slideId: slide.id,
          title: slide.title,
          prompt: slide.visualPrompt,
          style
        },
        {
          onStart: (message) => {
            toastStore.info('生成图片', message);
          },
          onComplete: (data) => {
            callbacks?.onComplete?.(slide.id, data);
          },
          onError: (message) => {
            callbacks?.onError?.(slide.id, message);
            toastStore.warning('图片未生成', message);
          }
        }
      );
      pendingImageRequests.set(cacheKey, imagePromise);
      const image = await imagePromise;
      pendingImageRequests.delete(cacheKey);

      completed++;
      const progress = Math.round((completed / total) * 100);
      setStepProgress(progress);

      if (!image.error && image.url) {
        imageCache.set(cacheKey, image);
        toastStore.success('图片生成完成', slide.title);
      } else if (image.error) {
        callbacks?.onComplete?.(slide.id, image);
      }

      return image;
    } catch (error) {
      pendingImageRequests.delete(cacheKey);
      console.warn(`生成图片失败: ${slide.id}`, error);
      completed++;
      const progress = Math.round((completed / total) * 100);
      setStepProgress(progress);

      const errorImage: GeneratedImage = {
        id: `${slide.id}-image-1`,
        slideId: slide.id,
        title: slide.title,
        prompt: slide.visualPrompt,
        style,
        url: '',
        selected: true,
        error: true,
        errorMessage: error instanceof Error ? error.message : '未知错误'
      };
      callbacks?.onComplete?.(slide.id, errorImage);
      callbacks?.onError?.(slide.id, error instanceof Error ? error.message : '未知错误');
      return errorImage;
    }
  }

  function setStepProgress(progress: number) {
    callbacks?.onComplete?.('__progress__', { id: '__progress__', slideId: '__progress__', title: '', prompt: '', style: '', url: '', selected: false, error: false, _progress: progress } as any);
  }

  const batches: SlideOutline[][] = [];
  for (let i = 0; i < outline.length; i += safeConcurrency) {
    batches.push(outline.slice(i, i + safeConcurrency));
  }

  for (const batch of batches) {
    const results = await Promise.allSettled(
      batch.map(slide => processSlide(slide))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        images.push(result.value);
      }
    }
  }

  callbacks?.onAllComplete?.(images);

  const successCount = images.filter(img => !img.error && img.url).length;
  const totalCount = images.length;

  if (successCount === totalCount) {
    toastStore.success('所有图片生成完成', `共 ${totalCount} 张`);
  } else if (successCount > 0) {
    toastStore.warning('部分图片生成失败', `成功 ${successCount}/${totalCount} 张`);
  } else {
    toastStore.warning('图片未生成', '请手动重试成功后继续生成页面。');
  }

  return images;
}

export async function exportDeck(format: 'pptx' | 'pdf') {
  await new Promise(resolve => setTimeout(resolve, 180));
  return {
    format,
    name: `nexious-agent-deck.${format}`,
    status: 'ready' as const
  };
}
