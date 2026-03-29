import * as readline from "readline";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import chalk from "chalk";
import { createClient, chat } from "./client.js";
import { getSystemPrompt } from "./system-prompt.js";
import { getCwd } from "./tools/bash.js";
import { formatCost, estimateContextSize } from "./context.js";
import { getKaiMdContent } from "./config.js";
import { getMemoryContext } from "./memory.js";
import { gitInfo } from "./git.js";
import { getTasksForDisplay } from "./tools/tasks.js";
import {
  generateSessionId,
  saveSession,
  loadSession,
  getMostRecentSession,
  listSessions,
  formatSessionList,
  type Session,
} from "./sessions.js";
import {
  setPermissionMode,
  getPermissionMode,
} from "./permissions.js";
import { compactMessages } from "./context.js";

export interface ReplOptions {
  continueSession?: boolean;
  resumeSessionId?: string;
  sessionName?: string;
  autoApprove?: boolean;
}

export async function startRepl(options: ReplOptions = {}): Promise<void> {
  const client = createClient();

  // Build system prompt with context
  let systemContent = getSystemPrompt(getCwd());
  const kaiMd = getKaiMdContent();
  if (kaiMd) systemContent += `\n\n# Project Context (KAI.md)\n${kaiMd}`;
  const memoryCtx = getMemoryContext();
  if (memoryCtx) systemContent += `\n${memoryCtx}`;
  const git = gitInfo();
  if (git) systemContent += `\n\n# Git\n${git}`;

  let messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
  ];

  let session: Session;

  if (options.continueSession) {
    const recent = getMostRecentSession();
    if (recent) {
      messages = recent.messages;
      session = recent;
      console.log(chalk.dim(`\n  Resumed session: ${session.name || session.id}\n`));
    } else {
      session = createNewSession(options, messages);
    }
  } else if (options.resumeSessionId) {
    const loaded = loadSession(options.resumeSessionId);
    if (loaded) {
      messages = loaded.messages;
      session = loaded;
      console.log(chalk.dim(`\n  Resumed session: ${session.name || session.id}\n`));
    } else {
      console.log(chalk.yellow(`  Session not found. Starting new.\n`));
      session = createNewSession(options, messages);
    }
  } else {
    session = createNewSession(options, messages);
  }

  if (options.autoApprove) {
    setPermissionMode("auto");
  }

  // Welcome banner
  console.log(
    chalk.bold.cyan("\n  ⚡ Kai") +
      chalk.dim(" — AI coding assistant powered by Kimi K2.5\n")
  );
  console.log(chalk.dim(`  Working directory: ${getCwd()}`));
  if (git) console.log(chalk.dim(`  ${git}`));
  console.log(chalk.dim(`  Session: ${session.name || session.id}`));
  console.log(chalk.dim(`  Permission mode: ${getPermissionMode()}`));
  console.log(chalk.dim(`  Type /help for commands, "exit" to quit.\n`));

  // Use a simple line-by-line approach with a processing flag
  let processing = false;
  const inputQueue: string[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.bold.cyan("kai › "),
    terminal: true,
  });

  async function processInput(input: string) {
    processing = true;

    // Handle slash commands
    if (input.startsWith("/") || input === "exit") {
      const result = handleCommand(input, messages, session);
      if (result === "exit") {
        rl.close();
        process.exit(0);
      }
      if (result === "handled") {
        processing = false;
        rl.prompt();
        return;
      }
    }

    // Send to model
    messages.push({ role: "user", content: input });

    try {
      process.stdout.write("\n");

      const updatedMessages = await chat(client, messages, (token) => {
        process.stdout.write(token);
      });

      messages.length = 0;
      messages.push(...updatedMessages);

      process.stdout.write("\n");

      const taskDisplay = getTasksForDisplay();
      if (taskDisplay) console.log(taskDisplay + "\n");

      session.messages = messages;
      saveSession(session);
    } catch (err: any) {
      console.error(chalk.red(`\n  Error: ${err.message}\n`));
      if (err.message?.includes("401")) {
        console.error(chalk.yellow("  Check your TOGETHER_API_KEY in .env\n"));
      }
    }

    processing = false;

    // Process queued input
    if (inputQueue.length > 0) {
      const next = inputQueue.shift()!;
      await processInput(next);
    } else {
      rl.prompt();
    }
  }

  rl.on("line", (line) => {
    const input = line.trim();
    if (!input) {
      if (!processing) rl.prompt();
      return;
    }

    if (processing) {
      inputQueue.push(input);
    } else {
      processInput(input);
    }
  });

  rl.on("SIGINT", () => {
    if (processing) {
      console.log(chalk.dim("\n  Interrupted.\n"));
      processing = false;
      rl.prompt();
    } else {
      session.messages = messages;
      saveSession(session);
      console.log(chalk.dim("\n  Session saved. Goodbye!\n"));
      process.exit(0);
    }
  });

  rl.on("close", () => {
    session.messages = messages;
    saveSession(session);
    process.exit(0);
  });

  rl.prompt();
}

function createNewSession(
  options: ReplOptions,
  messages: ChatCompletionMessageParam[]
): Session {
  return {
    id: generateSessionId(),
    name: options.sessionName,
    cwd: getCwd(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages,
  };
}

function handleCommand(
  input: string,
  messages: ChatCompletionMessageParam[],
  session: Session
): "exit" | "handled" | "passthrough" {
  const cmd = input.toLowerCase();

  if (cmd === "exit" || cmd === "/exit" || cmd === "/quit") {
    session.messages = messages;
    saveSession(session);
    console.log(chalk.dim("\n  Session saved. Goodbye!\n"));
    return "exit";
  }

  if (cmd === "/clear") {
    const systemMsg = messages[0];
    messages.length = 0;
    messages.push(systemMsg);
    console.log(chalk.dim("  Conversation cleared.\n"));
    return "handled";
  }

  if (cmd === "/compact") {
    const before = estimateContextSize(messages);
    const compacted = compactMessages(messages);
    messages.length = 0;
    messages.push(...compacted);
    const after = estimateContextSize(messages);
    console.log(
      chalk.dim(`  Compacted: ~${before.toLocaleString()} → ~${after.toLocaleString()} tokens\n`)
    );
    return "handled";
  }

  if (cmd === "/cost") {
    console.log("\n" + formatCost() + "\n");
    return "handled";
  }

  if (cmd === "/sessions") {
    const sessions = listSessions();
    console.log(chalk.bold("\n  Recent sessions:\n"));
    console.log(formatSessionList(sessions) + "\n");
    return "handled";
  }

  if (cmd.startsWith("/rename ")) {
    session.name = input.substring(8).trim();
    saveSession(session);
    console.log(chalk.dim(`  Session renamed to: ${session.name}\n`));
    return "handled";
  }

  if (cmd === "/permissions") {
    const mode = getPermissionMode();
    console.log(chalk.dim(`  Current mode: ${mode}`));
    console.log(chalk.dim("  Options: default, auto, deny_all"));
    console.log(chalk.dim("  Usage: /permissions auto\n"));
    return "handled";
  }

  if (cmd.startsWith("/permissions ")) {
    const mode = input.substring(13).trim() as any;
    if (["default", "auto", "deny_all"].includes(mode)) {
      setPermissionMode(mode);
      console.log(chalk.dim(`  Permission mode set to: ${mode}\n`));
    } else {
      console.log(chalk.yellow("  Invalid mode. Use: default, auto, deny_all\n"));
    }
    return "handled";
  }

  if (cmd === "/git") {
    const info = gitInfo();
    console.log(chalk.dim(info ? `  ${info}` : "  Not a git repo.") + "\n");
    return "handled";
  }

  if (cmd === "/help") {
    console.log(
      chalk.dim(`
  Commands:
    /clear         Clear conversation history
    /compact       Compress context to save tokens
    /cost          Show token usage and estimated cost
    /sessions      List recent sessions
    /rename <name> Rename current session
    /permissions   View/set permission mode (default, auto, deny_all)
    /git           Show git status
    /help          Show this help
    /exit          Exit Kai

  Tools available to the AI:
    bash, read_file, write_file, edit_file, glob, grep,
    web_fetch, web_search, task_create, task_update, task_list,
    save_memory, list_memories, spawn_agent

  Subagents: explorer, planner, worker
`)
    );
    return "handled";
  }

  return "passthrough";
}
