/**
 * Enhanced session manager with compaction, usage tracking, and resume flows.
 * Uses SQLite for fast listing and atomic writes (inspired by claw-code).
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { ensureKaiDir } from "../config.js";
import { compactSession, shouldCompact, getSessionStats } from "./compact.js";
import {
  dbSaveSession,
  dbLoadSession,
  dbListSessions,
  dbDeleteSession,
  dbSaveCompacted,
  dbLoadCompacted,
  dbCleanupSessions,
  dbFindSessionByPersona,
  dbFindSessionByTag,
  type SessionListRow,
} from "./session-db.js";

export interface Session {
  id: string;
  name?: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatCompletionMessageParam[];
  type?: "chat" | "code" | "agent";
  /** Links session to a persona for persistent agent chats */
  personaId?: string;
  /** Session tags for filtering/grouping */
  tags?: string[];
  /** Provider/model used */
  model?: string;
  /** Compact metadata saved to session */
  compactedAt?: string;
  originalMessageCount?: number;
}

export interface SessionMetadata {
  id: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  estimatedTokens: number;
  type?: string;
  tags?: string[];
  personaId?: string;
}

function projectKey(): string {
  return crypto
    .createHash("md5")
    .update(process.cwd())
    .digest("hex")
    .substring(0, 8);
}

export function generateSessionId(): string {
  return `${projectKey()}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

// Debounced save state
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingSave: Session | null = null;

export function saveSession(session: Session): void {
  session.updatedAt = new Date().toISOString();
  _pendingSave = session;

  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    if (_pendingSave) {
      try {
        dbSaveSession({
          id: _pendingSave.id,
          name: _pendingSave.name,
          cwd: _pendingSave.cwd,
          type: _pendingSave.type,
          personaId: _pendingSave.personaId,
          model: _pendingSave.model,
          tags: _pendingSave.tags,
          messages: _pendingSave.messages,
          compactedAt: _pendingSave.compactedAt,
          originalMessageCount: _pendingSave.originalMessageCount,
          createdAt: _pendingSave.createdAt,
          updatedAt: _pendingSave.updatedAt,
        });
      } catch {}
      _pendingSave = null;
    }
    _saveTimer = null;
  }, 1000);
}

export function saveSessionSync(session: Session): void {
  if (_saveTimer) clearTimeout(_saveTimer);
  _pendingSave = null;
  session.updatedAt = new Date().toISOString();
  dbSaveSession({
    id: session.id,
    name: session.name,
    cwd: session.cwd,
    type: session.type,
    personaId: session.personaId,
    model: session.model,
    tags: session.tags,
    messages: session.messages,
    compactedAt: session.compactedAt,
    originalMessageCount: session.originalMessageCount,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
}

export function loadSession(sessionId: string): Session | null {
  try {
    const row = dbLoadSession(sessionId);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name || undefined,
      cwd: row.cwd,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: JSON.parse(row.messages),
      type: (row.type as Session["type"]) || undefined,
      personaId: row.persona_id || undefined,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      model: row.model || undefined,
      compactedAt: row.compacted_at || undefined,
      originalMessageCount: row.original_message_count || undefined,
    };
  } catch {
    return null;
  }
}

export function loadCompactedSession(sessionId: string): Session | null {
  try {
    const data = dbLoadCompacted(sessionId);
    if (!data) return null;
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Compact a session and save both versions.
 */
export function compactAndSave(session: Session): Session {
  const result = compactSession(session.messages);

  // Save original to compacted storage
  dbSaveCompacted(session.id, JSON.stringify(session));

  // Update session with compacted messages
  session.messages = [session.messages[0], result.summaryMessage, ...session.messages.slice(-result.compactedCount + 2)];
  session.compactedAt = new Date().toISOString();
  session.originalMessageCount = result.originalCount;

  // Save compacted version
  saveSessionSync(session);

  return session;
}

/**
 * Check and auto-compact if needed.
 */
export function autoCompact(session: Session): { compacted: boolean; stats?: ReturnType<typeof getSessionStats> } {
  const stats = getSessionStats(session.messages);

  if (stats.needsCompaction) {
    compactAndSave(session);
    return { compacted: true, stats };
  }

  return { compacted: false, stats };
}

/** Convert a SQLite list row to SessionMetadata */
function rowToMetadata(row: SessionListRow): SessionMetadata {
  // Fast token estimate: ~4 chars per token
  const estimatedTokens = Math.ceil(row.messages_length / 4);
  return {
    id: row.id,
    name: row.name || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
    estimatedTokens,
    type: row.type || undefined,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    personaId: row.persona_id || undefined,
  };
}

export function listSessions(limit = 20, allProjects = false): SessionMetadata[] {
  try {
    const prefix = projectKey();
    const rows = dbListSessions(prefix, limit, allProjects);
    return rows.map(rowToMetadata);
  } catch {
    return [];
  }
}

export function deleteSession(sessionId: string): boolean {
  return dbDeleteSession(sessionId);
}

export function getMostRecentSession(): Session | null {
  const sessions = listSessions(1);
  if (sessions.length === 0) return null;
  return loadSession(sessions[0].id);
}

export function findSessionByPersona(personaId: string): Session | null {
  try {
    const rows = dbFindSessionByPersona(personaId);
    if (rows.length === 0) return null;
    return loadSession(rows[0].id);
  } catch {
    return null;
  }
}

export function findSessionByTag(tag: string): SessionMetadata | null {
  try {
    const row = dbFindSessionByTag(tag);
    if (!row) return null;
    return rowToMetadata(row);
  } catch {
    return null;
  }
}

export function cleanupSessions(maxAgeDays = 30): number {
  try {
    return dbCleanupSessions(maxAgeDays);
  } catch {
    return 0;
  }
}

export function formatSessionList(sessions: SessionMetadata[]): string {
  if (sessions.length === 0) return "  No sessions found.";

  return sessions
    .map((s) => {
      const date = new Date(s.updatedAt).toLocaleString();
      const userMsgs = Math.floor(s.messageCount / 2);
      const tokens = s.estimatedTokens > 1000 ? `${Math.round(s.estimatedTokens / 1000)}k` : s.estimatedTokens;
      const tagStr = s.tags?.length ? ` [${s.tags.join(", ")}]` : "";

      return `  ${s.name || s.id} ${tagStr}\n    ${userMsgs} exchanges · ${tokens} tokens · ${date}`;
    })
    .join("\n\n");
}

// Re-export for backward compatibility
export { compactSession, shouldCompact, getSessionStats };
