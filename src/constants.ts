// Model & API
export const MAX_TOKENS = 32768;
export const MAX_TOOL_TURNS = 200;
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

// Excluded directories for search
export const EXCLUDED_DIRS = ["node_modules", ".git", "dist", ".next", ".cache"];
