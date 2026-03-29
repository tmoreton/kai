#!/usr/bin/env node

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Command } from "commander";
import { createClient, chat } from "./client.js";
import { getSystemPrompt } from "./system-prompt.js";
import { startRepl } from "./repl.js";
import { getCwd } from "./tools/bash.js";
import { getKaiMdContent } from "./config.js";
import { getMemoryContext } from "./memory.js";
import { gitInfo } from "./git.js";

// Load .env from all possible locations — override existing env vars
// so ~/.kai/.env always takes precedence over stale shell exports
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(process.env.HOME || "~", ".kai/.env"), override: true, quiet: true });
config({ path: resolve(__dirname, "../.env"), quiet: true });
config({ path: resolve(process.cwd(), ".env"), quiet: true });

const program = new Command();

program
  .name("kai")
  .description("AI agent platform powered by Kimi K2.5 via Together.ai")
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
    process.on("SIGINT", () => {
      const { stopDaemon, closeDb } = require("./agents/daemon.js");
      const { getDaemonPidPath } = require("./agents/daemon.js");
      stopDaemon();
      try { require("fs").unlinkSync(getDaemonPidPath()); } catch {}
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

program.parse();

async function runOneShot(prompt: string, autoApprove = false): Promise<void> {
  if (autoApprove) {
    const { setPermissionMode } = await import("./permissions.js");
    setPermissionMode("auto");
  }

  const client = createClient();

  let systemContent = getSystemPrompt(getCwd());
  const kaiMd = getKaiMdContent();
  if (kaiMd) systemContent += `\n\n# Project Context (KAI.md)\n${kaiMd}`;
  const memoryCtx = getMemoryContext();
  if (memoryCtx) systemContent += `\n${memoryCtx}`;
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
