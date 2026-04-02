// ============================================
// App Store - Global UI State
// ============================================

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Attachment } from '../types/api';

export interface ErrorData {
  message: string;
  details?: string;
  type?: string;
  fixable?: boolean;
}

interface AppState {
  // Navigation
  activeView: 'chat' | 'code' | 'agents' | 'agent-detail' | 'docs' | 'settings' | 'notifications';
  sidebarCollapsed: boolean;
  sidebarOpen: boolean; // mobile

  // Chat state
  currentSessionId: string | null;
  streamingSessions: Set<string>;
  attachments: Attachment[];
  commandPaletteOpen: boolean;
  selectedModel: string;

  // Agent/Persona selection
  selectedPersonaId: string | null;
  selectedAgentId: string | null;
  agentsViewMode: 'grouped' | 'all';

  // Error handling
  currentError: ErrorData | null;

  // Actions
  setView: (view: AppState['activeView']) => void;
  toggleSidebar: () => void;
  collapseSidebar: () => void;
  expandSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  setCurrentSession: (id: string | null) => void;
  startStreaming: (sessionId: string) => void;
  stopStreaming: (sessionId: string) => void;
  isStreaming: (sessionId: string) => boolean;

  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;

  addAttachment: (attachment: Attachment) => void;
  removeAttachment: (index: number) => void;
  clearAttachments: () => void;
  setSelectedModel: (model: string) => void;

  selectPersona: (id: string | null) => void;
  selectAgent: (id: string | null) => void;
  setAgentsViewMode: (mode: 'grouped' | 'all') => void;

  setError: (error: ErrorData | null) => void;
  clearError: () => void;
}

export const useAppStore = create<AppState>()(
  devtools(
    (set, get) => ({
      // Initial state
      activeView: 'chat',
      sidebarCollapsed: false,
      sidebarOpen: false,
      currentSessionId: null,
      streamingSessions: new Set(),
      attachments: [],
      commandPaletteOpen: false,
      selectedModel: 'accounts/fireworks/models/deepseek-v3',
      selectedPersonaId: null,
      selectedAgentId: null,
      agentsViewMode: 'grouped',
      currentError: null,

      // Navigation actions
      setView: (view) => set({ activeView: view }),

      toggleSidebar: () =>
        set((state) => ({
          sidebarCollapsed: !state.sidebarCollapsed,
        })),

      collapseSidebar: () => set({ sidebarCollapsed: true }),

      expandSidebar: () => set({ sidebarCollapsed: false }),

      setSidebarOpen: (open) => set({ sidebarOpen: open }),

      // Chat actions
      setCurrentSession: (id) => set({ currentSessionId: id }),

      startStreaming: (sessionId) =>
        set((state) => ({
          streamingSessions: new Set([...state.streamingSessions, sessionId]),
        })),

      stopStreaming: (sessionId) =>
        set((state) => {
          const newSet = new Set(state.streamingSessions);
          newSet.delete(sessionId);
          return { streamingSessions: newSet };
        }),

      isStreaming: (sessionId) => get().streamingSessions.has(sessionId),

      // Command palette
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

      toggleCommandPalette: () =>
        set((state) => ({
          commandPaletteOpen: !state.commandPaletteOpen,
        })),

      // Attachments
      addAttachment: (attachment) =>
        set((state) => ({
          attachments: [...state.attachments, attachment],
        })),

      removeAttachment: (index) =>
        set((state) => ({
          attachments: state.attachments.filter((_, i) => i !== index),
        })),

      clearAttachments: () => set({ attachments: [] }),

      setSelectedModel: (model) => set({ selectedModel: model }),

      // Agent/Persona selection
      selectPersona: (id) => set({ selectedPersonaId: id }),

      selectAgent: (id) => set({ selectedAgentId: id }),

      setAgentsViewMode: (mode) => set({ agentsViewMode: mode }),

      // Error handling
      setError: (error) => set({ currentError: error }),

      clearError: () => set({ currentError: null }),
    }),
    { name: 'app-store' }
  )
);
