/**
 * SQLite-based session storage.
 * Replaces JSON file-per-session with a single WAL-mode SQLite database
 * for faster listing, atomic writes, and better scalability.
 */
import Database from "better-sqlite3";
import path from "path";
import { ensureKaiDir } from "../config.js";

/**
 * Deterministic JSON serialization with sorted keys.
 * Produces consistent output for the same data, improving cache
 * friendliness and reducing noise in diffs.
 */
function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value).sort().reduce<Record<string, unknown>>((sorted, k) => {
        sorted[k] = (value as Record<string, unknown>)[k];
        return sorted;
      }, {});
    }
    return value;
  });
}

let db: Database.Database | null = null;

export function getSessionDb(): Database.Database {
  if (db) return db;

  const dbPath = path.join(ensureKaiDir(), "sessions.db");
  db = new Database(dbPath);

  // WAL mode for concurrent reads + single writer
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT,
      cwd TEXT NOT NULL,
      type TEXT DEFAULT 'chat',
      persona_id TEXT,
      model TEXT,
      tags TEXT DEFAULT '[]',
      messages TEXT NOT NULL DEFAULT '[]',
      compacted_at TEXT,
      original_message_count INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_persona ON sessions(persona_id);

    CREATE TABLE IF NOT EXISTS compacted_sessions (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (id) REFERENCES sessions(id)
    );
  `);

  return db;
}

// Prepared statement cache for hot paths
let _stmtUpsert: Database.Statement | null = null;
let _stmtLoad: Database.Statement | null = null;
let _stmtList: Database.Statement | null = null;
let _stmtListAll: Database.Statement | null = null;
let _stmtDelete: Database.Statement | null = null;

function stmtUpsert(): Database.Statement {
  if (!_stmtUpsert) {
    _stmtUpsert = getSessionDb().prepare(`
      INSERT INTO sessions (id, name, cwd, type, persona_id, model, tags, messages, compacted_at, original_message_count, created_at, updated_at)
      VALUES (@id, @name, @cwd, @type, @personaId, @model, @tags, @messages, @compactedAt, @originalMessageCount, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        name = @name,
        cwd = @cwd,
        type = @type,
        persona_id = @personaId,
        model = @model,
        tags = @tags,
        messages = @messages,
        compacted_at = @compactedAt,
        original_message_count = @originalMessageCount,
        updated_at = @updatedAt
    `);
  }
  return _stmtUpsert;
}

function stmtLoad(): Database.Statement {
  if (!_stmtLoad) {
    _stmtLoad = getSessionDb().prepare(`SELECT * FROM sessions WHERE id = ?`);
  }
  return _stmtLoad;
}

function stmtList(): Database.Statement {
  if (!_stmtList) {
    _stmtList = getSessionDb().prepare(`
      SELECT id, name, type, persona_id, model, tags,
             compacted_at, original_message_count,
             created_at, updated_at,
             length(messages) as messages_length,
             json_array_length(messages) as message_count
      FROM sessions
      WHERE id LIKE ? || '%'
      ORDER BY updated_at DESC
      LIMIT ?
    `);
  }
  return _stmtList;
}

function stmtListAll(): Database.Statement {
  if (!_stmtListAll) {
    _stmtListAll = getSessionDb().prepare(`
      SELECT id, name, type, persona_id, model, tags,
             compacted_at, original_message_count,
             created_at, updated_at,
             length(messages) as messages_length,
             json_array_length(messages) as message_count
      FROM sessions
      ORDER BY updated_at DESC
      LIMIT ?
    `);
  }
  return _stmtListAll;
}

function stmtDelete(): Database.Statement {
  if (!_stmtDelete) {
    _stmtDelete = getSessionDb().prepare(`DELETE FROM sessions WHERE id = ?`);
  }
  return _stmtDelete;
}

// ─── Public API (drop-in replacement for file-based manager) ──────────────

export interface SessionRow {
  id: string;
  name: string | null;
  cwd: string;
  type: string;
  persona_id: string | null;
  model: string | null;
  tags: string;
  messages: string;
  compacted_at: string | null;
  original_message_count: number | null;
  created_at: string;
  updated_at: string;
}

export interface SessionListRow {
  id: string;
  name: string | null;
  type: string;
  persona_id: string | null;
  model: string | null;
  tags: string;
  compacted_at: string | null;
  original_message_count: number | null;
  created_at: string;
  updated_at: string;
  messages_length: number;
  message_count: number;
}

export function dbSaveSession(session: {
  id: string;
  name?: string;
  cwd: string;
  type?: string;
  personaId?: string;
  model?: string;
  tags?: string[];
  messages: unknown[];
  compactedAt?: string;
  originalMessageCount?: number;
  createdAt: string;
  updatedAt: string;
}): void {
  stmtUpsert().run({
    id: session.id,
    name: session.name || null,
    cwd: session.cwd,
    type: session.type || "chat",
    personaId: session.personaId || null,
    model: session.model || null,
    tags: stableStringify(session.tags || []),
    messages: stableStringify(session.messages),
    compactedAt: session.compactedAt || null,
    originalMessageCount: session.originalMessageCount || null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
}

export function dbLoadSession(sessionId: string): SessionRow | null {
  return (stmtLoad().get(sessionId) as SessionRow) || null;
}

export function dbListSessions(
  projectPrefix: string,
  limit: number,
  allProjects: boolean
): SessionListRow[] {
  if (allProjects) {
    return stmtListAll().all(limit) as SessionListRow[];
  }
  return stmtList().all(projectPrefix, limit) as SessionListRow[];
}

export function dbDeleteSession(sessionId: string): boolean {
  const result = stmtDelete().run(sessionId);
  // Also delete compacted version
  getSessionDb().prepare(`DELETE FROM compacted_sessions WHERE id = ?`).run(sessionId);
  return result.changes > 0;
}

export function dbSaveCompacted(sessionId: string, data: string): void {
  getSessionDb().prepare(`
    INSERT INTO compacted_sessions (id, data)
    VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET data = ?, created_at = datetime('now')
  `).run(sessionId, data, data);
}

export function dbLoadCompacted(sessionId: string): string | null {
  const row = getSessionDb()
    .prepare(`SELECT data FROM compacted_sessions WHERE id = ?`)
    .get(sessionId) as { data: string } | undefined;
  return row?.data || null;
}

export function dbCleanupSessions(maxAgeDays: number): number {
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  const result = getSessionDb()
    .prepare(`DELETE FROM sessions WHERE updated_at < ?`)
    .run(cutoff);
  // Clean orphaned compacted sessions
  getSessionDb().exec(`DELETE FROM compacted_sessions WHERE id NOT IN (SELECT id FROM sessions)`);
  return result.changes;
}

export function dbFindSessionByPersona(personaId: string, limit = 100): SessionListRow[] {
  return getSessionDb()
    .prepare(`
      SELECT id, name, type, persona_id, model, tags,
             compacted_at, original_message_count,
             created_at, updated_at,
             length(messages) as messages_length,
             json_array_length(messages) as message_count
      FROM sessions
      WHERE persona_id = ?
      ORDER BY message_count DESC, updated_at DESC
      LIMIT ?
    `)
    .all(personaId, limit) as SessionListRow[];
}

export function dbFindSessionByTag(tag: string): SessionListRow | null {
  // Use JSON search since tags is stored as a JSON array
  const row = getSessionDb()
    .prepare(`
      SELECT id, name, type, persona_id, model, tags,
             compacted_at, original_message_count,
             created_at, updated_at,
             length(messages) as messages_length,
             json_array_length(messages) as message_count
      FROM sessions
      WHERE json_each.value = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `)
    .bind(tag);

  // Simpler approach: filter in-memory since tag searches are rare
  const all = getSessionDb()
    .prepare(`
      SELECT id, name, type, persona_id, model, tags,
             compacted_at, original_message_count,
             created_at, updated_at,
             length(messages) as messages_length,
             json_array_length(messages) as message_count
      FROM sessions
      ORDER BY updated_at DESC
    `)
    .all() as SessionListRow[];

  return all.find((r) => {
    try {
      const tags: string[] = JSON.parse(r.tags);
      return tags.includes(tag);
    } catch {
      return false;
    }
  }) || null;
}
