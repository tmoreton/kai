// Model & API
// Note: max_tokens is the OUTPUT token limit, not context window.
// Setting this too low causes premature truncation. Kimi K2.5 supports up to 256k context.
// We use a high max_tokens to allow long outputs while still having a safety limit.
export const MAX_TOKENS = 128_000; // Increased from 32k - was causing truncation on long outputs
export const MAX_TOOL_TURNS = 50;
export const STREAM_TIMEOUT_MS = 120_000; // 2 minutes

// Context window
export const MAX_CONTEXT_TOKENS = 256_000;
export const COMPACT_THRESHOLD = 0.60; // Compact at 60% to leave room
export const COMPACT_RECENT_RATIO = 1 / 3;
export const COMPACT_RECENT_MIN = 10;

// Tiered truncation threshold - apply progressive truncation before full compaction
export const TIERED_TRUNCATE_THRESHOLD = 0.30; // Start tiered truncation at 30%

// Context budgets (tokens)
export const TOOL_OUTPUT_CONTEXT_LIMIT = 1_000; // Max tokens per tool result in messages
export const MEMORY_CONTEXT_BUDGET = 2_000; // Max tokens for memory injection
export const KAIMD_CONTEXT_BUDGET = 3_000; // Max tokens for KAI.md
export const SOUL_CONTEXT_BUDGET = 2_000; // Max tokens for core memory blocks

// Bash
export const BASH_DEFAULT_TIMEOUT = 30_000;
export const BASH_MAX_TIMEOUT = 120_000;
export const BASH_MAX_BUFFER = 10 * 1024 * 1024; // 10MB

// Search
export const MAX_SEARCH_RESULTS = 100;
export const WEB_CONTENT_LIMIT = 50_000;

// Display (what the user sees, separate from context)
export const TOOL_OUTPUT_MAX_LINES = 10;
export const TOOL_OUTPUT_PREVIEW_LINES = 8;
export const TOOL_OUTPUT_MAX_CHARS = 500;

// Sessions
export const MAX_SESSION_LIST = 20;

// Retry / backoff
export const RETRY_BASE_DELAY_MS = 3_000;
export const RETRY_MAX_DELAY_MS = 15_000;
export const RETRY_MAX_ATTEMPTS = 3;
export const MAX_CONSECUTIVE_ERRORS = 3;
export const RETRYABLE_STATUS_CODES = [500, 502, 503, 429];

// Truncation limits (chars)
export const AGENT_OUTPUT_PREVIEW_LIMIT = 3_000;
export const WORKFLOW_STEP_OUTPUT_LIMIT = 50_000;
export const WORKFLOW_REVIEW_OUTPUT_LIMIT = 2_000;
export const SHELL_STEP_TIMEOUT = 60_000;
export const SHELL_STEP_MAX_BUFFER = 5 * 1024 * 1024; // 5MB

// Network timeouts
export const FETCH_TIMEOUT_MS = 15_000;

// Excluded directories for search
export const EXCLUDED_DIRS = ["node_modules", ".git", "dist", ".next", ".cache"];

// Model defaults (overridable via ~/.kai/settings.json)
// Primary: OpenRouter with Kimi K2.5 (required)
// Fallback: Fireworks with Kimi K2.5 Turbo (optional, takes precedence if key present)
export const DEFAULT_OPENROUTER_MODEL = "moonshotai/kimi-k2.5";
export const DEFAULT_FIREWORKS_MODEL = "accounts/fireworks/routers/kimi-k2p5-turbo";
export const DEFAULT_IMAGE_MODEL = "google/gemini-2.5-flash-image";

// Provider endpoint defaults
export const DEFAULT_FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";
export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Tools that sub-agents are never allowed to use (prevents recursive spawning, swarm bombs)
export const AGENT_BLOCKED_TOOLS = new Set([
  "spawn_agent", "spawn_swarm", "agent_create",
]);

// Built-in agent types shared between subagent.ts and swarm.ts
export const BUILT_IN_AGENT_CONFIGS = {
  explorer: {
    description: "Fast read-only agent for exploring codebases. Use for finding files, searching code, answering questions about structure.",
    systemPromptTemplate: `You are an exploration agent. Your job is to quickly find information in the codebase.
You have read-only access — use find_symbol, goto_definition, find_references for semantic code search, glob for file discovery, and read_file to see contents.
Be concise. Return only the relevant findings.`,
    tools: ["read_file", "glob", "find_symbol", "goto_definition", "find_references", "list_symbols", "grep"],
    maxTurns: 10,
  },
  planner: {
    description: "Planning agent that researches and designs implementation strategies before writing code.",
    systemPromptTemplate: `You are a planning agent. Research the codebase and create a step-by-step implementation plan.
Use find_symbol, goto_definition, find_references for understanding code structure. Use glob and read_file to explore.
Do NOT make changes. Return a clear, actionable plan with file paths and specific changes needed.`,
    tools: ["read_file", "glob", "find_symbol", "goto_definition", "find_references", "list_symbols", "grep", "bash"],
    maxTurns: 15,
  },
  worker: {
    description: "General-purpose agent that can read, write, and execute code for complex multi-step tasks.",
    systemPromptTemplate: `You are a worker agent. Complete the assigned task autonomously and fully.
You have full access to the filesystem and shell.
Work step by step: understand → implement → verify. After implementing, ALWAYS verify (build, test).
Never ask "should I continue?" or "want me to proceed?" — just do the work. Only stop when the task is done or you hit a genuine design decision you can't resolve from context.
You do NOT have access to spawn other agents or swarms.`,
    tools: undefined as string[] | undefined,
    maxTurns: 50,
  },
} as const;
