/**
 * Git Tools Skill Handler
 *
 * Git operations with safety checks and structured output.
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
} from "../../../git.js";

import type { SkillHandler } from "../../types.js";

const actions: Record<string, (params: Record<string, any>) => Promise<string>> = {
  async log(params: Record<string, any>): Promise<string> {
    if (!isGitRepo()) return "Error: Not a git repository.";

    const count = params.count || 15;
    const commits = gitLogDetailed(count);

    if (commits.length === 0) return "No commits found.";

    const lines = commits.map((c, i) =>
      `${String(i + 1).padStart(2)}. ${c.shortHash} ${c.message}  (${c.date})`
    );

    return `Recent commits (${commits.length}):\n\n${lines.join("\n")}`;
  },

  async diff_session(params: Record<string, any>): Promise<string> {
    if (!isGitRepo()) return "Error: Not a git repository.";

    const startHash = gitCommitAtTime(params.session_start);

    if (!startHash) {
      const staged = gitDiff(true);
      const unstaged = gitDiff(false);
      if (!staged && !unstaged) return "No changes since session started.";
      return `Changes this session (uncommitted only):\n\n${staged || ""}${staged && unstaged ? "\n" : ""}${unstaged || ""}`;
    }

    const committedDiff = gitDiffBetween(startHash, "HEAD");
    const uncommittedDiff = gitDiff(false) || gitDiff(true) || "";
    const filesChanged = gitFilesChangedBetween(startHash, "HEAD");

    if (!committedDiff && !uncommittedDiff) return "No changes since session started.";

    let output = `Session diff (since ${new Date(params.session_start).toLocaleTimeString()}):\n\n`;

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
  },

  async undo(params: Record<string, any>): Promise<string> {
    if (!isGitRepo()) return "Error: Not a git repository.";

    const count = params.count || 1;
    const mode = params.mode || "soft";
    const commits = gitLogDetailed(count + 1);

    if (commits.length === 0) return "Error: No commits to undo.";
    if (count > commits.length) return `Error: Only ${commits.length} commits exist. Cannot undo ${count}.`;
    if (count > 10) return "Error: Refusing to undo more than 10 commits. Use git reset manually for larger rewrites.";

    const undoing = commits.slice(0, count);
    const targetHash = commits[count - 1].hash;
    const resetTo = `${targetHash}~1`;

    let report = `Undoing ${count} commit(s) (${mode} reset):\n\n`;
    for (const c of undoing) {
      report += `  ✗ ${c.shortHash} ${c.message}  (${c.date})\n`;
    }
    report += "\n";

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

    const status = gitStatus();
    if (status) {
      report += `\n\nCurrent status:\n${status}`;
    } else {
      report += "\n\nWorking directory is clean.";
    }

    return report;
  },

  async stash(params: Record<string, any>): Promise<string> {
    if (!isGitRepo()) return "Error: Not a git repository.";

    const status = gitStatus();
    if (!status) return "Nothing to stash — working directory is clean.";

    const result = gitStash(params.message);

    if (!result.success) {
      return `Error: Stash failed: ${result.error}`;
    }

    return `Changes stashed${params.message ? `: ${params.message}` : ""}. Restore with: git stash pop`;
  },
};

const handler: SkillHandler = {
  actions,
};

export default handler;
