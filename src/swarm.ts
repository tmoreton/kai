/**
 * Agent Swarm — Run multiple subagents concurrently.
 *
 * Supports both built-in agent types (explorer, planner, worker) and
 * persona-based agents (youtube, personal, or any custom persona).
 * All agents run simultaneously via Promise.allSettled().
 *
 * Features:
 * - Shared scratchpad: agents can read/write to a shared key-value store
 * - Post-swarm synthesis: LLM aggregates all agent outputs into a unified summary
 */

import { runSubagent, runPersonaAgent, type SubagentConfig } from "./subagent.js";
import { loadPersona } from "./agent-persona.js";
import { getCwd } from "./tools/bash.js";
import { BUILT_IN_AGENT_CONFIGS } from "./constants.js";
import { createClient, getModelId } from "./client.js";
import chalk from "chalk";

export interface SwarmTask {
  agent: string; // built-in type OR persona ID
  task: string;
}

interface SwarmResult {
  agent: string;
  task: string;
  status: "fulfilled" | "rejected";
  output: string;
}

export interface SwarmOptions {
  synthesize?: boolean; // Run post-swarm synthesis (default: true)
  synthesisPrompt?: string; // Custom synthesis prompt
}

// ---------------------------------------------------------------------------
// Shared Scratchpad — thread-safe (single-threaded JS) KV store for swarm agents
// ---------------------------------------------------------------------------

export class SwarmScratchpad {
  private store = new Map<string, string>();

  read(key?: string): string {
    if (key) {
      return this.store.get(key) ?? `[key "${key}" not found]`;
    }
    // Return all entries
    if (this.store.size === 0) return "[scratchpad is empty]";
    const entries = [...this.store.entries()]
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    return entries;
  }

  write(key: string, value: string): string {
    this.store.set(key, value);
    return `Written to scratchpad: ${key}`;
  }

  append(key: string, value: string): string {
    const existing = this.store.get(key) || "";
    this.store.set(key, existing ? `${existing}\n${value}` : value);
    return `Appended to scratchpad: ${key}`;
  }

  keys(): string[] {
    return [...this.store.keys()];
  }

  dump(): string {
    return this.read();
  }
}

// Active scratchpad for current swarm (only one swarm runs at a time in a session)
let _activeScratchpad: SwarmScratchpad | null = null;

export function getActiveScratchpad(): SwarmScratchpad | null {
  return _activeScratchpad;
}

/**
 * Tool definitions injected into swarm agents for scratchpad access.
 */
export function getScratchpadToolDefs() {
  return [
    {
      type: "function" as const,
      function: {
        name: "swarm_scratchpad_read",
        description:
          "Read from the shared swarm scratchpad. Other agents in this swarm can also read/write here. Use to check what other agents have found or to avoid duplicate work. Omit key to read all entries.",
        parameters: {
          type: "object",
          properties: {
            key: {
              type: "string",
              description: "Key to read (omit for all entries)",
            },
          },
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "swarm_scratchpad_write",
        description:
          "Write a finding or result to the shared swarm scratchpad so other agents can see it. Use descriptive keys like 'frontend_analysis' or 'auth_issues_found'.",
        parameters: {
          type: "object",
          properties: {
            key: {
              type: "string",
              description: "Key to write (descriptive, e.g. 'security_findings')",
            },
            value: {
              type: "string",
              description: "The content to store",
            },
            append: {
              type: "boolean",
              description: "Append to existing key instead of replacing (default: false)",
            },
          },
          required: ["key", "value"],
        },
      },
    },
  ];
}

/**
 * Handle scratchpad tool calls. Called from the tool executor.
 */
export function handleScratchpadTool(
  name: string,
  args: Record<string, any>
): string | null {
  const pad = _activeScratchpad;
  if (!pad) return "[No active swarm scratchpad]";

  if (name === "swarm_scratchpad_read") {
    return pad.read(args.key);
  }
  if (name === "swarm_scratchpad_write") {
    if (args.append) {
      return pad.append(args.key, args.value);
    }
    return pad.write(args.key, args.value);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Agent Launching
// ---------------------------------------------------------------------------

/**
 * Launch a single agent — resolves built-in types first, then persona IDs.
 */
function launchAgent(agentType: string, task: string, index: number): Promise<string> {
  // Built-in agent
  const agentDef = BUILT_IN_AGENT_CONFIGS[agentType as keyof typeof BUILT_IN_AGENT_CONFIGS];
  if (agentDef) {
    const config: SubagentConfig = {
      name: `${agentType}-${index + 1}`,
      description: agentDef.description,
      systemPrompt: `${agentDef.systemPromptTemplate}\nWorking directory: ${getCwd()}`,
      tools: agentDef.tools ? [...agentDef.tools] : undefined,
      maxTurns: agentDef.maxTurns,
      injectScratchpad: true,
    };
    return runSubagent(config, task);
  }

  // Persona-based agent
  const persona = loadPersona(agentType);
  if (persona) {
    return runPersonaAgent(agentType, task, undefined, { injectScratchpad: true });
  }

  return Promise.reject(new Error(`Unknown agent: "${agentType}". Use a built-in type (explorer, planner, worker) or a persona ID.`));
}

// ---------------------------------------------------------------------------
// Post-Swarm Synthesis
// ---------------------------------------------------------------------------

async function synthesizeResults(
  results: SwarmResult[],
  customPrompt?: string
): Promise<string> {
  const succeeded = results.filter((r) => r.status === "fulfilled");
  if (succeeded.length === 0) return "";

  const client = createClient();
  const model = getModelId();

  const agentOutputs = succeeded
    .map((r, i) => `## Agent: ${r.agent}\n**Task:** ${r.task}\n\n${r.output}`)
    .join("\n\n---\n\n");

  const scratchpad = _activeScratchpad?.dump() || "";
  const scratchpadSection = scratchpad && scratchpad !== "[scratchpad is empty]"
    ? `\n\n## Shared Scratchpad\n${scratchpad}`
    : "";

  const prompt = customPrompt || `You are synthesizing the results from ${succeeded.length} agents that worked on related tasks in parallel.

Combine their findings into a single, coherent summary:
- Merge overlapping findings
- Highlight agreements and contradictions between agents
- Organize by theme, not by agent
- Call out key insights and actionable items
- Be concise — don't repeat raw data, synthesize it

${agentOutputs}${scratchpadSection}`;

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You synthesize outputs from multiple parallel agents into a unified, actionable summary. Be concise and structured.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 4096,
    });

    return (
      (response as any).choices[0]?.message?.content ||
      (response as any).choices[0]?.message?.reasoning ||
      ""
    );
  } catch (err) {
    // Synthesis is best-effort — return empty on failure
    console.log(chalk.dim("  ⚠ Synthesis step failed, returning raw results"));
    return "";
  }
}

// ---------------------------------------------------------------------------
// Main Swarm Runner
// ---------------------------------------------------------------------------

/**
 * Run multiple agents concurrently and aggregate results.
 */
export async function runSwarm(
  tasks: SwarmTask[],
  options?: SwarmOptions
): Promise<string> {
  if (tasks.length === 0) {
    return "No tasks provided to the swarm.";
  }

  if (tasks.length === 1) {
    return launchAgent(tasks[0].agent, tasks[0].task, 0);
  }

  const shouldSynthesize = options?.synthesize !== false;

  console.log(
    chalk.magenta(`\n  🐝 Swarm launching ${tasks.length} agents in parallel...\n`)
  );

  // Initialize shared scratchpad for this swarm
  _activeScratchpad = new SwarmScratchpad();

  const startTime = Date.now();

  const promises = tasks.map((t, i) => launchAgent(t.agent, t.task, i));
  const settled = await Promise.allSettled(promises);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const results: SwarmResult[] = settled.map((result, i) => ({
    agent: tasks[i].agent,
    task: tasks[i].task,
    status: result.status,
    output:
      result.status === "fulfilled"
        ? result.value
        : `Error: ${(result as PromiseRejectedResult).reason?.message || "Unknown error"}`,
  }));

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  console.log(
    chalk.magenta(
      `  🐝 Swarm complete: ${succeeded} succeeded, ${failed} failed (${elapsed}s)\n`
    )
  );

  // Build raw results sections
  const sections = results.map((r, i) => {
    const statusIcon = r.status === "fulfilled" ? "✓" : "✗";
    return `## Agent ${i + 1}: ${r.agent} [${statusIcon}]
**Task:** ${r.task}

${r.output}`;
  });

  // Include scratchpad contents if any
  const scratchpadDump = _activeScratchpad.dump();
  const scratchpadSection =
    scratchpadDump !== "[scratchpad is empty]"
      ? `\n\n---\n\n## Shared Scratchpad\n${scratchpadDump}`
      : "";

  // Post-swarm synthesis
  let synthesisSection = "";
  if (shouldSynthesize && succeeded >= 2) {
    console.log(chalk.magenta("  🧠 Synthesizing swarm results...\n"));
    const synthesis = await synthesizeResults(results, options?.synthesisPrompt);
    if (synthesis) {
      synthesisSection = `\n\n---\n\n## Synthesis\n${synthesis}`;
    }
  }

  // Clean up scratchpad
  _activeScratchpad = null;

  return `[SWARM COMPLETE — ${tasks.length} agents, ${succeeded} succeeded, ${failed} failed, ${elapsed}s]

${sections.join("\n\n---\n\n")}${scratchpadSection}${synthesisSection}

[END SWARM OUTPUT — All agent results above. Synthesize findings and continue.]`;
}
