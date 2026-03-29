import { config as dotenvConfig } from "dotenv";
import cron from "node-cron";
import chalk from "chalk";
import path from "path";
import fs from "fs";
import { ensureKaiDir } from "../config.js";

// Load env from multiple locations
dotenvConfig({ path: path.resolve(ensureKaiDir(), ".env"), quiet: true } as any);
dotenvConfig({ path: path.resolve(process.cwd(), ".env"), quiet: true } as any);
import { registerAllIntegrations } from "./integrations/index.js";
import {
  parseWorkflow,
  executeWorkflow,
} from "./workflow.js";
import {
  listAgents,
  getAgent,
  addLog,
  type AgentRecord,
} from "./db.js";

/**
 * Daemon: Persistent background agent runner.
 *
 * - Loads all registered agents from the database
 * - Schedules cron jobs for agents with schedules
 * - Runs workflows when triggered
 * - Sends notifications on completion
 */

const scheduledJobs = new Map<string, ReturnType<typeof cron.schedule>>();

export function startDaemon(): void {
  console.log(chalk.bold.cyan("\n  ⚡ Kai Agent Daemon starting...\n"));

  // Register all integrations
  registerAllIntegrations();

  // Load all agents and schedule them
  const agents = listAgents();
  console.log(chalk.dim(`  Found ${agents.length} agents\n`));

  for (const agent of agents) {
    if (agent.enabled && agent.schedule) {
      scheduleAgent(agent);
    }
  }

  // Keep the process alive
  console.log(chalk.dim("  Daemon running. Press Ctrl+C to stop.\n"));

  // Log status periodically
  setInterval(() => {
    const count = scheduledJobs.size;
    addLog("__daemon__", "info", `Heartbeat: ${count} agents scheduled`);
  }, 5 * 60 * 1000); // Every 5 minutes
}

function scheduleAgent(agent: AgentRecord): void {
  if (!agent.schedule || !cron.validate(agent.schedule)) {
    console.log(chalk.yellow(`  ⚠ Agent "${agent.name}": invalid schedule "${agent.schedule}"`));
    return;
  }

  const task = cron.schedule(agent.schedule, async () => {
    console.log(chalk.dim(`\n  ⏰ Running agent: ${agent.name}`));
    await runAgent(agent.id);
  });

  scheduledJobs.set(agent.id, task);
  console.log(chalk.dim(`  ✓ Scheduled "${agent.name}" — ${agent.schedule}`));
}

export async function runAgent(agentId: string): Promise<{ success: boolean; error?: string }> {
  // Allow both "yt-daily-scout" and "agent-yt-daily-scout"
  let agent = getAgent(agentId);
  if (!agent && !agentId.startsWith("agent-")) {
    agent = getAgent(`agent-${agentId}`);
  }
  if (!agent) return { success: false, error: `Agent "${agentId}" not found` };

  // Register integrations if not already done
  registerAllIntegrations();

  try {
    const workflow = parseWorkflow(agent.workflow_path);
    const config = JSON.parse(agent.config || "{}");

    const result = await executeWorkflow(
      workflow,
      agentId,
      config,
      (step, status) => {
        console.log(chalk.dim(`    ${step}: ${status}`));
      }
    );

    if (result.success) {
      console.log(chalk.green(`  ✓ Agent "${agent.name}" completed\n`));
    } else {
      console.log(chalk.red(`  ✗ Agent "${agent.name}" failed: ${result.error}\n`));
    }

    return { success: result.success, error: result.error };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog(agentId, "error", `Failed to run: ${msg}`);
    return { success: false, error: msg };
  }
}

export function stopDaemon(): void {
  for (const [id, task] of scheduledJobs) {
    task.stop();
  }
  scheduledJobs.clear();
}

export function getDaemonPidPath(): string {
  return path.join(ensureKaiDir(), "daemon.pid");
}

export function isDaemonRunning(): boolean {
  const pidPath = getDaemonPidPath();
  if (!fs.existsSync(pidPath)) return false;

  try {
    const pid = parseInt(fs.readFileSync(pidPath, "utf-8").trim());
    // Check if process exists
    process.kill(pid, 0);
    return true;
  } catch {
    // Process not running, clean up stale PID file
    try { fs.unlinkSync(pidPath); } catch {}
    return false;
  }
}

export function writeDaemonPid(): void {
  fs.writeFileSync(getDaemonPidPath(), String(process.pid), "utf-8");
}

export function stopDaemonProcess(): boolean {
  const pidPath = getDaemonPidPath();
  if (!fs.existsSync(pidPath)) return false;

  try {
    const pid = parseInt(fs.readFileSync(pidPath, "utf-8").trim());
    process.kill(pid, "SIGTERM");
    fs.unlinkSync(pidPath);
    return true;
  } catch {
    try { fs.unlinkSync(pidPath); } catch {}
    return false;
  }
}
