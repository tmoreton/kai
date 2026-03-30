#!/usr/bin/env node

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Command } from "commander";
import { createClient, chat } from "./client.js";
import { getSystemPrompt } from "./system-prompt.js";
import { startRepl } from "./repl.js";
import { getCwd } from "./tools/bash.js";
import { getProfileContext } from "./project-profile.js";
import { archivalList } from "./archival.js";
import { gitInfo } from "./git.js";
import { initMcpServers, shutdownMcpServers, listMcpServers } from "./tools/index.js";

// Load .env from all possible locations — override existing env vars
// so ~/.kai/.env always takes precedence over stale shell exports
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(process.env.HOME || "~", ".kai/.env"), override: true, quiet: true });
config({ path: resolve(__dirname, "../.env"), quiet: true });
config({ path: resolve(process.cwd(), ".env"), quiet: true });

const program = new Command();

program
  .name("kai")
  .description("AI agent platform — multi-provider coding CLI + background agents")
  .version("1.0.0");

// --- Default: Interactive REPL or one-shot ---
program
  .argument("[prompt]", "One-shot prompt (runs and exits)")
  .option("-p, --print <prompt>", "Run a one-shot prompt and print result")
  .option("-c, --continue", "Continue most recent session")
  .option("-r, --resume <id>", "Resume a specific session by ID")
  .option("-n, --name <name>", "Name for the session")
  .option("-y, --yes", "Auto-approve all tool calls")
  .action(async (promptArg, options) => {
    const oneShot = options.print || promptArg;

    let pipedInput = "";
    if (!process.stdin.isTTY) {
      pipedInput = await readStdin();
    }

    // Initialize MCP servers before any interaction
    await initMcpServers();

    if (oneShot || pipedInput) {
      const prompt = [pipedInput, oneShot].filter(Boolean).join("\n\n");
      await runOneShot(prompt, options.yes);
    } else {
      await startRepl({
        continueSession: options.continue,
        resumeSessionId: options.resume,
        sessionName: options.name,
        autoApprove: options.yes,
      });
    }
  });

// --- Server (Web UI + Agent Daemon + API) ---
program
  .command("server")
  .alias("app")
  .alias("ui")
  .description("Start Kai server — web UI, agent daemon, and API")
  .option("--port <port>", "Port to listen on", "3141")
  .option("--no-ui", "Disable web UI (API + agents only)")
  .option("--no-agents", "Disable agent daemon (UI + API only)")
  .action(async (options) => {
    const { startServer } = await import("./web/server.js");
    await startServer({
      port: parseInt(options.port),
      ui: options.ui,
      agents: options.agents,
    });
  });

// --- Agent commands ---
const agent = program.command("agent").description("Manage background agents");

agent
  .command("create <name> <workflow-file>")
  .description("Create a new agent from a workflow YAML file")
  .option("-s, --schedule <cron>", "Cron schedule (e.g. '0 */6 * * *')")
  .option("--config <json>", "JSON config overrides")
  .action(async (name, workflowFile, options) => {
    const { createAgent } = await import("./agents/manager.js");
    try {
      const config = options.config ? JSON.parse(options.config) : undefined;
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
    const { formatAgentList, daemonStatus } = await import("./agents/manager.js");
    console.log(daemonStatus());
    console.log(formatAgentList());
  });

agent
  .command("output <agent-id> [step]")
  .description("Show the output from an agent's latest run")
  .action(async (agentId, step) => {
    const { formatAgentOutput } = await import("./agents/manager.js");
    console.log(formatAgentOutput(agentId, step));
  });

agent
  .command("info <agent-id>")
  .description("Show detailed info about an agent")
  .action(async (agentId) => {
    const { formatAgentDetail } = await import("./agents/manager.js");
    console.log(formatAgentDetail(agentId));
  });

agent
  .command("run <agent-id>")
  .description("Run an agent immediately")
  .action(async (agentId) => {
    const { runAgentCommand } = await import("./agents/manager.js");
    await runAgentCommand(agentId);
  });

agent
  .command("delete <agent-id>")
  .description("Delete an agent and its history")
  .action(async (agentId) => {
    const { deleteAgent } = await import("./agents/db.js");
    deleteAgent(agentId);
    console.log(`✓ Agent "${agentId}" deleted`);
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

// --- YouTube commands ---
const yt = program.command("yt").description("YouTube content pipeline");

yt
  .command("idea <text...>")
  .description("Submit a video idea for expansion and analysis")
  .action(async (textParts: string[]) => {
    const idea = textParts.join(" ");
    const fs = await import("fs");
    const path = await import("path");
    const home = process.env.HOME || "~";
    const outputDir = path.join(home, ".kai/youtube/productions", `idea-${Date.now()}`);
    fs.mkdirSync(outputDir, { recursive: true });

    // Write the inbox workflow config override
    const config = {
      mode: "idea",
      input: idea,
      output_dir: outputDir,
    };

    console.log(`\n  💡 Processing idea: "${idea}"\n`);
    console.log(`  Output: ${outputDir}\n`);

    // Run the inbox workflow directly
    const { registerAllIntegrations } = await import("./agents/integrations/index.js");
    const { parseWorkflow, executeWorkflow } = await import("./agents/workflow.js");
    await registerAllIntegrations();

    const workflowPath = path.join(home, ".kai/workflows/yt-inbox.yaml");
    if (!fs.existsSync(workflowPath)) {
      console.error("  Error: yt-inbox.yaml workflow not found. Run: kai agent create yt-inbox ~/.kai/workflows/yt-inbox.yaml");
      process.exit(1);
    }

    const workflow = parseWorkflow(workflowPath);
    const result = await executeWorkflow(workflow, "yt-inbox", config, (step, status) => {
      console.log(`    ${step}: ${status}`);
    });

    if (result.success) {
      console.log("\n  ✓ Idea processed! Check output:\n");
      console.log(`    ${outputDir}/output.json`);
      if (result.results.thumbnail) {
        console.log(`    Thumbnail: ${JSON.stringify(result.results.thumbnail)}`);
      }
    } else {
      console.log(`\n  ✗ Failed: ${result.error}`);
    }
  });

yt
  .command("process <file>")
  .description("Process an SRT/transcript file into a full production package")
  .action(async (file: string) => {
    const fs = await import("fs");
    const path = await import("path");
    const home = process.env.HOME || "~";

    // Resolve file path
    const filePath = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
    if (!fs.existsSync(filePath)) {
      console.error(`  Error: File not found: ${filePath}`);
      process.exit(1);
    }

    const transcript = fs.readFileSync(filePath, "utf-8");
    const slug = path.basename(file, path.extname(file)).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const outputDir = path.join(home, `.kai/youtube/productions/${slug}-${Date.now()}`);
    fs.mkdirSync(outputDir, { recursive: true });

    const config = {
      mode: "transcript",
      input: transcript,
      output_dir: outputDir,
    };

    console.log(`\n  🎬 Processing transcript: ${path.basename(file)}\n`);
    console.log(`  Output: ${outputDir}\n`);

    const { registerAllIntegrations } = await import("./agents/integrations/index.js");
    const { parseWorkflow, executeWorkflow } = await import("./agents/workflow.js");
    await registerAllIntegrations();

    const workflowPath = path.join(home, ".kai/workflows/yt-inbox.yaml");
    if (!fs.existsSync(workflowPath)) {
      console.error("  Error: yt-inbox.yaml workflow not found.");
      process.exit(1);
    }

    const workflow = parseWorkflow(workflowPath);
    const result = await executeWorkflow(workflow, "yt-inbox", config, (step, status) => {
      console.log(`    ${step}: ${status}`);
    });

    if (result.success) {
      console.log("\n  ✓ Transcript processed! Check output:\n");
      console.log(`    ${outputDir}/output.json`);
      console.log("\n  Includes: clean script, edit guide, titles, SEO, shorts clips, thumbnail\n");
    } else {
      console.log(`\n  ✗ Failed: ${result.error}`);
    }
  });

yt
  .command("produce [idea]")
  .description("Trigger the Producer — optionally specify an idea to produce")
  .action(async (idea?: string) => {
    const fs = await import("fs");
    const path = await import("path");
    const home = process.env.HOME || "~";

    // If an idea is specified, write it to manual-produce.json
    if (idea) {
      const manualPath = path.join(home, ".kai/youtube/data/manual-produce.json");
      const dir = path.dirname(manualPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(manualPath, JSON.stringify({
        idea,
        submitted_at: new Date().toISOString(),
      }, null, 2), "utf-8");
      console.log(`\n  Queued manual idea: "${idea}"\n`);
    }

    console.log("  Running Producer agent...\n");

    const { registerAllIntegrations } = await import("./agents/integrations/index.js");
    const { parseWorkflow, executeWorkflow } = await import("./agents/workflow.js");
    await registerAllIntegrations();

    const workflowPath = path.join(home, ".kai/workflows/yt-producer.yaml");
    if (!fs.existsSync(workflowPath)) {
      console.error("  Error: yt-producer.yaml not found.");
      process.exit(1);
    }

    const workflow = parseWorkflow(workflowPath);
    const result = await executeWorkflow(workflow, "yt-producer", {}, (step, status) => {
      console.log(`    ${step}: ${status}`);
    });

    if (result.success) {
      console.log("\n  ✓ Production package ready!\n");
      console.log(`    ~/.kai/youtube/productions/latest.json`);
    } else {
      console.log(`\n  ✗ Failed: ${result.error}`);
    }
  });

yt
  .command("board")
  .description("Show the current content board")
  .action(async () => {
    const fs = await import("fs");
    const path = await import("path");
    const chalk = (await import("chalk")).default;
    const home = process.env.HOME || "~";
    const boardPath = path.join(home, ".kai/youtube/data/content-board.json");

    if (!fs.existsSync(boardPath)) {
      console.log(chalk.dim("  No content board yet. Run the strategist agent first."));
      return;
    }

    const board = JSON.parse(fs.readFileSync(boardPath, "utf-8"));
    console.log(chalk.bold("\n  📋 Content Board\n"));
    if (board.week_summary) {
      console.log(chalk.dim(`  ${board.week_summary}\n`));
    }
    if (board.updated_at) {
      console.log(chalk.dim(`  Updated: ${board.updated_at}\n`));
    }

    if (board.this_week_picks) {
      console.log(chalk.bold.cyan("  This Week's Picks:"));
      if (board.this_week_picks.long_form?.length) {
        console.log(chalk.bold("    Long-form:"), board.this_week_picks.long_form.join(", "));
      }
      if (board.this_week_picks.short_form?.length) {
        console.log(chalk.bold("    Short-form:"), board.this_week_picks.short_form.join(", "));
      }
      console.log("");
    }

    const ideas = board.ideas || [];
    for (const idea of ideas) {
      const typeIcon = idea.type === "long" ? "🎬" : "⚡";
      const urgencyBar = "█".repeat(Math.min(idea.urgency || 0, 10)) + "░".repeat(10 - Math.min(idea.urgency || 0, 10));
      console.log(`  ${typeIcon} #${idea.rank || "?"} ${chalk.bold(idea.title_options?.[0] || idea.id)}`);
      console.log(chalk.dim(`     ${idea.type} | ${idea.difficulty || "?"} | ~${idea.estimated_views || "?"} views | urgency: ${urgencyBar}`));
      if (idea.hook) console.log(chalk.dim(`     Hook: ${idea.hook.substring(0, 80)}`));
      console.log("");
    }
  });

yt
  .command("status")
  .description("Show YouTube pipeline status")
  .action(async () => {
    const fs = await import("fs");
    const path = await import("path");
    const chalk = (await import("chalk")).default;
    const home = process.env.HOME || "~";

    console.log(chalk.bold("\n  📊 YouTube Pipeline Status\n"));

    // Intel feed
    const intelPath = path.join(home, ".kai/youtube/data/intel.json");
    if (fs.existsSync(intelPath)) {
      const intel = JSON.parse(fs.readFileSync(intelPath, "utf-8"));
      const entries = Array.isArray(intel) ? intel : [];
      const latest = entries[entries.length - 1];
      console.log(chalk.bold("  Scout Intel:"));
      console.log(chalk.dim(`    ${entries.length} entries collected`));
      if (latest?._timestamp) console.log(chalk.dim(`    Last update: ${latest._timestamp}`));
    } else {
      console.log(chalk.dim("  Scout Intel: no data yet"));
    }
    console.log("");

    // Content board
    const boardPath = path.join(home, ".kai/youtube/data/content-board.json");
    if (fs.existsSync(boardPath)) {
      const board = JSON.parse(fs.readFileSync(boardPath, "utf-8"));
      const ideas = board.ideas || [];
      console.log(chalk.bold("  Content Board:"));
      console.log(chalk.dim(`    ${ideas.filter((i: any) => i.type === "long").length} long-form ideas`));
      console.log(chalk.dim(`    ${ideas.filter((i: any) => i.type === "short").length} short-form ideas`));
      if (board.updated_at) console.log(chalk.dim(`    Last update: ${board.updated_at}`));
    } else {
      console.log(chalk.dim("  Content Board: not created yet"));
    }
    console.log("");

    // Idea backlog
    const backlogPath = path.join(home, ".kai/youtube/data/idea-backlog.json");
    if (fs.existsSync(backlogPath)) {
      const backlog = JSON.parse(fs.readFileSync(backlogPath, "utf-8"));
      const count = Array.isArray(backlog) ? backlog.length : 0;
      console.log(chalk.bold("  Idea Backlog:"));
      console.log(chalk.dim(`    ${count} pending ideas`));
    } else {
      console.log(chalk.dim("  Idea Backlog: empty"));
    }
    console.log("");

    // Productions
    const prodDir = path.join(home, ".kai/youtube/productions");
    if (fs.existsSync(prodDir)) {
      const prods = fs.readdirSync(prodDir).filter((f: string) => !f.startsWith("."));
      console.log(chalk.bold("  Productions:"));
      console.log(chalk.dim(`    ${prods.length} packages created`));
      for (const p of prods.slice(-3)) {
        console.log(chalk.dim(`    - ${p}`));
      }
    }
    console.log("");
  });

// Graceful shutdown of MCP servers on exit
process.on("exit", () => { shutdownMcpServers(); });
process.on("SIGINT", () => { shutdownMcpServers(); process.exit(0); });

program.parse();

async function runOneShot(prompt: string, autoApprove = false): Promise<void> {
  if (autoApprove) {
    const { setPermissionMode } = await import("./permissions.js");
    setPermissionMode("auto");
  }

  const client = createClient();

  let systemContent = getSystemPrompt(getCwd());
  const profileCtx = getProfileContext();
  if (profileCtx) systemContent += `\n\n${profileCtx}`;
  const archivalCtx = archivalList(10);
  if (archivalCtx && !archivalCtx.startsWith("No archival")) {
    systemContent += `\n\n# Archival Knowledge\n${archivalCtx}`;
  }
  const git = gitInfo();
  if (git) systemContent += `\n\n# Git\n${git}`;

  const messages = [
    { role: "system" as const, content: systemContent },
    { role: "user" as const, content: prompt },
  ];

  try {
    await chat(client, messages, (token) => {
      process.stdout.write(token);
    });
    process.stdout.write("\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}
