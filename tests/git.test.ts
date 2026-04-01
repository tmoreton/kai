import { describe, it, expect } from "vitest";
import {
  isGitRepo,
  gitBranch,
  gitStatus,
  gitLog,
  gitLogDetailed,
  gitInfo,
  gitBaseBranch,
} from "../src/git.js";

describe("git", () => {
  it("detects git repo", () => {
    // We're running from the kai repo, so this should be true
    expect(isGitRepo()).toBe(true);
  });

  it("returns current branch", () => {
    const branch = gitBranch();
    expect(typeof branch).toBe("string");
    expect(branch.length).toBeGreaterThan(0);
  });

  it("returns git status", () => {
    // Status is a string (possibly empty if clean)
    const status = gitStatus();
    expect(typeof status).toBe("string");
  });

  it("returns git log", () => {
    const log = gitLog(5);
    expect(typeof log).toBe("string");
    expect(log.length).toBeGreaterThan(0);
  });

  it("returns detailed log with hashes", () => {
    const commits = gitLogDetailed(5);
    expect(commits.length).toBeGreaterThan(0);
    expect(commits[0]).toHaveProperty("hash");
    expect(commits[0]).toHaveProperty("shortHash");
    expect(commits[0]).toHaveProperty("date");
    expect(commits[0]).toHaveProperty("message");
    expect(commits[0].hash.length).toBe(40); // Full SHA
    expect(commits[0].shortHash.length).toBeGreaterThan(0);
  });

  it("returns git info summary", () => {
    const info = gitInfo();
    expect(info).toContain("Git branch:");
  });

  it("detects base branch", () => {
    const base = gitBaseBranch();
    expect(["main", "master"]).toContain(base);
  });
});
