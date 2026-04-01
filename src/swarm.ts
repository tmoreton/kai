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

const BUILTIN_CONFIGS: Record<string, () => SubagentConfig> = {
  explorer: () => ({
    name: "explorer",
    description: "Fast read-only code exploration",
    systemPrompt: `You are an exploration agent. Your job is to quickly find information in the codebase.
You have read-only access — use glob, grep, and read_file to find what's needed.
Be concise. Return only the relevant findings.
Working directory: ${getCwd()}`,
    tools: ["read_file", "glob", "grep"],
    maxTurns: 10,
  }),
  planner: () => ({
    name: "planner",
    description: "Research and plan implementation",
    systemPrompt: `You are a planning agent. Research the codebase and create a step-by-step implementation plan.
Use read-only tools to understand the code. Do NOT make changes.
Return a clear, actionable plan with file paths and specific changes needed.
Working directory: ${getCwd()}`,
    tools: ["read_file", "glob", "grep", "bash"],
    maxTurns: 15,
  }),
  worker: () => ({
    name: "worker",
    description: "Full read/write agent for complex tasks",
    systemPrompt: `You are a worker agent. Complete the assigned task autonomously.
You have full access to the filesystem and shell.
Work step by step: understand → implement → verify.
Working directory: ${getCwd()}`,
    maxTurns: 25,
  }),
};

/**
 * Launch a single agent — resolves built-in types first, then persona IDs.
 */
function launchAgent(agentType: string, task: string, index: number): Promise<string> {
  // Built-in agent
  const configBuilder = BUILTIN_CONFIGS[agentType];
  if (configBuilder) {
    const config = configBuilder();
    config.name = `${config.name}-${index + 1}`;
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
