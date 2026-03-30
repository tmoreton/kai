import * as readline from "readline";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import chalk from "chalk";
import { createClient, chat, getModelId, getProviderName, refreshProvider } from "./client.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { getCwd, cleanupBackgroundProcesses } from "./tools/bash.js";
import { formatCost, estimateContextSize, formatContextBreakdown, compactMessages } from "./context.js";
import {
  gitInfo, gitDiff, gitStatus, gitBranch, gitLog, gitBaseBranch,
  gitDiffAgainstBase, gitListBranches, gitRemote, ghAvailable, isGitRepo,
} from "./git.js";
import { getTasksForDisplay } from "./tools/tasks.js";
import {
  generateSessionId,
  saveSession,
  loadSession,
  getMostRecentSession,
  listSessions,
  formatSessionList,
  cleanupSessions,
  type Session,
} from "./sessions.js";
import { appendRecall, getRecallStats, type RecallEntry } from "./recall.js";
import { loadSoul } from "./soul.js";
import fs from "fs";
import path from "path";
import { setPermissionMode, getPermissionMode } from "./permissions.js";
import { getCurrentProject } from "./project.js";
import { renderMarkdown } from "./render.js";
import {
  loadCustomCommands,
  findCustomCommand,
  resolveCommand,
  formatCustomCommands,
} from "./commands.js";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
const MIME_MAP: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
};

function readImageAsDataUrl(filePath: string): { dataUrl: string; sizeKB: number } | { error: string } {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(getCwd(), filePath);
  if (!fs.existsSync(resolved)) return { error: `Image not found: ${resolved}` };
  const ext = path.extname(resolved).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) return { error: `Unsupported format: ${ext}` };
  const stat = fs.statSync(resolved);
  if (stat.size > 20 * 1024 * 1024) return { error: "Image too large (max 20MB)" };
  const base64 = fs.readFileSync(resolved).toString("base64");
  return { dataUrl: `data:${MIME_MAP[ext] || "image/png"};base64,${base64}`, sizeKB: Math.round(stat.size / 1024) };
}

export interface ReplOptions {
  continueSession?: boolean;
  resumeSessionId?: string;
  sessionName?: string;
  autoApprove?: boolean;
}

export async function startRepl(options: ReplOptions = {}, initialPrompt?: string): Promise<void> {
  // Prune sessions older than 30 days on startup
  const pruned = cleanupSessions(30);
  if (pruned > 0) {
    console.log(chalk.dim(`  Cleaned up ${pruned} old session(s).\n`));
  }

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
      chalk.dim(` — AI coding assistant (${getProviderName()}/${getModelId()})\n`)
  );
  const project = getCurrentProject();
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
  console.log("");
  console.log(chalk.dim("  Tips:"));
  console.log(chalk.dim("    • Ask me to build, debug, or refactor code"));
  console.log(chalk.dim("    • I can read/write files, run commands, and search the web"));
  console.log(chalk.dim("    • Run " + chalk.cyan("kai") + " from any project directory to work in that folder"));
  console.log(chalk.dim("    • Type /help for all commands\n"));

  // Use a simple line-by-line approach with a processing flag
  let processing = false;
  const inputQueue: string[] = [];

  const SLASH_COMMANDS = [
    { cmd: "/help", desc: "Show all commands" },
    { cmd: "/clear", desc: "Clear conversation" },
    { cmd: "/cost", desc: "Token usage + context" },
    { cmd: "/sessions", desc: "List sessions" },
    { cmd: "/soul", desc: "View memory" },
    { cmd: "/git", desc: "Git commands" },
    { cmd: "/git diff", desc: "Colorized diff" },
    { cmd: "/git commit", desc: "AI commit" },
    { cmd: "/git pr", desc: "Create PR" },
    { cmd: "/git branch", desc: "Branch management" },
    { cmd: "/agent", desc: "List agents" },
    { cmd: "/agent run", desc: "Run agent" },
    { cmd: "/agent output", desc: "View output" },
    { cmd: "/agent info", desc: "Agent details" },
    { cmd: "/model", desc: "Show current model" },
    { cmd: "/model set", desc: "Change model" },
    { cmd: "/model list", desc: "List models" },
    { cmd: "/mcp", desc: "List MCP servers" },
    { cmd: "/mcp add", desc: "Add MCP server" },
    { cmd: "/mcp remove", desc: "Remove MCP server" },
    { cmd: "/exit", desc: "Exit Kai" },
  ];

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

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.bold.cyan("kai › "),
    terminal: true,
    completer,
  });

  async function processInput(input: string) {
    processing = true;

    // Show command menu on bare "/"
    if (input === "/") {
      console.log(chalk.bold("\n  Commands:\n"));
      for (const c of SLASH_COMMANDS) {
        console.log(chalk.cyan(`    ${c.cmd.padEnd(16)}`) + chalk.dim(c.desc));
      }
      console.log("");
      processing = false;
      rl.prompt();
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
        rl.prompt();
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

    // Image attachment detection
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

      let streamBuffer = "";
      let streamLineCount = 0;
      let firstResponseToken = true;

      const updatedMessages = await chat(client, messages, (token) => {
        if (firstResponseToken && token.trim()) {
          process.stdout.write(chalk.cyan("⏺ "));
          firstResponseToken = false;
        }
        streamBuffer += token;
        process.stdout.write(token);
        // Track newlines for re-render
        for (const ch of token) {
          if (ch === "\n") streamLineCount++;
        }
      });

      // Re-render the final assistant content with markdown formatting
      const lastMsg = updatedMessages[updatedMessages.length - 1];
      if (lastMsg?.role === "assistant" && typeof lastMsg.content === "string" && lastMsg.content.trim()) {
        // Move cursor up to overwrite raw streamed text, then render markdown
        if (streamLineCount > 0) {
          process.stdout.write(`\x1b[${streamLineCount + 1}A\x1b[0J`);
        } else {
          process.stdout.write("\r\x1b[0J");
        }
        process.stdout.write(renderMarkdown(lastMsg.content));
      }

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
        console.error(chalk.yellow("  Check your OPENROUTER_API_KEY in .env\n"));
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
      cleanupBackgroundProcesses();
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

  // If an initial prompt was provided (e.g. `kai "fix the bug"`), process it immediately
  if (initialPrompt) {
    processInput(initialPrompt);
  }
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

async function handleCommand(
  input: string,
  messages: ChatCompletionMessageParam[],
  session: Session
): Promise<"exit" | "handled" | "passthrough"> {
  const cmd = input.toLowerCase().trim();

  if (cmd === "exit" || cmd === "/exit" || cmd === "/quit") {
    session.messages = messages;
    saveSession(session);
    console.log(chalk.dim("\n  Session saved. Goodbye!\n"));
    return "exit";
  }

  // === /clear ===
  if (cmd === "/clear") {
    const systemMsg = messages[0];
    messages.length = 0;
    messages.push(systemMsg);
    console.log(chalk.dim("  Conversation cleared.\n"));
    return "handled";
  }

  // === /cost [compact] — token usage + context breakdown ===
  if (cmd === "/cost") {
    console.log("\n" + formatCost());
    console.log(formatContextBreakdown(messages));
    return "handled";
  }
  if (cmd === "/cost compact") {
    const before = estimateContextSize(messages);
    const compacted = compactMessages(messages);
    messages.length = 0;
    messages.push(...compacted);
    const after = estimateContextSize(messages);
    console.log(chalk.dim(`  Compacted: ~${before.toLocaleString()} → ~${after.toLocaleString()} tokens\n`));
    return "handled";
  }

  // === /sessions [rename <name>] ===
  if (cmd === "/sessions") {
    const sessions = listSessions();
    console.log(chalk.bold("\n  Recent sessions:\n"));
    console.log(formatSessionList(sessions) + "\n");
    return "handled";
  }
  if (cmd.startsWith("/sessions rename ")) {
    session.name = input.substring(17).trim();
    saveSession(session);
    console.log(chalk.dim(`  Session renamed to: ${session.name}\n`));
    return "handled";
  }

  // === /soul — core memory + recall stats ===
  if (cmd === "/soul") {
    const soul = loadSoul();
    console.log(chalk.bold("\n  Core Memory:\n"));
    for (const [key, block] of Object.entries(soul)) {
      console.log(chalk.cyan(`  [${key}]`));
      console.log(chalk.dim(`  ${block.content}\n`));
    }
    const stats = getRecallStats();
    console.log(chalk.dim(`  Recall: ${stats.totalEntries} past messages (${stats.fileSizeKB} KB)\n`));
    return "handled";
  }

  // === /git [diff|commit|pr|branch] ===
  if (cmd === "/git") {
    if (!isGitRepo()) {
      console.log(chalk.dim("  Not a git repo.\n"));
      return "handled";
    }
    const info = gitInfo();
    const status = gitStatus();
    console.log(chalk.bold(`\n  ${info}\n`));
    if (status) {
      console.log(status.split("\n").map((l) => chalk.dim(`  ${l}`)).join("\n"));
      console.log("");
    }
    return "handled";
  }

  if (cmd === "/git diff") {
    if (!isGitRepo()) { console.log(chalk.dim("  Not a git repo.\n")); return "handled"; }
    const { renderColorDiff } = await import("./diff.js");
    const staged = gitDiff(true);
    const unstaged = gitDiff(false);
    if (!staged && !unstaged) {
      console.log(chalk.dim("  No changes.\n"));
    } else {
      if (staged) {
        console.log(chalk.bold("\n  Staged:\n"));
        console.log(renderColorDiff(staged, 100).split("\n").map((l) => `  ${l}`).join("\n"));
      }
      if (unstaged) {
        console.log(chalk.bold("\n  Unstaged:\n"));
        console.log(renderColorDiff(unstaged, 100).split("\n").map((l) => `  ${l}`).join("\n"));
      }
      console.log("");
    }
    return "handled";
  }

  if (cmd.startsWith("/git commit")) {
    if (!isGitRepo()) { console.log(chalk.dim("  Not a git repo.\n")); return "handled"; }
    const status = gitStatus();
    if (!status) { console.log(chalk.dim("  Nothing to commit.\n")); return "handled"; }
    const diff = gitDiff(false) || gitDiff(true) || status;
    const recentLog = gitLog(5);
    const branch = gitBranch();
    const flags = input.substring(11).trim();
    const shouldPush = flags.includes("--push");
    const userMsg = flags.replace("--push", "").trim();
    const prompt = `Generate a concise git commit message for these changes, then stage all modified files and commit.
${shouldPush ? "After committing, push to origin." : ""}
${userMsg ? `Additional context: ${userMsg}` : ""}

Branch: ${branch}
Recent commits (match this style):
${recentLog}

Git status:
${status}

Diff (first 3000 chars):
${diff.substring(0, 3000)}`;
    messages.push({ role: "user", content: prompt });
    return "passthrough";
  }

  if (cmd.startsWith("/git pr")) {
    if (!isGitRepo()) { console.log(chalk.dim("  Not a git repo.\n")); return "handled"; }
    if (!ghAvailable()) { console.log(chalk.yellow("  GitHub CLI (gh) not installed. Install: https://cli.github.com\n")); return "handled"; }
    const status = gitStatus();
    const branch = gitBranch();
    const baseBranch = gitBaseBranch();
    const remote = gitRemote();
    const recentLog = gitLog(10);
    const diffAgainstBase = gitDiffAgainstBase();
    const userTitle = input.substring(7).trim();

    const prompt = `Create a pull request for the current changes. Follow these steps:
1. If on ${baseBranch}, create a descriptive branch name and switch to it using: git checkout -b <branch-name>
2. Stage and commit any uncommitted changes with a good message
3. Push to origin: git push -u origin <branch-name>
4. Create the PR using: gh pr create --title "<title>" --body "<body>"
   - The body should summarize the changes (use markdown)
   - Keep the title under 70 chars
${userTitle ? `\nUser-provided title/context: ${userTitle}` : ""}

Current state:
- Branch: ${branch}
- Base branch: ${baseBranch}
- Remote: ${remote}
- Status: ${status || "(clean)"}

Recent commits on this branch:
${recentLog}

Diff against ${baseBranch} (first 4000 chars):
${diffAgainstBase.substring(0, 4000) || "(no diff — changes may not be committed yet)"}

Unstaged diff (first 2000 chars):
${(gitDiff(false) || "(none)").substring(0, 2000)}`;
    messages.push({ role: "user", content: prompt });
    return "passthrough";
  }

  if (cmd.startsWith("/git branch")) {
    if (!isGitRepo()) { console.log(chalk.dim("  Not a git repo.\n")); return "handled"; }
    const arg = input.substring(11).trim();
    if (!arg) {
      const current = gitBranch();
      const branches = gitListBranches();
      console.log(chalk.bold(`\n  Current: ${current}\n`));
      console.log(branches.split("\n").map((l) => `  ${l}`).join("\n"));
      console.log("");
      return "handled";
    }
    const prompt = `Switch to branch "${arg}". If it doesn't exist, create it. Use: git checkout -b ${arg} (for new) or git checkout ${arg} (for existing).`;
    messages.push({ role: "user", content: prompt });
    return "passthrough";
  }

  // === /agent [list|run|output|info] ===
  if (cmd === "/agent" || cmd === "/agent list") {
    const { formatAgentList, daemonStatus } = await import("./agents/manager.js");
    console.log(daemonStatus());
    console.log(formatAgentList());
    return "handled";
  }
  if (cmd.startsWith("/agent run ")) {
    const agentId = input.substring(11).trim();
    const { runAgentCommand } = await import("./agents/manager.js");
    await runAgentCommand(agentId);
    return "handled";
  }
  if (cmd.startsWith("/agent output ")) {
    const parts = input.substring(14).trim().split(/\s+/);
    const { formatAgentOutput } = await import("./agents/manager.js");
    console.log(formatAgentOutput(parts[0], parts[1]));
    return "handled";
  }
  if (cmd.startsWith("/agent info ")) {
    const agentId = input.substring(12).trim();
    const { formatAgentDetail } = await import("./agents/manager.js");
    console.log(formatAgentDetail(agentId));
    return "handled";
  }

  // === /mcp [list|add|remove] ===
  if (cmd === "/mcp" || cmd === "/mcp list") {
    const { listMcpServers } = await import("./tools/index.js");
    const servers = listMcpServers();
    if (servers.length === 0) {
      console.log(chalk.dim("\n  No MCP servers configured."));
      console.log(chalk.dim("  Add one: /mcp add <name> <command> [args...]\n"));
    } else {
      console.log(chalk.bold("\n  MCP Servers:\n"));
      for (const s of servers) {
        const icon = s.ready ? chalk.green("●") : chalk.red("●");
        console.log(`  ${icon} ${chalk.bold(s.name)}`);
        for (const t of s.tools) {
          console.log(chalk.dim(`    - ${t}`));
        }
      }
      console.log("");
    }
    return "handled";
  }
  if (cmd.startsWith("/mcp add ")) {
    const parts = input.substring(9).trim().split(/\s+/);
    if (parts.length < 2) {
      console.log(chalk.yellow("  Usage: /mcp add <name> <command> [args...]"));
      console.log(chalk.dim("  Examples:"));
      console.log(chalk.dim("    /mcp add filesystem npx -y @modelcontextprotocol/server-filesystem /tmp"));
      console.log(chalk.dim("    /mcp add github npx -y @modelcontextprotocol/server-github"));
      console.log(chalk.dim("    /mcp add slack npx -y @anthropic/mcp-server-slack\n"));
      return "handled";
    }
    const name = parts[0];
    const command = parts[1];
    const args = parts.slice(2);
    const settingsPath = path.resolve(process.env.HOME || "~", ".kai/settings.json");
    let settings: any = {};
    try { if (fs.existsSync(settingsPath)) settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")); } catch {}
    if (!settings.mcp) settings.mcp = {};
    if (!settings.mcp.servers) settings.mcp.servers = {};
    settings.mcp.servers[name] = { command, args };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
    console.log(chalk.green(`\n  Added MCP server "${name}"`));
    console.log(chalk.dim(`  Command: ${command} ${args.join(" ")}`));
    console.log(chalk.dim("  Restart Kai to connect.\n"));
    return "handled";
  }
  if (cmd.startsWith("/mcp remove ")) {
    const name = input.substring(12).trim();
    if (!name) { console.log(chalk.yellow("  Usage: /mcp remove <name>\n")); return "handled"; }
    const settingsPath = path.resolve(process.env.HOME || "~", ".kai/settings.json");
    let settings: any = {};
    try { if (fs.existsSync(settingsPath)) settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")); } catch {}
    if (settings.mcp?.servers?.[name]) {
      delete settings.mcp.servers[name];
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
      console.log(chalk.green(`\n  Removed MCP server "${name}". Restart Kai to apply.\n`));
    } else {
      console.log(chalk.yellow(`\n  MCP server "${name}" not found.\n`));
    }
    return "handled";
  }

  // === /model [list|set <id>] ===
  if (cmd === "/model" || cmd === "/model show") {
    const { getConfig, clearConfigCache } = await import("./config.js");
    const { OPENROUTER_PROVIDER } = await import("./providers/index.js");
    const config = getConfig();
    const current = config.model || process.env.MODEL_ID || OPENROUTER_PROVIDER.defaultModel;
    console.log(chalk.bold(`\n  Current model: `) + chalk.cyan(current));
    if (config.model) {
      console.log(chalk.dim("  (from ~/.kai/settings.json)"));
    } else if (process.env.MODEL_ID) {
      console.log(chalk.dim("  (from MODEL_ID env)"));
    } else {
      console.log(chalk.dim("  (built-in default)"));
    }
    console.log(chalk.dim("\n  Change: /model set <model-id>"));
    console.log(chalk.dim("  List:   /model list\n"));
    return "handled";
  }
  if (cmd === "/model list") {
    const { getConfig } = await import("./config.js");
    const { OPENROUTER_PROVIDER } = await import("./providers/index.js");
    const config = getConfig();
    const active = config.model || process.env.MODEL_ID || OPENROUTER_PROVIDER.defaultModel;
    const models = [
      { id: "moonshotai/kimi-k2.5", label: "Kimi K2.5" },
      { id: "qwen/qwen3.5-397b-a17b", label: "Qwen 3.5 397B" },
      { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2" },
      { id: "qwen/qwen3-235b-a22b", label: "Qwen 3 235B" },
      { id: "mistralai/mistral-large-2512", label: "Mistral Large" },
      { id: "xiaomi/mimo-v2-pro", label: "MiMo V2 Pro" },
      { id: "z-ai/glm-5-turbo", label: "GLM-5 Turbo" },
      { id: "minimax/minimax-m2.7", label: "MiniMax M2.7" },
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
    ];
    console.log(chalk.bold("\n  Available Models\n"));
    for (const m of models) {
      const isCurrent = m.id === active;
      const dot = isCurrent ? chalk.green("●") : chalk.dim("○");
      const label = isCurrent ? chalk.bold(m.label) : m.label;
      console.log(`  ${dot} ${label}  ${chalk.dim(m.id)}`);
    }
    console.log(chalk.dim(`\n  Set: /model set <model-id>\n`));
    return "handled";
  }
  if (cmd.startsWith("/model set ")) {
    const modelId = input.substring(11).trim();
    if (!modelId) {
      console.log(chalk.yellow("  Usage: /model set <model-id>\n"));
      return "handled";
    }
    const { ensureKaiDir, clearConfigCache } = await import("./config.js");
    const settingsPath = path.resolve(ensureKaiDir(), "settings.json");
    let settings: any = {};
    try {
      if (fs.existsSync(settingsPath)) {
        settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      }
    } catch {}
    settings.model = modelId;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    clearConfigCache();
    refreshProvider();
    console.log(chalk.green(`\n  Model set to: ${modelId}`));
    console.log(chalk.dim("  Active now — next message will use this model.\n"));
    return "handled";
  }

  // === /help ===
  if (cmd === "/help") {
    console.log(
      chalk.dim(`
  /clear                  Clear conversation
  /cost                   Token usage + context breakdown
  /cost compact           Compress context to save tokens
  /sessions               List recent sessions
  /sessions rename <name> Rename current session
  /soul                   View memory (persona, human, goals, scratchpad, recall)

  /model                  Show current model
  /model list             List available models
  /model set <model-id>   Change model (persists across CLI + web)

  /git                    Status + changed files
  /git diff               Colorized diff (staged + unstaged)
  /git commit [msg]       AI commit (--push to also push)
  /git pr [title]         Create PR (branch + commit + push + open)
  /git branch [name]      List or create/switch branches

  /agent                  List background agents
  /agent run <id>         Run an agent now
  /agent output <id>      View agent output
  /agent info <id>        Agent details + run history

  /mcp                    List connected MCP servers + tools
  /mcp add <name> <cmd>   Add an MCP server
  /mcp remove <name>      Remove an MCP server

  /help                   Show this help
  /exit                   Exit Kai
${formatCustomCommands()}
`)
    );
    return "handled";
  }

  return "passthrough";
}
