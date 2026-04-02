// ============================================
// React Query Definitions - Optimized for Performance
// ============================================

import { queryOptions } from '@tanstack/react-query';
import { api } from './client';

// Default stale times by data criticality
const STALE_TIMES = {
  critical: 30000,    // 30s - chat sessions, current messages
  frequent: 60000,   // 1m - agent lists, notifications
  standard: 5 * 60000, // 5m - settings, personas
  static: 30 * 60000, // 30m - model info, core status
} as const;

// Default retry configuration
const defaultRetryConfig = {
  retry: (failureCount: number, error: Error) => {
    // Don't retry on client errors (4xx)
    if (error.message?.includes('4') || error.name === 'AbortError') {
      return false;
    }
    return failureCount < 2;
  },
  retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30000),
};

// Sessions
export const sessionsQueries = {
  all: () => ['sessions'] as const,

  list: (type?: 'chat' | 'code' | 'agent') =>
    queryOptions({
      queryKey: [...sessionsQueries.all(), type ?? 'all'],
      queryFn: () => api.sessions.list(type),
      staleTime: STALE_TIMES.frequent,
      ...defaultRetryConfig,
    }),

  detail: (id: string) =>
    queryOptions({
      queryKey: [...sessionsQueries.all(), id],
      queryFn: () => api.sessions.get(id),
      staleTime: STALE_TIMES.critical, // Chat data changes frequently but don't over-fetch
      ...defaultRetryConfig,
    }),
};

// Projects
export const projectsQueries = {
  all: () => ['projects'] as const,

  list: () =>
    queryOptions({
      queryKey: projectsQueries.all(),
      queryFn: () => api.projects.list(),
      staleTime: STALE_TIMES.standard,
      ...defaultRetryConfig,
    }),
};

// Agents & Personas
export const agentsQueries = {
  all: () => ['agents'] as const,

  list: () =>
    queryOptions({
      queryKey: agentsQueries.all(),
      queryFn: () => api.agents.list(),
      staleTime: STALE_TIMES.frequent,
      // Removed: refetchInterval - rely on manual invalidation instead of polling
      ...defaultRetryConfig,
    }),

  detail: (id: string) =>
    queryOptions({
      queryKey: [...agentsQueries.all(), id],
      queryFn: () => api.agents.get(id),
      staleTime: STALE_TIMES.standard,
      ...defaultRetryConfig,
    }),

  workflow: (id: string) =>
    queryOptions({
      queryKey: [...agentsQueries.all(), id, 'workflow'],
      queryFn: () => api.agents.getWorkflow(id),
      staleTime: STALE_TIMES.standard,
      ...defaultRetryConfig,
    }),

  output: (id: string, isActive = false) =>
    queryOptions({
      queryKey: [...agentsQueries.all(), id, 'output'],
      queryFn: () => api.agents.getOutput(id),
      // Only poll when agent is actively running - controlled by enabled flag
      refetchInterval: isActive ? 5000 : false,
      staleTime: STALE_TIMES.critical,
      ...defaultRetryConfig,
    }),

  logs: (id: string, limit = 50) =>
    queryOptions({
      queryKey: [...agentsQueries.all(), id, 'logs', limit],
      queryFn: () => api.agents.getLogs(id, limit),
      staleTime: STALE_TIMES.frequent,
      ...defaultRetryConfig,
    }),

  recap: (id: string) =>
    queryOptions({
      queryKey: [...agentsQueries.all(), id, 'recap'],
      queryFn: () => api.agents.getRecap(id),
      staleTime: STALE_TIMES.standard,
      ...defaultRetryConfig,
    }),

  runSteps: (agentId: string, runId: string) =>
    queryOptions({
      queryKey: [...agentsQueries.all(), agentId, 'runs', runId],
      queryFn: () => api.agents.getRunSteps(agentId, runId),
      staleTime: STALE_TIMES.critical,
      ...defaultRetryConfig,
    }),
};

// Notifications
export const notificationsQueries = {
  all: () => ['notifications'] as const,

  list: (limit = 30) =>
    queryOptions({
      queryKey: [...notificationsQueries.all(), limit],
      queryFn: () => api.notifications.list(limit),
      staleTime: STALE_TIMES.frequent,
      // Removed: refetchInterval - notifications should use WebSocket or manual refresh
      // to avoid polling overhead
      ...defaultRetryConfig,
    }),
};

// Settings
export const settingsQueries = {
  all: () => ['settings'] as const,

  list: () =>
    queryOptions({
      queryKey: settingsQueries.all(),
      queryFn: () => api.settings.get(),
      staleTime: STALE_TIMES.standard, // Settings change infrequently
      ...defaultRetryConfig,
    }),

  soul: () =>
    queryOptions({
      queryKey: [...settingsQueries.all(), 'soul'],
      queryFn: () => api.settings.getSoul(),
      staleTime: STALE_TIMES.standard,
      ...defaultRetryConfig,
    }),

  context: () =>
    queryOptions({
      queryKey: [...settingsQueries.all(), 'context'],
      queryFn: () => api.settings.getContext(),
      staleTime: STALE_TIMES.standard,
      ...defaultRetryConfig,
    }),

  env: () =>
    queryOptions({
      queryKey: [...settingsQueries.all(), 'env'],
      queryFn: () => api.settings.getEnv(),
      staleTime: STALE_TIMES.standard,
      ...defaultRetryConfig,
    }),
};

// Core/Status
export const coreQueries = {
  status: () =>
    queryOptions({
      queryKey: ['status'],
      queryFn: () => api.core.status(),
      staleTime: STALE_TIMES.frequent,
      // Removed: refetchInterval - status checked on demand or when errors occur
      ...defaultRetryConfig,
    }),

  model: () =>
    queryOptions({
      queryKey: ['model'],
      queryFn: () => api.core.model(),
      staleTime: STALE_TIMES.static, // Model info rarely changes
      ...defaultRetryConfig,
    }),
};

// Skill detail (dynamic)
export const skillQueries = {
  detail: (id: string) =>
    queryOptions({
      queryKey: ['skills', id],
      queryFn: () => api.settings.getSkill(id),
      enabled: !!id,
      staleTime: STALE_TIMES.standard,
      ...defaultRetryConfig,
    }),
};
