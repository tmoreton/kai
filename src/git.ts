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
