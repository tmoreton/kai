import { getCoreMemoryContext } from "./soul.js";
import { getProfileContext } from "./project-profile.js";
import { getCwd } from "./tools/bash.js";

/**
 * System Prompt Budget Enforcement
 * - Total system prompt hard limit: ~1000 tokens (~4000 chars)
 * - Removed: Tool descriptions (in tool defs), archival, git info
 * - Skill tool descriptions: max 60 chars each (handled in loader.ts)
 * - Project profile: max 500 tokens (~2000 chars) (handled in project-profile.ts)
 */

const MAX_SYSTEM_PROMPT_LENGTH = 8000; // ~2000 tokens

let _cachedSystemPrompt: string | null = null;

export function buildSystemPrompt(): string {
  if (_cachedSystemPrompt) return _cachedSystemPrompt;

  let systemContent = getSystemPrompt(getCwd());
  
  // Project profile - lightweight tech stack only
  const profileCtx = getProfileContext();
  if (profileCtx) systemContent += `\n\n${profileCtx}`;
  
  // Skip archival - tools are available to search when needed
  // Skip git - tools are available to check when needed

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
${coreMemory}`;
}
