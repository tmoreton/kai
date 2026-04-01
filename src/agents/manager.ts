import fs from "fs";
import path from "path";
import crypto from "crypto";
import chalk from "chalk";
import { ensureKaiDir } from "../config.js";
import {
  saveAgent,
  getAgent,
  listAgents,
  deleteAgent,
  getLatestRuns,
  getSteps,
  getAgentLogs,
} from "./db.js";
import { parseWorkflow } from "./workflow.js";
import { runAgent, isDaemonRunning, stopDaemonProcess } from "./daemon.js";

/**
 * Agent Manager: CLI interface for creating, listing, running agents.
 */

function workflowsDir(): string {
  const dir = path.join(ensureKaiDir(), "workflows");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function createAgent(args: {
  name: string;
  workflowFile: string;
  schedule?: string;
  config?: Record<string, any>;
}): string {
  const id = `agent-${args.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  // Resolve workflow path
  let workflowPath = args.workflowFile;
  if (!path.isAbsolute(workflowPath)) {
    workflowPath = path.resolve(process.cwd(), workflowPath);
  }

  // Copy workflow to ~/.kai/workflows/ if not already there
  const destDir = workflowsDir();
  const destPath = path.join(destDir, `${id}.yaml`);
  if (workflowPath !== destPath) {
    fs.copyFileSync(workflowPath, destPath);
    workflowPath = destPath;
  }

  // Validate the workflow
  const workflow = parseWorkflow(workflowPath);

  saveAgent({
    id,
    name: args.name,
    description: workflow.description || "",
    workflow_path: workflowPath,
    schedule: args.schedule || workflow.schedule || "",
    enabled: 1,
    config: JSON.stringify(args.config || workflow.config || {}),
  });

  return id;
}

export function formatAgentList(): string {
  const agents = listAgents();
  if (agents.length === 0) return chalk.dim("  No agents registered.\n");

  const lines: string[] = [];
  for (const agent of agents) {
    const status = agent.enabled ? chalk.green("✔") : chalk.dim("◻");
    const schedule = agent.schedule ? chalk.dim(` (${agent.schedule})`) : "";
    lines.push(`  ${status} ${chalk.bold(agent.name)} ${chalk.dim(`[${agent.id}]`)}${schedule}`);

    if (agent.description) {
      lines.push(chalk.dim(`    ${agent.description}`));
    }

    // Show latest run
    const runs = getLatestRuns(agent.id, 1);
    if (runs.length > 0) {
      const run = runs[0];
      const statusIcon = run.status === "completed" ? chalk.green("✔") : run.status === "failed" ? chalk.red("✗") : chalk.cyan("✢");
      const time = new Date(run.started_at).toLocaleString();
      lines.push(chalk.dim(`    ⎿  ${run.status} (${time})  `) + statusIcon);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatAgentDetail(agentId: string): string {
  const agent = getAgent(agentId);
  if (!agent) return chalk.red(`  Agent "${agentId}" not found.\n`);

  const lines: string[] = [
    chalk.bold(`\n  ${agent.name}`),
    chalk.dim(`  ID: ${agent.id}`),
    chalk.dim(`  Status: ${agent.enabled ? "enabled" : "disabled"}`),
    chalk.dim(`  Schedule: ${agent.schedule || "manual only"}`),
    chalk.dim(`  Workflow: ${agent.workflow_path}`),
  ];

  if (agent.description) {
    lines.push(chalk.dim(`  Description: ${agent.description}`));
  }

  const config = JSON.parse(agent.config || "{}");
  if (config.heartbeat?.enabled) {
    const hb = config.heartbeat;
    lines.push(chalk.cyan(`  Heartbeat: enabled`));
    lines.push(chalk.dim(`    Cooldown: ${(hb.cooldown_ms || 300000) / 1000}s`));
    if (hb.conditions?.length) {
      for (const c of hb.conditions) {
        lines.push(chalk.dim(`    Condition: [${c.type}] ${c.check}`));
      }
    }
  }
  const { heartbeat: _, ...restConfig } = config;
  if (Object.keys(restConfig).length > 0) {
    lines.push(chalk.dim(`  Config: ${JSON.stringify(restConfig, null, 2).split("\n").join("\n    ")}`));
  }

  // Recent runs
  const runs = getLatestRuns(agent.id, 5);
  if (runs.length > 0) {
    lines.push(chalk.bold("\n  Recent Runs:"));
    for (const run of runs) {
      const icon = run.status === "completed" ? chalk.green("✔") : run.status === "failed" ? chalk.red("✗") : chalk.cyan("✢");
      const time = new Date(run.started_at).toLocaleString();
      const duration = run.completed_at
        ? `${Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s`
        : "running";
      lines.push(`    ${icon} ${run.id} — ${run.status} (${time}, ${duration})`);

      if (run.error) {
        lines.push(chalk.red(`      Error: ${run.error.substring(0, 100)}`));
      }

      // Show steps for the latest run
      if (run === runs[0]) {
        const steps = getSteps(run.id);
        for (const step of steps) {
          const sIcon = step.status === "completed" ? chalk.green("✔") : step.status === "failed" ? chalk.red("✗") : chalk.dim("◻");
          lines.push(chalk.dim(`      ${sIcon} ${step.step_name} (${step.status})`));
          if (step.error) {
            lines.push(chalk.red(`        ${step.error.substring(0, 200)}`));
          }
        }
      }
    }
  }

  // Recent logs
  const logs = getAgentLogs(agent.id, 10);
  if (logs.length > 0) {
    lines.push(chalk.bold("\n  Recent Logs:"));
    for (const log of logs) {
      const color = log.level === "error" ? chalk.red : chalk.dim;
      lines.push(color(`    [${log.created_at}] ${log.level}: ${log.message}`));
    }
  }

  lines.push("");
  return lines.join("\n");
}

export async function runAgentCommand(agentId: string): Promise<void> {
  console.log(chalk.dim(`\n  Running agent: ${agentId}\n`));
  const result = await runAgent(agentId);
  if (result.success) {
    console.log(chalk.green(`\n  ✔ Agent completed successfully\n`));

    // Generate a summary via LLM
    await generateRunSummary(agentId);
  } else {
    console.log(chalk.red(`\n  ✗ Agent failed: ${result.error}\n`));
  }
}

async function generateRunSummary(agentId: string): Promise<void> {
  const agent = getAgent(agentId);
  if (!agent) return;

  const runs = getLatestRuns(agentId, 1);
  if (runs.length === 0) return;

  const steps = getSteps(runs[0].id);
  const completedSteps = steps.filter((s) => s.status === "completed" && s.output);

  // Collect key outputs (skip raw data steps, focus on LLM analysis steps)
  const keyOutputs: string[] = [];
  for (const step of completedSteps) {
    if (!step.output) continue;
    // Include LLM-generated steps and limit size
    const output = step.output.substring(0, 3000);
    keyOutputs.push(`## ${step.step_name}\n${output}`);
  }

  if (keyOutputs.length === 0) return;

  console.log(chalk.dim("  Generating summary...\n"));

  try {
    const { resolveProvider } = await import("../providers/index.js");
    const { client, model } = resolveProvider();

    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You are summarizing the results of an AI agent workflow. Be concise, highlight the most actionable insights, and format with clear headers. Keep it under 400 words.",
        },
        {
          role: "user",
          content: `Summarize the key results from this "${agent.name}" agent run:\n\n${keyOutputs.join("\n\n---\n\n")}`,
        },
      ],
      max_tokens: 2048,
    });

    const content = response.choices[0]?.message?.content
      || (response.choices[0]?.message as any)?.reasoning
      || "";

    if (content) {
      console.log(chalk.bold("  ═══ Summary ═══\n"));
      // Indent each line
      const lines = content.split("\n");
      for (const line of lines) {
        console.log(`  ${line}`);
      }
      console.log("");
    }
  } catch (err: unknown) {
    // Summary is nice-to-have, don't fail the whole command
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.dim(`  (Summary generation failed: ${msg})\n`));
  }
}

export function formatAgentOutput(agentId: string, stepName?: string): string {
  const agent = getAgent(agentId);
  if (!agent) return chalk.red(`  Agent "${agentId}" not found.\n`);

  const runs = getLatestRuns(agentId, 1);
  if (runs.length === 0) return chalk.dim("  No runs yet.\n");

  const steps = getSteps(runs[0].id);
  const lines: string[] = [
    chalk.bold(`\n  Output from: ${agent.name}`),
    chalk.dim(`  Run: ${runs[0].id} (${runs[0].status})\n`),
  ];

  for (const step of steps) {
    if (stepName && step.step_name !== stepName) continue;

    lines.push(chalk.cyan(`  ── ${step.step_name} ──`));
    if (step.output) {
      // Truncate very long output for display
      const output = step.output.length > 3000
        ? step.output.substring(0, 3000) + "\n\n... (truncated)"
        : step.output;
      lines.push(output);
    } else if (step.error) {
      lines.push(chalk.red(step.error));
    } else {
      lines.push(chalk.dim("(no output)"));
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function daemonStatus(): string {
  if (isDaemonRunning()) {
    return chalk.green("  ✔ Daemon is running\n");
  }
  return chalk.dim("  ◻ Daemon is not running\n") +
    chalk.dim("  Start with: kai agent daemon\n");
}
