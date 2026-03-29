// Model & API
export const DEFAULT_MODEL = "moonshotai/Kimi-K2.5";
export const MAX_TOKENS = 8192;
export const MAX_TOOL_TURNS = 50;
export const STREAM_TIMEOUT_MS = 120_000; // 2 minutes

// Context window
export const MAX_CONTEXT_TOKENS = 128_000;
export const COMPACT_THRESHOLD = 0.85;
export const COMPACT_RECENT_RATIO = 1 / 3;
export const COMPACT_RECENT_MIN = 10;

// Bash
export const BASH_DEFAULT_TIMEOUT = 30_000;
export const BASH_MAX_TIMEOUT = 120_000;
export const BASH_MAX_BUFFER = 10 * 1024 * 1024; // 10MB

// Search
export const MAX_SEARCH_RESULTS = 100;
export const WEB_CONTENT_LIMIT = 50_000;

// Display
export const TOOL_OUTPUT_MAX_LINES = 10;
export const TOOL_OUTPUT_PREVIEW_LINES = 8;
export const TOOL_OUTPUT_MAX_CHARS = 500;

// Sessions
export const MAX_SESSION_LIST = 20;

// Excluded directories for search
export const EXCLUDED_DIRS = ["node_modules", ".git", "dist", ".next", ".cache"];
