import fs from "fs";
import path from "path";
import crypto from "crypto";
import chalk from "chalk";
import YAML from "yaml";
import { ensureKaiDir } from "../config.js";
import { expandHome } from "../utils.js";
import {
  saveAgent,
  getAgent,
  listAgents,
  deleteAgent,
  getLatestRuns,
  getSteps,
  getAgentLogs,
  listNotificationsSince,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getRunOutputsForComparison,
  calculateTrend,
  getPendingApprovals,
  resolveApproval,
  getApprovalById,
  hasPendingApprovals,
  type NotificationRecord,
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

  // Resolve workflow path (expand ~ before checking absolute)
  let workflowPath = expandHome(args.workflowFile);
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

/**
 * Scan for workflow variants (A/B test candidates) for an agent.
 * Returns variants found in the workflows directory and agent config.
 */
export function listWorkflowVariants(agentId: string): Array<{
  name: string;
  active: boolean;
  workflowPath: string;
  createdAt?: string;
  description?: string;
  metrics?: Record<string, any>;
}> {
  const agent = getAgent(agentId);
  if (!agent) return [];

  const variants: ReturnType<typeof listWorkflowVariants> = [];
  const workflowsDir = path.dirname(agent.workflow_path);
  const baseName = path.basename(agent.workflow_path, ".yaml");

  // Scan directory for variant workflows
  try {
    const files = fs.readdirSync(workflowsDir);
    for (const file of files) {
      if (file.startsWith(`${baseName}-`) && file.endsWith(".yaml")) {
        const variantName = file.slice(baseName.length + 1, -5);
        const variantPath = path.join(workflowsDir, file);
        
        // Parse variant metadata
        let description: string | undefined;
        let createdAt: string | undefined;
        try {
          const raw = fs.readFileSync(variantPath, "utf-8");
          const parsed = YAML.parse(raw);
          description = parsed.description;
          createdAt = parsed.variant?.createdAt;
        } catch {
          // Ignore parse errors
        }

        variants.push({
          name: variantName,
          active: false, // Will be updated from config below
          workflowPath: variantPath,
          description,
          createdAt,
        });
      }
    }
  } catch {
    // Directory might not exist
  }

  // Merge with agent config experiment metadata
  try {
    const config = JSON.parse(agent.config || "{}");
    if (config.experiments && Array.isArray(config.experiments)) {
      for (const exp of config.experiments) {
        const existing = variants.find(v => v.name === exp.variantName);
        if (existing) {
          existing.active = exp.active || false;
          if (exp.metrics) existing.metrics = exp.metrics;
        } else if (exp.variantName) {
          // Config-only experiment (workflow might have been moved)
          variants.push({
            name: exp.variantName,
            active: exp.active || false,
            workflowPath: exp.workflowPath || path.join(workflowsDir, `${baseName}-${exp.variantName}.yaml`),
            description: exp.description,
            createdAt: exp.createdAt,
            metrics: exp.metrics,
          });
        }
      }
    }
  } catch {
    // Config might not be valid JSON
  }

  return variants;
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
          content: "You are presenting the final output of an AI agent workflow run. Focus on the ACTUAL CONTENT and END RESULTS produced — not on describing what the agent is or what it can do. For example, if the agent fetched news articles, show the articles. If it generated a report, show the report findings. If it did a backup, show what was backed up. Present the real data and findings, not meta-commentary about capabilities or architecture. Be concise, use markdown formatting, and keep it under 400 words.",
        },
        {
          role: "user",
          content: `Present the end results from this "${agent.name}" agent run. Show the actual content produced, not a description of the agent:\n\n${keyOutputs.join("\n\n---\n\n")}`,
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

export function formatNotificationDigest(hours = 24): string {
  const notifications = listNotificationsSince(hours);
  if (notifications.length === 0) {
    return "";
  }

  // Deduplicate: only show the most recent notification per agent per type
  // (prevents spam from repeated "3 consecutive failures" notifications)
  const seen = new Map<string, NotificationRecord>();
  for (const n of notifications) {
    const key = `${n.agent_id}-${n.type}`;
    // Keep the most recent (notifications are already sorted DESC by created_at)
    if (!seen.has(key)) {
      seen.set(key, n);
    }
  }
  const deduped = Array.from(seen.values()).sort((a, b) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const lines: string[] = [
    chalk.bold.cyan("\n  📬 Agent Digest"),
    chalk.dim(`     (last ${hours}h)\n`),
  ];

  for (const n of deduped.slice(0, 10)) {
    const icon = n.type === "agent_failed" || n.type === "agent_error" ? chalk.red("✗")
      : n.type === "agent_completed" || n.type === "agent_recovery" ? chalk.green("✓")
      : chalk.blue("•");
    const title = n.read ? chalk.dim(n.title) : chalk.bold(n.title);
    const time = chalk.dim(new Date(n.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    lines.push(`  ${icon} ${title} ${time}`);
    if (n.body) {
      const body = n.body.length > 80 ? n.body.substring(0, 77) + "..." : n.body;
      lines.push(chalk.dim(`    ${body.split("\n")[0]}`));
    }
  }

  if (deduped.length > 10) {
    lines.push(chalk.dim(`\n  ... and ${deduped.length - 10} more`));
  }

  lines.push("");
  return lines.join("\n");
}

export function formatNotificationsList(limit = 20): string {
  const notifications = listNotifications(limit);
  if (notifications.length === 0) {
    return "  No notifications yet.\n";
  }

  const lines: string[] = [chalk.bold("\n  Notifications\n")];

  for (const n of notifications) {
    const icon = n.type === "agent_failed" ? chalk.red("✗")
      : n.type === "agent_completed" ? chalk.green("✓")
      : chalk.blue("•");
    const readMark = n.read ? chalk.dim("◻") : chalk.cyan("◼");
    const title = n.read ? chalk.dim(n.title) : chalk.bold(n.title);
    const time = chalk.dim(new Date(n.created_at).toLocaleString());

    lines.push(`  ${readMark} [${n.id}] ${icon} ${title}`);
    lines.push(chalk.dim(`     ${time}`));
    if (n.body) {
      const body = n.body.length > 200 ? n.body.substring(0, 197) + "..." : n.body;
      lines.push(body.split("\n").map((l) => `     ${l}`).join("\n"));
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function markNotificationAsRead(id: number): string {
  markNotificationRead(id);
  return `Marked notification ${id} as read.`;
}

export function markAllNotificationsAsRead(): string {
  markAllNotificationsRead();
  return "All notifications marked as read.";
}

export function formatAgentTrends(agentId: string, stepName?: string): string {
  const agent = getAgent(agentId);
  if (!agent) return chalk.red(`Agent "${agentId}" not found.\n`);

  // If no step name provided, ask for one or show available
  if (!stepName) {
    // Try to infer from common step names
    const steps = getLatestRuns(agentId, 1);
    if (steps.length === 0) return chalk.dim("No runs yet.\n");

    const stepRecords = getSteps(steps[0].id);
    const commonSteps = stepRecords
      .filter(s => s.status === "completed" && s.output)
      .map(s => s.step_name);

    if (commonSteps.length === 0) return chalk.dim("No completed steps with output.\n");

    stepName = commonSteps[0];
  }

  const outputs = getRunOutputsForComparison(agentId, stepName, 5);
  if (outputs.length === 0) {
    return chalk.dim(`No outputs for step "${stepName}".\n`);
  }

  const lines: string[] = [
    chalk.bold(`\n  Trend: ${agent.name} — ${stepName}\n`),
    chalk.dim(`  Comparing ${outputs.length} recent runs:\n`),
  ];

  for (let i = 0; i < outputs.length; i++) {
    const { output, created_at } = outputs[i];
    const date = new Date(created_at).toLocaleDateString();
    const preview = output.length > 60 ? output.substring(0, 57) + "..." : output;
    const marker = i === 0 ? chalk.green("✓ current") : chalk.dim("← older");
    lines.push(`  ${marker} ${date}: ${preview.split('\n')[0]}`);
  }

  // Try to extract numeric trend if looks like numbers
  const numericLines = outputs[0]?.output.match(/(\d+[,\d]*\.?\d*)/g);
  if (numericLines && numericLines.length > 0) {
    const current = parseFloat(numericLines[0].replace(/,/g, ""));
    const prevOutput = outputs[1]?.output;
    if (prevOutput) {
      const prevMatches = prevOutput.match(/(\d+[,\d]*\.?\d*)/g);
      if (prevMatches && prevMatches.length > 0) {
        const previous = parseFloat(prevMatches[0].replace(/,/g, ""));
        if (!isNaN(current) && !isNaN(previous) && previous !== 0) {
          const change = ((current - previous) / previous) * 100;
          const arrow = change > 0 ? "↑" : change < 0 ? "↓" : "→";
          const color = change > 0 ? chalk.green : change < 0 ? chalk.red : chalk.dim;
          lines.push(`\n  ${color(`${arrow} ${Math.abs(change).toFixed(1)}% change`)} (${previous.toLocaleString()} → ${current.toLocaleString()})`);
        }
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}
