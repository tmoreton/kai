/**
 * Auto-Router — Classifies user requests and decides execution strategy.
 *
 * Makes a fast, low-token API call to classify the task complexity and
 * automatically enables plan mode, swarm hints, or direct execution.
 */

import OpenAI from "openai";
import { getModelId } from "./client.js";
import { setPlanMode, isPlanMode } from "./plan-mode.js";
import chalk from "chalk";

export interface RouteDecision {
  /** Execution strategy */
  strategy: "direct" | "plan_first" | "swarm" | "plan_then_swarm";
  /** Why this strategy was chosen (shown to user) */
  reason: string;
  /** For swarm/plan_then_swarm: suggested agent tasks */
  swarmTasks?: Array<{ agent: "explorer" | "planner" | "worker"; task: string }>;
  /** Injected system hint for the main chat loop */
  hint: string;
}

const CLASSIFY_PROMPT = `You are a task router. Classify the user's request and decide the best execution strategy.

Strategies:
- "direct": Simple tasks. Single-file edits, quick questions, running a command, small bug fixes. Most requests are direct.
- "plan_first": Complex tasks that need research before coding. Multi-file refactors, new features touching many files, architecture changes. The agent should explore the codebase first in read-only mode before making changes.
- "swarm": Tasks with 2+ clearly independent subtasks that can run in parallel. Example: "search for all API routes AND find all database models" or "update the auth module and the logging module" (independent modules). Also use when the user mentions multiple domain-specific agents (e.g. "YouTube stuff and personal tasks").
- "plan_then_swarm": Very large tasks that need planning first, then parallel execution. Example: "refactor the entire test suite" or "migrate from REST to GraphQL".

Available agent types for swarm_tasks:
- Built-in: "explorer" (read-only code search), "planner" (research + plan), "worker" (full read/write)
- Persona agents: "youtube" (content strategy), "personal" (life management), or any custom persona ID

Respond with ONLY valid JSON, no markdown fences:
{
  "strategy": "direct" | "plan_first" | "swarm" | "plan_then_swarm",
  "reason": "one sentence why",
  "swarm_tasks": [{"agent": "explorer|planner|worker|youtube|personal|...", "task": "description"}] // only for swarm strategies, 2-5 tasks
}

Rules:
- Default to "direct" if unsure. Most requests ARE direct.
- Only use "plan_first" for tasks that clearly need multi-file understanding first.
- Only use "swarm" when there are genuinely independent subtasks.
- Use persona agents (youtube, personal) when the task matches their domain.
- Keep swarm_tasks to 2-5 entries max.
- Be concise.`;

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
        { role: "system", content: CLASSIFY_PROMPT },
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
    if (!["direct", "plan_first", "swarm", "plan_then_swarm"].includes(strategy)) {
      return fallback();
    }

    // Build the hint that gets injected into the conversation
    let hint = "";
    const swarmTasks: RouteDecision["swarmTasks"] = [];

    if (strategy === "plan_first" || strategy === "plan_then_swarm") {
      hint += "[AUTO-ROUTE: This is a complex task. Start in EXPLORATION mode — use read_file, glob, grep to understand the codebase before making any changes. Create a plan with task_create before implementing.]";
    }

    if (strategy === "swarm" || strategy === "plan_then_swarm") {
      if (Array.isArray(parsed.swarm_tasks)) {
        for (const t of parsed.swarm_tasks.slice(0, 5)) {
          if (t.agent && t.task) {
            const agent = ["explorer", "planner", "worker"].includes(t.agent) ? t.agent : "explorer";
            swarmTasks.push({ agent: agent as "explorer" | "planner" | "worker", task: t.task });
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
