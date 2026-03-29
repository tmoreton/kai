import * as readline from "readline";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import chalk from "chalk";
import { createClient, chat } from "./client.js";
import { getSystemPrompt } from "./system-prompt.js";
import { getCwd } from "./tools/bash.js";
import { formatCost, estimateContextSize, formatContextBreakdown } from "./context.js";
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
import { appendRecall, getRecallStats, type RecallEntry } from "./recall.js";
import { loadSoul } from "./soul.js";
import { listCronJobs, cleanupCrons } from "./cron.js";
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
      // Refresh system prompt to pick up any changes
      if (messages.length > 0 && messages[0].role === "system") {
        messages[0] = { role: "system", content: systemContent };
      }
      session = recent;
      console.log(chalk.dim(`\n  Resumed session: ${session.name || session.id}\n`));
    } else {
      session = createNewSession(options, messages);
    }
  } else if (options.resumeSessionId) {
    const loaded = loadSession(options.resumeSessionId);
    if (loaded) {
      messages = loaded.messages;
      if (messages.length > 0 && messages[0].role === "system") {
        messages[0] = { role: "system", content: systemContent };
      }
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
  console.log(chalk.dim(`  cwd:         ${getCwd()}`));
  if (git) console.log(chalk.dim(`  git:         ${git}`));
  console.log(chalk.dim(`  session:     ${session.name || session.id}`));
  console.log(chalk.dim(`  permissions: ${getPermissionMode()}`));
  console.log("");
  console.log(chalk.dim("  Tips:"));
  console.log(chalk.dim("    • Ask me to build, debug, or refactor code"));
  console.log(chalk.dim("    • I can read/write files, run commands, and search the web"));
  console.log(chalk.dim("    • Run " + chalk.cyan("kai") + " from any project directory to work in that folder"));
  console.log(chalk.dim("    • Type /help for all commands\n"));

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

      // Save to recall memory for future session search
      const newRecalls: RecallEntry[] = [];
      newRecalls.push({
        sessionId: session.id,
        timestamp: new Date().toISOString(),
        role: "user",
        content: input,
      });
      const lastAssistant = updatedMessages[updatedMessages.length - 1];
      if (lastAssistant?.role === "assistant" && typeof lastAssistant.content === "string") {
        newRecalls.push({
          sessionId: session.id,
          timestamp: new Date().toISOString(),
          role: "assistant",
          content: lastAssistant.content,
        });
      }
      appendRecall(newRecalls);

      session.messages = messages;
      saveSession(session);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`\n  Error: ${msg}\n`));
      if (msg.includes("401")) {
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
      cleanupCrons();
      session.messages = messages;
      saveSession(session);
      console.log(chalk.dim("\n  Session saved. Goodbye!\n"));
      process.exit(0);
    }
  });

  rl.on("close", () => {
    cleanupCrons();
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

  if (cmd === "/soul") {
    const soul = loadSoul();
    console.log(chalk.bold("\n  Soul (Core Memory):\n"));
    for (const [key, block] of Object.entries(soul)) {
      console.log(chalk.cyan(`  [${key}]`));
      console.log(chalk.dim(`  ${block.content}\n`));
    }
    return "handled";
  }

  if (cmd === "/crons") {
    const jobs = listCronJobs();
    console.log(chalk.bold("\n  Scheduled Jobs:\n"));
    console.log(chalk.dim(jobs) + "\n");
    return "handled";
  }

  if (cmd === "/recall") {
    const stats = getRecallStats();
    console.log(chalk.dim(`  Recall memory: ${stats.totalEntries} entries (${stats.fileSizeKB} KB)\n`));
    return "handled";
  }

  if (cmd === "/context") {
    console.log(formatContextBreakdown(messages));
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
    /permissions   View/set permission mode
    /soul          View core memory (persona, human, goals, scratchpad)
    /crons         List scheduled background jobs
    /recall        Show recall memory stats
    /context       Show context window breakdown (where tokens go)
    /git           Show git status
    /help          Show this help
    /exit          Exit Kai

  AI Tools (22):
    Files:    bash, read_file, write_file, edit_file, glob, grep
    Web:      web_fetch, web_search
    Memory:   core_memory_read/update, recall_search,
              archival_insert/search, save_memory, list_memories
    Tasks:    task_create, task_update, task_list
    Schedule: cron_create, cron_list, cron_delete
    Agents:   spawn_agent (explorer, planner, worker)
`)
    );
    return "handled";
  }

  return "passthrough";
}
