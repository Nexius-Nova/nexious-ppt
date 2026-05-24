import type { AgentParameters, DeckInput, GeneratedImage, ImageStyle, SlideOutline } from '@/types/agent';
import { aiApi, type StreamCallbacks } from '@/services/api';
import { useToastStore } from '@/stores/toastStore';

export async function analyzeDeckInput(
  input: DeckInput,
  params: AgentParameters,
  callbacks?: StreamCallbacks
): Promise<SlideOutline[]> {
  const toastStore = useToastStore();

  try {
    const outline = await aiApi.generateOutlineStream(
      {
        topic: input.topic,
        content: input.content,
        slideCount: params.slideCount,
        tone: params.tone,
        summaryLength: params.summaryLength
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
      chartHint: item.chartHint
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
  }
): Promise<GeneratedImage[]> {
  const toastStore = useToastStore();
  const images: GeneratedImage[] = [];

  for (const slide of outline) {
    try {
      callbacks?.onStart?.(slide.id, `正在为"${slide.title}"生成图片...`);

      const image = await aiApi.generateImageStream(
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
            toastStore.error('生成图片失败', message);
          }
        }
      );

      images.push(image);

      if (!image.error && image.url) {
        toastStore.success('图片生成完成', slide.title);
      }
    } catch (error) {
      console.error(`生成图片失败: ${slide.id}`, error);
      const errorImage: GeneratedImage = {
        id: `${slide.id}-image-1`,
        slideId: slide.id,
        title: slide.title,
        prompt: slide.visualPrompt,
        style,
        url: '',
        selected: true,
        error: true
      };
      images.push(errorImage);
      callbacks?.onError?.(slide.id, error instanceof Error ? error.message : '未知错误');
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
    toastStore.error('图片生成失败', '请检查图像模型配置');
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
