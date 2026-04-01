// Model & API
export const MAX_TOKENS = 32768;
export const MAX_TOOL_TURNS = 40;
export const STREAM_TIMEOUT_MS = 120_000; // 2 minutes

// Context window
export const MAX_CONTEXT_TOKENS = 128_000;
export const COMPACT_THRESHOLD = 0.80; // Compact at 80% to leave room
export const COMPACT_RECENT_RATIO = 1 / 3;
export const COMPACT_RECENT_MIN = 10;

// Context budgets (tokens)
export const TOOL_OUTPUT_CONTEXT_LIMIT = 4_000; // Max tokens per tool result in messages
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

// Model (single model via Fireworks)
export const FIREWORKS_MODEL = "accounts/fireworks/routers/kimi-k2p5-turbo";
export const FIREWORKS_MODEL_LABEL = "Kimi K2.5 Turbo";

// Built-in agent types shared between subagent.ts and swarm.ts
export const BUILT_IN_AGENT_CONFIGS = {
  explorer: {
    description: "Fast read-only agent for exploring codebases. Use for finding files, searching code, answering questions about structure.",
    systemPromptTemplate: `You are an exploration agent. Your job is to quickly find information in the codebase.
You have read-only access — use glob, grep, and read_file to find what's needed.
Be concise. Return only the relevant findings.`,
    tools: ["read_file", "glob", "grep"],
    maxTurns: 10,
  },
  planner: {
    description: "Planning agent that researches and designs implementation strategies before writing code.",
    systemPromptTemplate: `You are a planning agent. Research the codebase and create a step-by-step implementation plan.
Use read-only tools to understand the code. Do NOT make changes.
Return a clear, actionable plan with file paths and specific changes needed.`,
    tools: ["read_file", "glob", "grep", "bash"],
    maxTurns: 15,
  },
  worker: {
    description: "General-purpose agent that can read, write, and execute code for complex multi-step tasks.",
    systemPromptTemplate: `You are a worker agent. Complete the assigned task autonomously.
You have full access to the filesystem and shell.
Work step by step: understand → implement → verify.`,
    tools: undefined as string[] | undefined,
    maxTurns: 25,
  },
} as const;
