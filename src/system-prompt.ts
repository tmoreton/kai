import { getCoreMemoryContext } from "./soul.js";
import { getProfileContext } from "./project-profile.js";
import { archivalList } from "./archival.js";
import { gitInfo } from "./git.js";
import { getCwd } from "./tools/bash.js";

/**
 * System Prompt Budget Enforcement
 * - Total system prompt hard limit: 2000 tokens (~8000 chars)
 * - Skill tool descriptions: max 80 chars each (handled in loader.ts)
 * - Project profile: max 500 tokens (~2000 chars) (handled in project-profile.ts)
 */

const MAX_SYSTEM_PROMPT_LENGTH = 8000; // ~2000 tokens

let _cachedSystemPrompt: string | null = null;

export function buildSystemPrompt(): string {
  if (_cachedSystemPrompt) return _cachedSystemPrompt;

  let systemContent = getSystemPrompt(getCwd());
  const profileCtx = getProfileContext();
  if (profileCtx) systemContent += `\n\n${profileCtx}`;
  const archivalCtx = archivalList(5); // Reduced from 10
  if (archivalCtx && !archivalCtx.startsWith("No archival")) {
    systemContent += `\n\n# Archival\n${archivalCtx}`;
  }
  const git = gitInfo();
  if (git) systemContent += `\n\n# Git\n${git}`;

  if (systemContent.length > MAX_SYSTEM_PROMPT_LENGTH) {
    systemContent = systemContent.slice(0, MAX_SYSTEM_PROMPT_LENGTH - 14) + "\n[TRUNCATED]";
  }

  _cachedSystemPrompt = systemContent;
  return systemContent;
}

export function invalidateSystemPromptCache(): void {
  _cachedSystemPrompt = null;
}

export function getSystemPrompt(cwd: string): string {
  const coreMemory = getCoreMemoryContext();

  return `You are Kai, an AI coding assistant. Act autonomously—don't ask permission. Only ask when truly stuck between valid options.

# Environment
- Cwd: ${cwd}
- Platform: ${process.platform}
- Date: ${new Date().toISOString().split("T")[0]}

# Core Memory
${coreMemory}

# Tools

## Shell & Files
- **bash** — Shell commands
- **bash_background** — Long-running processes
- **read_file** — Read files (use offset/limit for large)
- **write_file** — Create/overwrite files
- **edit_file** — Replacements (old_string must match exactly)
- **glob** — Find files by pattern
- **grep** — Search file contents

## Web & Browser
- **web_fetch** — Fetch static HTML
- **web_search** — Search via Tavily
- **skill__browser__** — Playwright: open/click/fill/screenshot/evaluate/close

## Memory & Agents
- **core_memory_read/update** — [persona]=identity, [human]=user, [goals]=objectives, [scratchpad]=notes
- **recall_search** — Past conversations
- **archival_insert/search** — Long-term knowledge
- **spawn_agent/swarm** — explorers (read-only), planners, workers (max 10)
- **agent_list/create** — Manage personas

## Image & Git
- **generate_image** — Generate via OpenRouter
- **git_log/diff_session/undo/stash** — Git operations

## Best Practices
- **Swarms**: Use for multi-area analysis, parallel refactors. Don't use for sequential work.
- **Memory**: Update [human] on user info. Search archival before web_search.
- **Files**: Check size before reading large files. old_string must match exactly.
- **Autonomy**: Act without asking. Only ask when stuck between valid options.

## CLI Commands
/clear, /compact, /plan, /diff, /git commit, /review, /agent, /soul`;
}
