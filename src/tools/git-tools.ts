/**
 * Git tools — allow the LLM to perform git operations directly.
 *
 * These supplement bash-based git commands with higher-level operations
 * that include safety checks and structured output.
 */

import {
  isGitRepo,
  gitLogDetailed,
  gitResetSoft,
  gitResetHard,
  gitStash,
  gitStatus,
  gitDiff,
  gitCommitAtTime,
  gitDiffBetween,
  gitFilesChangedBetween,
} from "../git.js";

export async function gitLogTool(args: {
  count?: number;
}): Promise<string> {
  if (!isGitRepo()) return "Error: Not a git repository.";

  const count = args.count || 15;
  const commits = gitLogDetailed(count);

  if (commits.length === 0) return "No commits found.";

  const lines = commits.map((c, i) =>
    `${String(i + 1).padStart(2)}. ${c.shortHash} ${c.message}  (${c.date})`
  );

  return `Recent commits (${commits.length}):\n\n${lines.join("\n")}`;
}

export async function gitDiffSessionTool(args: {
  session_start: string;
}): Promise<string> {
  if (!isGitRepo()) return "Error: Not a git repository.";

  const startHash = gitCommitAtTime(args.session_start);

  if (!startHash) {
    // No commits before session — just show uncommitted
    const staged = gitDiff(true);
    const unstaged = gitDiff(false);
    if (!staged && !unstaged) return "No changes since session started.";
    return `Changes this session (uncommitted only):\n\n${staged || ""}${staged && unstaged ? "\n" : ""}${unstaged || ""}`;
  }

  const committedDiff = gitDiffBetween(startHash, "HEAD");
  const uncommittedDiff = gitDiff(false) || gitDiff(true) || "";
  const filesChanged = gitFilesChangedBetween(startHash, "HEAD");

  if (!committedDiff && !uncommittedDiff) return "No changes since session started.";

  let output = `Session diff (since ${new Date(args.session_start).toLocaleTimeString()}):\n\n`;

  if (filesChanged.length > 0) {
    output += `Files changed: ${filesChanged.length}\n`;
    output += filesChanged.map((f) => `  ${f}`).join("\n") + "\n\n";
  }

  if (committedDiff) {
    output += `Committed changes:\n${committedDiff.substring(0, 8000)}\n`;
    if (committedDiff.length > 8000) {
      output += `\n[Diff truncated — ${committedDiff.length} chars total]`;
    }
  }

  if (uncommittedDiff) {
    output += `\nUncommitted changes:\n${uncommittedDiff.substring(0, 4000)}`;
    if (uncommittedDiff.length > 4000) {
      output += `\n[Diff truncated — ${uncommittedDiff.length} chars total]`;
    }
  }

  return output;
}

export async function gitUndoTool(args: {
  count?: number;
  mode?: "soft" | "hard";
}): Promise<string> {
  if (!isGitRepo()) return "Error: Not a git repository.";

  const count = args.count || 1;
  const mode = args.mode || "soft";
  const commits = gitLogDetailed(count + 1);

  if (commits.length === 0) return "Error: No commits to undo.";
  if (count > commits.length) return `Error: Only ${commits.length} commits exist. Cannot undo ${count}.`;
  if (count > 10) return "Error: Refusing to undo more than 10 commits. Use git reset manually for larger rewrites.";

  // Show what's being undone
  const undoing = commits.slice(0, count);
  const targetHash = commits[count - 1].hash;
  const resetTo = `${targetHash}~1`;

  let report = `Undoing ${count} commit(s) (${mode} reset):\n\n`;
  for (const c of undoing) {
    report += `  ✗ ${c.shortHash} ${c.message}  (${c.date})\n`;
  }
  report += "\n";

  // Perform the reset
  const result = mode === "hard"
    ? gitResetHard(resetTo)
    : gitResetSoft(resetTo);

  if (!result.success) {
    return `Error: Git reset failed: ${result.error}`;
  }

  report += `Reset complete (${mode}).`;

  if (mode === "soft") {
    report += " Changes are preserved as staged files.";
  } else {
    report += " All changes have been discarded.";
  }

  // Show post-reset status
  const status = gitStatus();
  if (status) {
    report += `\n\nCurrent status:\n${status}`;
  } else {
    report += "\n\nWorking directory is clean.";
  }

  return report;
}

export async function gitStashTool(args: {
  message?: string;
}): Promise<string> {
  if (!isGitRepo()) return "Error: Not a git repository.";

  const status = gitStatus();
  if (!status) return "Nothing to stash — working directory is clean.";

  const result = gitStash(args.message);

  if (!result.success) {
    return `Error: Stash failed: ${result.error}`;
  }

  return `Changes stashed${args.message ? `: ${args.message}` : ""}. Restore with: git stash pop`;
}
