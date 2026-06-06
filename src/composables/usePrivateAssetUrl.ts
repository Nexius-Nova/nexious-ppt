import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const PRIVATE_ASSET_PATHS = ['/generated-images/', '/avatars/'];
const dataUrlCache = new Map<string, Promise<string | null>>();

export function isPrivateAssetUrl(value: string): boolean {
  if (!value) return false;
  if (/^(data:|blob:)/i.test(value)) return false;
  if (PRIVATE_ASSET_PATHS.some((prefix) => value.startsWith(prefix))) return true;

  try {
    const url = new URL(value, API_BASE_URL);
    const apiUrl = new URL(API_BASE_URL);
    return url.origin === apiUrl.origin && PRIVATE_ASSET_PATHS.some((prefix) => url.pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

function toAbsoluteAssetUrl(value: string): string {
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  return `${API_BASE_URL}${value.startsWith('/') ? value : `/${value}`}`;
}

async function fetchPrivateAssetBlob(value: string): Promise<Blob> {
  const token = localStorage.getItem('auth_token');
  const response = await fetch(toAbsoluteAssetUrl(value), {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });

  if (!response.ok) throw new Error('资源加载失败');
  return response.blob();
}

async function fetchPrivateAssetUrl(value: string): Promise<string> {
  return URL.createObjectURL(await fetchPrivateAssetBlob(value));
}

export async function fetchPrivateAssetAsDataUrl(value: string): Promise<string | null> {
  if (!isPrivateAssetUrl(value)) return null;

  const token = localStorage.getItem('auth_token') || '';
  const cacheKey = `${token}:${toAbsoluteAssetUrl(value)}`;
  const cached = dataUrlCache.get(cacheKey);
  if (cached) return cached;

  const task = fetchPrivateAssetBlob(value)
    .then((blob) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('资源转换失败'));
      reader.readAsDataURL(blob);
    }))
    .catch((err) => {
      console.warn('[privateAssets] private asset inline failed:', err);
      dataUrlCache.delete(cacheKey);
      return null;
    });

  dataUrlCache.set(cacheKey, task);
  return task;
}

function collectPrivateSvgUrls(svg: string): string[] {
  const urls = new Set<string>();
  const imageTagRegex = /<image\b[^>]*>/gi;
  const imageHrefRegex = /\b(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/gi;
  const cssUrlRegex = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
  let imageMatch: RegExpExecArray | null;

  while ((imageMatch = imageTagRegex.exec(svg)) !== null) {
    imageHrefRegex.lastIndex = 0;
    let hrefMatch: RegExpExecArray | null;
    while ((hrefMatch = imageHrefRegex.exec(imageMatch[0])) !== null) {
      const href = hrefMatch[2];
      if (isPrivateAssetUrl(href)) urls.add(href);
    }
  }

  let cssMatch: RegExpExecArray | null;
  while ((cssMatch = cssUrlRegex.exec(svg)) !== null) {
    const href = cssMatch[2];
    if (isPrivateAssetUrl(href)) urls.add(href);
  }

  return Array.from(urls);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function inlinePrivateSvgImages(svg: string): Promise<string> {
  if (!svg) return '';

  const urls = collectPrivateSvgUrls(svg);
  if (!urls.length) return svg;

  const replacements = new Map<string, string>();
  await Promise.all(
    urls.map(async (url) => {
      const dataUrl = await fetchPrivateAssetAsDataUrl(url);
      if (dataUrl) replacements.set(url, dataUrl);
    })
  );

  const missingUrls = urls.filter((url) => !replacements.has(url));
  if (missingUrls.length > 0) {
    throw new Error('SVG 私有资源加载失败');
  }

  let result = svg;
  for (const [url, dataUrl] of replacements) {
    const escaped = escapeRegExp(url);
    result = result.replace(
      new RegExp(`((?:href|xlink:href)\\s*=\\s*["'])${escaped}(["'])`, 'gi'),
      `$1${dataUrl}$2`
    );
    result = result.replace(
      new RegExp(`(url\\(\\s*["']?)${escaped}(["']?\\s*\\))`, 'gi'),
      `$1${dataUrl}$2`
    );
  }

  return result;
}

export function resolvePublicAssetUrl(value?: string | null): string {
  if (!value) return '';
  if (/^(data:|blob:)/i.test(value)) return value;
  return toAbsoluteAssetUrl(value);
}

export function usePrivateAssetUrl(source: Ref<string | null | undefined>) {
  const objectUrl = ref('');
  const loading = ref(false);
  const error = ref<Error | null>(null);

  function revokeObjectUrl() {
    if (objectUrl.value && objectUrl.value.startsWith('blob:')) {
      URL.revokeObjectURL(objectUrl.value);
    }
    objectUrl.value = '';
  }

  watch(
    source,
    async (value, _oldValue, onCleanup) => {
      revokeObjectUrl();
      error.value = null;
      if (!value) return;
      if (!isPrivateAssetUrl(value)) {
        objectUrl.value = resolvePublicAssetUrl(value);
        return;
      }

      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
      });

      try {
        loading.value = true;
        const url = await fetchPrivateAssetUrl(value);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl.value = url;
      } catch (err) {
        if (!cancelled) error.value = err instanceof Error ? err : new Error('资源加载失败');
      } finally {
        if (!cancelled) loading.value = false;
      }
    },
    { immediate: true }
  );

  onBeforeUnmount(revokeObjectUrl);

  return {
    url: computed(() => objectUrl.value),
    loading,
    error
  };
}

export function usePrivateSvg(source: Ref<string | null | undefined>) {
  const svg = ref('');
  const loading = ref(false);
  const error = ref<Error | null>(null);

  watch(
    source,
    async (value, _oldValue, onCleanup) => {
      error.value = null;
      svg.value = value || '';
      if (!value) return;

      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
      });

      try {
        loading.value = true;
        const inlined = await inlinePrivateSvgImages(value);
        if (!cancelled) svg.value = inlined;
      } catch (err) {
        if (!cancelled) {
          error.value = err instanceof Error ? err : new Error('SVG 预览加载失败');
          svg.value = value;
        }
      } finally {
        if (!cancelled) loading.value = false;
      }
    },
    { immediate: true }
  );

  return {
    svg: computed(() => svg.value),
    loading,
    error
  };
}
