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
        promptContent: promptContent || '',
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
        },
      }
    );

    return outline.map(item => ({
      id: item.id,
      title: item.title,
      bullets: item.bullets,
      speakerNotes: item.speakerNotes,
      visualPrompt: item.visualPrompt,
      imagePlan: item.imagePlan,
      chartHint: item.chartHint,
      layout: item.layout as SlideLayout | undefined,
    }));
  } catch (error) {
    console.error('生成大纲错误:', error);
    toastStore.error('生成大纲失败', error instanceof Error ? error.message : '未知错误');
    throw error;
  }
}

type ImageTask = {
  slide: SlideOutline;
  plan: {
    id: string;
    prompt: string;
    purpose?: string;
    style: string;
  };
};

function normalizeImageTasks(outline: SlideOutline[], fallbackStyle: ImageStyle): ImageTask[] {
  return outline.flatMap((slide) => {
    const plans = Array.isArray(slide.imagePlan)
      ? slide.imagePlan
          .slice(0, 4)
          .map((plan, index) => ({
            id: String(plan?.id || `img-${index + 1}`).replace(/[^\w-]/g, '-').slice(0, 40) || `img-${index + 1}`,
            prompt: String(plan?.prompt || '').trim(),
            purpose: plan?.purpose ? String(plan.purpose).slice(0, 80) : undefined,
            style: plan?.style ? String(plan.style).slice(0, 80) : fallbackStyle,
          }))
          .filter((plan) => plan.prompt)
      : [];

    if (plans.length) return plans.map((plan) => ({ slide, plan }));

    const legacyPrompt = String(slide.visualPrompt || '').trim();
    if (!legacyPrompt || Array.isArray(slide.imagePlan)) return [];
    return [{
      slide,
      plan: {
        id: 'img-1',
        prompt: legacyPrompt,
        purpose: 'supporting',
        style: fallbackStyle,
      },
    }];
  });
}

function buildImageTitle(slide: SlideOutline, plan: ImageTask['plan']) {
  return `${slide.title}${plan.purpose ? ` / ${plan.purpose}` : ''}`;
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
  concurrency: number = 3,
  options: { imageModelId?: string | null } = {}
): Promise<GeneratedImage[]> {
  const toastStore = useToastStore();
  const images: GeneratedImage[] = [];
  const imageCache = new Map<string, GeneratedImage>();
  const pendingImageRequests = new Map<string, Promise<GeneratedImage>>();
  const imageTasks = normalizeImageTasks(outline, style);
  const total = imageTasks.length;
  const safeConcurrency = Math.max(1, Math.min(3, Math.floor(concurrency) || 1));
  let completed = 0;

  function setStepProgress(progress: number) {
    callbacks?.onComplete?.('__progress__', {
      id: '__progress__',
      slideId: '__progress__',
      title: '',
      prompt: '',
      style: '',
      url: '',
      selected: false,
      error: false,
      _progress: progress,
    } as any);
  }

  async function processTask({ slide, plan }: ImageTask): Promise<GeneratedImage> {
    const cacheKey = `${plan.style}::${plan.prompt}`.trim().toLowerCase();
    const title = buildImageTitle(slide, plan);

    const buildReusedImage = (source: GeneratedImage): GeneratedImage => ({
      ...source,
      id: `${slide.id}-${plan.id}`,
      slideId: slide.id,
      assetId: plan.id,
      title,
      prompt: plan.prompt,
      purpose: plan.purpose,
      style: plan.style,
      selected: true,
    });

    const cached = imageCache.get(cacheKey);
    if (cached?.url && !cached.error) {
      const reusedImage = buildReusedImage(cached);
      completed += 1;
      setStepProgress(Math.round((completed / Math.max(1, total)) * 100));
      callbacks?.onComplete?.(slide.id, reusedImage);
      return reusedImage;
    }

    const pendingImage = pendingImageRequests.get(cacheKey);
    if (pendingImage) {
      const reusedImage = buildReusedImage(await pendingImage);
      completed += 1;
      setStepProgress(Math.round((completed / Math.max(1, total)) * 100));
      callbacks?.onComplete?.(slide.id, reusedImage);
      return reusedImage;
    }

    try {
      callbacks?.onStart?.(slide.id, `正在生成图片素材：${title}`);

      const imagePromise = aiApi.generateImageStream(
        {
          slideId: slide.id,
          assetId: plan.id,
          title,
          prompt: plan.prompt,
          purpose: plan.purpose,
          style: plan.style,
          imageModelId: options.imageModelId || null,
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
          },
        }
      );

      pendingImageRequests.set(cacheKey, imagePromise);
      const image = await imagePromise;
      pendingImageRequests.delete(cacheKey);

      completed += 1;
      setStepProgress(Math.round((completed / Math.max(1, total)) * 100));

      if (!image.error && image.url) {
        imageCache.set(cacheKey, image);
        toastStore.success('图片生成完成', title);
      } else if (image.error) {
        callbacks?.onComplete?.(slide.id, image);
      }

      return image;
    } catch (error) {
      pendingImageRequests.delete(cacheKey);
      console.warn(`生成图片失败: ${slide.id}/${plan.id}`, error);
      completed += 1;
      setStepProgress(Math.round((completed / Math.max(1, total)) * 100));

      const errorImage: GeneratedImage = {
        id: `${slide.id}-${plan.id}`,
        slideId: slide.id,
        assetId: plan.id,
        title,
        prompt: plan.prompt,
        purpose: plan.purpose,
        style: plan.style,
        url: '',
        selected: true,
        error: true,
        errorMessage: error instanceof Error ? error.message : '未知错误',
      };
      callbacks?.onComplete?.(slide.id, errorImage);
      callbacks?.onError?.(slide.id, errorImage.errorMessage || '未知错误');
      return errorImage;
    }
  }

  for (let i = 0; i < imageTasks.length; i += safeConcurrency) {
    const batch = imageTasks.slice(i, i + safeConcurrency);
    const results = await Promise.allSettled(batch.map(task => processTask(task)));
    for (const result of results) {
      if (result.status === 'fulfilled') images.push(result.value);
    }
  }

  callbacks?.onAllComplete?.(images);

  const successCount = images.filter(img => !img.error && img.url).length;
  const totalCount = images.length;

  if (totalCount === 0) {
    return images;
  }
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
    status: 'ready' as const,
  };
}
