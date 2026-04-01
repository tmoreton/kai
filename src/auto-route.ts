/**
 * Auto-Router — Classifies user requests and decides execution strategy.
 *
 * Makes a fast, low-token API call to classify the task complexity and
 * automatically enables plan mode, swarm hints, or direct execution.
 */

import OpenAI from "openai";
import { getModelId } from "./client.js";
import { setPlanMode, isPlanMode } from "./plan-mode.js";
import { listPersonas } from "./agent-persona.js";
import chalk from "chalk";

export interface RouteDecision {
  /** Execution strategy */
  strategy: "direct" | "plan_first" | "swarm" | "plan_then_swarm" | "delegate";
  /** Why this strategy was chosen (shown to user) */
  reason: string;
  /** For delegate: which persona agent to route to */
  delegateTo?: string;
  /** For swarm/plan_then_swarm: suggested agent tasks */
  swarmTasks?: Array<{ agent: string; task: string }>;
  /** Injected system hint for the main chat loop */
  hint: string;
}

function buildClassifyPrompt(): string {
  // Dynamically discover available persona agents
  const personas = listPersonas();
  let personaSection = "";
  if (personas.length > 0) {
    const personaLines = personas.map((p) => `- "${p.id}": ${p.name} — ${p.role}`).join("\n");
    personaSection = `\n\nPersona agents (user-created, with persistent memory):\n${personaLines}`;
  }

  return `You are a task router. Classify the user's request and decide the best execution strategy.

Strategies:
- "direct": Simple tasks. Single-file edits, quick questions, running a command, small bug fixes. Most requests are direct.
- "plan_first": Complex tasks that need research before coding. Multi-file refactors, new features touching many files, architecture changes. The agent should explore the codebase first in read-only mode before making changes.
- "swarm": Tasks with 2+ clearly independent subtasks that can run in parallel. Also use when the task spans multiple domains handled by different persona agents.
- "plan_then_swarm": Very large tasks that need planning first, then parallel execution.
- "delegate": The task belongs entirely to one persona agent. Route the whole thing to that agent.

Available agents:
- Built-in: "explorer" (read-only code search), "planner" (research + plan), "worker" (full read/write)${personaSection}

Respond with ONLY valid JSON, no markdown fences:
{
  "strategy": "direct" | "plan_first" | "swarm" | "plan_then_swarm" | "delegate",
  "reason": "one sentence why",
  "delegate_to": "agent-id",  // only for "delegate" strategy
  "swarm_tasks": [{"agent": "agent-id", "task": "description"}] // only for swarm strategies, 2-5 tasks
}

Rules:
- Default to "direct" if unsure. Most requests ARE direct.
- Use "delegate" when the task clearly belongs to one persona agent. This is common — use it freely for domain-specific requests.
- Use "swarm" when there are 2+ independent subtasks across different agents/domains.
- Only use "plan_first" for complex multi-file coding tasks.
- Keep swarm_tasks to 2-5 entries max.
- Be concise.`;
}

/**
 * Classify a user request and return the execution strategy.
 * Uses a fast, low-token API call (~200 tokens response).
 */
export async function autoRoute(
  client: OpenAI,
  userMessage: string
): Promise<RouteDecision> {
  // Skip routing for very short messages (likely follow-ups or simple commands)
  if (userMessage.length < 20) {
    return { strategy: "direct", reason: "short message", hint: "" };
  }

  try {
    const response = await client.chat.completions.create({
      model: getModelId(),
      messages: [
        { role: "system", content: buildClassifyPrompt() },
        { role: "user", content: userMessage },
      ],
      max_tokens: 512,
      temperature: 0,
    });

    const raw = response.choices?.[0]?.message?.content?.trim();
    if (!raw) return fallback();

    // Strip markdown fences if the model wraps them anyway
    const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
    const parsed = JSON.parse(cleaned);

    const strategy = parsed.strategy as RouteDecision["strategy"];
    if (!["direct", "plan_first", "swarm", "plan_then_swarm", "delegate"].includes(strategy)) {
      return fallback();
    }

    // Build the hint that gets injected into the conversation
    let hint = "";
    const swarmTasks: RouteDecision["swarmTasks"] = [];
    let delegateTo: string | undefined;

    if (strategy === "delegate") {
      delegateTo = parsed.delegate_to as string;
      if (delegateTo) {
        hint = `[AUTO-ROUTE: This task belongs to the "${delegateTo}" agent. Use spawn_agent("${delegateTo}", "<the user's full request>") to delegate this task to the specialized agent. Pass the user's request as-is — the agent has its own context and memory.]`;
      } else {
        return fallback();
      }
    }

    if (strategy === "plan_first" || strategy === "plan_then_swarm") {
      hint += "[AUTO-ROUTE: This is a complex task. Start in EXPLORATION mode — use read_file, glob, grep to understand the codebase before making any changes. Create a plan with task_create before implementing.]";
    }

    if (strategy === "swarm" || strategy === "plan_then_swarm") {
      if (Array.isArray(parsed.swarm_tasks)) {
        for (const t of parsed.swarm_tasks.slice(0, 5)) {
          if (t.agent && t.task) {
            swarmTasks.push({ agent: t.agent, task: t.task });
          }
        }
      }
      if (swarmTasks.length >= 2) {
        hint += `\n[AUTO-ROUTE: This task has ${swarmTasks.length} independent subtasks. Use spawn_swarm to run them in parallel for maximum speed.]`;
      }
    }

    return {
      strategy,
      reason: parsed.reason || "",
      delegateTo,
      swarmTasks: swarmTasks.length >= 2 ? swarmTasks : undefined,
      hint,
    };
  } catch {
    return fallback();
  }
}

function fallback(): RouteDecision {
  return { strategy: "direct", reason: "classification failed, defaulting to direct", hint: "" };
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
