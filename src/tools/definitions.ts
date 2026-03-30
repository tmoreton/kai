export const toolDefinitions = [
  {
    type: "function" as const,
    function: {
      name: "bash",
      description:
        "Execute a shell command and return its stdout/stderr. Use for running builds, tests, git commands, installations, and any system operation. The working directory persists between calls. For long-running processes (dev servers, watchers), use bash_background instead.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute",
          },
          timeout: {
            type: "number",
            description: "Timeout in milliseconds (default: 30000, max: 120000)",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "bash_background",
      description:
        "Start a long-running background process (dev servers, file watchers, etc.). Returns immediately with PID and initial output. Use this for: npm run dev, python -m http.server, etc. The process runs until you kill it or the session ends.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The command to run in background",
          },
          wait_seconds: {
            type: "number",
            description: "Seconds to wait for initial output (default: 3)",
          },
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
        "Read a file and return its contents with line numbers. Use this before editing any file. Supports offset and limit for large files.",
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
        "Search file contents using regex. Returns matching lines with context. Use for finding code patterns, function definitions, imports, etc.",
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
      name: "task_create",
      description:
        "Create a task to track progress on multi-step work. Use for complex tasks requiring multiple steps.",
      parameters: {
        type: "object",
        properties: {
          subject: {
            type: "string",
            description: "Brief title for the task",
          },
          description: {
            type: "string",
            description: "What needs to be done",
          },
        },
        required: ["subject", "description"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "task_update",
      description:
        "Update a task's status or details. Use to mark tasks as in_progress or completed.",
      parameters: {
        type: "object",
        properties: {
          task_id: {
            type: "number",
            description: "The task ID",
          },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed"],
            description: "New status",
          },
          subject: {
            type: "string",
            description: "Updated subject",
          },
        },
        required: ["task_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "task_list",
      description: "List all tasks and their status.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "spawn_agent",
      description:
        'Spawn a subagent to handle a task. Available agents: "explorer" (read-only code search), "planner" (design implementation plans), "worker" (full read/write for complex tasks).',
      parameters: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            enum: ["explorer", "planner", "worker"],
            description: "Which agent to spawn",
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
  {
    type: "function" as const,
    function: {
      name: "generate_image",
      description:
        "Generate images via OpenRouter (Nano Banana). Describe the scene naturally.",
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
            description: "Directory to save generated images (default: ~/.kai/agent-output/thumbnails)",
          },
        },
        required: ["prompt"],
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
