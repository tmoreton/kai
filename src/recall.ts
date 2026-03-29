import fs from "fs";
import path from "path";
import { ensureProjectDir, getProjectId, listProjects } from "./project.js";

/**
 * Recall Memory: Searchable archive of past conversations.
 * Stored per-project as JSONL files (append-only, no full rewrite).
 */

export interface RecallEntry {
  sessionId: string;
  timestamp: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
}

function recallFilePath(projectId?: string): string {
  const dir = ensureProjectDir("recall", projectId);
  return path.join(dir, "history.jsonl");
}

export function appendRecall(entries: RecallEntry[], projectId?: string): void {
  const filePath = recallFilePath(projectId);
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.appendFileSync(filePath, lines, "utf-8");
}

function searchFile(filePath: string, queryTerms: string[], limit: number): { entry: RecallEntry; score: number }[] {
  if (!fs.existsSync(filePath)) return [];

  try {
    const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
    const scored: { entry: RecallEntry; score: number }[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as RecallEntry;
        const contentLower = entry.content.toLowerCase();
        let score = 0;
        for (const term of queryTerms) {
          if (contentLower.includes(term)) score++;
        }
        if (score > 0) scored.push({ entry, score });
      } catch { continue; }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.entry.timestamp.localeCompare(a.entry.timestamp);
    });

    return scored.slice(0, limit);
  } catch {
    return [];
  }
}

export function searchRecall(
  query: string,
  limit = 10,
  scope: "project" | "all" = "project"
): RecallEntry[] {
  const queryTerms = query.toLowerCase().split(/\s+/);

  if (scope === "project") {
    return searchFile(recallFilePath(), queryTerms, limit).map((s) => s.entry);
  }

  // Search across all projects
  const allResults: { entry: RecallEntry; score: number }[] = [];
  const projects = listProjects();

  for (const proj of projects) {
    const filePath = path.join(
      path.resolve(process.env.HOME || "~", ".kai/recall/projects", proj.id),
      "history.jsonl"
    );
    allResults.push(...searchFile(filePath, queryTerms, limit));
  }

  // Also search global
  const globalPath = path.join(
    path.resolve(process.env.HOME || "~", ".kai/recall/projects/__global__"),
    "history.jsonl"
  );
  allResults.push(...searchFile(globalPath, queryTerms, limit));

  allResults.sort((a, b) => b.score - a.score);
  return allResults.slice(0, limit).map((s) => s.entry);
}

export function getRecallStats(): { totalEntries: number; fileSizeKB: number } {
  const filePath = recallFilePath();
  if (!fs.existsSync(filePath)) return { totalEntries: 0, fileSizeKB: 0 };

  try {
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    return {
      totalEntries: lines.length,
      fileSizeKB: Math.round(stat.size / 1024),
    };
  } catch {
    return { totalEntries: 0, fileSizeKB: 0 };
  }
}
