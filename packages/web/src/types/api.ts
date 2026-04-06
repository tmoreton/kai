// ============================================
// API Types - Generated from backend audit
// ============================================

// Shared Error State
export interface ErrorState {
  message: string;
  type: 'network' | 'timeout' | 'server' | 'unknown';
  recoverable: boolean;
  field?: string;
}

// Core Session Types
export interface Session {
  id: string;
  name?: string;
  type: 'chat' | 'code' | 'agent';
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview?: string | null;
}

export interface SessionDetail extends Session {
  messages: Message[];
  persona?: Persona;
}

// Message Types
export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | MessageContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// Extended tool call with runtime status for UI
export interface ToolCallWithStatus extends ToolCall {
  status: "running" | "done" | "error";
  args: string;
  result?: string;
  diff?: string;
  error?: boolean;
}

// Agent Types
export interface Agent {
  id: string;
  name: string;
  description?: string;
  schedule?: string;
  enabled: boolean;
  workflow_path?: string;
  steps?: WorkflowStep[];
  lastRun: AgentRun | null;
  config?: Record<string, unknown>;
}

export interface WorkflowStep {
  name: string;
  type: 'llm' | 'skill' | 'integration' | 'shell' | 'notify' | 'review' | 'approval' | 'parallel';
  skill?: string;
  action?: string;
  tool?: string;
  prompt?: string;
  command?: string;
  condition?: string;
  output_var?: string;
  params?: Record<string, unknown>;
  max_tokens?: number;
  auto_approve?: boolean;
  stream?: boolean;
}

export interface AgentRun {
  id: string;
  status: 'completed' | 'failed' | 'running' | 'paused' | 'never';
  startedAt: string;
  completedAt?: string;
  error?: string;
  trigger?: string;
  recap?: string;
}

export interface AgentStep {
  name: string;
  index: number;
  status: string;
  output?: string;
  error?: string;
  tokensUsed?: number;
  startedAt?: string;
  completedAt?: string;
}

export interface InterruptedRun {
  id: string;
  agentId: string;
  status: string;
  currentStep: number;
  startedAt: string;
  checkpointStep: number;
  canResume: boolean;
}

export interface CheckpointStatus {
  runId: string;
  canResume: boolean;
  status: string;
  lastCheckpoint: {
    stepIndex: number;
    createdAt: string;
  } | null;
}

export interface AgentDetail extends Agent {
  config: Record<string, unknown>;
  runs: AgentRun[];
}

// Persona Types
export interface Persona {
  id: string;
  name: string;
  role: string;
  personality?: string;
  goals?: string;
  scratchpad?: string;
  tools?: string[];
  maxTurns?: number;
  files?: FileRef[];
}

export interface FileRef {
  storedName: string;
  originalName: string;
  label: string;
  mimeType: string;
  size: number;
}

// Project Types
export interface Project {
  cwd: string;
  name: string;
  sessionCount: number;
  lastActive: string;
  sessions: ProjectSession[];
}

export interface ProjectSession {
  id: string;
  name?: string;
  preview: string | null;
  updatedAt: string;
  messageCount: number;
}

// Notification Types
export interface Notification {
  id: number;
  agentId: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  attachments?: NotificationAttachment[];
}

export interface NotificationAttachment {
  path: string;
  type: 'image' | 'file' | 'markdown';
  name: string;
}

// Settings Types
export interface Settings {
  config: UserConfig;
  env: Record<string, string>;
  mcp: {
    servers: McpServer[];
  };
  skills: Skill[];
}

export interface UserConfig {
  autoCompact?: boolean;
  maxTokens?: number;
  mcp?: {
    servers: Record<string, McpServerConfig>;
  };
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpServer {
  name: string;
  ready: boolean;
  tools: string[];
  config: McpServerConfig;
}

export interface Skill {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tools: SkillTool[];
  path: string;
  missingConfig?: string[];
}

export interface SkillTool {
  name: string;
  description: string;
}

export interface SkillDetail extends Skill {
  manifest: string;
  handler: string;
}

// Status Types
export interface ServerStatus {
  provider: string;
  model: string;
  cwd: string;
  daemon: boolean;
  daemonInProcess: boolean;
  agents: boolean;
  ui: boolean;
  tailscale: boolean;
  funnel: boolean;
}

// Chat Request/Response Types
export interface ChatRequest {
  sessionId?: string;
  message: string;
  attachments?: Attachment[];
  model?: string;
}

export interface Attachment {
  type: 'image' | 'file';
  name: string;
  mimeType: string;
  data: string; // base64
}

// SSE Event Types
export type SSEEventType =
  | 'session'
  | 'token'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'turn_limit'
  | 'error'
  | 'done';

export interface SSEEvent {
  event: SSEEventType;
  data: string;
}

export interface SessionEvent {
  id: string;
}

export interface TokenEvent {
  text: string;
}

export interface ThinkingEvent {
  active: boolean;
  message?: string;
}

export interface ToolCallEvent {
  id: string;
  name: string;
  args: string;
}

export interface ToolResultEvent {
  id: string;
  name: string;
  result: string;
  diff?: string;
  error?: boolean;
}

export interface TurnLimitEvent {
  turns: number;
}

export interface ErrorEvent {
  message: string;
  details?: string;
  type?: string;
}

export interface DoneEvent {
  sessionId: string;
}

// Soul/Context Types
export interface SoulData {
  persona?: { content: string };
  human?: { content: string };
  goals?: { content: string };
  scratchpad?: { content: string };
}

export interface ContextData {
  goals?: { content: string };
  scratchpad?: { content: string };
}
