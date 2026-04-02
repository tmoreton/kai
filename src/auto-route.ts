/**
 * Auto-Router — Classifies user requests and decides execution strategy.
 *
 * Uses fast LOCAL heuristics instead of an API call to eliminate 1-3s latency per message.
 * Falls back to API classification only when explicitly enabled via config.
 */

import OpenAI from "openai";
import { getModelId } from "./client.js";
import { setPlanMode, isPlanMode } from "./plan-mode.js";
import { listPersonas } from "./agent-persona.js";
import chalk from "chalk";

export interface RouteDecision {
  strategy: "direct" | "plan_first" | "swarm" | "plan_then_swarm" | "delegate";
  reason: string;
  delegateTo?: string;
  swarmTasks?: Array<{ agent: string; task: string }>;
  hint: string;
}

// Patterns that indicate the user already has the diagnosis — skip analysis, go direct
const FAST_PATH_PATTERNS = [
  // Stack traces (e.g. "at Function.foo (file.ts:50:13)")
  /at\s+\S+\s+\(.*:\d+:\d+\)/,
  // Error messages with file:line references
  /(?:Error|TypeError|ReferenceError|SyntaxError).*\n/,
  // Explicit file:line references (e.g. "bash.ts:50", "src/foo.js:120")
  /\b[\w/.-]+\.[a-z]{1,4}:\d+\b/,
  // User pasted a Node/Python/etc traceback
  /^\s+at\s+/m,
  // Short targeted fix requests with a file reference
  /\b(?:fix|patch|change|update)\b.*\b[\w/.-]+\.[a-z]{1,4}\b/i,
];

// Patterns that suggest complex, multi-file work
const COMPLEX_PATTERNS = [
  /refactor\s+(?:the\s+)?(?:entire|whole|all|every)/i,
  /rewrite\s+(?:the\s+)?(?:entire|whole|all)/i,
  /migrate\s+(?:from|to)\b/i,
  /add\s+(?:a\s+)?(?:new\s+)?(?:feature|system|module|service|api|endpoint)/i,
  /implement\s+(?:a\s+)?(?:new\s+)?(?:feature|system|module|service)/i,
  /redesign\s+/i,
  /architect/i,
  /set\s*up\s+(?:a\s+)?(?:new\s+)?(?:project|repo|monorepo|pipeline|ci)/i,
];

// Patterns that suggest parallelizable work → swarm candidates
const SWARM_PATTERNS = [
  /(?:review|audit|analyze|check|scan)\s+(?:the\s+)?(?:entire|whole|full|all)?\s*(?:codebase|repo|project|code)/i,
  /find\s+(?:all|every)\s+(?:security|performance|bug|issue|problem|vulnerability)/i,
  /(?:compare|evaluate|investigate)\s+(?:\w+\s+(?:vs|versus|and|,)\s+)+/i,
  /(?:update|change|rename|replace)\s+(?:\w+\s+)?(?:everywhere|across|in all|in every)/i,
  /(?:search|look|check)\s+(?:across|through|in)\s+(?:all|every|the entire)/i,
];

// Patterns that suggest delegation to a persona agent
const DELEGATE_PATTERNS = [
  /(?:give|suggest|brainstorm|come up with|generate)\s+(?:me\s+)?(?:video|content|thumbnail|title)\s*(?:ideas?)?/i,
  /(?:what(?:'s| is)\s+trending|analyze\s+(?:my\s+)?(?:channel|analytics|performance))/i,
  /(?:plan|schedule|create)\s+(?:a\s+)?(?:content\s+)?(?:calendar|schedule)/i,
];

// Words that indicate the user is asking about code, not delegating
const CODE_INDICATORS = [
  /\b(?:fix|bug|error|crash|broken|fails?|failing)\b/i,
  /\b(?:edit|modify|change|update|patch)\s+(?:the\s+)?(?:file|code|function|component)/i,
  /\b(?:src|dist|node_modules|package\.json|tsconfig)\b/i,
  /\b(?:import|export|function|class|interface|type|const|let|var)\b/i,
];

// Cached persona list + compiled regexes (avoid filesystem scan + regex compilation per message)
let _personaCache: { personas: ReturnType<typeof listPersonas>; regexes: Map<string, RegExp>; cachedAt: number } | null = null;
const PERSONA_CACHE_TTL = 30_000; // 30 seconds

function getCachedPersonas() {
  if (_personaCache && Date.now() - _personaCache.cachedAt < PERSONA_CACHE_TTL) {
    return _personaCache;
  }
  const personas = listPersonas();
  const regexes = new Map<string, RegExp>();
  for (const p of personas) {
    regexes.set(p.id, new RegExp(`\\b(?:${p.id}|${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`, "i"));
  }
  _personaCache = { personas, regexes, cachedAt: Date.now() };
  return _personaCache;
}

/**
 * Fast heuristic-based routing. No API call needed.
 */
export function autoRouteHeuristic(userMessage: string): RouteDecision {
  const msg = userMessage.trim();

  // Short messages are always direct
  if (msg.length < 30) {
    return { strategy: "direct", reason: "short message", hint: "" };
  }

  // Fast path: user already provided the diagnosis (stack trace, file:line, etc.)
  // Go direct — no plan mode, no exploration, just fix it
  if (FAST_PATH_PATTERNS.some((p) => p.test(msg))) {
    return {
      strategy: "direct",
      reason: "diagnostic context provided — fast path",
      hint: "",
    };
  }

  // Check for code indicators first — these override delegation
  const isCodeTask = CODE_INDICATORS.some((p) => p.test(msg));

  // Check for persona delegation (only if not a code task)
  if (!isCodeTask) {
    const { personas, regexes } = getCachedPersonas();
    for (const persona of personas) {
      const nameMatch = regexes.get(persona.id)!.test(msg);
      const delegateMatch = DELEGATE_PATTERNS.some((p) => p.test(msg));

      if (nameMatch && delegateMatch) {
        return {
          strategy: "delegate",
          reason: `task matches ${persona.name} agent`,
          delegateTo: persona.id,
          hint: `[AUTO-ROUTE: This task belongs to the "${persona.id}" agent. Use spawn_agent("${persona.id}", "<the user's full request>") to delegate this task to the specialized agent.]`,
        };
      }
    }
  }

  // Check for swarm-worthy tasks (broad analysis, multi-area work)
  if (SWARM_PATTERNS.some((p) => p.test(msg))) {
    return {
      strategy: "swarm",
      reason: "parallelizable broad task detected",
      hint: `[AUTO-ROUTE: This task can be parallelized. Use spawn_swarm to launch multiple explorer or worker agents simultaneously. Break the work into independent subtasks (e.g. by directory, by concern, by file). Each agent has access to a shared scratchpad (swarm_scratchpad_read/write) to coordinate and avoid duplicate work. After all agents finish, a synthesis step will automatically merge their findings. Example: for "audit the codebase", spawn explorers for src/agents/, src/tools/, src/skills/, etc.]`,
    };
  }

  // Check for complex multi-file tasks
  if (COMPLEX_PATTERNS.some((p) => p.test(msg))) {
    return {
      strategy: "plan_first",
      reason: "complex multi-file task detected",
      hint: "[AUTO-ROUTE: This is a complex task. Start in EXPLORATION mode — use read_file, glob, grep to understand the codebase before making any changes. Create a step-by-step plan before implementing.]",
    };
  }

  // Check for multiple explicit subtasks (numbered lists, "and also", etc.)
  // Plan first to understand dependencies, then swarm the independent items
  const subtaskIndicators = msg.match(/(?:^|\n)\s*(?:\d+[\.\)]\s|[-*]\s)/gm);
  if (subtaskIndicators && subtaskIndicators.length >= 3 && msg.length > 200) {
    return {
      strategy: "plan_then_swarm",
      reason: `${subtaskIndicators.length} subtasks detected — plan then parallelize`,
      hint: `[AUTO-ROUTE: The user listed ${subtaskIndicators.length} items. First, explore the codebase to understand what's needed for each item (use read_file, glob, grep). Then use spawn_swarm to run the independent items in parallel — assign each to a "worker" agent (or "explorer" for read-only tasks). Group dependent items together under one agent. After all agents finish, a synthesis step will merge their results.]`,
    };
  }

  // Default: direct execution (no overhead)
  return { strategy: "direct", reason: "direct execution", hint: "" };
}

/**
 * Main entry point — uses heuristics by default, API only if config enables it.
 */
export async function autoRoute(
  client: OpenAI,
  userMessage: string
): Promise<RouteDecision> {
  // Fast heuristic path — no API call
  return autoRouteHeuristic(userMessage);
}

/**
 * Apply the route decision — enable plan mode, inject hints, show status.
 */
export function applyRoute(decision: RouteDecision): string | null {
  // Reset plan mode for new tasks unless already manually set
  if (decision.strategy === "plan_first" || decision.strategy === "plan_then_swarm") {
    if (!isPlanMode()) {
      setPlanMode(true);
      console.log(
        chalk.yellow(`  🧭 Auto-routing: plan mode ON`) +
        chalk.dim(` — ${decision.reason}`)
      );
    }
  }

  if (decision.strategy === "swarm" || decision.strategy === "plan_then_swarm") {
    const count = decision.swarmTasks?.length || 0;
    if (count >= 2) {
      console.log(
        chalk.magenta(`  🐝 Auto-routing: swarm suggested (${count} parallel agents)`) +
        chalk.dim(` — ${decision.reason}`)
      );
    }
  }

  if (decision.strategy === "delegate" && decision.delegateTo) {
    console.log(
      chalk.magenta(`  🤖 Auto-routing: delegating to ${decision.delegateTo} agent`) +
      chalk.dim(` — ${decision.reason}`)
    );
  }

  if (decision.strategy === "direct") {
    // If plan mode was auto-enabled previously, turn it off for direct tasks
    if (isPlanMode()) {
      setPlanMode(false);
    }
    return null;
  }

  // Return the hint to inject into the conversation
  return decision.hint || null;
}
