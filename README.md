# Kai

AI coding assistant with persistent memory, background agents, and tool use. Powered by OpenRouter.

> 📖 **Non-technical user?** Check out the [Simple Chat UI Guide](CHAT_UI_GUIDE.md) — no coding experience required!

## Quick Start

```bash
# Install dependencies
npm install

# Set up your API key
cp .env.example .env
# Edit .env and add your OpenRouter API key

# Run in development
npm run dev

# Or build and run
npm run build
npm start
```

## Features

- **Interactive REPL** — streaming responses with tool calling and markdown rendering
- **Persistent memory** — soul (identity), archival (long-term knowledge), recall (conversation history)
- **Background agents** — schedule autonomous workflows with cron via YAML definitions
- **Web UI** — browser-based chat interface with SSE streaming
- **20+ tools** — bash, file ops, web search/fetch, image generation, git, MCP servers, tasks
- **Sub-agents** — spawn explorer, planner, and worker agents for complex tasks
- **MCP support** — extend with any Model Context Protocol server
- **Project-aware** — auto-detects project root and scopes memory per-project
- **Self-improving agents** — workflows can include a review loop for quality iteration

## Architecture

```
src/
├── index.ts              # CLI entry point (Commander)
├── client.ts             # LLM client + tool execution loop
├── repl.ts               # Interactive REPL with slash commands
├── system-prompt.ts      # System prompt builder
├── config.ts             # Config loading (settings.json, env)
├── constants.ts          # All shared constants (timeouts, limits, retries)
├── utils.ts              # Shared utilities (retry, path resolution)
├── context.ts            # Token tracking & auto-compaction
├── permissions.ts        # Tool permission rules & confirmation
├── commands.ts           # Custom slash commands
├── sessions.ts           # Session persistence
├── project.ts            # Project detection & scoping
├── soul.ts               # Core memory (persona, human, goals, scratchpad)
├── archival.ts           # Long-term knowledge store (JSONL)
├── recall.ts             # Conversation history archive
├── project-profile.ts    # Per-project metadata
├── subagent.ts           # Specialized sub-agents (explorer/planner/worker)
├── git.ts                # Git utilities
├── diff.ts               # Diff rendering
├── render.ts             # Markdown rendering for terminal
├── hooks.ts              # Before/after hooks for tools
├── tools/
│   ├── definitions.ts    # Tool schemas (OpenAI format)
│   ├── executor.ts       # Tool dispatcher + permission checks
│   ├── bash.ts           # Shell command execution
│   ├── files.ts          # File read/write/edit
│   ├── search.ts         # Glob & grep
│   ├── web.ts            # Web fetch & Tavily search
│   ├── image.ts          # Image generation (OpenRouter)
│   ├── mcp.ts            # Model Context Protocol client
│   ├── tasks.ts          # Task management
│   └── index.ts          # Tool exports
├── agents/
│   ├── db.ts             # SQLite agent database
│   ├── daemon.ts         # Cron scheduler
│   ├── manager.ts        # Agent CLI interface
│   ├── workflow.ts       # YAML workflow engine
│   └── integrations/     # Workflow integrations
│       ├── data.ts       # JSON file read/write/append
│       ├── youtube.ts    # YouTube Data API v3
│       ├── web.ts        # Web search
│       ├── image.ts      # Image generation
│       └── mcp.ts        # MCP server access
├── providers/
│   └── index.ts          # OpenRouter provider
└── web/
    ├── server.ts         # Hono HTTP server + SSE streaming
    └── public/
        └── index.html    # Web UI (SPA)
```

## Configuration

Kai loads config from (highest priority first):

1. `.kai/settings.json` (project-level)
2. `kai.config.json` (project-level)
3. `~/.kai/settings.json` (user-level)

### Settings

```json
{
  "model": "moonshotai/kimi-k2.5",
  "mcp": {
    "servers": {
      "example": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        "env": {}
      }
    }
  },
  "permissions": {
    "mode": "default",
    "allow": [],
    "deny": []
  },
  "hooks": {
    "before": {},
    "after": {}
  }
}
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key |
| `MODEL_ID` | No | Override default model (default: `moonshotai/kimi-k2.5`) |
| `TAVILY_API_KEY` | No | Enable web search via Tavily |
| `YOUTUBE_API_KEY` | No | Enable YouTube agent features |

## CLI Commands

```bash
# Interactive REPL
kai

# One-shot query
kai "explain this codebase"

# Continue / resume sessions
kai --continue             # Resume most recent session
kai --resume <id>          # Resume specific session
kai --name "my session"    # Name the session
kai --yes                  # Auto-approve all tool calls

# Pipe input
echo "explain this" | kai
cat file.ts | kai "review this code"

# Web server (API + UI + agent daemon)
kai server                 # Start on port 3141
kai server --port 3000     # Custom port
kai server --no-ui         # API + agents only
kai server --no-agents     # API + UI only

# Agent management
kai agent list             # List all agents
kai agent create <name> <workflow.yaml> [--schedule "0 */6 * * *"]
kai agent run <id>         # Run an agent now
kai agent output <id>      # View latest output
kai agent info <id>        # Agent details + run history
kai agent delete <id>      # Delete an agent
kai agent daemon           # Start the cron scheduler
kai agent stop             # Stop the scheduler

# MCP servers
kai mcp list               # List configured servers + tools
```

## REPL Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/clear` | Clear conversation (keep system prompt) |
| `/cost` | Token usage + context breakdown |
| `/cost compact` | Compress context to save tokens |
| `/sessions` | List recent sessions |
| `/sessions rename <name>` | Rename current session |
| `/soul` | View core memory + recall stats |
| `/git` | Git status + changed files |
| `/git diff` | Colorized diff (staged + unstaged) |
| `/git commit [msg]` | AI-generated commit (add `--push` to push) |
| `/git pr [title]` | Create PR (branch + commit + push + open) |
| `/git branch [name]` | List or create/switch branches |
| `/agent` | List background agents |
| `/agent run <id>` | Run an agent now |
| `/agent output <id>` | View agent output |
| `/agent info <id>` | Agent details + run history |
| `/mcp` | List connected MCP servers + tools |
| `/mcp add <name> <cmd>` | Add an MCP server |
| `/mcp remove <name>` | Remove an MCP server |
| `/exit` | Exit Kai |

Custom commands can be added as markdown files in `.kai/commands/`.

## Tools

Kai's LLM has access to these tools:

| Tool | Description |
|------|-------------|
| `bash` | Run shell commands (working directory persists) |
| `bash_background` | Start long-running processes (returns PID) |
| `read_file` | Read files with line numbers, offset/limit |
| `write_file` | Create or overwrite files |
| `edit_file` | Targeted text replacements |
| `glob` | Find files by pattern |
| `grep` | Search file contents with regex |
| `web_fetch` | Fetch URL content (HTML → readable text) |
| `web_search` | Web search via Tavily |
| `generate_image` | Image generation via OpenRouter |
| `core_memory_read` | Read identity/context memory |
| `core_memory_update` | Update persona, human, goals, scratchpad |
| `recall_search` | Search past conversation history |
| `archival_insert` | Store long-term knowledge |
| `archival_search` | Search long-term knowledge |
| `task_create` | Create tasks for multi-step tracking |
| `task_update` | Update task status |
| `task_list` | List all tasks |
| `spawn_agent` | Spawn subagents (explorer/planner/worker) |
| `mcp__*` | Dynamic tools from configured MCP servers |

## Models

All models are accessed via [OpenRouter](https://openrouter.ai):

| Role | Model | ID |
|------|-------|----|
| Primary | Kimi K2.5 | `moonshotai/kimi-k2.5` |
| Fallback | Qwen3 235B | `qwen/qwen3-235b-a22b` |
| Image Gen | Gemini 2.5 Flash | `google/gemini-2.5-flash-image` |

Override with `MODEL_ID` in `.env` or `"model"` in settings.json.

## Memory System

Kai has three memory layers:

| Layer | Purpose | Storage |
|-------|---------|---------|
| **Soul** | Persistent identity (`persona`, `human`) + per-project context (`goals`, `scratchpad`) | `~/.kai/soul/` + `~/.kai/projects/{id}/` |
| **Archival** | Long-term knowledge store, searchable by keyword and tags | `~/.kai/projects/{id}/archival/` (JSONL) |
| **Recall** | Searchable archive of past conversations across sessions | `~/.kai/projects/{id}/recall/` (JSONL) |

Memory is scoped per-project (auto-detected via `.git`, `package.json`, etc.).

## Background Agents

Agents run autonomous YAML workflows on a cron schedule. Example:

```yaml
name: nightly-commit
description: Auto-commit config changes
schedule: "0 2 * * *"
steps:
  - name: check_changes
    type: shell
    command: "cd ~/.kai && git status --porcelain"
  - name: generate_message
    type: llm
    prompt: "Generate a commit message for: ${vars.check_changes}"
  - name: commit
    type: shell
    command: "cd ~/.kai && git add -A && git commit -m '${vars.generate_message}'"
```

### Workflow Step Types

| Type | Description |
|------|-------------|
| `llm` | Send a prompt to the LLM, store the response |
| `integration` | Call a built-in integration (youtube, data, web, image, mcp) |
| `shell` | Run a shell command |
| `notify` | Send a desktop notification |
| `review` | Self-improvement review loop |

### Built-in Integrations

| Integration | Actions |
|-------------|---------|
| `youtube` | `search_videos`, `get_video_stats`, `get_channel`, `get_recent_uploads`, `get_trending` |
| `data` | `read`, `write`, `append`, `archive`, `read_text`, `list_files` |
| `web` | Web search via Tavily |
| `image` | Image generation via OpenRouter |
| `mcp` | Call tools on configured MCP servers |

## Web API

When running `kai server`, these endpoints are available:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Server status, model, usage |
| `/api/chat` | POST | Chat with SSE streaming |
| `/api/chat/stop` | POST | Cancel a streaming response |
| `/api/sessions` | GET | List sessions |
| `/api/sessions/:id` | GET | Get session messages |
| `/api/sessions` | POST | Create new session |
| `/api/sessions/:id` | DELETE | Delete session |
| `/api/agents` | GET | List agents |
| `/api/agents/:id` | GET | Agent details + runs |
| `/api/agents/:id` | PATCH | Edit agent (toggle, rename, schedule) |
| `/api/agents/:id` | DELETE | Delete agent |
| `/api/agents/:id/run` | POST | Run agent |
| `/api/agents/:id/output` | GET | Latest run output |
| `/api/agents/:id/recap` | GET | LLM-generated run summary |
| `/api/agents/:id/logs` | GET | Agent logs |
| `/api/agents/:id/runs/:runId` | GET | Steps for a specific run |
| `/api/models` | GET | Available models (cached) |
| `/api/image` | GET | Serve local image files |

## License

ISC
