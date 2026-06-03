const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

import type { DesignSpec, SpecSlide, SpecLock, SkillExtension } from '../types/agent';

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  status?: number;
}

class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

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
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          message: data.message || '请求失败',
          error: data.error,
          status: response.status,
        };
      }

      return data;
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : '网络错误',
      };
    }
  }

  async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, body?: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
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

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
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
        const errorData = await response.json();
        throw new Error(errorData.message || '请求失败');
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
  settings: any;
  state?: any;
  created_at: string;
  updated_at: string;
  slides?: Slide[];
}

export interface Slide {
  id: number;
  project_id: number;
  order_index: number;
  title: string | null;
  bullets: string[] | null;
  speaker_notes: string | null;
  visual_prompt: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Image {
  id: number;
  slide_id: number;
  prompt: string;
  style: string | null;
  url: string;
  is_selected: boolean;
  created_at: string;
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

  updateMe: (data: { name?: string; avatar?: string; password?: string }) =>
    api.put<User>('/api/auth/me', data),

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
    settings?: any;
    state?: any;
  }) => api.post<{ id: number }>('/api/projects', data),

  update: (id: number, data: {
    title?: string;
    topic?: string;
    content?: string;
    status?: 'draft' | 'generating' | 'completed';
    settings?: any;
    state?: any;
  }) => api.put<{ id?: number; replacedMissingId?: number }>(`/api/projects/${id}`, data),

  delete: (id: number) => api.delete(`/api/projects/${id}`),

  getSlides: (projectId: number) => api.get<Slide[]>(`/api/projects/${projectId}/slides`),

  createSlide: (projectId: number, data: {
    title?: string;
    bullets?: string[];
    speaker_notes?: string;
    visual_prompt?: string;
    order_index?: number;
  }) => api.post<{ id: number }>(`/api/projects/${projectId}/slides`, data),

  updateSlide: (projectId: number, slideId: number, data: {
    title?: string;
    bullets?: string[];
    speaker_notes?: string;
    visual_prompt?: string;
    image_url?: string;
    order_index?: number;
  }) => api.put(`/api/projects/${projectId}/slides/${slideId}`, data),

  deleteSlide: (projectId: number, slideId: number) =>
    api.delete(`/api/projects/${projectId}/slides/${slideId}`),

  getImages: (projectId: number, slideId: number) =>
    api.get<Image[]>(`/api/projects/${projectId}/slides/${slideId}/images`),

  createImage: (projectId: number, slideId: number, data: {
    prompt: string;
    style?: string;
    url: string;
    is_selected?: boolean;
  }) => api.post<{ id: number }>(`/api/projects/${projectId}/slides/${slideId}/images`, data),

  updateImage: (projectId: number, slideId: number, imageId: number, data: {
    url?: string;
    is_selected?: boolean;
  }) => api.put(`/api/projects/${projectId}/slides/${slideId}/images/${imageId}`, data),

  selectImage: (projectId: number, slideId: number, imageId: number) =>
    api.post(`/api/projects/${projectId}/slides/${slideId}/images/${imageId}/select`),
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
  onComplete?: (data: any) => void;
  onError?: (message: string) => void;
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
      imageStyle: string;
      template: string;
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

  exportPptx: async (pages: Array<{ svg: string; speakerNotes: string }>, spec: DesignSpec, lock?: SpecLock): Promise<string> => {
    const response = await fetch(`${API_BASE_URL}/api/generate/export-pptx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  settings: Record<string, any>;
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

export const promptApi = {
  getAll: () => api.get<Prompt[]>('/api/prompts'),

  getById: (id: number) => api.get<Prompt>(`/api/prompts/${id}`),

  create: (data: { title: string; scene?: string; content: string }) =>
    api.post<Prompt>('/api/prompts', data),

  update: (id: number, data: { title: string; scene?: string; content: string }) =>
    api.put<Prompt>(`/api/prompts/${id}`, data),

  delete: (id: number) => api.delete(`/api/prompts/${id}`)
};

export const skillApi = {
  getAll: () => api.get<Skill[]>('/api/skills'),

  getById: (id: number) => api.get<Skill>(`/api/skills/${id}`),

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

  toggle: (id: number) => api.post(`/api/skills/${id}/toggle`)
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
    settings?: Record<string, any>;
    is_public?: boolean;
  }) => api.post<Template>('/api/templates', data),

  update: (id: number, data: {
    name: string;
    category?: string;
    description?: string;
    slide_count?: number;
    accent?: string;
    preview_url?: string;
    settings?: Record<string, any>;
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

  save: (projectId: string, data: { label?: string; outline: any[]; parameters: any; slideCount: number }) =>
    api.post(`/api/versions/${projectId}`, data),

  delete: (projectId: string, versionId: string) =>
    api.delete(`/api/versions/${projectId}/${versionId}`)
};
