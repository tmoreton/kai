import { config as dotenvConfig } from "dotenv";
import cron from "node-cron";
import chalk from "chalk";
import path from "path";
import fs from "fs";
import { ensureKaiDir } from "../config.js";

// Load env from multiple locations
dotenvConfig({ path: path.resolve(ensureKaiDir(), ".env"), quiet: true } as any);
dotenvConfig({ path: path.resolve(process.cwd(), ".env"), quiet: true } as any);
import { loadAllSkills, getLoadedSkills } from "../skills/index.js";
import { listMcpServers } from "../tools/index.js";
import {
  parseWorkflow,
  executeWorkflow,
} from "./workflow.js";
import {
  listAgents,
  getAgent,
  getLatestRuns,
  getFailedOrStuckRuns,
  getConsecutiveFailCount,
  completeRun,
  markAllStuckRunsFailed,
  addLog,
  createNotification,
  hasRecentNotification,
  type AgentRecord,
} from "./db.js";

// V2 Event-driven imports
import {
  eventBus,
  registerAgentTriggers,
  convertHeartbeatToTriggers,
  startEmailWatcher,
  unwatchAll,
  recoverAll,
} from "../agents-v2/index.js";
import type { TriggerConfig } from "../agents-v2/types.js";

/**
 * Daemon: Persistent background agent runner.
 *
 * - Loads all registered agents from the database
 * - Schedules cron jobs for agents with schedules
 * - Runs workflows when triggered
 * - Sends notifications on completion
 */

const scheduledJobs = new Map<string, ReturnType<typeof cron.schedule>>();
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RESTART_DELAY_MS = 3000;

let restartTimestamps: number[] = [];

async function startDaemonInner(): Promise<void> {
  console.log(chalk.bold.cyan("\n  ⚡ Kai Agent Daemon starting (v2 event-driven)...\n"));

  // Catch unhandled errors from scheduled agent runs so they don't kill the daemon
  process.on("uncaughtException", (err) => {
    console.error(chalk.red(`  Uncaught exception: ${err.message}`));
    addLog("__daemon__", "error", `Uncaught: ${err.message}`);
  });
  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error(chalk.red(`  Unhandled rejection: ${msg}`));
    addLog("__daemon__", "error", `Unhandled rejection: ${msg}`);
  });

  // Load all skills first (needed for workflows)
  await loadAllSkills();

  // Recover interrupted runs from previous session
  console.log(chalk.dim("  Checking for interrupted runs..."));
  const recovery = await recoverAll({ olderThanMinutes: 2 });
  if (recovery.recovered.length > 0) {
    console.log(chalk.green(`  ✓ Recovered ${recovery.recovered.length} run(s)`));
  }

  // Load all agents and register event-driven triggers
  const agents = listAgents();
  console.log(chalk.dim(`  Found ${agents.length} agents\n`));

  for (const agent of agents) {
    if (!agent.enabled) continue;
    
    const triggers: TriggerConfig[] = [];
    
    // Add cron schedule if exists
    if (agent.schedule) {
      triggers.push({ type: "cron", expr: agent.schedule });
      console.log(chalk.dim(`  ✓ Cron: ${agent.name} (${agent.schedule})`));
    }
    
    // Convert heartbeat conditions to triggers
    let config: Record<string, any>;
    try {
      config = JSON.parse(agent.config || "{}");
    } catch { continue; }
    
    if (config.heartbeat?.enabled && config.heartbeat.conditions) {
      const heartbeatTriggers = convertHeartbeatToTriggers(config.heartbeat.conditions);
      triggers.push(...heartbeatTriggers);
      console.log(chalk.dim(`  ✓ Triggers: ${agent.name} (${heartbeatTriggers.length} condition-based)`));
    }
    
    if (triggers.length > 0) {
      registerAgentTriggers({ agentId: agent.id, triggers });
    }
  }

  // Subscribe to manual run requests
  eventBus.subscribe("agent:run-requested", async (event) => {
    const agentId = event.payload.agentId as string;
    if (agentId) {
      const { runAgent } = await import("../agents-v2/runner.js");
      await runAgent(agentId, { triggerEvent: event });
    }
  });

  // Start email watcher (event-driven)
  try {
    await startEmailWatcher(60000);
  } catch {
    // Email not configured, that's fine
  }

  // Keep the process alive
  console.log(chalk.dim("  Daemon running. Press Ctrl+C to stop.\n"));

  // Start simplified heartbeat (just for self-healing, no condition polling)
  startProactiveHeartbeat();
}

/**
 * Start the daemon with auto-restart on crash.
 * Restarts up to MAX_RESTARTS times within RESTART_WINDOW_MS.
 * If the limit is exceeded, gives up and exits.
 */
export async function startDaemon(): Promise<void> {
  try {
    await startDaemonInner();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`\n  Daemon crashed: ${msg}\n`));
    addLog("__daemon__", "error", `Crashed: ${msg}`);

    // Track restarts within the window
    const now = Date.now();
    restartTimestamps = restartTimestamps.filter((t) => now - t < RESTART_WINDOW_MS);
    restartTimestamps.push(now);

    if (restartTimestamps.length >= MAX_RESTARTS) {
      console.error(chalk.red(`  Too many crashes (${MAX_RESTARTS} in ${RESTART_WINDOW_MS / 60000}m). Giving up.\n`));
      addLog("__daemon__", "error", `Exceeded restart limit (${MAX_RESTARTS}). Shutting down.`);
      process.exit(1);
    }

    console.log(chalk.yellow(`  Restarting in ${RESTART_DELAY_MS / 1000}s... (${restartTimestamps.length}/${MAX_RESTARTS})\n`));
    stopDaemon(); // Clean up old scheduled jobs
    await new Promise((r) => setTimeout(r, RESTART_DELAY_MS));
    return startDaemon(); // Recursive restart
  }
}

const HEARTBEAT_CHECK_INTERVAL = 30_000; // 30 seconds
const DEFAULT_COOLDOWN_MS = 300_000; // 5 minutes
const MAX_AUTO_RETRIES = 3; // stop retrying after 3 consecutive failures
const STALE_RUN_MINUTES = 30; // mark runs as stuck after 30 minutes

/**
 * Proactive heartbeat: Only for self-healing (no condition polling - now event-driven)
 */
function startProactiveHeartbeat(): void {
  let checkCount = 0;

  heartbeatInterval = setInterval(async () => {
    checkCount++;

    // Log daemon status every 10 checks (~5 minutes)
    if (checkCount % 10 === 0) {
      const stats = eventBus.getStats();
      addLog("__daemon__", "info", `Heartbeat: ${stats.types} event handlers`);
    }

    // --- Self-healing: check for failed/stuck runs and auto-retry ---
    // Run every 6 checks (~3 minutes) to avoid hammering
    if (checkCount % 6 === 3) {
      await checkAndRetryFailedRuns();
    }

    // REMOVED: Heartbeat condition polling - now event-driven via agents-v2
  }, HEARTBEAT_CHECK_INTERVAL);
}

/**
 * Self-healing: find failed or stuck runs and auto-retry them.
 * - Failed runs: retry if the agent hasn't exceeded MAX_AUTO_RETRIES consecutive failures
 * - Stuck runs: mark as failed first, then retry
 */
async function checkAndRetryFailedRuns(): Promise<void> {
  const problemRuns = getFailedOrStuckRuns(1, STALE_RUN_MINUTES);
  if (problemRuns.length === 0) return;

  const seen = new Set<string>(); // only retry each agent once per check

  for (const run of problemRuns) {
    if (seen.has(run.agent_id)) continue;
    seen.add(run.agent_id);

    const agent = getAgent(run.agent_id);
    if (!agent || !agent.enabled) continue;

    // Handle stuck runs — mark ALL stuck runs for this agent as failed so they don't keep retriggering
    if (run.status === "running") {
      const cleaned = markAllStuckRunsFailed(run.agent_id, STALE_RUN_MINUTES);
      addLog(run.agent_id, "warn", `Marked ${cleaned} stuck run(s) as failed — will retry`, run.id);
      console.log(chalk.yellow(`  ⚠ Stuck runs detected: ${agent.name} (${cleaned} run(s)) — marking failed`));
    }

    // Check consecutive failure count to avoid retry loops
    const failCount = getConsecutiveFailCount(run.agent_id);
    if (failCount >= MAX_AUTO_RETRIES) {
      // Already notified recently — skip entirely (don't keep retrying auto-fix)
      if (hasRecentNotification(run.agent_id, "agent_error", 24)) {
        continue;
      }

      // Try auto-fix before giving up
      const fixed = await attemptAutoFix(agent, run);
      if (fixed) {
        console.log(chalk.green(`  ✓ Auto-fix succeeded for ${agent.name}, retrying...`));
        // Retry after fix
        try {
          const result = await runAgent(run.agent_id);
          if (result.success) {
            addLog(run.agent_id, "info", `Auto-retry succeeded after auto-fix`);
            console.log(chalk.green(`  ✓ Auto-retry succeeded: ${agent.name}`));
            createNotification({
              type: "agent_recovery",
              title: `${agent.name}: recovered after auto-fix`,
              body: `Agent was auto-fixed and completed successfully`,
              agentId: run.agent_id,
            });
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          addLog(run.agent_id, "error", `Auto-retry after fix failed: ${msg}`);
        }
        continue;
      }

      // Notify once — won't repeat for 24h thanks to hasRecentNotification check above
      addLog(run.agent_id, "error", `Auto-retry disabled: ${failCount} consecutive failures. Manual intervention required.`);
      createNotification({
        type: "agent_error",
        title: `${agent.name}: ${failCount} consecutive failures`,
        body: `Last error: ${run.error || "unknown"}. Auto-retry stopped. Run manually with: kai agent run ${agent.id}`,
        agentId: run.agent_id,
        runId: run.id,
      });
      console.log(chalk.red(`  ✗ ${agent.name}: ${failCount} consecutive failures — auto-retry stopped`));
      continue;
    }

    // Retry the agent
    addLog(run.agent_id, "info", `Auto-retrying after failure (attempt ${failCount + 1}/${MAX_AUTO_RETRIES}). Previous error: ${run.error || "unknown"}`, run.id);
    console.log(chalk.cyan(`  🔄 Auto-retrying: ${agent.name} (attempt ${failCount + 1}/${MAX_AUTO_RETRIES})`));

    try {
      const result = await runAgent(run.agent_id);
      if (result.success) {
        addLog(run.agent_id, "info", `Auto-retry succeeded after ${failCount + 1} attempt(s)`);
        console.log(chalk.green(`  ✓ Auto-retry succeeded: ${agent.name}`));
        createNotification({
          type: "agent_recovery",
          title: `${agent.name}: recovered after ${failCount + 1} attempt(s)`,
          body: `Previous error was: ${run.error || "unknown"}`,
          agentId: run.agent_id,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(run.agent_id, "error", `Auto-retry failed: ${msg}`);
    }
  }
}

/**
 * Attempt to auto-fix common agent failure issues.
 * Returns true if a fix was applied (caller should retry).
 */
async function attemptAutoFix(
  agent: AgentRecord,
  run: { status: string; error: string | null }
): Promise<boolean> {
  const error = (run.error || "").toLowerCase();
  let fixed = false;

  // Fix 1: Workflow file missing or moved — check if file exists
  if (!fs.existsSync(agent.workflow_path)) {
    // Check common locations
    const kaiDir = ensureKaiDir();
    const workflowsDir = path.join(kaiDir, "workflows");
    const agentFile = path.basename(agent.workflow_path);
    const possiblePaths = [
      path.join(workflowsDir, agentFile),
      path.join(kaiDir, agentFile),
      path.join(process.cwd(), agentFile),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        // Update the agent's workflow path
        const { saveAgent } = await import("./db.js");
        saveAgent({ ...agent, workflow_path: p });
        addLog(agent.id, "info", `Auto-fixed: updated workflow path to ${p}`);
        fixed = true;
        break;
      }
    }
  }

  // Fix 2: Parse workflow file errors — validate and report
  if (!fixed && error.includes("workflow") && error.includes("parse")) {
    try {
      parseWorkflow(agent.workflow_path);
    } catch (parseErr: any) {
      addLog(agent.id, "warn", `Workflow parse error persists: ${parseErr.message}`);
    }
  }

  // Fix 3: Comment out empty/malformed env var section in workflow that causes YAML parse errors
  if (!fixed && (error.includes("yaml") || error.includes("parse"))) {
    try {
      const content = fs.readFileSync(agent.workflow_path, "utf-8");
      // Check for empty env: block which breaks YAML parser
      if (/^env:\s*$/m.test(content) && !/^env:\s*\S/m.test(content)) {
        const fixedContent = content.replace(/^env:\s*$/m, "# env:");
        fs.writeFileSync(agent.workflow_path, fixedContent);
        addLog(agent.id, "info", "Auto-fixed: commented out empty env block in workflow");
        fixed = true;
      }
    } catch (e: any) {
      addLog(agent.id, "debug", `Auto-fix env block failed: ${e.message}`);
    }
  }

  return fixed;
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

  // Load skills if not already done
  await loadAllSkills();

  // Validate workflow path exists
  if (!agent.workflow_path) {
    const msg = `Agent "${agent.name}" has no workflow path configured. Re-create it with: kai agent create <name> <workflow.yaml>`;
    addLog(agentId, "error", `Failed to run: ${msg}`);
    return { success: false, error: msg };
  }
  if (!fs.existsSync(agent.workflow_path)) {
    const msg = `Workflow file not found: ${agent.workflow_path}`;
    addLog(agentId, "error", `Failed to run: ${msg}`);
    return { success: false, error: msg };
  }

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
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  for (const [id, task] of scheduledJobs) {
    task.stop();
  }
  scheduledJobs.clear();

  // Stop v2 watchers
  unwatchAll();
  
  import("../agents-v2/watchers/email.js").then(m => m.stopEmailWatcher()).catch(() => {});
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
