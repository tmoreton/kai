/**
 * Rich tool descriptions for better semantic search matching.
 * These are used for embeddings (not shown to users) to improve
 * vector search accuracy.
 */

export const RICH_TOOL_DESCRIPTIONS: Record<string, string> = {
  // Core file operations - enhanced with synonyms and use cases
  read_file: "Read, view, open files to see contents. Essential first step before editing code. Use for: viewing source code, reading configs, inspecting documents, checking file contents. Supports text files, code, PDF, DOCX, images.",
  write_file: "Create new files, write code from scratch, generate files, save content to disk. Use for: creating new components, writing documentation, saving generated code, creating configs. Overwrites existing files completely.",
  edit_file: "Modify, change, update existing files. Fix bugs, refactor code, update text, patch files. old_string must match exactly including whitespace and indentation. Always use read_file first to see current content.",
  glob: "Find, locate, discover files by pattern matching. Search for files using patterns like **/*.ts, src/**/*.test.js. Returns file paths sorted by modification time. Use for: finding all test files, locating config files, discovering components.",
  grep: "Search, find text patterns, regex search in file contents. Look for functions, imports, TODO comments, code patterns across entire codebase. Use for: finding where functions are defined, searching for specific code patterns, locating strings in files.",
  
  // LSP-based semantic code search - faster and more accurate than grep
  find_symbol: "Find, locate, discover symbols by name across codebase. Semantic code search using LSP. Find functions, classes, interfaces, variables. Use for: finding where things are defined, locating exports, discovering API surface. Faster and more accurate than grep.",
  goto_definition: "Navigate, jump, go to where a symbol is defined. Precise definition navigation using LSP. Use for: finding function implementations, class definitions, variable declarations. Much faster than searching with grep.",
  find_references: "Find, discover, locate all usages of a symbol. Find actual code references using LSP, not just text matches. Use for: refactoring impact analysis, finding who uses a function, usage tracking. More accurate than grep.",
  list_symbols: "List, enumerate, show all symbols in a file. See what's exported or defined. Use for: understanding API surface, exploring file contents, finding exports. Accurate parsing with LSP.",

  // Shell operations - enhanced with dev workflows
  bash: "Run, execute shell commands. Run build scripts, execute tests, install npm packages, compile code, run linters. Use for: npm run build, npm test, pip install, cargo build, make, gradle. Short commands only.",
  bash_background: "Start, launch long-running background processes. Run dev servers, start watchers, launch development environment. Use for: npm run dev, python http.server, file watchers, hot reload servers. Returns PID immediately.",

  // Web operations
  web_fetch: "Download, fetch web pages and API endpoints. Get content from URLs. Use for: reading API docs, fetching JSON data, downloading web content, scraping static pages. Returns text content.",
  web_search: "Search, lookup, find information on the internet. Tavily web search. Use for: researching libraries, finding documentation, looking up error solutions, current events, latest info. Returns summaries with sources.",

  // Agents
  spawn_agent: "Create, deploy, launch sub-agents for parallel tasks. Agent types: explorer (read-only search), planner (design research), worker (full read/write). Use for: parallel codebase analysis, multi-file refactoring, distributed tasks, concurrent work.",
  spawn_swarm: "Launch, dispatch multiple agents in parallel simultaneously. Launch up to 10 agents at once. Use for: multi-area analysis, parallel refactors, reviewing different directories, concurrent independent subtasks.",
  agent_list: "View, list, see available agent personas and built-in agent types. Check what specialized agents exist. Use before spawning to find the right agent for your task.",
  agent_create: "Define, create new custom persona agents with persistent identity, goals, and memory. Build specialist agents for specific domains like marketing, analytics, devops. Agents remember context across sessions.",

  // Memory - enhanced with specific use cases
  core_memory_read: "Read, view persistent memory blocks. Access stored information about: persona (AI identity), human (user preferences and facts), goals (current objectives), scratchpad (working notes). Always loaded in context.",
  core_memory_update: "Save, store, update persistent memory. Record user preferences in [human] block, set objectives in [goals], track progress in [scratchpad]. Use when learning about user habits, preferences, or setting new targets.",
  recall_search: "Search, lookup past conversation history. Find what was discussed in previous sessions. Use for: remembering decisions, finding previous code discussions, recalling user instructions from earlier chats.",
  archival_insert: "Archive, store long-term knowledge permanently. Save facts, research findings, API patterns, user preferences worth remembering indefinitely. Check before web search - you might already know the answer.",
  archival_search: "Query, search long-term knowledge archive. Find stored facts and information. Use before web searching - faster and might already contain what you need. Search by keywords or tags.",

  // Image
  generate_image: "Create, generate AI images and art using OpenRouter. Make thumbnails, illustrations, diagrams, artwork. Describe scenes naturally. Use for: blog images, thumbnails, visual content, creative assets.",

  // Web UI
  take_screenshot: "Capture, take macOS screen screenshots. See current display, verify UI state, check what's visible. Use for: visual verification, UI testing, showing current state to user.",
  analyze_image: "Describe, analyze, interpret images and screenshots. Extract text with OCR, identify UI elements, answer questions about visual content. Use for: reading screenshots, understanding diagrams, analyzing visual data.",

  // Git - enhanced with workflow language
  git_log: "View, see recent git commits and history. Check what changed recently, review commit messages, see hashes. Use for: understanding recent changes, reviewing work history, finding specific commits.",
  git_diff_session: "Show, compare all changes since session started. Review what you've modified in this conversation. Shows both staged and unstaged changes across all files.",
  git_undo: "Revert, undo, rollback recent git commits. Soft mode (default) keeps changes staged; hard mode discards everything. Use for: undoing mistakes, reverting bad commits, starting fresh. Always show what will be undone first.",
  git_stash: "Save, shelve uncommitted changes temporarily. Store work-in-progress without committing. Restore later with git stash pop. Use for: switching branches with uncommitted work, saving experimental changes.",

  // Validators
  validate_plan: "Verify, check if a plan is safe and valid before execution. Confirm constraints, validate approach, ensure limits are respected. Safety check before making changes.",
  validate_work: "Check, verify work meets requirements and quality standards before finalizing. Quality assurance tool. Use before considering a task complete.",
};
