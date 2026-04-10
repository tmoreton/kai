export const toolDefinitions = [
  {
    type: "function" as const,
    function: {
      name: "bash",
      description: "Execute shell command. Returns stdout/stderr. For dev servers, use bash_background.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          timeout: { type: "number", description: "Timeout ms (default 30000, max 120000)" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "bash_background",
      description: "Start background process. Returns PID immediately. For dev servers, watchers.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command to run in background" },
          wait_seconds: { type: "number", description: "Seconds to wait for initial output (default 3)" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description:
        "Read a file and return its contents. Supports text files (with line numbers), PDFs, DOCX, XLSX/XLS (converted to text/CSV), CSV, and images (returned as base64 for vision). Use this before editing any file. Supports offset and limit for large text files.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute or relative path to the file",
          },
          offset: {
            type: "number",
            description: "Line number to start reading from (1-based)",
          },
          limit: {
            type: "number",
            description: "Max number of lines to read (default: 2000)",
          },
        },
        required: ["file_path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description:
        "Create a new file or completely overwrite an existing file. Use for creating new files. For modifying existing files, prefer edit_file instead.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute or relative path to the file",
          },
          content: {
            type: "string",
            description: "The full content to write to the file",
          },
        },
        required: ["file_path", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "edit_file",
      description:
        "Make targeted edits to a file by replacing specific text. The old_string must match exactly (including whitespace/indentation). Use read_file first to see the current content.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path to the file to edit",
          },
          old_string: {
            type: "string",
            description: "The exact text to find and replace",
          },
          new_string: {
            type: "string",
            description: "The text to replace it with",
          },
          replace_all: {
            type: "boolean",
            description: "Replace all occurrences (default: false)",
          },
        },
        required: ["file_path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "glob",
      description:
        'Find files matching a glob pattern. Returns file paths sorted by modification time. Examples: "**/*.ts", "src/**/*.test.js"',
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Glob pattern to match files",
          },
          path: {
            type: "string",
            description: "Directory to search in (default: current working directory)",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "grep",
      description:
        "Search file contents using regex. Returns matching lines with context. Use for finding code patterns, function definitions, imports, etc. Consider using find_symbol, goto_definition, find_references for semantic code search when available.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Regex pattern to search for",
          },
          path: {
            type: "string",
            description: "File or directory to search in (default: cwd)",
          },
          include: {
            type: "string",
            description: 'Glob to filter files, e.g. "*.ts"',
          },
          context: {
            type: "number",
            description: "Lines of context around matches (default: 0)",
          },
          ignore_case: {
            type: "boolean",
            description: "Case-insensitive search (default: false)",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_symbol",
      description:
        "Find symbols (functions, classes, interfaces, variables) by name across the codebase. Uses LSP for semantic search, falls back to grep if unavailable. Faster and more accurate than grep for finding code symbols.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Symbol name to search for (exact or partial match)",
          },
          type: {
            type: "string",
            enum: ["function", "class", "interface", "variable", "constant", "import"],
            description: "Filter by symbol type (optional)",
          },
          file: {
            type: "string",
            description: "Specific file to search in (optional)",
          },
          path: {
            type: "string",
            description: "Directory to search in (default: cwd)",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "goto_definition",
      description:
        "Find the definition location of a symbol. Uses LSP for precise navigation, falls back to grep if unavailable. Much faster than grep for finding where functions, classes, or variables are defined.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Symbol name to find definition for",
          },
          file: {
            type: "string",
            description: "File containing the symbol reference (helps narrow search)",
          },
          path: {
            type: "string",
            description: "Directory to search in (default: cwd)",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_references",
      description:
        "Find all references to a symbol across the codebase. Uses LSP for semantic analysis, falls back to grep if unavailable. Finds actual usages, not just text matches.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Symbol name to find references for",
          },
          file: {
            type: "string",
            description: "File containing the symbol (helps narrow search)",
          },
          path: {
            type: "string",
            description: "Directory to search in (default: cwd)",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_symbols",
      description:
        "List all symbols in a specific file. Uses LSP for accurate parsing, falls back to grep if unavailable. Great for understanding what's exported or defined in a file.",
      parameters: {
        type: "object",
        properties: {
          file: {
            type: "string",
            description: "File path to list symbols from",
          },
          type: {
            type: "string",
            enum: ["function", "class", "interface", "variable"],
            description: "Filter by symbol type (optional)",
          },
          path: {
            type: "string",
            description: "Base directory for relative file path (default: cwd)",
          },
        },
        required: ["file"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "web_fetch",
      description:
        "Fetch content from a URL. Returns the page content as text (HTML converted to readable text). Use for reading documentation, APIs, etc.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to fetch",
          },
          method: {
            type: "string",
            description: "HTTP method (default: GET)",
          },
        },
        required: ["url"],
      },
    },
  },
{
    type: "function" as const,
    function: {
      name: "spawn_agent",
      description:
        'Spawn a subagent to handle a task. Built-in types: "explorer" (read-only code search), "planner" (design implementation plans), "worker" (full read/write). You can also spawn persona-based agents by their ID (e.g. "youtube", "personal") — these have persistent identity, goals, and memory across invocations. Use agent_list to see available personas.',
      parameters: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            description: 'Agent type or persona ID (e.g. "explorer", "worker", "youtube", "personal")',
          },
          task: {
            type: "string",
            description: "The task for the agent to perform",
          },
        },
        required: ["agent", "task"],
      },
    },
  },
  // === AGENT PERSONA MANAGEMENT ===
  {
    type: "function" as const,
    function: {
      name: "agent_create",
      description:
        "Create a new agent persona with its own persistent identity, goals, and memory. Use this to define specialized agents (e.g. a YouTube content agent, a DevOps agent, etc.).",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Short identifier (lowercase, no spaces) e.g. 'youtube', 'devops'",
          },
          name: {
            type: "string",
            description: "Display name e.g. 'YouTube Agent'",
          },
          role: {
            type: "string",
            description: "One-line role description",
          },
          personality: {
            type: "string",
            description: "Detailed personality and behavioral traits for this agent",
          },
          goals: {
            type: "string",
            description: "The agent's current goals and objectives",
          },
          tools: {
            type: "array",
            items: { type: "string" },
            description: "List of tool names this agent can use (empty = all tools)",
          },
          max_turns: {
            type: "number",
            description: "Max tool turns per invocation (default: 25)",
          },
        },
        required: ["id", "name", "role", "personality", "goals"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "agent_list",
      description:
        "List all available agent personas with their roles and goals.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  // === AGENT SWARM ===
  {
    type: "function" as const,
    function: {
      name: "spawn_swarm",
      description:
        'Launch multiple agents in parallel. Supports built-in types ("explorer", "planner", "worker") AND persona IDs ("youtube", "personal", or any custom persona). Use agent_list to see available personas.',
      parameters: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            description: "Array of tasks to run in parallel",
            items: {
              type: "object",
              properties: {
                agent: {
                  type: "string",
                  description: 'Agent type or persona ID (e.g. "explorer", "youtube", "personal")',
                },
                task: {
                  type: "string",
                  description: "The task description for this agent",
                },
              },
              required: ["agent", "task"],
            },
          },
        },
        required: ["tasks"],
      },
    },
  },
  // Note: Git operations are now provided by the core git-tools skill
  // (skill__git-tools__log, skill__git-tools__diff_session, skill__git-tools__undo, skill__git-tools__stash)
  // === WEB SEARCH ===
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description:
        "Search the web using Tavily. Returns an answer plus top results with titles, URLs, and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query",
          },
          max_results: {
            type: "number",
            description: "Maximum number of results (default: 5)",
          },
        },
        required: ["query"],
      },
    },
  },
  // === IMAGE GENERATION ===
  // Note: generate_image is now provided by the openrouter skill
  // Install with: kai skill install openrouter
  {
    type: "function" as const,
    function: {
      name: "generate_image",
      description:
        "Generate images via OpenRouter (Gemini 3 Pro Image Preview). Describe the scene naturally. Install openrouter skill for full functionality.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Detailed description of the image to generate",
          },
          reference_image: {
            type: "string",
            description: "Path to a reference photo to include that person in the scene",
          },
          width: {
            type: "number",
            description: "Image width in pixels (default: 1280)",
          },
          height: {
            type: "number",
            description: "Image height in pixels (default: 720)",
          },
          output_dir: {
            type: "string",
            description: "Directory to save generated images. Leave empty to use the default ~/.kai/agent-output/thumbnails.",
          },
        },
        required: ["prompt"],
      },
    },
  },
  // === VISION / SCREENSHOT ===
  {
    type: "function" as const,
    function: {
      name: "take_screenshot",
      description:
        "Capture a screenshot of the screen. Returns the image for visual analysis. Use this to see what's on screen, verify UI changes, or analyze visual content. macOS only.",
      parameters: {
        type: "object",
        properties: {
          region: {
            type: "string",
            enum: ["full", "window", "selection"],
            description: 'What to capture: "full" (entire screen, default), "window" (frontmost window), "selection" (interactive selection)',
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "analyze_image",
      description:
        "Analyze an image file using the vision model. Describe, extract text, identify UI elements, or answer questions about the image content.",
      parameters: {
        type: "object",
        properties: {
          image_path: {
            type: "string",
            description: "Path to the image file to analyze",
          },
          question: {
            type: "string",
            description: 'What to analyze or ask about the image (default: "Describe this image in detail.")',
          },
        },
        required: ["image_path"],
      },
    },
  },
  // === CORE MEMORY (Soul) ===
  {
    type: "function" as const,
    function: {
      name: "core_memory_read",
      description:
        "Read your core memory blocks (persona, human, goals, scratchpad). Core memory is always in context but use this to inspect the full content.",
      parameters: {
        type: "object",
        properties: {
          block: {
            type: "string",
            enum: ["persona", "human", "goals", "scratchpad"],
            description: "Which block to read (omit for all)",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "core_memory_update",
      description:
        'Update a core memory block. Use "replace" to overwrite or "append" to add. Update [human] when you learn about the user. Update [goals] when objectives change. Use [scratchpad] for working notes.',
      parameters: {
        type: "object",
        properties: {
          block: {
            type: "string",
            enum: ["persona", "human", "goals", "scratchpad"],
            description: "Which block to update",
          },
          operation: {
            type: "string",
            enum: ["replace", "append"],
            description: "Replace entire block or append to it",
          },
          content: {
            type: "string",
            description: "The new content",
          },
        },
        required: ["block", "operation", "content"],
      },
    },
  },
  // === RECALL MEMORY ===
  {
    type: "function" as const,
    function: {
      name: "recall_search",
      description:
        "Search past conversations from previous sessions. Use when you need to remember what was discussed before. Returns matching messages from conversation history.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query (keywords from past conversations)",
          },
          limit: {
            type: "number",
            description: "Max results (default: 10)",
          },
        },
        required: ["query"],
      },
    },
  },
  // === ARCHIVAL MEMORY ===
  {
    type: "function" as const,
    function: {
      name: "archival_insert",
      description:
        "Store important knowledge in long-term archival memory. Use for facts, user preferences, project knowledge, research findings — anything worth remembering permanently.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The knowledge to store",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: 'Tags for categorization (e.g. ["user-pref", "project-setup"])',
          },
          source: {
            type: "string",
            description: "Where this knowledge came from",
          },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "archival_search",
      description:
        "Search long-term archival memory for stored knowledge. Use before web searching — check if you already know the answer.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Filter by tags",
          },
          limit: {
            type: "number",
            description: "Max results (default: 5)",
          },
        },
        required: ["query"],
      },
    },
  },
];
