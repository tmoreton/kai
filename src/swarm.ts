/**
 * Agent Swarm — Run multiple subagents concurrently.
 *
 * Supports both built-in agent types (explorer, planner, worker) and
 * persona-based agents (youtube, personal, or any custom persona).
 * All agents run simultaneously via Promise.allSettled().
 */

import { runSubagent, runPersonaAgent, type SubagentConfig } from "./subagent.js";
import { loadPersona } from "./agent-persona.js";
import { getCwd } from "./tools/bash.js";
import { BUILT_IN_AGENT_CONFIGS } from "./constants.js";
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
    };
    return runSubagent(config, task);
  }

  // Persona-based agent
  const persona = loadPersona(agentType);
  if (persona) {
    return runPersonaAgent(agentType, task);
  }

  return Promise.reject(new Error(`Unknown agent: "${agentType}". Use a built-in type (explorer, planner, worker) or a persona ID.`));
}

/**
 * Run multiple agents concurrently and aggregate results.
 */
export async function runSwarm(tasks: SwarmTask[]): Promise<string> {
  if (tasks.length === 0) {
    return "No tasks provided to the swarm.";
  }

  if (tasks.length === 1) {
    return launchAgent(tasks[0].agent, tasks[0].task, 0);
  }

  console.log(
    chalk.magenta(`\n  🐝 Swarm launching ${tasks.length} agents in parallel...\n`)
  );

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

  const sections = results.map((r, i) => {
    const statusIcon = r.status === "fulfilled" ? "✓" : "✗";
    return `## Agent ${i + 1}: ${r.agent} [${statusIcon}]
**Task:** ${r.task}

${r.output}`;
  });

  return `[SWARM COMPLETE — ${tasks.length} agents, ${succeeded} succeeded, ${failed} failed, ${elapsed}s]

${sections.join("\n\n---\n\n")}

[END SWARM OUTPUT — All agent results above. Synthesize findings and continue.]`;
}
