import fs from "fs";
import path from "path";
import { ensureKaiDir } from "./config.js";

/**
 * Archival Memory: Long-term knowledge store.
 * Unlike recall (auto-populated from conversations), archival memory
 * is explicitly curated — the agent decides what to store here.
 * Used for: learned facts, user preferences, project knowledge, research notes.
 */

export interface ArchivalEntry {
  id: string;
  content: string;
  tags: string[];
  createdAt: string;
  source?: string; // Where this knowledge came from
}

function archivalDir(): string {
  const dir = path.join(ensureKaiDir(), "archival");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function archivalFilePath(): string {
  return path.join(archivalDir(), "knowledge.json");
}

function loadArchival(): ArchivalEntry[] {
  const filePath = archivalFilePath();
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch {
    // corrupt file
  }
  return [];
}

function saveArchival(entries: ArchivalEntry[]): void {
  fs.writeFileSync(archivalFilePath(), JSON.stringify(entries, null, 2), "utf-8");
}

export function archivalInsert(args: {
  content: string;
  tags?: string[];
  source?: string;
}): string {
  const entries = loadArchival();
  const id = `arch-${Date.now().toString(36)}`;
  entries.push({
    id,
    content: args.content,
    tags: args.tags || [],
    createdAt: new Date().toISOString(),
    source: args.source,
  });
  saveArchival(entries);
  return `Archived knowledge (${id}): "${args.content.substring(0, 80)}..."`;
}

export function archivalSearch(args: {
  query: string;
  tags?: string[];
  limit?: number;
}): string {
  const entries = loadArchival();
  if (entries.length === 0) return "No archival memories found.";

  const queryLower = args.query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/);

  const scored: { entry: ArchivalEntry; score: number }[] = [];
  for (const entry of entries) {
    const contentLower = entry.content.toLowerCase();
    let score = 0;

    // Score by keyword match
    for (const term of queryTerms) {
      if (contentLower.includes(term)) score++;
    }

    // Boost by tag match
    if (args.tags) {
      for (const tag of args.tags) {
        if (entry.tags.includes(tag)) score += 2;
      }
    }

    if (score > 0) {
      scored.push({ entry, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, args.limit || 5);

  if (results.length === 0) return "No matching archival memories found.";

  return results
    .map(
      (r, i) =>
        `${i + 1}. [${r.entry.id}] (tags: ${r.entry.tags.join(", ") || "none"})\n   ${r.entry.content}`
    )
    .join("\n\n");
}

export function archivalList(limit = 20): string {
  const entries = loadArchival();
  if (entries.length === 0) return "No archival memories.";

  return entries
    .slice(-limit)
    .map(
      (e) =>
        `- [${e.id}] ${e.content.substring(0, 100)} (tags: ${e.tags.join(", ") || "none"})`
    )
    .join("\n");
}

export function archivalDelete(id: string): string {
  const entries = loadArchival();
  const index = entries.findIndex((e) => e.id === id);
  if (index === -1) return `Archival entry "${id}" not found.`;
  entries.splice(index, 1);
  saveArchival(entries);
  return `Archival entry "${id}" deleted.`;
}
