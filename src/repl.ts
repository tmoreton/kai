import * as readline from "readline";
import { Writable } from "stream";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import chalk from "chalk";
import { createClient, chat, signalUserTyping } from "./client.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { getCwd, cleanupBackgroundProcesses } from "./tools/bash.js";
import { estimateContextSize, compactMessages } from "./context.js";
import { gitInfo, isGitRepo } from "./git.js";

import {
  generateSessionId,
  saveSession,
  saveSessionSync,
  loadSession,
  getMostRecentSession,
  cleanupSessions,
  autoCompact,
  formatSessionList,
  listSessions,
  type Session,
} from "./sessions/manager.js";
import { appendRecall, type RecallEntry } from "./recall.js";
import fs from "fs";
import path from "path";
import { setPermissionMode, getPermissionMode } from "./permissions.js";
import { getCurrentProject } from "./project.js";
import { renderMarkdown } from "./render.js";
import {
  loadCustomCommands,
  findCustomCommand,
  resolveCommand,
} from "./commands.js";
import { isPlanMode } from "./plan-mode.js";
import { autoRoute, applyRoute } from "./auto-route.js";
import { recordError, installGlobalErrorHandlers } from "./error-tracker.js";
import { resolveFilePath, expandHome } from "./utils.js";
import { bootstrapBuiltinAgents } from "./agents-core/bootstrap.js";
import { SLASH_COMMANDS, handleCommand } from "./repl-commands.js";
import { startSpinner, stopSpinner, renderToolCard, renderAssistantMarker, clearLine, COLOR_THEME, MarkdownStreamBuffer } from "./render/stream.js";
import { recordUsage, migrateUsageFromJson } from "./usage.js";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
const MIME_MAP: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
};

function readImageAsDataUrl(filePath: string): { dataUrl: string; sizeKB: number } | { error: string } {
  const resolved = resolveFilePath(expandHome(filePath));
  if (!fs.existsSync(resolved)) return { error: `Image not found: ${resolved}` };
  const ext = path.extname(resolved).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) return { error: `Unsupported format: ${ext}` };
  const stat = fs.statSync(resolved);
  if (stat.size > 20 * 1024 * 1024) return { error: "Image too large (max 20MB)" };
  const base64 = fs.readFileSync(resolved).toString("base64");
  return { dataUrl: `data:${MIME_MAP[ext] || "image/png"};base64,${base64}`, sizeKB: Math.round(stat.size / 1024) };
}

function printGoodbye(sessionId: string): void {
  console.log(chalk.dim("\n  Session saved. Goodbye!\n"));
  console.log(chalk.dim("  Resume this session:"));
  console.log(chalk.dim("  kai "));
  console.log(chalk.cyan(`  --resume ${sessionId}\n`));
}

export interface ReplOptions {
  continueSession?: boolean;
  resumeSessionId?: string;
  sessionName?: string;
  autoApprove?: boolean;
  unleash?: boolean;
}

export async function startRepl(options: ReplOptions = {}, initialPrompt?: string): Promise<void> {
  // Install global error handlers for crash tracking
  installGlobalErrorHandlers();

  // Prune old sessions in background (non-blocking startup)
  setTimeout(() => {
    try {
      const pruned = cleanupSessions(30);
      if (pruned > 0) {
        process.stderr.write(chalk.dim(`  Cleaned up ${pruned} old session(s).\n`));
      }
    } catch {}
  }, 5000);

  // Install built-in agents on first run (e.g. nightly backup)
  const bootstrapped = bootstrapBuiltinAgents();
  if (bootstrapped > 0) {
    console.log(chalk.dim(`  Installed ${bootstrapped} built-in agent(s). Run /agent to see them.\n`));
  }

  // Migrate legacy usage.json to SQLite (one-time, silent)
  setTimeout(() => {
    try {
      const migrated = migrateUsageFromJson();
      if (migrated.imported > 0) {
        console.log(chalk.dim(`  Migrated ${migrated.imported} usage records to database.\n`));
      }
    } catch {}
  }, 100);

  const client = createClient();

  let messages: ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt() },
  ];

  let session: Session;

  if (options.continueSession) {
    const recent = getMostRecentSession();
    if (recent) {
      messages = recent.messages;
      // Refresh system prompt to pick up any changes
      if (messages.length > 0 && messages[0].role === "system") {
        messages[0] = { role: "system", content: buildSystemPrompt() };
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
        messages[0] = { role: "system", content: buildSystemPrompt() };
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
      chalk.dim(` — AI coding assistant\n`)
  );
  const project = getCurrentProject();
  const { getConfig: getKaiConfig } = await import("./config.js");
  const kaiConfig = getKaiConfig();

  console.log(chalk.dim(`  cwd:         ${getCwd()}`));
  if (project) {
    console.log(chalk.dim(`  project:     ${project.name}`));
  } else {
    console.log(chalk.dim(`  project:     (desktop mode — no project detected)`));
  }
  const gitSummary = gitInfo();
  if (gitSummary) console.log(chalk.dim(`  git:         ${gitSummary}`));
  console.log(chalk.dim(`  session:     ${session.name || session.id}`));
  console.log(chalk.dim(`  permissions: ${getPermissionMode()}`));
  // Show MCP server count if any are configured
  try {
    const { getMcpToolDefinitions } = await import("./tools/index.js");
    const mcpTools = getMcpToolDefinitions();
    if (mcpTools.length > 0) {
      const serverNames = new Set(mcpTools.map((t: any) => t.function?.name?.split("__")[1]).filter(Boolean));
      console.log(chalk.dim(`  mcp:         ${serverNames.size} server${serverNames.size !== 1 ? "s" : ""} (${mcpTools.length} tools)`));
    }
  } catch {}
  console.log("");

  console.log(chalk.dim("  Tips: Ask me to build/debug/refactor • Type /help for commands\n"));

  // Startup warnings
  if (!process.env.TAVILY_API_KEY) {
    console.log(chalk.yellow("  ! TAVILY_API_KEY not set — web_search will not work."));
    console.log(chalk.dim("    Set it in ~/.kai/.env or your environment.\n"));
  }

  // Use a simple line-by-line approach with a processing flag
  let processing = false;
  let chatAbort: AbortController | null = null;
  const inputQueue: string[] = [];
  let typingBuffer = "";
  let inputBoxActive = false;

  // Show status line at bottom - simple stderr write
  function showInputBox() {
    if (!process.stdout.isTTY || inputBoxActive) return;
    inputBoxActive = true;
    updateInputBox();
  }

  function updateInputBox() {
    if (!process.stdout.isTTY || !inputBoxActive) return;
    const queueLabel = inputQueue.length > 0 ? chalk.yellow(` [${inputQueue.length} in queue]`) : "";
    // Show brackets around typing when processing
    const content = typingBuffer ? chalk.cyan(`[${typingBuffer}]`) : "";
    // Write to stderr (doesn't interfere with readline)
    process.stderr.write(`\x1b[2K\r  ${chalk.bold("›")} ${content}${queueLabel}\r`);
  }

  function hideInputBox() {
    if (!process.stdout.isTTY || !inputBoxActive) return;
    inputBoxActive = false;
    process.stderr.write("\x1b[2K\r"); // Clear line
  }

  // Multiline paste detection using bracketed paste mode
  let pasteBuffer: string[] = [];
  let pasteTimer: ReturnType<typeof setTimeout> | null = null;
  const PASTE_DEBOUNCE_MS = 50;
  let isPasting = false;

  function completer(line: string): [string[], string] {
    if (line.startsWith("/")) {
      const builtIn = SLASH_COMMANDS
        .filter((c) => c.cmd.startsWith(line))
        .map((c) => c.cmd);
      const custom = loadCustomCommands()
        .filter((c) => `/${c.name}`.startsWith(line))
        .map((c) => `/${c.name}`);
      return [[...builtIn, ...custom], line];
    }
    return [[], line];
  }

  function getPrompt(): string {
    if (isPlanMode()) {
      return chalk.bold.yellow("kai [plan] › ");
    }
    return chalk.bold.cyan("kai › ");
  }

  // Enable bracketed paste mode so we can detect paste start/end
  // Paste start: \x1b[200~  Paste end: \x1b[201~
  if (process.stdin.isTTY) {
    process.stdout.write("\x1b[?2004h");
    // Register BEFORE readline so our handler fires first
    process.stdin.on("data", (chunk: Buffer) => {
      const str = chunk.toString();
      if (str.includes("\x1b[200~")) isPasting = true;
      if (str.includes("\x1b[201~")) {
        isPasting = false;
        // After paste ends, show a summary and wait for Enter to submit
        if (pasteBuffer.length > 0) {
          const lineCount = pasteBuffer.length;
          const preview = pasteBuffer[0].substring(0, 40);
          process.stdout.write(chalk.dim(` [pasted ${lineCount} line${lineCount > 1 ? "s" : ""}]`));
        }
      }
    });
  }

  // Mute stream to suppress readline echo while processing — input only shows in the fixed bar
  const muteStream = new Writable({ write(_chunk, _enc, cb) { cb(); } });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: getPrompt(),
    terminal: true,
    completer,
  });

  function muteReadline() {
    if (process.stdout.isTTY) {
      (rl as unknown as { output: Writable }).output = muteStream;
    }
  }

  function unmuteReadline() {
    if (process.stdout.isTTY) {
      (rl as unknown as { output: Writable }).output = process.stdout;
    }
  }

  // Cleanup terminal state on exit
  const cleanupTerminal = () => {
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[?2004l"); // Disable bracketed paste
      hideInputBox(); // Reset terminal
    }
  };
  process.on("exit", cleanupTerminal);

  // Signal typing activity so spinners pause while user types during processing
  if (process.stdin.isTTY) {
    process.stdin.on("keypress", (_str: string | undefined, key: readline.Key) => {
      if (processing) {
        signalUserTyping();
        // Track what the user is typing for the input bar
        if (key?.name === "backspace") {
          typingBuffer = typingBuffer.slice(0, -1);
        } else if (key?.name === "return") {
          // Will be handled by the line event
        } else if (_str && !key?.ctrl && !key?.meta && _str.length === 1) {
          typingBuffer += _str;
        }
        updateInputBox();
      }
    });
  }

  async function processInput(input: string) {
    processing = true;
    typingBuffer = "";
    muteReadline();
    showInputBox();

    // Show command menu on bare "/"
    if (input === "/") {
      console.log(chalk.bold("\n  Commands:\n"));
      for (const c of SLASH_COMMANDS) {
        console.log(chalk.cyan(`    ${c.cmd.padEnd(16)}`) + chalk.dim(c.desc));
      }
      console.log("");
      processing = false;
      rl.setPrompt(getPrompt()); rl.prompt();
      return;
    }

    // Handle built-in slash commands
    if (input.startsWith("/") || input === "exit") {
      const result = await handleCommand(input, messages, session);
      if (result === "exit") {
        rl.close();
        process.exit(0);
      }
      if (result === "handled") {
        processing = false;
        rl.setPrompt(getPrompt()); rl.prompt();
        return;
      }
    }

    // Determine what message to send to the model
    let messageAdded = false;

    // Custom slash commands: /review, /test, etc.
    if (input.startsWith("/")) {
      const parts = input.substring(1).split(/\s+/);
      const cmdName = parts[0];
      const cmdArgs = parts.slice(1).join(" ");
      const customCmd = findCustomCommand(cmdName);
      if (customCmd) {
        const prompt = resolveCommand(customCmd, cmdArgs);
        console.log(chalk.dim(`  Running command: /${cmdName}\n`));
        messages.push({ role: "user", content: prompt });
        messageAdded = true;
      } else {
        // Unknown command — pass through as regular input
        messages.push({ role: "user", content: input });
        messageAdded = true;
      }
    }

    // Image attachment detection — send directly to the main model
    if (!messageAdded) {
      const imagePathMatch = input.match(/(?:^|\s)([^\s]+\.(?:png|jpg|jpeg|gif|webp|bmp))(?:\s|$)/i);
      if (imagePathMatch) {
        const imgPath = imagePathMatch[1].replace(/^~/, process.env.HOME || "~");
        const imgResult = readImageAsDataUrl(imgPath);
        if ("dataUrl" in imgResult) {
          const textPart = input.replace(imagePathMatch[1], "").trim() || "Analyze this image.";
          messages.push({
            role: "user",
            content: [
              { type: "text", text: textPart },
              { type: "image_url", image_url: { url: imgResult.dataUrl } },
            ],
          } as ChatCompletionMessageParam);
          console.log(chalk.dim(`  🖼️  Image attached: ${imgPath} (${imgResult.sizeKB} KB)`));
          messageAdded = true;
        }
      }
    }

    // Regular text input
    if (!messageAdded) {
      messages.push({ role: "user", content: input });
    }

    try {
      process.stdout.write("\n");

      // Auto-route: classify the task and decide strategy
      const routeDecision = await autoRoute(client, input);
      const routeHint = applyRoute(routeDecision);
      if (routeHint) {
        // Inject routing hint as a system message so the model follows the strategy
        messages.push({ role: "user", content: routeHint });
      }

      // Check for auto-compaction before chatting
      const compactResult = autoCompact(session);
      if (compactResult.compacted) {
        messages = session.messages;
        console.log(chalk.dim(`📦 Session compacted from ${compactResult.stats?.estimatedTokens.toLocaleString()} to ${Math.round((compactResult.stats?.estimatedTokens || 0) * 0.7).toLocaleString()} tokens\n`));
      }

      let firstResponseToken = true;
      const streamBuffer = new MarkdownStreamBuffer();

      // Start spinner for thinking phase
      let thinkingSpinner: ReturnType<typeof startSpinner> | null = null;
      thinkingSpinner = startSpinner("thinking...", (text) => {
        process.stderr.write(text);
      });

      chatAbort = new AbortController();
      const updatedMessages = await chat(client, messages, (token) => {
        if (firstResponseToken && token.trim()) {
          if (thinkingSpinner) {
            stopSpinner(thinkingSpinner, null);
          }
          renderAssistantMarker();
          firstResponseToken = false;
        }
        // Buffer tokens and flush rendered markdown at safe boundaries
        const rendered = streamBuffer.push(token);
        if (rendered) {
          process.stdout.write(rendered);
        }
      }, { signal: chatAbort.signal, unleash: options.unleash, onUsage: recordUsage });

      // Stop spinner if still running (no tokens received)
      if (thinkingSpinner && firstResponseToken) {
        stopSpinner(thinkingSpinner, null);
      }

      // Flush any remaining buffered content
      const remaining = streamBuffer.flush();
      if (remaining) {
        process.stdout.write(remaining);
      }

      messages.length = 0;
      messages.push(...updatedMessages);

      process.stdout.write("\n");

      // Show token budget inline after each response
      const contextTokens = estimateContextSize(messages);
      const MAX_CTX = 256_000;
      const ctxK = Math.round(contextTokens / 1000);
      const maxK = Math.round(MAX_CTX / 1000);
      const pct = Math.round((contextTokens / MAX_CTX) * 100);
      const ctxColor = pct > 80 ? chalk.yellow : pct > 60 ? chalk.dim : chalk.dim;
      console.log(ctxColor(`  [${ctxK}k / ${maxK}k tokens · ${pct}%]`));

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
      // Ignore abort errors — user pressed Ctrl+C to stop
      if (err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"))) {
        // Chat was stopped by user — just re-prompt
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`\n  Error: ${msg}\n`));
        if (msg.includes("401")) {
          console.error(chalk.yellow("  Check your FIREWORKS_API_KEY in .env\n"));
        }
        recordError({ source: "repl", error: err, context: { sessionId: session.id } });
      }
    }

    processing = false;
    sigintCount = 0;
    unmuteReadline();
    hideInputBox();

    // Process queued input
    if (inputQueue.length > 0) {
      const next = inputQueue.shift()!;
      await processInput(next);
    } else {
      rl.setPrompt(getPrompt()); rl.prompt();
    }
  }

  function flushPasteBuffer() {
    pasteTimer = null;
    const input = pasteBuffer.join("\n").trim();
    pasteBuffer = [];
    if (!input) {
      if (!processing) { rl.setPrompt(getPrompt()); rl.prompt(); }
      return;
    }

    // /exit and exit should always work, even during processing
    if (input === "/exit" || input === "exit") {
      if (chatAbort) {
        chatAbort.abort();
        chatAbort = null;
      }
      cleanupBackgroundProcesses();
      session.messages = messages;
      saveSessionSync(session);
      printGoodbye(session.id);
      rl.close();
      process.exit(0);
    }

    if (processing) {
      inputQueue.push(input);
      typingBuffer = "";
      updateInputBox();
    } else {
      processInput(input);
    }
  }

  rl.on("line", (line) => {
    // Strip any leftover bracketed paste escape sequences from the line
    const cleaned = line.replace(/\x1b\[\??200[0-9]?[~h]/g, "");
    pasteBuffer.push(cleaned);

    if (isPasting) {
      // Mid-paste: buffer lines but don't flush — wait for paste to end + Enter
      return;
    }

    // Normal Enter or paste just ended: use debounce to catch any trailing lines
    if (pasteTimer) clearTimeout(pasteTimer);
    pasteTimer = setTimeout(flushPasteBuffer, PASTE_DEBOUNCE_MS);
  });

  let sigintCount = 0;
  rl.on("SIGINT", () => {
    if (processing) {
      sigintCount++;
      console.log(chalk.dim("\n  Stopped.\n"));
      if (chatAbort) {
        chatAbort.abort();
        chatAbort = null;
      }
      // Force exit on double Ctrl+C during processing
      if (sigintCount >= 2) {
        cleanupBackgroundProcesses();
        session.messages = messages;
        saveSessionSync(session);
        printGoodbye(session.id);
        process.exit(0);
      }
      // Force processing flag reset so prompt reappears
      processing = false;
      inputQueue.length = 0;
      unmuteReadline();
      hideInputBox();
      rl.setPrompt(getPrompt()); rl.prompt();
    } else {
      cleanupBackgroundProcesses();
      session.messages = messages;
      saveSessionSync(session);
      printGoodbye(session.id);
      process.exit(0);
    }
  });

  rl.on("close", () => {
    session.messages = messages;
    saveSessionSync(session);
    printGoodbye(session.id);
    process.exit(0);
  });

  rl.prompt();

  // If an initial prompt was provided (e.g. `kai "fix the bug"`), process it immediately
  if (initialPrompt) {
    processInput(initialPrompt);
  }

  // Keep the function alive until the readline interface closes,
  // otherwise the caller's `await startRepl()` resolves and the process may exit.
  await new Promise<void>((resolve) => {
    rl.once("close", resolve);
  });
}

function createNewSession(
  options: ReplOptions,
  messages: ChatCompletionMessageParam[]
): Session {
  return {
    id: generateSessionId(),
    name: options.sessionName,
    cwd: getCwd(),
    type: "code", // CLI sessions are code-type by default
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages,
  };
}
