# Kai

AI coding assistant with persistent memory, background agents, and tool use. Powered by OpenRouter.

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

- **Interactive REPL** with streaming responses and tool calling
- **Persistent memory** — soul (identity), archival (long-term knowledge), recall (conversation history)
- **Background agents** — schedule autonomous workflows with cron
- **Web UI** — browser-based chat interface
- **Tool use** — bash, file ops, web search/fetch, image generation, git, MCP servers
- **Sub-agents** — spawn explorer, planner, and worker agents for complex tasks
- **Project-aware** — auto-detects project root and scopes memory per-project

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

# Web UI
kai server              # API only
kai app                 # API + open browser
kai ui                  # API + agents + open browser

# Agent management
kai agent list          # List all agents
kai agent create        # Create a new agent
kai agent run <id>      # Run an agent
kai agent output <id>   # View agent output
kai agent info <id>     # Agent details
kai agent delete <id>   # Delete an agent
kai agent daemon        # Start the agent scheduler
kai agent stop          # Stop the scheduler

# MCP
kai mcp list            # List configured MCP servers
```

## REPL Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/new` | Start a new session |
| `/sessions` | List past sessions |
| `/resume <id>` | Resume a session |
| `/compact` | Compress context to save tokens |
| `/context` | Show token usage breakdown |
| `/cost` | Show token usage stats |
| `/recall` | Show recall memory stats |
| `/model <id>` | Switch model mid-session |
| `/agents` | List background agents |
| `/agent run <id>` | Run an agent |
| `/agent output <id>` | View agent output |
| `/exit` | Quit |

## Models

All models are accessed via [OpenRouter](https://openrouter.ai):

| Role | Model | ID |
|------|-------|----|
| Primary | Kimi K2.5 | `moonshotai/kimi-k2.5` |
| Fallback | Qwen3 235B | `qwen/qwen3-235b-a22b` |
| Image Gen | Nano Banana | `google/gemini-2.5-flash-image` |

You can use any model available on OpenRouter by setting `MODEL_ID` in your `.env` or `model` in settings.

## Memory System

Kai has three memory layers:

- **Soul (Core Memory)** — persistent identity (`persona`, `human`) and per-project context (`goals`, `scratchpad`)
- **Archival** — long-term knowledge store, searchable by keyword and tags
- **Recall** — searchable archive of past conversations across sessions

Memory is stored in `~/.kai/` and scoped per-project.

## License

ISC
