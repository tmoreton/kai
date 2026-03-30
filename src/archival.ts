import fs from "fs";
import path from "path";
import { ensureProjectDir, ensureGlobalDir, getProjectId } from "./project.js";

/**
 * Archival Memory: Long-term knowledge store.
 * Split into global (cross-project) and per-project knowledge.
 * Uses JSONL format (append-friendly, no full rewrite).
 */

export interface ArchivalEntry {
  id: string;
  content: string;
  tags: string[];
  createdAt: string;
  source?: string;
  projectId?: string;
}

function globalArchivalPath(): string {
  const dir = ensureGlobalDir("archival");
  return path.join(dir, "global.jsonl");
}

function projectArchivalPath(projectId?: string): string {
  const dir = ensureProjectDir("archival", projectId);
  return path.join(dir, "knowledge.jsonl");
}

function appendEntry(filePath: string, entry: ArchivalEntry): void {
  fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
}

function loadEntries(filePath: string): ArchivalEntry[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    return fs.readFileSync(filePath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean) as ArchivalEntry[];
  } catch {
    return [];
  }
}

// --- Public API ---

export function archivalInsert(args: {
  content: string;
  tags?: string[];
  source?: string;
  scope?: "global" | "project";
}): string {
  const scope = args.scope || "project";
  const id = `arch-${Date.now().toString(36)}`;
  const entry: ArchivalEntry = {
    id,
    content: args.content,
    tags: args.tags || [],
    createdAt: new Date().toISOString(),
    source: args.source,
    projectId: scope === "project" ? getProjectId() : undefined,
  };

  const filePath = scope === "global"
    ? globalArchivalPath()
    : projectArchivalPath();

  appendEntry(filePath, entry);
  return `Archived (${scope}/${id}): "${args.content.substring(0, 80)}..."`;
}

export function archivalSearch(args: {
  query: string;
  tags?: string[];
  limit?: number;
  scope?: "global" | "project" | "all";
}): string {
  const scope = args.scope || "all";
  let entries: ArchivalEntry[] = [];

  if (scope === "global" || scope === "all") {
    entries.push(...loadEntries(globalArchivalPath()));
  }
  if (scope === "project" || scope === "all") {
    entries.push(...loadEntries(projectArchivalPath()));
  }

  if (entries.length === 0) return "No archival memories found.";

  const queryLower = args.query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/);

  const scored: { entry: ArchivalEntry; score: number }[] = [];
  for (const entry of entries) {
    const contentLower = entry.content.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      if (contentLower.includes(term)) score++;
    }
    if (args.tags) {
      for (const tag of args.tags) {
        if (entry.tags.includes(tag)) score += 2;
      }
    }
    if (score > 0) scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, args.limit || 5);

  if (results.length === 0) return "No matching archival memories found.";

  return results
    .map(
      (r, i) =>
        `${i + 1}. [${r.entry.id}] (${r.entry.projectId ? "project" : "global"}, tags: ${r.entry.tags.join(", ") || "none"})\n   ${r.entry.content}`
    )
    .join("\n\n");
}

export function archivalList(limit = 20): string {
  const entries = [
    ...loadEntries(globalArchivalPath()),
    ...loadEntries(projectArchivalPath()),
  ];

  if (entries.length === 0) return "No archival memories.";

  return entries
    .slice(-limit)
    .map(
      (e) =>
        `- [${e.id}] ${e.content.substring(0, 100)} (${e.projectId ? "project" : "global"}, tags: ${e.tags.join(", ") || "none"})`
    )
    .join("\n");
}

