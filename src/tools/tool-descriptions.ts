/**
 * Rich tool descriptions for better semantic search matching.
 * These are used for embeddings (not shown to users) to improve
 * vector search accuracy.
 */

export const RICH_TOOL_DESCRIPTIONS: Record<string, string> = {
  // Core file operations
  read_file: "Read and view file contents. Use before editing. Supports text, PDF, DOCX, images. Essential for understanding code.",
  write_file: "Create new files or completely overwrite existing files. Use for new code, configs, documentation.",
  edit_file: "Make precise text replacements in existing files. old_string must match exactly including whitespace. Use read_file first.",
  glob: "Find files by pattern like **/*.ts or src/**/*.test.js. Returns matching paths sorted by modification time.",
  grep: "Search file contents with regex patterns. Find code patterns, function definitions, imports across codebase.",

  // Shell operations
  bash: "Execute shell commands, run builds, run tests, install packages. Working directory persists. Short commands only.",
  bash_background: "Start long-running background processes like dev servers, watchers, npm run dev. Returns PID immediately.",

  // Web operations
  web_fetch: "Fetch web pages and APIs. Returns text content. Use for documentation, REST APIs, static pages.",
  web_search: "Search the internet with Tavily. Returns web results with summaries. Use for research, current info.",

  // Agents
  spawn_agent: "Create sub-agents for parallel work. Types: explorer (read-only search), planner (research tasks), worker (full access).",
  spawn_swarm: "Launch multiple agents in parallel (max 10). Use for multi-area analysis, parallel refactors, independent subtasks.",
  agent_list: "View available agent personas and built-in types. See what specialized agents exist.",
  agent_create: "Create new persona agents with persistent identity, goals, and memory. Define custom specialist agents.",

  // Memory
  core_memory_read: "Read persistent memory blocks: persona (identity), human (user info), goals (objectives), scratchpad (notes).",
  core_memory_update: "Update memory blocks. Store user preferences in [human], objectives in [goals], progress in [scratchpad].",
  recall_search: "Search past conversation history from previous sessions. Find what was discussed before.",
  archival_insert: "Store long-term knowledge permanently. Facts, research, patterns, user preferences worth remembering.",
  archival_search: "Search long-term knowledge store. Check memory before web search.",

  // Image
  generate_image: "Create images with AI using OpenRouter. Describe scenes naturally for thumbnails, illustrations, art.",

  // Web UI
  take_screenshot: "Capture macOS screen for visual verification. See what's currently displayed.",
  analyze_image: "Describe images, extract text with OCR, analyze UI elements, answer questions about visual content.",

  // Git
  git_log: "View recent git commits with messages and hashes. See what changed recently.",
  git_diff_session: "Show all changes since session started. Review what you've modified.",
  git_undo: "Undo recent git commits. Soft mode keeps changes, hard mode discards everything.",
  git_stash: "Save uncommitted changes temporarily. Restore later with git stash pop.",

  // Validators
  validate_plan: "Check if a plan is safe to execute. Verify constraints before implementation.",
  validate_work: "Verify work meets requirements before finalizing. Quality check tool.",
};
