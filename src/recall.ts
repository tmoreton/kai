import fs from "fs";
import path from "path";
import { ensureKaiDir } from "./config.js";

/**
 * Recall Memory: Searchable archive of past conversations.
 * When messages are compacted/evicted from context, they're stored here.
 * The agent can search recall memory to find past exchanges.
 */

export interface RecallEntry {
  sessionId: string;
  timestamp: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
}

function recallDir(): string {
  const dir = path.join(ensureKaiDir(), "recall");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function recallFilePath(): string {
  return path.join(recallDir(), "history.jsonl");
}

export function appendRecall(entries: RecallEntry[]): void {
  const filePath = recallFilePath();
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.appendFileSync(filePath, lines, "utf-8");
}

export function searchRecall(query: string, limit = 10): RecallEntry[] {
  const filePath = recallFilePath();
  if (!fs.existsSync(filePath)) return [];

  try {
    const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/);

    // Score each entry by keyword match
    const scored: { entry: RecallEntry; score: number }[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as RecallEntry;
        const contentLower = entry.content.toLowerCase();

        // Count matching terms
        let score = 0;
        for (const term of queryTerms) {
          if (contentLower.includes(term)) score++;
        }

        if (score > 0) {
          scored.push({ entry, score });
        }
      } catch {
        continue;
      }
    }

    // Sort by score descending, then by timestamp descending
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.entry.timestamp.localeCompare(a.entry.timestamp);
    });

    return scored.slice(0, limit).map((s) => s.entry);
  } catch {
    return [];
  }
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
