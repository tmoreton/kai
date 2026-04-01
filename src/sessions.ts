import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { ensureKaiDir } from "./config.js";
import chalk from "chalk";

export interface Session {
  id: string;
  name?: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatCompletionMessageParam[];
  type?: "chat" | "code";
}

function sessionsDir(): string {
  const dir = path.join(ensureKaiDir(), "sessions");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function projectKey(): string {
  // Hash the cwd to group sessions by project
  return crypto
    .createHash("md5")
    .update(process.cwd())
    .digest("hex")
    .substring(0, 8);
}

export function generateSessionId(): string {
  return `${projectKey()}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

export function saveSession(session: Session): void {
  session.updatedAt = new Date().toISOString();
  const filePath = path.join(sessionsDir(), `${session.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8");
}

export function loadSession(sessionId: string): Session | null {
  const filePath = path.join(sessionsDir(), `${sessionId}.json`);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch {
    // corrupt session
  }
  return null;
}

export function listSessions(limit = 20, allProjects = false): Session[] {
  const dir = sessionsDir();
  const prefix = projectKey();

  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => (allProjects || f.startsWith(prefix)) && f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, limit);

    return files
      .map((f) => {
        try {
          return JSON.parse(
            fs.readFileSync(path.join(dir, f), "utf-8")
          ) as Session;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Session[];
  } catch {
    return [];
  }
}

export function deleteSession(sessionId: string): boolean {
  const filePath = path.join(sessionsDir(), `${sessionId}.json`);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch {}
  return false;
}

export function getMostRecentSession(): Session | null {
  const sessions = listSessions(1);
  return sessions[0] || null;
}

/**
 * Delete sessions older than `maxAgeDays`.
 * Returns number of sessions removed.
 */
export function cleanupSessions(maxAgeDays = 30): number {
  const dir = sessionsDir();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          removed++;
        }
      } catch {}
    }
  } catch {}

  return removed;
}

export function formatSessionList(sessions: Session[]): string {
  if (sessions.length === 0) return chalk.dim("  No sessions found.");

  return sessions
    .map((s) => {
      const date = new Date(s.updatedAt).toLocaleString();
      const msgs = s.messages.filter((m) => m.role === "user").length;
      const name = s.name || s.id;
      return `  ${chalk.cyan(name)} ${chalk.dim(`(${msgs} messages, ${date})`)}`;
    })
    .join("\n");
}
