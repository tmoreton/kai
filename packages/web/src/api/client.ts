// ============================================
// API Client - All 50+ endpoints
// ============================================

import type {
  Session,
  SessionDetail,
  Agent,
  AgentDetail,
  AgentRun,
  AgentStep,
  Project,
  Notification,
  Settings,
  McpServerConfig,
  SkillDetail,
  ServerStatus,
  ChatRequest,
  InterruptedRun,
  CheckpointStatus,
} from '../types/api';
import { toast } from '../components/Toast';

const API_BASE = '/api';
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second base delay

// ============================================
// Error Classes
// ============================================

export class ApiError extends Error {
  status: number;
  data?: unknown;
  retryable: boolean;

  constructor(
    message: string,
    status: number,
    data?: unknown,
    retryable = false
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.retryable = retryable;
  }
}

export class NetworkError extends Error {
  constructor(message = 'Network error - please check your connection') {
    super(message);
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

// ============================================
// Fetch with Timeout and Retry
// ============================================

interface FetchOptions extends RequestInit {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  showErrorToast?: boolean;
}

async function fetchWithTimeout(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (controller.signal.aborted) {
      throw new TimeoutError(timeout);
    }
    throw error;
  }
}

async function fetchWithRetry<T>(
  url: string,
  options: FetchOptions = {}
): Promise<T> {
  const {
    retries = MAX_RETRIES,
    retryDelay = RETRY_DELAY,
    showErrorToast = true,
    ...fetchOptions
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, fetchOptions);

      if (!response.ok) {
        const text = await response.text();
        let errorData: unknown;
        
        try {
          errorData = JSON.parse(text);
        } catch {
          errorData = text;
        }

        // Determine if error is retryable
        const isRetryable =
          response.status >= 500 || // Server errors
          response.status === 429 || // Rate limit
          response.status === 408 || // Timeout
          response.status === 502 || // Bad gateway
          response.status === 503 || // Service unavailable
          response.status === 504; // Gateway timeout

        const error = new ApiError(
          (errorData as { message?: string })?.message || 
          (errorData as { error?: string })?.error || 
          text || 
          response.statusText,
          response.status,
          errorData,
          isRetryable
        );

        // Don't retry non-retryable errors (like 400, 401, 403, 404)
        if (!isRetryable || attempt === retries) {
          throw error;
        }

        lastError = error;
      } else {
        // Success!
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          return await response.json();
        }
        return response as unknown as T;
      }
    } catch (error) {
      // Handle network errors and timeouts
      if (error instanceof TypeError || error instanceof TimeoutError) {
        const isLastAttempt = attempt === retries;
        
        if (isLastAttempt) {
          if (error instanceof TimeoutError) {
            throw error;
          }
          throw new NetworkError();
        }
        
        lastError = error instanceof Error ? error : new Error(String(error));
      } else {
        throw error; // Re-throw ApiErrors immediately
      }
    }

    // Wait before retrying (exponential backoff)
    if (attempt < retries) {
      const delay = retryDelay * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but just in case
  throw lastError || new Error('Request failed');
}

// ============================================
// Error Handler with Toast
// ============================================

function handleApiError(error: unknown, showToast: boolean): never {
  let message = 'An unexpected error occurred';
  let title = 'Error';
  let details: string | undefined;

  if (error instanceof ApiError) {
    title = `Error ${error.status}`;
    message = error.message;
    
    // User-friendly messages for common errors
    switch (error.status) {
      case 400:
        title = 'Invalid Request';
        message = error.message || 'The request was invalid. Please check your input.';
        break;
      case 401:
        title = 'Not Authenticated';
        message = 'Please sign in to continue.';
        break;
      case 403:
        title = 'Access Denied';
        message = 'You do not have permission to perform this action.';
        break;
      case 404:
        title = 'Not Found';
        message = error.message || 'The requested resource could not be found.';
        break;
      case 408:
        title = 'Request Timeout';
        message = 'The server took too long to respond. Please try again.';
        break;
      case 429:
        title = 'Too Many Requests';
        message = 'Please wait a moment before trying again.';
        break;
      case 500:
        title = 'Server Error';
        message = 'Something went wrong on our end. Please try again later.';
        break;
      case 502:
      case 503:
      case 504:
        title = 'Service Unavailable';
        message = 'The service is temporarily unavailable. Please try again later.';
        break;
    }
  } else if (error instanceof TimeoutError) {
    title = 'Request Timeout';
    message = error.message;
  } else if (error instanceof NetworkError) {
    title = 'Connection Error';
    message = error.message;
    details = 'Please check your internet connection and try again.';
  } else if (error instanceof Error) {
    message = error.message;
  }

  if (showToast) {
    toast.error(title, details || message, 8000);
  }

  throw error;
}

// ============================================
// Main Fetch Function
// ============================================

async function fetchJson<T>(
  url: string,
  options?: FetchOptions
): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    ...options?.headers,
  };

  try {
    return await fetchWithRetry<T>(url, {
      ...options,
      headers,
    });
  } catch (error) {
    return handleApiError(error, options?.showErrorToast !== false);
  }
}

// ============================================
// Chat API
// ============================================

export const chatApi = {
  sendMessage: (_request: ChatRequest): EventSource => {
    const url = `${API_BASE}/chat`;
    return new EventSource(url);
  },

  stopStreaming: (sessionId: string): Promise<{ stopped: boolean }> => {
    return fetchJson(`${API_BASE}/chat/stop`, {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
  },
};

// Streaming chat using fetch with ReadableStream
export async function* streamChat(
  request: ChatRequest,
  signal?: AbortSignal
): AsyncGenerator<{
  event: string;
  data: unknown;
}> {
  const timeoutMs = 120000; // 2 minutes for streaming
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Combine external signal with our controller
  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const response = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      throw new ApiError(text || response.statusText, response.status);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let currentEvent: string | null = null;
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.substring(7).trim();
        } else if (line.startsWith('data: ') && currentEvent) {
          try {
            const data = JSON.parse(line.substring(6));
            yield { event: currentEvent, data };
          } catch {
            yield { event: currentEvent, data: line.substring(6) };
          }
        }
      }
    }
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    if (controller.signal.aborted) {
      throw new TimeoutError(timeoutMs);
    }
    
    if (error instanceof TypeError) {
      throw new NetworkError('Connection lost during streaming. Please try again.');
    }
    
    throw error;
  }
}

// ============================================
// Sessions API
// ============================================

export const sessionsApi = {
  list: (type?: 'chat' | 'code' | 'agent'): Promise<Session[]> => {
    const url = type
      ? `${API_BASE}/sessions?type=${type}`
      : `${API_BASE}/sessions`;
    return fetchJson(url);
  },

  get: (id: string): Promise<SessionDetail> => {
    return fetchJson(`${API_BASE}/sessions/${id}`);
  },

  create: (body: {
    name?: string;
    type?: 'chat' | 'code' | 'agent';
    cwd?: string;
  }): Promise<{ id: string; name?: string; type: string }> => {
    return fetchJson(`${API_BASE}/sessions`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  delete: (id: string): Promise<{ deleted: boolean }> => {
    return fetchJson(`${API_BASE}/sessions/${id}`, {
      method: 'DELETE',
    });
  },

  exportSession: (id: string): Promise<string> => {
    return fetchJson(`${API_BASE}/sessions/${id}/export`, { method: 'POST' });
  },

  clearSession: (id: string): Promise<{ cleared: boolean }> => {
    return fetchJson(`${API_BASE}/sessions/${id}/clear`, { method: 'POST' });
  },
};

// ============================================
// Projects API
// ============================================

export const projectsApi = {
  list: (): Promise<Project[]> => {
    return fetchJson(`${API_BASE}/projects`);
  },

  create: (path: string): Promise<{ id: string; name: string; cwd: string }> => {
    return fetchJson(`${API_BASE}/projects`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  },
};

// ============================================
// Agents API
// ============================================

export interface AgentsListResponse {
  agents: Agent[];
}

export const agentsApi = {
  list: (): Promise<AgentsListResponse> => {
    return fetchJson(`${API_BASE}/agents`);
  },

  get: (id: string): Promise<AgentDetail> => {
    return fetchJson(`${API_BASE}/agents/${id}`);
  },

  create: (body: {
    name: string;
    description?: string;
    schedule?: string;
    prompt: string;
  }): Promise<Agent> => {
    return fetchJson(`${API_BASE}/agents`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  update: (id: string, body: {
    enabled?: boolean;
    name?: string;
    description?: string;
    schedule?: string;
    config?: Record<string, unknown>;
  }): Promise<Agent> => {
    return fetchJson(`${API_BASE}/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  delete: (id: string): Promise<{ deleted: boolean }> => {
    return fetchJson(`${API_BASE}/agents/${id}`, {
      method: 'DELETE',
    });
  },

  run: (id: string): Promise<{ success: boolean; message?: string; agentId?: string; runId?: string; status?: string }> => {
    // Use shorter timeout since runs are now async (server returns immediately)
    return fetchJson(`${API_BASE}/agents/${id}/run`, {
      method: 'POST',
      timeout: 10000, // 10 seconds is plenty for the async trigger
    });
  },

  getWorkflow: (id: string): Promise<{ yaml: string; path: string }> => {
    return fetchJson(`${API_BASE}/agents/${id}/workflow`);
  },

  updateWorkflow: (id: string, yaml: string): Promise<{ ok: boolean }> => {
    return fetchJson(`${API_BASE}/agents/${id}/workflow`, {
      method: 'PUT',
      body: JSON.stringify({ yaml }),
    });
  },

  getOutput: (id: string): Promise<{ run: AgentRun; steps: AgentStep[] }> => {
    return fetchJson(`${API_BASE}/agents/${id}/output`);
  },

  getRunSteps: (id: string, runId: string): Promise<{ steps: AgentStep[] }> => {
    return fetchJson(`${API_BASE}/agents/${id}/runs/${runId}`);
  },

  resumeRun: (agentId: string, runId: string): Promise<{ success: boolean; runId?: string; results?: Record<string, any>; error?: string }> => {
    return fetchJson(`${API_BASE}/agents/${agentId}/resume/${runId}`, {
      method: 'POST',
    });
  },

  getInterruptedRuns: (id: string): Promise<{ interruptedRuns: InterruptedRun[] }> => {
    return fetchJson(`${API_BASE}/agents/${id}/interrupted`);
  },

  getCheckpointStatus: (agentId: string, runId: string): Promise<CheckpointStatus> => {
    return fetchJson(`${API_BASE}/agents/${agentId}/runs/${runId}/checkpoint`);
  },

  getLogs: (id: string, limit = 50): Promise<unknown[]> => {
    return fetchJson(`${API_BASE}/agents/${id}/logs?limit=${limit}`);
  },

  getRecap: (id: string): Promise<{ recap: string | null; run: AgentRun }> => {
    return fetchJson(`${API_BASE}/agents/${id}/recap`);
  },

  chat: (id: string, message: string, attachments?: Array<{type: 'image' | 'file'; name: string; mimeType: string; data: string}>): Promise<{ response: string; sessionId: string }> => {
    return fetchJson(`${API_BASE}/agents/${id}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message, attachments }),
    });
  },
};

// ============================================
// Notifications API
// ============================================

export interface NotificationsResponse {
  notifications: Notification[];
  unread: number;
}

export const notificationsApi = {
  list: (limit = 30): Promise<NotificationsResponse> => {
    return fetchJson(`${API_BASE}/notifications?limit=${limit}`);
  },

  markRead: (id: number): Promise<{ ok: boolean }> => {
    return fetchJson(`${API_BASE}/notifications/${id}/read`, {
      method: 'PATCH',
    });
  },

  markAllRead: (): Promise<{ ok: boolean }> => {
    return fetchJson(`${API_BASE}/notifications/read-all`, {
      method: 'POST',
    });
  },

  delete: (id: number): Promise<{ ok: boolean }> => {
    return fetchJson(`${API_BASE}/notifications/${id}`, {
      method: 'DELETE',
    });
  },

  deleteAll: (): Promise<{ ok: boolean }> => {
    return fetchJson(`${API_BASE}/notifications`, {
      method: 'DELETE',
    });
  },
};

// ============================================
// Settings API
// ============================================

export const settingsApi = {
  get: (): Promise<Settings> => {
    return fetchJson(`${API_BASE}/settings`);
  },

  update: (updates: { autoCompact?: boolean; maxTokens?: number; profile?: { name?: string; role?: string; context?: string } }): Promise<{ ok: boolean }> => {
    return fetchJson(`${API_BASE}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  // MCP Servers
  addMcpServer: (body: McpServerConfig & { name: string }): Promise<{ ok: boolean }> => {
    return fetchJson(`${API_BASE}/settings/mcp`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  removeMcpServer: (name: string): Promise<{ ok: boolean }> => {
    return fetchJson(`${API_BASE}/settings/mcp/${name}`, {
      method: 'DELETE',
    });
  },

  // Skills
  reloadSkills: (): Promise<{ loaded: number; errors: string[] }> => {
    return fetchJson(`${API_BASE}/settings/skills/reload`, { method: 'POST' });
  },

  installSkill: (source: string): Promise<{ ok: boolean; id: string }> => {
    return fetchJson(`${API_BASE}/settings/skills/install`, {
      method: 'POST',
      body: JSON.stringify({ source }),
    });
  },

  uninstallSkill: (id: string): Promise<{ ok: boolean }> => {
    return fetchJson(`${API_BASE}/settings/skills/${id}`, {
      method: 'DELETE',
    });
  },

  getSkill: (id: string): Promise<SkillDetail> => {
    return fetchJson(`${API_BASE}/settings/skills/${id}`);
  },

  updateSkillManifest: (id: string, manifest: string): Promise<{ ok: boolean }> => {
    return fetchJson(`${API_BASE}/settings/skills/${id}/manifest`, {
      method: 'PUT',
      body: JSON.stringify({ manifest }),
    });
  },

  updateSkillHandler: (id: string, handler: string): Promise<{ ok: boolean }> => {
    return fetchJson(`${API_BASE}/settings/skills/${id}/handler`, {
      method: 'PUT',
      body: JSON.stringify({ handler }),
    });
  },

  createSkill: (body: {
    id: string;
    name: string;
    version?: string;
    description?: string;
    author?: string;
  }): Promise<{ ok: boolean; id: string }> => {
    return fetchJson(`${API_BASE}/settings/skills`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  createCustomSkill: (name: string, description: string, code: string): Promise<{ ok: boolean; id: string }> => {
    return fetchJson(`${API_BASE}/settings/skills/custom`, {
      method: 'POST',
      body: JSON.stringify({ name, description, code }),
    });
  },

  // Available Skills from Registry
  getAvailableSkills: (): Promise<{ skills: Array<{ id: string; name: string; description: string; version: string; author: string; tags: string[]; installed: boolean }> }> => {
    return fetchJson(`${API_BASE}/settings/skills/available`);
  },

  // Environment Variables
  getEnv: (): Promise<{ env: Record<string, string> }> => {
    return fetchJson(`${API_BASE}/settings/env`);
  },

  setEnv: (key: string, value: string): Promise<{ ok: boolean }> => {
    return fetchJson(`${API_BASE}/settings/env`, {
      method: 'POST',
      body: JSON.stringify({ key, value }),
    });
  },

  removeEnv: (key: string): Promise<{ ok: boolean }> => {
    return fetchJson(`${API_BASE}/settings/env/${key}`, {
      method: 'DELETE',
    });
  },

  // Reload AI provider after API key changes
  reloadProvider: (): Promise<{ ok: boolean }> => {
    return fetchJson(`${API_BASE}/settings/reload-provider`, { method: 'POST' });
  },

  // Soul (Identity)
  getSoul: (): Promise<{ content: string; path: string }> => {
    return fetchJson(`${API_BASE}/settings/soul`);
  },

  updateSoul: (content: string): Promise<{ ok: boolean }> => {
    return fetchJson(`${API_BASE}/settings/soul`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
  },

  // Context (Goals/Scratchpad)
  getContext: (): Promise<{
    content: string;
    path: string;
    globalPath: string;
    projectPath: string | null;
    isProject: boolean;
    hasProjectContext: boolean;
  }> => {
    return fetchJson(`${API_BASE}/settings/context`);
  },

  updateContext: (content: string, scope: 'global' | 'project'): Promise<{ ok: boolean; path: string }> => {
    return fetchJson(`${API_BASE}/settings/context`, {
      method: 'PUT',
      body: JSON.stringify({ content, scope }),
    });
  },

  // CLI Installation
  getCliStatus: (): Promise<{ installed: boolean; path: string | null; source: string; needsSudo?: boolean }> => {
    return fetchJson(`${API_BASE}/settings/cli`);
  },

  installCli: (): Promise<{ ok: boolean; path: string } | { error: string; needsSudo?: boolean }> => {
    return fetchJson(`${API_BASE}/settings/cli/install`, { method: 'POST' });
  },

  uninstallCli: (): Promise<{ ok: boolean } | { error: string; needsSudo?: boolean }> => {
    return fetchJson(`${API_BASE}/settings/cli/uninstall`, { method: 'POST' });
  },
};

// ============================================
// Core/Status API
// ============================================

export const coreApi = {
  status: (): Promise<ServerStatus> => {
    return fetchJson(`${API_BASE}/status`);
  },

  tailscale: (): Promise<{
    installed: boolean;
    running: boolean;
    enabled: boolean;
    funnel: boolean;
  }> => {
    return fetchJson(`${API_BASE}/tailscale`);
  },

  model: (): Promise<{ model: string; provider: string }> => {
    return fetchJson(`${API_BASE}/model`);
  },

  getImage: (path: string): Promise<Blob> => {
    return fetchWithRetry<Response>(`${API_BASE}/image?path=${encodeURIComponent(path)}`).then(r => {
      if (!r.ok) throw new ApiError('Image not found', r.status);
      return r.blob();
    });
  },

  generateImage: (prompt: string, options?: { width?: number; height?: number }): Promise<{ path: string }> => {
    return fetchJson(`${API_BASE}/image/generate`, {
      method: 'POST',
      body: JSON.stringify({ prompt, ...options }),
    });
  },

  getAttachment: (path: string): Promise<Blob> => {
    return fetchWithRetry<Response>(`${API_BASE}/attachments?path=${encodeURIComponent(path)}`).then(r => {
      if (!r.ok) throw new ApiError('Attachment not found', r.status);
      return r.blob();
    });
  },

  exportSession: (id: string): Promise<string> => {
    return fetchJson(`${API_BASE}/sessions/${id}/export`, { method: 'POST' });
  },

  clearSession: (id: string): Promise<{ cleared: boolean }> => {
    return fetchJson(`${API_BASE}/sessions/${id}/clear`, { method: 'POST' });
  },
};

// ============================================
// Retry Helper for Components
// ============================================

export interface RetryOptions {
  retries?: number;
  retryDelay?: number;
  onRetry?: (attempt: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { retries = MAX_RETRIES, retryDelay = RETRY_DELAY, onRetry } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      if (error instanceof ApiError && !error.retryable) {
        throw error;
      }

      if (attempt < retries) {
        onRetry?.(attempt + 1);
        const delay = retryDelay * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('All retry attempts failed');
}

// ============================================
// Export all APIs
// ============================================

export const api = {
  chat: chatApi,
  streamChat,
  sessions: sessionsApi,
  projects: projectsApi,
  agents: agentsApi,
  notifications: notificationsApi,
  settings: settingsApi,
  core: coreApi,
};

// Error classes are already exported above

// Stub API methods for agent actions
export const toggleAgent = async (id: string, enabled: boolean) => {
  return fetchJson(`${API_BASE}/agents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
};

export const runAgent = async (id: string) => {
  return fetchJson(`${API_BASE}/agents/${id}/run`, {
    method: 'POST',
  });
};


  // VPN / Tailscale
  getVpnStatus: (): Promise<{vpn?: {enabled: boolean; funnel: boolean}; tailscale?: any}> => {
    return fetchJson(`${API_BASE}/settings/vpn`);
  },

  updateVpn: (settings: {enabled: boolean; funnel: boolean}): Promise<{ok: boolean}> => {
    return fetchJson(`${API_BASE}/settings/vpn`, {
      method: 'PATCH',
      body: JSON.stringify(settings),
    });
  },
