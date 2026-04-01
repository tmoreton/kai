import { execSync } from "child_process";
import { getCwd } from "./tools/bash.js";

export function isGitRepo(): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: getCwd(),
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

export function gitBranch(): string {
  try {
    return execSync("git branch --show-current", {
      cwd: getCwd(),
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch {
    return "";
  }
}

export function gitStatus(): string {
  try {
    return execSync("git status --short", {
      cwd: getCwd(),
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch {
    return "";
  }
}

export function gitDiff(staged = false): string {
  try {
    const flag = staged ? "--cached" : "";
    return execSync(`git diff ${flag}`, {
      cwd: getCwd(),
      encoding: "utf-8",
      stdio: "pipe",
      maxBuffer: 5 * 1024 * 1024,
    }).trim();
  } catch {
    return "";
  }
}

export function gitLog(count = 10): string {
  try {
    return execSync(
      `git log --oneline -${count}`,
      {
        cwd: getCwd(),
        encoding: "utf-8",
        stdio: "pipe",
      }
    ).trim();
  } catch {
    return "";
  }
}

export function gitInfo(): string {
  if (!isGitRepo()) return "";

  const branch = gitBranch();
  const status = gitStatus();
  const changedFiles = status
    ? status.split("\n").length
    : 0;

  let info = `Git branch: ${branch}`;
  if (changedFiles > 0) {
    info += ` (${changedFiles} changed files)`;
  }
  return info;
}

export function gitBaseBranch(): string {
  // Detect main or master using word-boundary matching
  try {
    const branches = execSync("git branch -a", {
      cwd: getCwd(),
      encoding: "utf-8",
      stdio: "pipe",
    });
    // Match exact branch names (not substrings like "feature/main-thing")
    const branchList = branches.split("\n").map((b) => b.replace(/^\*?\s+/, "").replace(/^remotes\/origin\//, "").trim());
    if (branchList.includes("main")) return "main";
    if (branchList.includes("master")) return "master";
  } catch {}
  return "main";
}

export function gitRemote(): string {
  try {
    return execSync("git remote get-url origin", {
      cwd: getCwd(),
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch {
    return "";
  }
}

export function gitDiffAgainstBase(base?: string): string {
  const baseBranch = base || gitBaseBranch();
  try {
    return execSync(`git diff ${baseBranch}...HEAD`, {
      cwd: getCwd(),
      encoding: "utf-8",
      stdio: "pipe",
      maxBuffer: 5 * 1024 * 1024,
    }).trim();
  } catch {
    return "";
  }
}

export function gitListBranches(): string {
  try {
    return execSync("git branch -vv", {
      cwd: getCwd(),
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch {
    return "";
  }
}

export function ghAvailable(): boolean {
  try {
    execSync("gh --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get recent commits with hash, date, and message.
 * Used by /git undo to let user pick which commit to rewind to.
 */
export function gitLogDetailed(count = 15): Array<{
  hash: string;
  shortHash: string;
  date: string;
  message: string;
}> {
  try {
    const raw = execSync(
      `git log --format="%H|%h|%ar|%s" -${count}`,
      { cwd: getCwd(), encoding: "utf-8", stdio: "pipe" }
    ).trim();
    if (!raw) return [];
    return raw.split("\n").map((line) => {
      const [hash, shortHash, date, ...msgParts] = line.split("|");
      return { hash, shortHash, date, message: msgParts.join("|") };
    });
  } catch {
    return [];
  }
}

/**
 * Get the diff of a specific commit.
 */
export function gitShowCommit(hash: string): string {
  try {
    return execSync(`git show --stat --format="%H %s" ${hash}`, {
      cwd: getCwd(),
      encoding: "utf-8",
      stdio: "pipe",
      maxBuffer: 5 * 1024 * 1024,
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Soft-reset to a specific commit (keeps changes as unstaged).
 */
export function gitResetSoft(hash: string): { success: boolean; error?: string } {
  try {
    execSync(`git reset --soft ${hash}`, {
      cwd: getCwd(),
      encoding: "utf-8",
      stdio: "pipe",
    });
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * Hard-reset to a specific commit (discards all changes).
 */
export function gitResetHard(hash: string): { success: boolean; error?: string } {
  try {
    execSync(`git reset --hard ${hash}`, {
      cwd: getCwd(),
      encoding: "utf-8",
      stdio: "pipe",
    });
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * Stash current uncommitted changes.
 */
export function gitStash(message?: string): { success: boolean; error?: string } {
  try {
    const cmd = message
      ? `git stash push -m "${message.replace(/"/g, '\\"')}"`
      : "git stash push";
    execSync(cmd, { cwd: getCwd(), encoding: "utf-8", stdio: "pipe" });
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * Get diff between a commit and the current HEAD.
 */
export function gitDiffBetween(fromHash: string, toHash = "HEAD"): string {
  try {
    return execSync(`git diff ${fromHash} ${toHash}`, {
      cwd: getCwd(),
      encoding: "utf-8",
      stdio: "pipe",
      maxBuffer: 5 * 1024 * 1024,
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Get the commit hash at the start of the current session (by timestamp).
 */
export function gitCommitAtTime(isoTimestamp: string): string {
  try {
    return execSync(
      `git log --before="${isoTimestamp}" --format="%H" -1`,
      { cwd: getCwd(), encoding: "utf-8", stdio: "pipe" }
    ).trim();
  } catch {
    return "";
  }
}

/**
 * Get list of files changed between two commits.
 */
export function gitFilesChangedBetween(fromHash: string, toHash = "HEAD"): string[] {
  try {
    const raw = execSync(`git diff --name-only ${fromHash} ${toHash}`, {
      cwd: getCwd(),
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    return raw ? raw.split("\n") : [];
  } catch {
    return [];
  }
}
