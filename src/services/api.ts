const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

import type { DesignSpec, SpecSlide, SpecLock, SkillExtension, TemplateAsset, TemplateAssetSettings } from '../types/agent';

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  status?: number;
  code?: string;
  requestId?: string;
  details?: unknown;
}

type ApiRequestOptions = RequestInit & {
  timeoutMs?: number;
};

class ApiClient {
  private baseUrl: string;
  private token: string | null = null;
  private timeoutMs = 30000;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('auth_token');
    }
  }

  setToken(token: string | null) {
    this.token = token;
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('auth_token', token);
      } else {
        localStorage.removeItem('auth_token');
      }
    }
  }

  private async request<T>(
    endpoint: string,
    options: ApiRequestOptions = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);
    const requestId = this.createRequestId();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: options.signal || controller.signal,
      });

      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json')
        ? await response.json().catch(() => ({}))
        : { message: await response.text().catch(() => '') };
      const responseRequestId = response.headers.get('x-request-id') || data.requestId || requestId;

      if (!response.ok) {
        if (response.status === 401 && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('api:unauthorized', {
            detail: data.message || '\u767b\u5f55\u72b6\u6001\u5df2\u5931\u6548\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55'
          }));
        }

        return {
          success: false,
          message: data.message || '\u8bf7\u6c42\u5931\u8d25',
          error: data.error,
          code: data.code,
          status: response.status,
          requestId: responseRequestId,
          details: data.details,
        };
      }

      return { ...data, requestId: responseRequestId };
    } catch (error) {
      const isAbortError = error instanceof DOMException && error.name === 'AbortError';
      return {
        success: false,
        message: isAbortError ? '\u8bf7\u6c42\u8d85\u65f6\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5' : error instanceof Error ? error.message : '\u7f51\u7edc\u9519\u8bef',
        code: isAbortError ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
        requestId,
      };
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, body?: any, options: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async put<T>(endpoint: string, body?: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  private createRequestId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  async patch<T>(endpoint: string, body?: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  async stream(
    endpoint: string,
    body: any,
    onMessage: (data: any) => void,
    onError?: (error: Error) => void
  ): Promise<void> {
    const url = `${this.baseUrl}${endpoint}`;
    const requestId = this.createRequestId();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 401 && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('api:unauthorized', {
            detail: errorData.message || '登录状态已失效，请重新登录'
          }));
        }

        const error = new Error(errorData.message || '请求失败') as Error & {
          code?: string;
          requestId?: string;
          status?: number;
        };
        error.code = errorData.code;
        error.status = response.status;
        error.requestId = response.headers.get('x-request-id') || errorData.requestId || requestId;
        throw error;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              onMessage(parsed);
            } catch {
              // ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      if (onError) {
        onError(error instanceof Error ? error : new Error('Unknown error'));
      }
      throw error;
    }
  }
}

export const api = new ApiClient(API_BASE_URL);

export function resolveAssetUrl(url?: string | null): string {
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  return `${API_BASE_URL}${url.startsWith('/') ? url : `/${url}`}`;
}

export interface User {
  userId: number;
  email: string;
  name: string | null;
  avatar: string | null;
  createdAt?: string;
}

export interface ApiKey {
  id: number;
  name: string;
  type: 'text' | 'image';
  provider: string;
  model: string | null;
  custom_provider_name?: string;
  custom_model_name?: string;
  is_default: boolean;
  is_active: boolean;
  has_key: boolean;
  base_url: string | null;
  created_at: string;
  updated_at?: string;
}

export interface Project {
  id: number;
  user_id: number;
  title: string;
  topic: string | null;
  content: string | null;
  status: 'draft' | 'generating' | 'completed';
  state?: any;
  created_at: string;
  updated_at: string;
}

export const authApi = {
  register: (email: string, password: string, name?: string) =>
    api.post<{ userId: number; email: string; name: string; token: string }>('/api/auth/register', {
      email,
      password,
      name,
    }),

  login: (email: string, password: string) =>
    api.post<{ userId: number; email: string; name: string; avatar: string | null; token: string }>('/api/auth/login', {
      email,
      password,
    }),

  getMe: () => api.get<User>('/api/auth/me'),

  updateMe: (data: { name?: string; avatar?: string; currentPassword?: string; password?: string }) =>
    api.put<User>('/api/auth/me', data),

  uploadAvatar: async (file: Blob) => {
    const token = localStorage.getItem('auth_token');
    const response = await fetch(`${API_BASE_URL}/api/auth/me/avatar`, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'image/jpeg',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: file,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        message: data.message || '头像上传失败',
        status: response.status,
      } as ApiResponse<User>;
    }
    return data as ApiResponse<User>;
  },

  deleteMe: () => api.delete('/api/auth/me'),
};

export const apiKeyApi = {
  getAll: () => api.get<ApiKey[]>('/api/api-keys'),

  getByType: (type: 'text' | 'image') => api.get<ApiKey[]>(`/api/api-keys/type/${type}`),

  getDefault: (type: 'text' | 'image') => api.get<ApiKey | null>(`/api/api-keys/default/${type}`),

  create: (data: {
    name: string;
    type: 'text' | 'image';
    provider: string;
    api_key: string;
    base_url?: string;
    model?: string;
    custom_provider_name?: string;
    custom_model_name?: string;
    is_default?: boolean;
  }) => api.post<{ id: number }>('/api/api-keys', data),

  update: (id: number, data: {
    name?: string;
    provider?: string;
    api_key?: string;
    base_url?: string;
    model?: string;
    custom_provider_name?: string;
    custom_model_name?: string;
    is_default?: boolean;
    is_active?: boolean;
  }) => api.put(`/api/api-keys/${id}`, data),

  delete: (id: number) => api.delete(`/api/api-keys/${id}`),

  setDefault: (id: number) => api.post(`/api/api-keys/${id}/set-default`),
};

export const projectApi = {
  getAll: () => api.get<Project[]>('/api/projects'),

  getStats: () => api.get<{ total: number; draft: number; generating: number; completed: number }>('/api/projects/stats'),

  getByStatus: (status: 'draft' | 'generating' | 'completed') =>
    api.get<Project[]>(`/api/projects/status/${status}`),

  getById: (id: number) => api.get<Project>(`/api/projects/${id}`),

  create: (data: {
    title: string;
    topic?: string;
    content?: string;
    status?: 'draft' | 'generating' | 'completed';
    state?: any;
  }) => api.post<{ id: number }>('/api/projects', data),

  update: (id: number, data: {
    title?: string;
    topic?: string;
    content?: string;
    status?: 'draft' | 'generating' | 'completed';
    state?: any;
  }) => api.put<{ id?: number }>(`/api/projects/${id}`, data),

  delete: (id: number) => api.delete(`/api/projects/${id}`),
};

export interface GeneratedOutline {
  id: string;
  title: string;
  bullets: string[];
  speakerNotes: string;
  visualPrompt: string;
  chartHint?: string;
  layout?: string;
}

export interface GeneratedImage {
  id: string;
  slideId: string;
  title: string;
  prompt: string;
  style: string;
  url: string;
  selected: boolean;
  error?: boolean;
  errorMessage?: string;
}

export interface StreamCallbacks {
  onStart?: (message: string) => void;
  onContent?: (content: string) => void;
  onOutlineSlide?: (slide: SpecSlide) => void;
  onComplete?: (data: any) => void;
  onError?: (message: string) => void;
}

export interface QueueJobSnapshot {
  id: string;
  kind: 'generate' | 'export';
  dbJobId?: number;
  userId: number;
  projectId: string;
  title?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  phase: string;
  progress: number;
  message?: string;
  errorMessage?: string;
  result?: any;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export const aiApi = {
  generateOutline: (data: {
    topic: string;
    content: string;
    slideCount: number;
    tone: string;
    summaryLength?: string;
    promptContent?: string;
  }) => api.post<GeneratedOutline[]>('/api/ai/generate-outline', data),

  generateImages: (data: {
    prompts: Array<{
      slideId: string;
      title: string;
      prompt: string;
    }>;
    style: string;
  }) => api.post<GeneratedImage[]>('/api/ai/generate-images', data),

  generateOutlineStream: async (
    data: {
      topic: string;
      content: string;
      slideCount: number;
      tone: string;
      summaryLength?: string;
      promptContent?: string;
    },
    callbacks: StreamCallbacks
  ): Promise<GeneratedOutline[]> => {
    return new Promise((resolve, reject) => {
      let outline: GeneratedOutline[] = [];

      api.stream(
        '/api/ai/generate-outline-stream',
        data,
        (parsed) => {
          if (parsed.status === 'start') {
            callbacks.onStart?.(parsed.message);
          } else if (parsed.content) {
            callbacks.onContent?.(parsed.content);
          } else if (parsed.status === 'complete') {
            outline = parsed.data.map((item: any) => ({
              id: item.id,
              title: item.title,
              bullets: item.bullets,
              speakerNotes: item.speakerNotes,
              visualPrompt: item.visualPrompt,
              chartHint: item.chartHint,
              layout: item.layout
            }));
            callbacks.onComplete?.(outline);
            resolve(outline);
          } else if (parsed.status === 'error') {
            callbacks.onError?.(parsed.message);
            reject(new Error(parsed.message));
          }
        },
        (error) => {
          callbacks.onError?.(error.message);
          reject(error);
        }
      );
    });
  },

  generateImageStream: async (
    data: {
      slideId: string;
      title: string;
      prompt: string;
      style: string;
    },
    callbacks: StreamCallbacks
  ): Promise<GeneratedImage> => {
    return new Promise((resolve, reject) => {
      let image: GeneratedImage | null = null;

      api.stream(
        '/api/ai/generate-image-stream',
        data,
        (parsed) => {
          if (parsed.status === 'start') {
            callbacks.onStart?.(parsed.message);
          } else if (parsed.status === 'complete') {
            image = {
              id: parsed.data.id,
              slideId: parsed.data.slideId,
              title: parsed.data.title,
              prompt: parsed.data.prompt,
              style: parsed.data.style,
              url: parsed.data.url,
              selected: parsed.data.selected
            };
            callbacks.onComplete?.(image);
            resolve(image);
          } else if (parsed.status === 'error') {
            callbacks.onError?.(parsed.message);
            if (parsed.data) {
              resolve({
                id: parsed.data.id,
                slideId: parsed.data.slideId,
                title: parsed.data.title,
                prompt: parsed.data.prompt,
                style: parsed.data.style,
                url: '',
                selected: true,
                error: true,
                errorMessage: parsed.message
              });
            } else {
              reject(new Error(parsed.message));
            }
          }
        },
        (error) => {
          callbacks.onError?.(error.message);
          reject(error);
        }
      );
    });
  },

  persistGeneratedImage: (data: { slideId: string; imageUrl: string }) =>
    api.post<{ url: string }>('/api/ai/persist-generated-image', data),

  testTextModel: () => api.post<{ success: boolean; message: string }>('/api/ai/test-text-model'),

  testImageModel: () => api.post<{ success: boolean; message: string }>('/api/ai/test-image-model'),

  runSkillStream: async (
    data: {
      skillId: string;
      skillName: string;
      slides: Array<{ id: string; title: string; bullets: string[]; speakerNotes?: string }>;
      params: Record<string, any>;
      intensity: number;
    },
    callbacks: StreamCallbacks
  ): Promise<{ skillId: string; skillName: string; result: any }> => {
    return new Promise((resolve, reject) => {
      api.stream(
        '/api/ai/run-skill',
        data,
        (parsed) => {
          if (parsed.status === 'start') {
            callbacks.onStart?.(parsed.message);
          } else if (parsed.content) {
            callbacks.onContent?.(parsed.content);
          } else if (parsed.status === 'outline-slide') {
            callbacks.onOutlineSlide?.(parsed.data);
          } else if (parsed.status === 'complete') {
            callbacks.onComplete?.(parsed.data);
            resolve(parsed.data);
          } else if (parsed.status === 'error') {
            callbacks.onError?.(parsed.message);
            reject(new Error(parsed.message));
          }
        },
        (error) => {
          callbacks.onError?.(error.message);
          reject(error);
        }
      );
    });
  },

  strategistStream: async (
    data: {
      topic: string;
      content: string;
      tone: string;
      summaryLength: string;
      slideCount: number;
      imageStyle: string;
      template: string;
      templateAsset?: TemplateAsset | null;
      promptContent?: string;
      skills: Array<{ id: string; name: string; instruction?: string }>;
    },
    callbacks: StreamCallbacks
  ): Promise<{ spec: DesignSpec; lock: SpecLock }> => {
    return new Promise((resolve, reject) => {
      api.stream(
        '/api/generate/strategist',
        data,
        (parsed) => {
          if (parsed.status === 'start') {
            callbacks.onStart?.(parsed.message);
          } else if (parsed.content) {
            callbacks.onContent?.(parsed.content);
          } else if (parsed.status === 'complete') {
            callbacks.onComplete?.(parsed.data);
            resolve(parsed.data);
          } else if (parsed.status === 'error') {
            callbacks.onError?.(parsed.message);
            reject(new Error(parsed.message));
          }
        },
        (error) => {
          callbacks.onError?.(error.message);
          reject(error);
        }
      );
    });
  },

  executorPageStream: async (
    data: { spec: DesignSpec; lock: SpecLock; slide: SpecSlide; imageUrl?: string },
    callbacks: StreamCallbacks
  ): Promise<string> => {
    return new Promise((resolve, reject) => {
      api.stream(
        '/api/generate/executor-page',
        data,
        (parsed) => {
          if (parsed.status === 'start') {
            callbacks.onStart?.(parsed.message);
          } else if (parsed.content) {
            callbacks.onContent?.(parsed.content);
          } else if (parsed.status === 'complete') {
            const svg = parsed.data?.svg || '';
            callbacks.onComplete?.(svg);
            resolve(svg);
          } else if (parsed.status === 'error') {
            callbacks.onError?.(parsed.message);
            reject(new Error(parsed.message));
          }
        },
        (error) => {
          callbacks.onError?.(error.message);
          reject(error);
        }
      );
    });
  },

  createGenerateJob: (data: {
    projectId: string;
    title?: string;
    input: {
      topic: string;
      content: string;
      tone: string;
      summaryLength: string;
      slideCount: number;
      imageStyle: string;
      template: string;
      templateAsset?: TemplateAsset | null;
      promptContent?: string;
      skills: Array<{ id: string; name: string; instruction?: string }>;
    };
    projectState?: any;
    includeImages?: boolean;
  }) => api.post<QueueJobSnapshot>('/api/generate/jobs/generate', data),

  createExportPptxJob: (data: {
    projectId: string;
    title?: string;
    pages: Array<{ pageNumber?: number; svg: string; speakerNotes: string }>;
    spec: DesignSpec;
    lock?: SpecLock;
  }) => api.post<QueueJobSnapshot>('/api/generate/jobs/export-pptx', data),

  getQueueJob: (id: string) => api.get<QueueJobSnapshot>(`/api/generate/jobs/${id}`),

  cancelQueueJob: (id: string) => api.post<QueueJobSnapshot>(`/api/generate/jobs/${id}/cancel`),

  subscribeQueueJob: async (
    id: string,
    onJob: (job: QueueJobSnapshot) => void,
    onError?: (error: Error) => void
  ): Promise<void> => {
    const token = localStorage.getItem('auth_token');
    const response = await fetch(`${API_BASE_URL}/api/generate/jobs/${id}/events`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });
    if (!response.ok) {
      throw new Error('任务订阅失败');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('任务订阅不可用');
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const job = JSON.parse(line.slice(6));
            onJob(job);
            if (['completed', 'failed', 'cancelled'].includes(job.status)) {
              await reader.cancel();
              return;
            }
          } catch {
            // ignore malformed event frames
          }
        }
      }
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error('任务订阅中断'));
      throw error;
    }
  },

  waitForQueueJob: async (
    id: string,
    onJob: (job: QueueJobSnapshot) => void,
    timeoutMs = 30 * 60 * 1000
  ): Promise<QueueJobSnapshot> => {
    const startedAt = Date.now();
    let lastJob: QueueJobSnapshot | null = null;
    try {
      await aiApi.subscribeQueueJob(id, (job) => {
        lastJob = job;
        onJob(job);
      });
    } catch (error) {
      // Fall back to polling below when SSE is interrupted.
    }

    while (!lastJob || !['completed', 'failed', 'cancelled'].includes(lastJob.status)) {
      if (Date.now() - startedAt > timeoutMs) throw new Error('任务等待超时');
      await new Promise(resolve => window.setTimeout(resolve, 1500));
      const response = await aiApi.getQueueJob(id);
      if (!response.success || !response.data) throw new Error(response.message || '获取任务状态失败');
      lastJob = response.data;
      onJob(lastJob);
    }

    if (lastJob.status === 'failed') throw new Error(lastJob.errorMessage || '任务执行失败');
    if (lastJob.status === 'cancelled') throw new Error('任务已取消');
    return lastJob;
  },

  downloadExportJob: async (id: string): Promise<string> => {
    const token = localStorage.getItem('auth_token');
    const response = await fetch(`${API_BASE_URL}/api/generate/jobs/${id}/download`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });
    if (!response.ok) throw new Error('导出文件下载失败');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const disposition = response.headers.get('Content-Disposition') || '';
    const encodedFileName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const fallbackFileName = disposition.match(/filename="([^"]+)"/)?.[1];
    const fileName = encodedFileName
      ? decodeURIComponent(encodedFileName)
      : fallbackFileName || `nexious-deck-${Date.now()}.pptx`;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return fileName;
  },

  exportPptx: async (pages: Array<{ svg: string; speakerNotes: string }>, spec: DesignSpec, lock?: SpecLock): Promise<string> => {
    const token = localStorage.getItem('auth_token');
    const response = await fetch(`${API_BASE_URL}/api/generate/export-pptx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ pages, spec, lock }),
    });
    if (!response.ok) throw new Error('导出失败');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const disposition = response.headers.get('Content-Disposition') || '';
    const encodedFileName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const fallbackFileName = disposition.match(/filename="([^"]+)"/)?.[1];
    const fileName = encodedFileName
      ? decodeURIComponent(encodedFileName)
      : fallbackFileName || `nexious-deck-${Date.now()}.pptx`;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return fileName;
  }
};

export interface Prompt {
  id: number;
  title: string;
  scene: string | null;
  content: string;
  preview_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Skill {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  parameters: Record<string, any>;
  is_enabled: boolean;
  type: 'prompt-only' | 'package' | string;
  runtime: 'prompt-only' | 'python' | 'node' | string;
  entry: string | null;
  package_path: string | null;
  manifest: Record<string, any> | null;
  dependency_file: string | null;
  install_status: 'not_required' | 'pending' | 'installing' | 'ready' | 'failed' | string;
  install_log: string | null;
  last_installed_at: string | null;
  test_status?: 'not_tested' | 'testing' | 'passed' | 'failed' | 'skipped' | string;
  test_log?: string | null;
  last_tested_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkillPackagePreviewFile {
  path: string;
  size: number;
  role: 'skill-md' | 'manifest' | 'dependency' | 'entry' | 'source' | 'asset' | string;
}

export interface SkillPackagePreview {
  name: string;
  description: string;
  icon: string;
  category: string;
  runtime: 'prompt-only' | 'python' | 'node' | string;
  entry: string | null;
  dependencyFile: string | null;
  inferredDependencies: string[];
  skillMdPath: string;
  skillJsonPath: string | null;
  fileCount: number;
  totalSize: number;
  instructionPreview: string;
  adaptationPlan: string[];
  files: SkillPackagePreviewFile[];
}

export interface SkillRun {
  id: number;
  user_id: number;
  skill_id: number;
  skill_name?: string;
  project_id: string | null;
  phase: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | string;
  progress: number;
  input: Record<string, any>;
  output: Record<string, any> | string | null;
  error_message: string | null;
  logs: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Template {
  id: number;
  name: string;
  category: string | null;
  description: string | null;
  slide_count: number;
  accent: string;
  preview_url: string | null;
  settings: TemplateAssetSettings | string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface RunConfig {
  id: number;
  name: string;
  key: string;
  type: 'string' | 'number' | 'select' | 'boolean';
  value: string;
  options: Array<{ value: string; label: string }>;
  min_value: number | null;
  max_value: number | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export type GenerationJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface GenerationJob {
  id: number;
  user_id: number;
  project_id: string;
  title: string | null;
  status: GenerationJobStatus;
  phase: string;
  progress: number;
  error_message: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export const promptApi = {
  getAll: () => api.get<Prompt[]>('/api/prompts'),

  getById: (id: number) => api.get<Prompt>(`/api/prompts/${id}`),

  create: (data: { title: string; scene?: string; content: string; preview_url?: string | null }) =>
    api.post<Prompt>('/api/prompts', data),

  update: (id: number, data: { title: string; scene?: string; content: string; preview_url?: string | null }) =>
    api.put<Prompt>(`/api/prompts/${id}`, data),

  uploadPreviewImage: (data: { filename: string; dataUrl: string }) =>
    api.post<{ url: string }>('/api/prompts/preview-image', data),

  delete: (id: number) => api.delete(`/api/prompts/${id}`)
};

export const skillApi = {
  getAll: () => api.get<Skill[]>('/api/skills'),

  getById: (id: number) => api.get<Skill>(`/api/skills/${id}`),

  getRuns: (projectId?: string) => {
    const params = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    return api.get<SkillRun[]>(`/api/skills/runs${params}`);
  },

  uploadPackage: (data: { filename: string; dataBase64: string; category?: string }) =>
    api.post<Skill>('/api/skills/upload-package', data),

  previewPackage: (data: { filename: string; dataBase64: string }) =>
    api.post<SkillPackagePreview>('/api/skills/preview-package', data),

  create: (data: {
    name: string;
    description?: string;
    icon?: string;
    category?: string;
    parameters?: Record<string, any>;
    is_enabled?: boolean;
  }) => api.post<Skill>('/api/skills', data),

  update: (id: number, data: {
    name: string;
    description?: string;
    icon?: string;
    category?: string;
    parameters?: Record<string, any>;
    is_enabled?: boolean;
  }) => api.put<Skill>(`/api/skills/${id}`, data),

  delete: (id: number) => api.delete(`/api/skills/${id}`),

  toggle: (id: number) => api.post(`/api/skills/${id}/toggle`),

  reinstall: (id: number) => api.post(`/api/skills/${id}/reinstall`),

  test: (id: number) => api.post(`/api/skills/${id}/test`),

  run: (id: number, data: { projectId?: string; phase?: string; input?: Record<string, any> }) =>
    api.post<SkillRun>(`/api/skills/${id}/run`, data, { timeoutMs: 150000 })
};

export const templateApi = {
  getAll: (category?: string) => {
    const params = category && category !== '全部' ? `?category=${encodeURIComponent(category)}` : '';
    return api.get<Template[]>(`/api/templates${params}`);
  },

  getCategories: () => api.get<string[]>('/api/templates/categories'),

  getById: (id: number) => api.get<Template>(`/api/templates/${id}`),

  create: (data: {
    name: string;
    category?: string;
    description?: string;
    slide_count?: number;
    accent?: string;
    preview_url?: string;
    settings?: TemplateAssetSettings;
    is_public?: boolean;
  }) => api.post<Template>('/api/templates', data),

  update: (id: number, data: {
    name: string;
    category?: string;
    description?: string;
    slide_count?: number;
    accent?: string;
    preview_url?: string;
    settings?: TemplateAssetSettings;
    is_public?: boolean;
  }) => api.put<Template>(`/api/templates/${id}`, data),

  delete: (id: number) => api.delete(`/api/templates/${id}`)
};

export const configApi = {
  getAll: () => api.get<RunConfig[]>('/api/configs'),

  getById: (id: number) => api.get<RunConfig>(`/api/configs/${id}`),

  create: (data: {
    name: string;
    key: string;
    type?: 'string' | 'number' | 'select' | 'boolean';
    value?: string;
    options?: Array<{ value: string; label: string }>;
    min_value?: number;
    max_value?: number;
    description?: string;
  }) => api.post<RunConfig>('/api/configs', data),

  update: (id: number, data: {
    name: string;
    key: string;
    type?: 'string' | 'number' | 'select' | 'boolean';
    value?: string;
    options?: Array<{ value: string; label: string }>;
    min_value?: number;
    max_value?: number;
    description?: string;
  }) => api.put<RunConfig>(`/api/configs/${id}`, data),

  delete: (id: number) => api.delete(`/api/configs/${id}`),

  reset: () => api.post<RunConfig[]>('/api/configs/reset')
};

export const workflowApi = {
  save: (snapshotData: any) => api.post('/api/workflows/save', { snapshotData }),

  restore: () => api.get<{ snapshotData: any; savedAt: string }>('/api/workflows/restore'),

  clear: () => api.delete('/api/workflows')
};

export const versionApi = {
  getAll: (projectId: string) => api.get<any[]>(`/api/versions/${projectId}`),

  save: (projectId: string, data: { label?: string; outline: any[]; parameters: any; slideCount: number; state?: any }) =>
    api.post(`/api/versions/${projectId}`, data),

  delete: (projectId: string, versionId: string) =>
    api.delete(`/api/versions/${projectId}/${versionId}`)
};

export const generationJobApi = {
  create: (data: { projectId: string; title?: string; metadata?: Record<string, any> }) =>
    api.post<{ id: number }>('/api/generation-jobs', data),

  update: (id: number, data: {
    status?: GenerationJobStatus;
    phase?: string;
    progress?: number;
    errorMessage?: string | null;
    metadata?: Record<string, any>;
  }) => api.patch<{ updated: boolean }>(`/api/generation-jobs/${id}`, data),

  getRecent: (limit = 20) =>
    api.get<GenerationJob[]>(`/api/generation-jobs?limit=${limit}`),

  getByProject: (projectId: string, limit = 20) =>
    api.get<GenerationJob[]>(`/api/generation-jobs/project/${encodeURIComponent(projectId)}?limit=${limit}`),

  cancel: (id: number) => api.post(`/api/generation-jobs/${id}/cancel`)
};
