import * as readline from "readline";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import chalk from "chalk";
import { getCwd } from "./tools/bash.js";
import { estimateContextSize, compactMessages } from "./context.js";
import {
  gitInfo, gitDiff, gitStatus, gitBranch, gitLog, gitBaseBranch,
  gitDiffAgainstBase, gitListBranches, gitRemote, ghAvailable, isGitRepo,
  gitLogDetailed, gitResetSoft, gitResetHard, gitStash, gitShowCommit,
  gitCommitAtTime, gitDiffBetween, gitFilesChangedBetween,
} from "./git.js";
import {
  saveSession,
  listSessions,
  formatSessionList,
  type Session,
} from "./sessions/manager.js";
import { getRecallStats } from "./recall.js";
import { loadSoul } from "./soul.js";
import fs from "fs";
import path from "path";
import { togglePlanMode } from "./plan-mode.js";
import { loadCustomCommands, formatCustomCommands } from "./commands.js";

export const SLASH_COMMANDS = [
  { cmd: "/help", desc: "Show all commands" },
  { cmd: "/clear", desc: "Clear conversation" },
  { cmd: "/compact", desc: "Compress context to save tokens" },
  { cmd: "/doctor", desc: "System diagnostics" },
  { cmd: "/export", desc: "Export session to markdown" },
  { cmd: "/plan", desc: "Toggle plan mode (research → present plan → implement)" },
  { cmd: "/review", desc: "Code review current changes" },
  { cmd: "/security-review", desc: "Security audit" },
  { cmd: "/sessions", desc: "List sessions" },
  { cmd: "/soul", desc: "View memory" },
  { cmd: "/diff", desc: "All changes made this session" },
  { cmd: "/git", desc: "Git commands" },
  { cmd: "/git diff", desc: "Colorized diff" },
  { cmd: "/git log", desc: "Recent commits" },
  { cmd: "/git undo", desc: "Undo commits + reset conversation" },
  { cmd: "/git stash", desc: "Stash uncommitted changes" },
  { cmd: "/git commit", desc: "AI commit" },
  { cmd: "/git pr", desc: "Create PR" },
  { cmd: "/git branch", desc: "Branch management" },
  { cmd: "/agent", desc: "List agents" },
  { cmd: "/agent run", desc: "Run agent" },
  { cmd: "/agent output", desc: "View output" },
  { cmd: "/notify", desc: "Agent notifications digest" },
  { cmd: "/notify --all", desc: "All notifications" },
  { cmd: "/agent info", desc: "Agent details" },
  { cmd: "/skill", desc: "List installed skills" },
  { cmd: "/skill reload", desc: "Hot-reload all skills" },
  { cmd: "/skill export-to-claude", desc: "Export skills to Claude Code" },
  { cmd: "/mcp", desc: "List MCP servers" },
  { cmd: "/mcp add", desc: "Add MCP server" },
  { cmd: "/mcp remove", desc: "Remove MCP server" },
  { cmd: "/errors", desc: "View tracked errors" },
  { cmd: "/exit", desc: "Exit Kai" },
];

function timeSince(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export async function runDoctor(): Promise<void> {
  const { execFileSync } = await import("child_process");
  console.log(chalk.bold("\n  Kai Doctor — System Diagnostics\n"));
  const checks: Array<{ name: string; status: "ok" | "warn" | "fail"; detail: string }> = [];

  // Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1));
  checks.push({
    name: "Node.js",
    status: major >= 20 ? "ok" : "warn",
    detail: `${nodeVersion}${major < 20 ? " (requires >= 20)" : ""}`,
  });

  // Git
  try {
    const gitVersion = execFileSync("git", ["--version"], { encoding: "utf-8", timeout: 5000 }).trim();
    checks.push({ name: "Git", status: "ok", detail: gitVersion });
  } catch {
    checks.push({ name: "Git", status: "fail", detail: "not found" });
  }

  // GitHub CLI
  try {
    const ghVersion = execFileSync("gh", ["--version"], { encoding: "utf-8", timeout: 5000 }).split("\n")[0].trim();
    checks.push({ name: "GitHub CLI", status: "ok", detail: ghVersion });
  } catch {
    checks.push({ name: "GitHub CLI", status: "warn", detail: "not installed (optional, for /git pr)" });
  }

  // Ripgrep
  try {
    const rgVersion = execFileSync("rg", ["--version"], { encoding: "utf-8", timeout: 5000 }).split("\n")[0].trim();
    checks.push({ name: "Ripgrep", status: "ok", detail: rgVersion });
  } catch {
    checks.push({ name: "Ripgrep", status: "warn", detail: "not installed (falling back to grep)" });
  }

  // API Keys
  const fireworksKey = process.env.FIREWORKS_API_KEY;
  checks.push({
    name: "FIREWORKS_API_KEY",
    status: fireworksKey ? "ok" : "fail",
    detail: fireworksKey ? `set (${fireworksKey.substring(0, 8)}...)` : "missing — required for LLM access",
  });

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  checks.push({
    name: "OPENROUTER_API_KEY",
    status: openrouterKey ? "ok" : "warn",
    detail: openrouterKey ? `set (${openrouterKey.substring(0, 8)}...)` : "missing — image generation will not work",
  });

  const tavilyKey = process.env.TAVILY_API_KEY;
  checks.push({
    name: "TAVILY_API_KEY",
    status: tavilyKey ? "ok" : "warn",
    detail: tavilyKey ? `set (${tavilyKey.substring(0, 8)}...)` : "missing — web_search will not work",
  });

  // Config files
  const configPaths = [
    path.resolve(process.env.HOME || "~", ".kai/settings.json"),
    path.resolve(process.cwd(), ".kai/settings.json"),
    path.resolve(process.cwd(), "KAI.md"),
  ];
  for (const p of configPaths) {
    const label = p.replace(process.env.HOME || "", "~");
    if (fs.existsSync(p)) {
      try {
        if (p.endsWith(".json")) {
          JSON.parse(fs.readFileSync(p, "utf-8"));
          checks.push({ name: label, status: "ok", detail: "valid JSON" });
        } else {
          const size = fs.statSync(p).size;
          checks.push({ name: label, status: "ok", detail: `${(size / 1024).toFixed(1)} KB` });
        }
      } catch {
        checks.push({ name: label, status: "fail", detail: "invalid JSON — parse error" });
      }
    }
  }

  // MCP Servers
  try {
    const { listMcpServers } = await import("./tools/index.js");
    const servers = listMcpServers();
    if (servers.length > 0) {
      for (const s of servers) {
        checks.push({
          name: `MCP: ${s.name}`,
          status: s.ready ? "ok" : "fail",
          detail: s.ready ? `${s.tools.length} tools` : "not connected",
        });
      }
    }
  } catch {}

  // Data directory size
  const kaiHome = path.resolve(process.env.HOME || "~", ".kai");
  if (fs.existsSync(kaiHome)) {
    try {
      const du = execFileSync("du", ["-sh", kaiHome], { encoding: "utf-8", timeout: 5000 }).trim();
      const size = du.split("\t")[0];
      checks.push({ name: "~/.kai data", status: "ok", detail: size });
    } catch {}
  }

  // Display results
  for (const check of checks) {
    const icon = check.status === "ok" ? chalk.green("✔") : check.status === "warn" ? chalk.yellow("!") : chalk.red("✗");
    const detail = check.status === "ok" ? chalk.dim(check.detail) : check.status === "warn" ? chalk.yellow(check.detail) : chalk.red(check.detail);
    console.log(`  ${icon} ${check.name.padEnd(22)} ${detail}`);
  }

  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  if (fails === 0 && warns === 0) {
    console.log(chalk.green("\n  All checks passed.\n"));
  } else {
    console.log(chalk.dim(`\n  ${fails} error(s), ${warns} warning(s)\n`));
  }
}

export async function exportSession(session: Session, outputPath?: string): Promise<void> {
  const filename = outputPath || `kai-session-${session.id}.md`;
  const resolved = path.isAbsolute(filename) ? filename : path.resolve(getCwd(), filename);

  const lines: string[] = [];
  lines.push(`# Kai Session: ${session.name || session.id}`);
  lines.push(`- **Date:** ${new Date(session.createdAt).toLocaleString()}`);
  lines.push(`- **Directory:** ${session.cwd}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const msg of session.messages) {
    if (msg.role === "system") continue;

    if (msg.role === "user") {
      const content = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((c: any) => ("text" in c ? c.text : "[image]")).join("\n")
          : "";
      // Skip system injections
      if (content.startsWith("[SYSTEM:")) continue;
      lines.push(`## User`);
      lines.push("");
      lines.push(content);
      lines.push("");
    } else if (msg.role === "assistant") {
      const content = typeof msg.content === "string" ? msg.content : "";
      if (content && !content.startsWith("[Reached maximum")) {
        lines.push(`## Assistant`);
        lines.push("");
        lines.push(content);
        lines.push("");
      }
      // Show tool calls
      if ("tool_calls" in msg && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if ("function" in tc && tc.function) {
            let argsSummary: string;
            try {
              const parsed = JSON.parse(tc.function.arguments);
              argsSummary = JSON.stringify(parsed, null, 2);
            } catch {
              argsSummary = tc.function.arguments;
            }
            lines.push(`> **Tool:** \`${tc.function.name}\``);
            lines.push(`> \`\`\``);
            lines.push(`> ${argsSummary.split("\n").join("\n> ")}`);
            lines.push(`> \`\`\``);
            lines.push("");
          }
        }
      }
    } else if (msg.role === "tool") {
      // Skip tool results in export — they're too verbose
    }
  }

  fs.writeFileSync(resolved, lines.join("\n"), "utf-8");
  console.log(chalk.green(`\n  Session exported to: ${resolved}\n`));
}

export async function handleCommand(
  input: string,
  messages: ChatCompletionMessageParam[],
  session: Session
): Promise<"exit" | "handled" | "passthrough"> {
  const cmd = input.toLowerCase().trim();

  if (cmd === "exit" || cmd === "/exit" || cmd === "/quit") {
    session.messages = messages;
    saveSession(session);
    console.log(chalk.dim("\n  Session saved. Goodbye!\n"));
    console.log(chalk.dim("  Resume this session:"));
    console.log(chalk.dim("  kai "));
    console.log(chalk.cyan(`  --resume ${session.id}\n`));
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

  // === /compact — manual context compaction ===
  if (cmd === "/compact") {
    const before = estimateContextSize(messages);
    const compacted = compactMessages(messages);
    messages.length = 0;
    messages.push(...compacted);
    const after = estimateContextSize(messages);
    console.log(chalk.dim(`  Compacted: ~${before.toLocaleString()} → ~${after.toLocaleString()} tokens\n`));
    return "handled";
  }

  // === /doctor — system diagnostics ===
  if (cmd === "/doctor") {
    await runDoctor();
    return "handled";
  }

  // === /export [path] — export session to markdown ===
  if (cmd === "/export" || cmd.startsWith("/export ")) {
    const exportPath = input.substring(7).trim();
    await exportSession(session, exportPath);
    return "handled";
  }

  // === /plan — toggle plan mode ===
  if (cmd === "/plan") {
    const enabled = togglePlanMode();
    if (enabled) {
      console.log(chalk.yellow("\n  ╔══════════════════════════════════════════════════════════════════╗"));
      console.log(chalk.yellow("  ║  PLAN MODE ON — Read-only exploration phase                     ║"));
      console.log(chalk.yellow("  ╠══════════════════════════════════════════════════════════════════╣"));
      console.log(chalk.yellow("  ║  You can now:                                                    ║"));
      console.log(chalk.yellow("  ║    • Explore the codebase (read_file, glob, grep)               ║"));
      console.log(chalk.yellow("  ║    • Research online (web_search, web_fetch)                    ║"));
      console.log(chalk.yellow("  ║    • Spawn explorer/planner agents                              ║"));
      console.log(chalk.yellow("  ║                                                                  ║"));
      console.log(chalk.yellow("  ║  Write operations are BLOCKED. Once you understand the task:     ║"));
      console.log(chalk.yellow("  ║    1. Present a clear plan to the user                          ║"));
      console.log(chalk.yellow("  ║    2. Type '/plan' again to exit and start implementing         ║"));
      console.log(chalk.yellow("  ╚══════════════════════════════════════════════════════════════════╝\n"));
    } else {
      console.log(chalk.green("\n  ╔══════════════════════════════════════════════════════════════════╗"));
      console.log(chalk.green("  ║  PLAN MODE OFF — Full tool access restored                      ║"));
      console.log(chalk.green("  ║                                                                  ║"));
      console.log(chalk.green("  ║  Implementing your plan now. All tools available.                ║"));
      console.log(chalk.green("  ╚══════════════════════════════════════════════════════════════════╝\n"));
    }
    return "handled";
  }

  // === /review — code review current changes ===
  if (cmd === "/review" || cmd.startsWith("/review ")) {
    if (!isGitRepo()) { console.log(chalk.dim("  Not a git repo.\n")); return "handled"; }
    const reviewArgs = input.substring(7).trim();
    const diff = gitDiff(false) || gitDiff(true) || "";
    const status = gitStatus();
    if (!diff && !status) { console.log(chalk.dim("  No changes to review.\n")); return "handled"; }
    const prompt = `Review the following code changes. Look for:
- Bugs, logic errors, edge cases
- Code quality issues (naming, readability, DRY)
- Missing error handling
- Performance concerns
- Potential improvements
${reviewArgs ? `\nAdditional focus: ${reviewArgs}` : ""}

Git status:
${status}

Diff:
${diff.substring(0, 6000)}`;
    messages.push({ role: "user", content: prompt });
    return "passthrough";
  }

  // === /security-review — security audit ===
  if (cmd === "/security-review" || cmd.startsWith("/security-review ")) {
    if (!isGitRepo()) { console.log(chalk.dim("  Not a git repo.\n")); return "handled"; }
    const secArgs = input.substring(16).trim();
    const diff = gitDiff(false) || gitDiff(true) || "";
    const status = gitStatus();
    if (!diff && !status) { console.log(chalk.dim("  No changes to review.\n")); return "handled"; }
    const prompt = `Perform a SECURITY-FOCUSED review of these code changes. Check for:
- Injection vulnerabilities (SQL, XSS, command injection, path traversal)
- Authentication/authorization issues
- Sensitive data exposure (API keys, secrets, PII in logs)
- Insecure dependencies or configurations
- OWASP Top 10 vulnerabilities
- Input validation gaps
- Unsafe deserialization
- Race conditions
${secArgs ? `\nAdditional focus: ${secArgs}` : ""}

Git status:
${status}

Diff:
${diff.substring(0, 6000)}`;
    messages.push({ role: "user", content: prompt });
    return "passthrough";
  }

  // === /diff — session diff (all changes since session started) ===
  if (cmd === "/diff") {
    if (!isGitRepo()) { console.log(chalk.dim("  Not a git repo.\n")); return "handled"; }

    // Find the commit at or before session start
    const sessionStart = session.createdAt;
    const startHash = gitCommitAtTime(sessionStart);

    if (!startHash) {
      // No commits before session — show all uncommitted changes instead
      const { renderColorDiff } = await import("./diff.js");
      const staged = gitDiff(true);
      const unstaged = gitDiff(false);
      if (!staged && !unstaged) {
        console.log(chalk.dim("  No changes since session started.\n"));
      } else {
        console.log(chalk.bold("\n  Changes this session:\n"));
        if (staged) console.log(renderColorDiff(staged, 120).split("\n").map((l) => `  ${l}`).join("\n"));
        if (unstaged) console.log(renderColorDiff(unstaged, 120).split("\n").map((l) => `  ${l}`).join("\n"));
        console.log("");
      }
      return "handled";
    }

    // Show committed changes since session start + any uncommitted
    const committedDiff = gitDiffBetween(startHash, "HEAD");
    const uncommittedDiff = gitDiff(false) || gitDiff(true) || "";
    const filesChanged = gitFilesChangedBetween(startHash, "HEAD");

    if (!committedDiff && !uncommittedDiff) {
      console.log(chalk.dim("  No changes since session started.\n"));
      return "handled";
    }

    console.log(chalk.bold("\n  Session diff") + chalk.dim(` (since ${new Date(sessionStart).toLocaleTimeString()}):\n`));

    if (filesChanged.length > 0) {
      console.log(chalk.dim(`  Files changed: ${filesChanged.length}`));
      for (const f of filesChanged.slice(0, 20)) {
        console.log(chalk.dim(`    ${f}`));
      }
      if (filesChanged.length > 20) {
        console.log(chalk.dim(`    ... and ${filesChanged.length - 20} more`));
      }
      console.log("");
    }

    const { renderColorDiff } = await import("./diff.js");
    const fullDiff = committedDiff + (uncommittedDiff ? "\n" + uncommittedDiff : "");
    if (fullDiff) {
      console.log(renderColorDiff(fullDiff, 150).split("\n").map((l) => `  ${l}`).join("\n"));
    }
    console.log("");
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

  // === /errors — view tracked errors ===
  if (cmd === "/errors" || cmd.startsWith("/errors ")) {
    const { getErrorSummary, getErrorTrends, getUnresolvedErrors } = await import("./agents-core/db.js");

    const arg = input.substring(7).trim();
    if (arg === "all") {
      const errors = getUnresolvedErrors(50);
      if (errors.length === 0) {
        console.log(chalk.green("\n  No tracked errors.\n"));
        return "handled";
      }
      console.log(chalk.bold(`\n  All unresolved errors (${errors.length}):\n`));
      for (const e of errors) {
        const age = timeSince(e.last_seen);
        console.log(`  ${chalk.red(e.error_class || "Error")} ${chalk.dim(`[${e.source}]`)} ${e.message.substring(0, 100)}`);
        console.log(chalk.dim(`    count: ${e.count} | first: ${e.first_seen} | last: ${age} ago | fp: ${e.fingerprint.substring(0, 8)}`));
        if (e.context) {
          try {
            const ctx = JSON.parse(e.context);
            if (ctx.toolName) console.log(chalk.dim(`    tool: ${ctx.toolName}`));
          } catch {}
        }
        console.log("");
      }
      return "handled";
    }

    // Default: summary view
    const summary = getErrorSummary(15);
    const trends = getErrorTrends(24);

    if (summary.length === 0) {
      console.log(chalk.green("\n  No tracked errors. The system is healthy.\n"));
      return "handled";
    }

    console.log(chalk.bold("\n  Error Summary (last 24h):\n"));

    // Trend by source
    if (trends.length > 0) {
      const trendLine = trends.map((t) => `${t.source}: ${t.count}`).join("  ");
      console.log(chalk.dim(`  By source: ${trendLine}\n`));
    }

    // Top errors by fingerprint
    for (const e of summary) {
      const countStr = chalk.yellow(`x${e.total_count}`);
      const sourceStr = chalk.dim(`[${e.source}]`);
      const classStr = chalk.red(e.error_class || "Error");
      console.log(`  ${countStr} ${classStr} ${sourceStr} ${e.message.substring(0, 80)}`);
    }
    console.log(chalk.dim(`\n  Use /errors all for full details.\n`));
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

  // === /git log [count] — show recent commits ===
  if (cmd === "/git log" || cmd.startsWith("/git log ")) {
    if (!isGitRepo()) { console.log(chalk.dim("  Not a git repo.\n")); return "handled"; }
    const countArg = input.substring(9).trim();
    const count = countArg ? parseInt(countArg) || 15 : 15;
    const commits = gitLogDetailed(count);
    if (commits.length === 0) {
      console.log(chalk.dim("  No commits found.\n"));
      return "handled";
    }
    console.log(chalk.bold("\n  Recent commits:\n"));
    commits.forEach((c, i) => {
      const num = chalk.dim(`  ${String(i + 1).padStart(2)}.`);
      const hash = chalk.yellow(c.shortHash);
      const date = chalk.dim(c.date);
      console.log(`${num} ${hash} ${c.message}  ${date}`);
    });
    console.log(chalk.dim(`\n  Undo: /git undo <number>  (e.g. /git undo 3 to undo last 3 commits)\n`));
    return "handled";
  }

  // === /git undo [n] — undo last N commits + reset conversation ===
  if (cmd === "/git undo" || cmd.startsWith("/git undo ")) {
    if (!isGitRepo()) { console.log(chalk.dim("  Not a git repo.\n")); return "handled"; }

    const arg = input.substring(10).trim();
    const commits = gitLogDetailed(15);

    if (commits.length === 0) {
      console.log(chalk.dim("  No commits to undo.\n"));
      return "handled";
    }

    // Parse argument: could be a number (undo N commits) or "soft"/"hard" modifier
    let undoCount = 1;
    let mode: "soft" | "hard" = "soft";

    const parts = arg.split(/\s+/).filter(Boolean);
    for (const p of parts) {
      if (p === "hard" || p === "--hard") {
        mode = "hard";
      } else if (p === "soft" || p === "--soft") {
        mode = "soft";
      } else {
        const n = parseInt(p);
        if (!isNaN(n) && n > 0 && n <= commits.length) {
          undoCount = n;
        } else if (p) {
          console.log(chalk.yellow(`  Invalid argument: "${p}"\n`));
          console.log(chalk.dim("  Usage:"));
          console.log(chalk.dim("    /git undo          Undo last commit (keep changes staged)"));
          console.log(chalk.dim("    /git undo 3        Undo last 3 commits (keep changes)"));
          console.log(chalk.dim("    /git undo 2 hard   Undo last 2 commits (discard changes)"));
          console.log(chalk.dim("    /git undo hard     Undo last commit + discard changes\n"));
          return "handled";
        }
      }
    }

    // Show what will be undone
    console.log(chalk.bold(`\n  Undoing ${undoCount} commit(s) (${mode} reset):\n`));
    for (let i = 0; i < undoCount; i++) {
      const c = commits[i];
      const icon = chalk.red("  ✗");
      console.log(`${icon} ${chalk.yellow(c.shortHash)} ${c.message}  ${chalk.dim(c.date)}`);
    }

    const targetHash = commits[undoCount - 1].hash;
    // Reset to the parent of the last commit to undo
    const resetTo = `${targetHash}~1`;

    console.log("");

    // Confirm with user if undoing more than 1 commit or using hard reset
    if (undoCount > 1 || mode === "hard") {
      const confirmed = await new Promise<boolean>((resolve) => {
        const confirmRl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const prompt = mode === "hard"
          ? chalk.red(`  This will PERMANENTLY discard changes. Continue? [y/N] `)
          : chalk.yellow(`  Undo ${undoCount} commits? Changes will be kept as staged. [y/N] `);
        confirmRl.question(prompt, (answer) => {
          confirmRl.close();
          resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes");
        });
      });

      if (!confirmed) {
        console.log(chalk.dim("  Cancelled.\n"));
        return "handled";
      }
    }

    // Perform the reset
    let result;
    if (mode === "hard") {
      result = gitResetHard(resetTo);
    } else {
      result = gitResetSoft(resetTo);
    }

    if (!result.success) {
      console.log(chalk.red(`  Reset failed: ${result.error}\n`));
      return "handled";
    }

    console.log(chalk.green(`  Reset to ${commits[undoCount - 1].shortHash}~1 (${mode})`));

    // Reset the conversation to clear context about undone work
    const systemMsg = messages[0];
    messages.length = 0;
    messages.push(systemMsg);
    console.log(chalk.dim("  Conversation cleared to match git state."));

    // Show current state
    const newStatus = gitStatus();
    if (newStatus) {
      console.log(chalk.dim(`\n  Current status:`));
      console.log(newStatus.split("\n").map((l) => chalk.dim(`    ${l}`)).join("\n"));
    }
    console.log("");
    return "handled";
  }

  // === /git stash [message] — stash uncommitted changes ===
  if (cmd === "/git stash" || cmd.startsWith("/git stash ")) {
    if (!isGitRepo()) { console.log(chalk.dim("  Not a git repo.\n")); return "handled"; }
    const status = gitStatus();
    if (!status) {
      console.log(chalk.dim("  Nothing to stash.\n"));
      return "handled";
    }
    const stashMsg = input.substring(10).trim() || undefined;
    const result = gitStash(stashMsg);
    if (result.success) {
      console.log(chalk.green(`\n  Changes stashed${stashMsg ? `: ${stashMsg}` : ""}`));
      console.log(chalk.dim("  Restore with: git stash pop\n"));
    } else {
      console.log(chalk.red(`  Stash failed: ${result.error}\n`));
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
    const { formatAgentList, daemonStatus } = await import("./agents-core/manager.js");
    console.log(daemonStatus());
    console.log(formatAgentList());
    return "handled";
  }
  if (cmd.startsWith("/agent run ")) {
    const agentId = input.substring(11).trim();
    const { runAgentCommand } = await import("./agents-core/manager.js");
    await runAgentCommand(agentId);
    return "handled";
  }
  if (cmd.startsWith("/agent output ")) {
    const parts = input.substring(14).trim().split(/\s+/);
    const { formatAgentOutput } = await import("./agents-core/manager.js");
    console.log(formatAgentOutput(parts[0], parts[1]));
    return "handled";
  }
  if (cmd.startsWith("/agent info ")) {
    const agentId = input.substring(12).trim();
    const { formatAgentDetail } = await import("./agents-core/manager.js");
    console.log(formatAgentDetail(agentId));
    return "handled";
  }

  // === /notify [options] ===
  if (cmd === "/notify" || cmd === "/notify --all") {
    const { formatNotificationsList, formatNotificationDigest, markAllNotificationsAsRead } = await import("./agents-core/manager.js");
    if (cmd === "/notify --all") {
      console.log(formatNotificationsList());
    } else {
      const digest = formatNotificationDigest(24);
      if (digest) {
        console.log(digest);
      } else {
        console.log(chalk.dim("\n  No agent activity in the last 24 hours.\n"));
      }
    }
    return "handled";
  }
  if (cmd === "/notify --read") {
    const { markAllNotificationsAsRead } = await import("./agents-core/manager.js");
    console.log(chalk.green("\n  ✓ All notifications marked as read\n"));
    console.log(markAllNotificationsAsRead());
    return "handled";
  }

  // === /skill [list|reload] ===
  if (cmd === "/skill" || cmd === "/skill list") {
    const { getLoadedSkills, skillsDir } = await import("./skills/index.js");
    const skills = getLoadedSkills();
    if (skills.length === 0) {
      console.log(chalk.dim("\n  No skills installed."));
      console.log(chalk.dim(`  Install to: ${skillsDir()}/`));
      console.log(chalk.dim("  CLI: kai skill install <github-url>\n"));
    } else {
      console.log(chalk.bold("\n  Installed Skills:\n"));
      for (const s of skills) {
        console.log(`  ${chalk.green("●")} ${chalk.bold(s.manifest.name)} ${chalk.dim(`v${s.manifest.version}`)} ${chalk.dim(`[${s.manifest.id}]`)}`);
        for (const t of s.manifest.tools) {
          console.log(chalk.dim(`    - ${t.name}: ${t.description || ""}`));
        }
      }
      console.log("");
    }
    return "handled";
  }
  if (cmd === "/skill reload") {
    const { reloadAllSkills } = await import("./skills/index.js");
    const result = await reloadAllSkills();
    console.log(chalk.green(`\n  ✓ Reloaded ${result.loaded} skills`));
    if (result.errors.length > 0) {
      for (const err of result.errors) {
        console.log(chalk.yellow(`  ⚠ ${err}`));
      }
    }
    console.log("");
    return "handled";
  }

  // === /skill export-to-claude ===
  if (cmd === "/skill export-to-claude" || cmd.startsWith("/skill export-to-claude ")) {
    const skillName = cmd.replace("/skill export-to-claude", "").trim();
    
    if (!skillName) {
      console.log(chalk.yellow("\n  Usage: /skill export-to-claude <skill-name>"));
      console.log(chalk.dim("  Examples:"));
      console.log(chalk.dim("    /skill export-to-claude youtube"));
      console.log(chalk.dim("    /skill export-to-claude notion"));
      console.log(chalk.dim("    /skill export-to-claude all\n"));
      return "handled";
    }
    
    const { getLoadedSkills, skillsDir } = await import("./skills/index.js");
    const skills = getLoadedSkills();
    const kaiSkillsDir = skillsDir();
    const claudeConfigPath = path.resolve(process.env.HOME || "~", ".claude/settings.json");
    
    // Ensure .claude directory exists
    const claudeDir = path.dirname(claudeConfigPath);
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }
    
    // Read or create Claude config
    let claudeConfig: any = {};
    try {
      if (fs.existsSync(claudeConfigPath)) {
        claudeConfig = JSON.parse(fs.readFileSync(claudeConfigPath, "utf-8"));
      }
    } catch (e) {
      console.log(chalk.yellow("  ⚠ Could not read existing Claude config, creating new one"));
    }
    
    if (!claudeConfig.mcpServers) {
      claudeConfig.mcpServers = {};
    }
    
    const exportSkill = (skillId: string, skillPath: string) => {
      // Build env from current environment
      const env: Record<string, string> = {};
      const skill = skills.find(s => s.manifest.id === skillId);
      if (skill?.manifest.config_schema) {
        for (const [key, field] of Object.entries(skill.manifest.config_schema)) {
          const envKey = (field as any).env || key;
          const value = process.env[envKey];
          if (value) {
            env[envKey] = value;
          }
        }
      }
      
      claudeConfig.mcpServers[skillId] = {
        command: "npx",
        args: ["-y", "kai-skill-mcp", skillPath],
        env: Object.keys(env).length > 0 ? env : undefined,
      };
    };
    
    if (skillName === "all") {
      console.log(chalk.bold("\n  Exporting all skills to Claude Code...\n"));
      let exported = 0;
      for (const skill of skills) {
        const skillPath = path.join(kaiSkillsDir, path.basename(skill.path));
        exportSkill(skill.manifest.id, skillPath);
        console.log(chalk.green(`  ✓ ${skill.manifest.name}`));
        exported++;
      }
      console.log(chalk.bold(`\n  Exported ${exported} skills\n`));
    } else {
      const skill = skills.find(s => s.manifest.id === skillName);
      if (!skill) {
        console.log(chalk.red(`\n  ❌ Skill "${skillName}" not found`));
        console.log(chalk.dim("  Run /skill to see installed skills\n"));
        return "handled";
      }
      
      const skillPath = path.join(kaiSkillsDir, path.basename(skill.path));
      exportSkill(skillName, skillPath);
      console.log(chalk.green(`\n  ✓ Exported "${skill.manifest.name}" to Claude Code\n`));
    }
    
    // Write Claude config
    fs.writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig, null, 2), "utf-8");
    console.log(chalk.dim(`  Config saved: ${claudeConfigPath}`));
    console.log(chalk.dim("  Restart Claude Code to use the skills\n"));
    
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


  // === /help ===
  if (cmd === "/help") {
    console.log(
      chalk.dim(`
  /clear                  Clear conversation
  /compact                Compress context to save tokens
  /doctor                 System diagnostics (check config, APIs, tools)
  /export [path]          Export session to markdown file
  /plan                   Toggle plan mode (read-only tools only)
  /review [focus]         Code review current git changes
  /security-review [focus] Security audit current changes
  /sessions               List recent sessions
  /sessions rename <name> Rename current session
  /soul                   View memory (persona, human, goals, scratchpad, recall)
  /errors                 View tracked errors (summary)
  /errors all             View all unresolved errors (detailed)

  /diff                   All changes made this session
  /git                    Status + changed files
  /git diff               Colorized diff (staged + unstaged)
  /git log [n]            Recent commits (default: 15)
  /git undo [n] [hard]    Undo last N commits + clear conversation
  /git stash [msg]        Stash uncommitted changes
  /git commit [msg]       AI commit (--push to also push)
  /git pr [title]         Create PR (branch + commit + push + open)
  /git branch [name]      List or create/switch branches

  /agent                  List background agents
  /agent run <id>         Run an agent now
  /agent output <id>      View agent output
  /agent info <id>        Agent details + run history

  /notify                 Agent notifications digest (last 24h)
  /notify --all           Show all notifications
  /notify --read          Mark all notifications as read

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
