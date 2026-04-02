#!/usr/bin/env node

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Command } from "commander";
import chalk from "chalk";
import { startRepl } from "./repl.js";
import { initMcpServers, shutdownMcpServers, listMcpServers } from "./tools/index.js";
import { loadAllSkills } from "./skills/index.js";

// Load .env from all possible locations — override existing env vars
// so ~/.kai/.env always takes precedence over stale shell exports
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(process.env.HOME || "~", ".kai/.env"), override: true, quiet: true });
config({ path: resolve(__dirname, "../.env"), quiet: true });
config({ path: resolve(process.cwd(), ".env"), quiet: true });

const program = new Command();

program
  .name("kai")
  .description("AI coding assistant with persistent memory, background agents, and tool use")
  .version("1.0.0");

// --- Default: Interactive REPL (with optional initial prompt) ---
program
  .argument("[prompt]", "Initial prompt (runs then continues into REPL)")
  .option("-c, --continue [id]", "Continue most recent session, or a specific session by ID")
  .option("-n, --name <name>", "Name for the session")
  .option("-y, --yes", "Auto-approve all tool calls")
  .option("--yolo", "Disable tool turn limits and stopping guards")
  .action(async (promptArg, options) => {
    let pipedInput = "";
    if (!process.stdin.isTTY) {
      pipedInput = await readStdin();
    }

    // Initialize MCP servers and skills in parallel (not sequential)
    await Promise.allSettled([initMcpServers(), loadAllSkills()]);

    const initialPrompt = [pipedInput, promptArg].filter(Boolean).join("\n\n") || undefined;

    // -c with no value → true (continue most recent), -c <id> → string
    const continueVal = options.continue;
    await startRepl({
      continueSession: continueVal === true,
      resumeSessionId: typeof continueVal === "string" ? continueVal : undefined,
      sessionName: options.name,
      autoApprove: options.yes,
      unleash: options.yolo,
    }, initialPrompt);
  });

// --- Server (Web UI + Agent Daemon + API) ---
program
  .command("start")
  .alias("server")
  .alias("app")
  .alias("ui")
  .description("Build and start Kai — web UI, agent daemon, and API")
  .option("--port <port>", "Port to listen on", "3141")
  .option("--no-ui", "Disable web UI (API + agents only)")
  .option("--no-agents", "Disable agent daemon (UI + API only)")
  .option("--tailscale", "Expose via Tailscale to your tailnet")
  .option("--funnel", "Expose via Tailscale Funnel to the public internet")
  .option("--skip-build", "Skip rebuild step")
  .action(async (options) => {
    if (!options.skipBuild) {
      const { execSync } = await import("child_process");
      const projectRoot = new URL("../", import.meta.url).pathname;
      console.log("  Building web app...");
      execSync("npm run build:web", { cwd: projectRoot, stdio: "inherit" });
      console.log("  Building server...");
      execSync("npm run build:server", { cwd: projectRoot, stdio: "inherit" });
      // Re-exec with --skip-build so Node loads the freshly compiled code
      // instead of using stale cached modules from before the rebuild
      const args = process.argv.slice(2).filter(a => a !== "--skip-build");
      args.push("--skip-build");
      execSync(`node ${projectRoot}dist/index.js ${args.join(" ")}`, {
        cwd: projectRoot,
        stdio: "inherit",
      });
      return;
    }
    const { startServer } = await import("./web/server.js");
    await startServer({
      port: parseInt(options.port),
      ui: options.ui,
      agents: options.agents,
      tailscale: options.tailscale || options.funnel,
      funnel: options.funnel,
    });
  });

// --- Agent commands ---
const agent = program.command("agent").description("Manage background agents");

agent
  .command("create <name> <workflow-file>")
  .description("Create a new agent from a workflow YAML file")
  .option("-s, --schedule <cron>", "Cron schedule (e.g. '0 */6 * * *')")
  .option("--config <json>", "JSON config overrides")
  .option("--heartbeat-condition <cmd>", "Shell command condition for proactive heartbeat")
  .option("--heartbeat-interval <ms>", "Heartbeat check interval in ms (default: 60000)")
  .option("--heartbeat-cooldown <ms>", "Cooldown between triggers in ms (default: 300000)")
  .action(async (name, workflowFile, options) => {
    const { createAgent } = await import("./agents/manager.js");
    try {
      let config = options.config ? JSON.parse(options.config) : undefined;

      // Build heartbeat config from CLI flags
      if (options.heartbeatCondition) {
        config = config || {};
        config.heartbeat = {
          enabled: true,
          interval_ms: options.heartbeatInterval ? parseInt(options.heartbeatInterval) : 60000,
          cooldown_ms: options.heartbeatCooldown ? parseInt(options.heartbeatCooldown) : 300000,
          conditions: [
            { type: "shell", check: options.heartbeatCondition },
          ],
        };
      }

      const id = createAgent({
        name,
        workflowFile,
        schedule: options.schedule,
        config,
      });
      console.log(`✓ Agent created: ${id}`);
      console.log(`  Workflow: ${workflowFile}`);
      if (options.schedule) console.log(`  Schedule: ${options.schedule}`);
      console.log(`\n  Run it:     kai agent run ${id}`);
      console.log(`  Start daemon: kai agent daemon`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

agent
  .command("list")
  .description("List all registered agents")
  .action(async () => {
    try {
      const { formatAgentList, daemonStatus } = await import("./agents/manager.js");
      console.log(daemonStatus());
      console.log(formatAgentList());
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

agent
  .command("output <agent-id> [step]")
  .description("Show the output from an agent's latest run")
  .action(async (agentId, step) => {
    try {
      const { formatAgentOutput } = await import("./agents/manager.js");
      console.log(formatAgentOutput(agentId, step));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

agent
  .command("info <agent-id>")
  .description("Show detailed info about an agent")
  .action(async (agentId) => {
    try {
      const { formatAgentDetail } = await import("./agents/manager.js");
      console.log(formatAgentDetail(agentId));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

agent
  .command("run <agent-id>")
  .description("Run an agent immediately")
  .action(async (agentId) => {
    try {
      const { runAgentCommand } = await import("./agents/manager.js");
      await runAgentCommand(agentId);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

agent
  .command("delete <agent-id>")
  .description("Delete an agent and its history")
  .action(async (agentId) => {
    try {
      const { deleteAgent } = await import("./agents/db.js");
      deleteAgent(agentId);
      console.log(`✓ Agent "${agentId}" deleted`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

agent
  .command("daemon")
  .description("Start the agent daemon (runs scheduled agents)")
  .action(async () => {
    const { startDaemon, writeDaemonPid, isDaemonRunning } = await import("./agents/daemon.js");
    if (isDaemonRunning()) {
      console.log("Daemon is already running.");
      process.exit(0);
    }
    writeDaemonPid();
    startDaemon();

    // Keep alive
    process.on("SIGINT", async () => {
      const { stopDaemon, getDaemonPidPath } = await import("./agents/daemon.js");
      const { closeDb } = await import("./agents/db.js");
      const fs = await import("fs");
      stopDaemon();
      try { fs.unlinkSync(getDaemonPidPath()); } catch {}
      closeDb();
      process.exit(0);
    });
  });

agent
  .command("stop")
  .description("Stop the running daemon")
  .action(async () => {
    const { stopDaemonProcess } = await import("./agents/daemon.js");
    if (stopDaemonProcess()) {
      console.log("✓ Daemon stopped");
    } else {
      console.log("Daemon is not running");
    }
  });

agent
  .command("notify")
  .description("Show agent notifications digest")
  .option("-a, --all", "Show all notifications")
  .option("-r, --read", "Mark notifications as read after viewing")
  .action(async (options) => {
    const chalk = (await import("chalk")).default;
    try {
      const { formatNotificationsList, formatNotificationDigest, markAllNotificationsAsRead } = await import("./agents/manager.js");
      if (options.all) {
        console.log(formatNotificationsList());
      } else {
        const digest = formatNotificationDigest(24);
        if (digest) {
          console.log(digest);
        } else {
          console.log(chalk.dim("\n  No agent activity in the last 24 hours.\n"));
        }
      }
      if (options.read) {
        console.log(chalk.dim(markAllNotificationsAsRead()));
      }
    } catch (err: any) {
      console.error(chalk.red(`  Error: ${err.message}`));
      process.exit(1);
    }
  });

agent
  .command("trends <agent-id>")
  .description("Show trends from agent run history")
  .argument("[step-name]", "Step name to analyze (defaults to first completed step)")
  .action(async (agentId, stepName) => {
    try {
      const { formatAgentTrends } = await import("./agents/manager.js");
      console.log(formatAgentTrends(agentId, stepName));
    } catch (err: any) {
      console.error(chalk.red(`  Error: ${err.message}`));
      process.exit(1);
    }
  });

// --- Skill commands ---
const skill = program.command("skill").description("Manage modular skills");

skill
  .command("list")
  .description("List installed skills and their tools")
  .action(async () => {
    const chalk = (await import("chalk")).default;
    const { loadAllSkills, getLoadedSkills, skillsDir } = await import("./skills/index.js");
    await loadAllSkills();
    const skills = getLoadedSkills();

    if (skills.length === 0) {
      console.log(chalk.dim("\n  No skills installed."));
      console.log(chalk.dim(`  Install skills to ${skillsDir()}/`));
      console.log(chalk.dim("  Or use: kai skill install <github-url>\n"));
      return;
    }

    console.log(chalk.bold("\n  Installed Skills\n"));
    for (const s of skills) {
      console.log(`  ${chalk.green("●")} ${chalk.bold(s.manifest.name)} ${chalk.dim(`v${s.manifest.version}`)} ${chalk.dim(`[${s.manifest.id}]`)}`);
      if (s.manifest.description) {
        console.log(chalk.dim(`    ${s.manifest.description}`));
      }
      if (s.manifest.tools.length > 0) {
        for (const tool of s.manifest.tools) {
          console.log(chalk.dim(`    - ${tool.name}: ${tool.description || ""}`));
        }
      }
      console.log("");
    }
  });

skill
  .command("install <source>")
  .description("Install a skill from a GitHub URL or local path")
  .action(async (source) => {
    const chalk = (await import("chalk")).default;
    const { installSkill } = await import("./skills/installer.js");
    try {
      const id = await installSkill(source);
      console.log(chalk.green(`\n  ✓ Skill "${id}" installed successfully\n`));
    } catch (err: any) {
      console.error(chalk.red(`  Error: ${err.message}`));
      process.exit(1);
    }
  });

skill
  .command("uninstall <skill-id>")
  .description("Uninstall a skill")
  .action(async (skillId) => {
    const chalk = (await import("chalk")).default;
    const { uninstallSkill } = await import("./skills/installer.js");
    try {
      await uninstallSkill(skillId);
      console.log(chalk.green(`\n  ✓ Skill "${skillId}" uninstalled\n`));
    } catch (err: any) {
      console.error(chalk.red(`  Error: ${err.message}`));
      process.exit(1);
    }
  });

skill
  .command("reload")
  .description("Hot-reload all installed skills")
  .action(async () => {
    const chalk = (await import("chalk")).default;
    const { reloadAllSkills } = await import("./skills/index.js");
    const result = await reloadAllSkills();
    console.log(chalk.green(`\n  ✓ Reloaded ${result.loaded} skills`));
    if (result.errors.length > 0) {
      for (const err of result.errors) {
        console.log(chalk.yellow(`  ⚠ ${err}`));
      }
    }
    console.log("");
  });

// --- MCP commands ---
const mcp = program.command("mcp").description("Manage MCP server connections");

mcp
  .command("list")
  .description("List configured MCP servers and their tools")
  .action(async () => {
    const chalk = (await import("chalk")).default;
    await initMcpServers();
    const servers = listMcpServers();

    if (servers.length === 0) {
      console.log(chalk.dim("\n  No MCP servers configured."));
      console.log(chalk.dim("  Add servers in ~/.kai/settings.json under \"mcp.servers\"\n"));
      return;
    }

    console.log(chalk.bold("\n  MCP Servers\n"));
    for (const server of servers) {
      const status = server.ready ? chalk.green("●") : chalk.red("●");
      console.log(`  ${status} ${chalk.bold(server.name)}`);
      if (server.tools.length > 0) {
        for (const tool of server.tools) {
          console.log(chalk.dim(`    - ${tool}`));
        }
      } else {
        console.log(chalk.dim("    (no tools)"));
      }
      console.log("");
    }

    await shutdownMcpServers();
  });

// Graceful shutdown of MCP servers on exit
process.on("exit", () => { shutdownMcpServers().catch(() => {}); });
process.on("SIGINT", () => { shutdownMcpServers().catch(() => {}).finally(() => process.exit(0)); });

program.parse();

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}
