#!/usr/bin/env node

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Command } from "commander";
import chalk from "chalk";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { createClient, chat } from "./client.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { startRepl } from "./repl.js";
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
  .description("AI coding assistant with persistent memory, background agents, and tool use")
  .version("1.0.0");

// --- Default: Interactive REPL or one-shot ---
program
  .argument("[prompt]", "One-shot prompt (runs and exits)")
  .option("-p, --print <prompt>", "Run a one-shot prompt and print result")
  .option("-k, --keep-alive", "Keep session alive after one-shot for follow-up questions")
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
      // -p/--print: true one-shot (run and exit)
      // Positional arg or piped input: run then continue into REPL
      if (options.print && !pipedInput) {
        await runOneShot(prompt, options.yes);
      } else {
        await runOneShotAndContinue(prompt, {
          continueSession: options.continue,
          resumeSessionId: options.resume,
          sessionName: options.name,
          autoApprove: options.yes,
        });
      }
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
  .command("start")
  .alias("server")
  .alias("app")
  .alias("ui")
  .description("Build and start Kai — web UI, agent daemon, and API")
  .option("--port <port>", "Port to listen on", "3141")
  .option("--no-ui", "Disable web UI (API + agents only)")
  .option("--no-agents", "Disable agent daemon (UI + API only)")
  .option("--skip-build", "Skip rebuild step")
  .action(async (options) => {
    if (!options.skipBuild) {
      const { execSync } = await import("child_process");
      const projectRoot = new URL("../", import.meta.url).pathname;
      console.log("  Building...");
      execSync("npm run build", { cwd: projectRoot, stdio: "inherit" });
    }
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

// --- Model commands ---
const model = program.command("model").description("Manage default model");

model
  .command("list")
  .description("List available models")
  .action(async () => {
    const chalk = (await import("chalk")).default;
    const { OPENROUTER_PROVIDER } = await import("./providers/index.js");
    
    console.log(chalk.bold("\n  Available Models\n"));
    console.log(`  ${chalk.green("●")} ${OPENROUTER_PROVIDER.defaultModel} ${chalk.dim("(default)")}`);
    console.log(`  ${chalk.dim("○")} ${OPENROUTER_PROVIDER.fallbackModel} ${chalk.dim("(fallback)")}`);
    console.log(`  ${chalk.dim("○")} ${OPENROUTER_PROVIDER.imageModel} ${chalk.dim("(image generation)")}`);
    console.log(chalk.dim("\n  Use 'kai model set <model-id>' to change the default\n"));
  });

model
  .command("set <model-id>")
  .description("Set the default model")
  .action(async (modelId) => {
    const chalk = (await import("chalk")).default;
    const fs = await import("fs");
    const path = await import("path");
    const { ensureKaiDir } = await import("./config.js");
    
    const configPath = path.resolve(ensureKaiDir(), "settings.json");
    let config = {};
    
    try {
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      }
    } catch {
      // Start fresh if invalid
    }
    
    (config as any).model = modelId;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    
    console.log(chalk.green(`  ✓ Default model set to: ${modelId}`));
    console.log(chalk.dim("  This will be used for all future sessions.\n"));
  });

model
  .command("show")
  .alias("get")
  .description("Show current default model")
  .action(async () => {
    const chalk = (await import("chalk")).default;
    const { getConfig } = await import("./config.js");
    const { OPENROUTER_PROVIDER } = await import("./providers/index.js");
    
    const config = getConfig();
    const currentModel = config.model || process.env.MODEL_ID || OPENROUTER_PROVIDER.defaultModel;
    
    console.log(chalk.bold("\n  Current Model\n"));
    console.log(`  ${chalk.green("●")} ${currentModel}`);
    
    if (config.model) {
      console.log(chalk.dim("    (from ~/.kai/settings.json)"));
    } else if (process.env.MODEL_ID) {
      console.log(chalk.dim("    (from MODEL_ID environment variable)"));
    } else {
      console.log(chalk.dim("    (built-in default)"));
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
process.on("exit", () => { shutdownMcpServers(); });
process.on("SIGINT", () => { shutdownMcpServers(); process.exit(0); });

program.parse();

async function runOneShot(prompt: string, autoApprove = false): Promise<void> {
  if (autoApprove) {
    const { setPermissionMode } = await import("./permissions.js");
    setPermissionMode("auto");
  }

  const client = createClient();

  const messages = [
    { role: "system" as const, content: buildSystemPrompt() },
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

interface ReplOptions {
  continueSession?: boolean;
  resumeSessionId?: string;
  sessionName?: string;
  autoApprove?: boolean;
}

async function runOneShotAndContinue(prompt: string, options: ReplOptions): Promise<void> {
  if (options.autoApprove) {
    const { setPermissionMode } = await import("./permissions.js");
    setPermissionMode("auto");
  }

  const client = createClient();

  const messages: ChatCompletionMessageParam[] = [
    { role: "system" as const, content: buildSystemPrompt() },
    { role: "user" as const, content: prompt },
  ];

  try {
    await chat(client, messages, (token) => {
      process.stdout.write(token);
    });
    process.stdout.write("\n\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }

  // Save the conversation and continue into REPL
  const { getCwd } = await import("./tools/bash.js");
  const { generateSessionId, saveSession } = await import("./sessions.js");

  const session = {
    id: generateSessionId(),
    name: options.sessionName,
    cwd: getCwd(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages,
  };

  saveSession(session);

  console.log(chalk.dim(`  Session saved: ${session.name || session.id}\n`));
  console.log(chalk.dim("  Continuing session — type your next question or /help for commands\n\n"));

  // Continue into REPL with the existing messages
  await startRepl({
    continueSession: false,
    resumeSessionId: undefined,
    sessionName: options.sessionName,
    autoApprove: options.autoApprove,
  }, messages);
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}
