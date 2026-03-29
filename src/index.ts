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

// Load .env — try project root first, then script dir
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env"), quiet: true });
config({ path: resolve(process.cwd(), ".env"), quiet: true });

const program = new Command();

program
  .name("kai")
  .description("AI coding assistant powered by Kimi K2.5 via Together.ai")
  .version("1.0.0")
  .argument("[prompt]", "One-shot prompt (runs and exits)")
  .option("-p, --print <prompt>", "Run a one-shot prompt and print result")
  .option("-c, --continue", "Continue most recent session")
  .option("-r, --resume <id>", "Resume a specific session by ID")
  .option("-n, --name <name>", "Name for the session")
  .option("-y, --yes", "Auto-approve all tool calls")
  .action(async (promptArg, options) => {
    const oneShot = options.print || promptArg;

    // Check for piped input
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
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
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
