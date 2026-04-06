/**
 * Database migration runner for Kai
 * Bundled migrations run automatically on first startup for any user.
 * Additional migrations can be placed in ~/.kai/migrations/ for local customization.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { ensureKaiDir } from "../config.js";

const MIGRATIONS_DIR = path.join(ensureKaiDir(), "migrations");

// ─── Bundled Migrations ───────────────────────────────────────────────────────
// These are embedded directly so the app works on first run without any
// external files. Named to match the files in ~/.kai/migrations/ so they
// are skipped if a user already applied the file-based version.

const BUNDLED_MIGRATIONS: Array<{ name: string; sql: string }> = [
  {
    name: "000_initial_schema.sql",
    sql: `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  workflow_path TEXT,
  schedule TEXT,
  enabled INTEGER DEFAULT 1,
  config TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agents_enabled ON agents(enabled);
CREATE INDEX IF NOT EXISTS idx_agents_schedule ON agents(schedule);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  version TEXT,
  schedule TEXT,
  enabled INTEGER DEFAULT 1,
  last_run_at TEXT,
  config TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_workflows_schedule ON workflows(schedule);
CREATE INDEX IF NOT EXISTS idx_workflows_enabled ON workflows(enabled);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  trigger TEXT DEFAULT 'manual',
  recap TEXT,
  current_step INTEGER DEFAULT 0,
  context TEXT DEFAULT '{}',
  parent_run_id TEXT,
  goal_id TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at);
CREATE INDEX IF NOT EXISTS idx_runs_status_started ON runs(status, started_at);

CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  step_name TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  input TEXT,
  output TEXT,
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  tokens_used INTEGER DEFAULT 0,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_steps_run ON steps(run_id);
CREATE INDEX IF NOT EXISTS idx_steps_status ON steps(status);

CREATE TABLE IF NOT EXISTS checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  context TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_run ON checkpoints(run_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_step ON checkpoints(run_id, step_index);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT,
  run_id TEXT,
  level TEXT DEFAULT 'info',
  message TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_logs_agent ON logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT DEFAULT 'agent_run',
  title TEXT NOT NULL,
  body TEXT,
  agent_id TEXT,
  run_id TEXT,
  read INTEGER DEFAULT 0,
  attachments TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_agent_type ON notifications(agent_id, type, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  step_name TEXT NOT NULL,
  prompt TEXT,
  context TEXT,
  approved INTEGER,
  response TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_approvals_run ON approvals(run_id);
CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(approved);

CREATE TABLE IF NOT EXISTS error_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL,
  source TEXT NOT NULL,
  error_class TEXT,
  error_code TEXT,
  message TEXT NOT NULL,
  stack TEXT,
  context TEXT,
  count INTEGER DEFAULT 1,
  first_seen TEXT DEFAULT (datetime('now')),
  last_seen TEXT DEFAULT (datetime('now')),
  resolved INTEGER DEFAULT 0,
  healing_run_id TEXT,
  FOREIGN KEY (healing_run_id) REFERENCES runs(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_error_fingerprint ON error_events(fingerprint);
CREATE INDEX IF NOT EXISTS idx_error_unresolved ON error_events(resolved, last_seen);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  priority INTEGER DEFAULT 3,
  status TEXT DEFAULT 'pending',
  parent_goal_id TEXT,
  sub_goal_ids TEXT DEFAULT '[]',
  context TEXT,
  result TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (parent_goal_id) REFERENCES goals(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
CREATE INDEX IF NOT EXISTS idx_goals_parent ON goals(parent_goal_id);

CREATE TABLE IF NOT EXISTS goal_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  sub_goal_id TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_goal_runs_goal ON goal_runs(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_runs_run ON goal_runs(run_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT,
  cwd TEXT NOT NULL,
  type TEXT DEFAULT 'chat',
  agent_id TEXT,
  model TEXT,
  tags TEXT DEFAULT '[]',
  messages TEXT NOT NULL DEFAULT '[]',
  compacted_at TEXT,
  original_message_count INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_cwd ON sessions(cwd);

CREATE TABLE IF NOT EXISTS compacted_sessions (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  last_accessed TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
CREATE INDEX IF NOT EXISTS idx_projects_accessed ON projects(last_accessed);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  type TEXT DEFAULT 'string',
  category TEXT DEFAULT 'general',
  description TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);

CREATE TABLE IF NOT EXISTS profiles (
  project_id TEXT PRIMARY KEY,
  context TEXT,
  preferences TEXT,
  custom_instructions TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT,
  agent_id TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL,
  UNIQUE(date, metric, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_usage_date ON usage(date);
CREATE INDEX IF NOT EXISTS idx_usage_metric ON usage(metric);
CREATE INDEX IF NOT EXISTS idx_usage_agent ON usage(agent_id);
CREATE INDEX IF NOT EXISTS idx_usage_date_metric ON usage(date, metric);

CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft',
  hypothesis TEXT,
  success_metric TEXT,
  start_date TEXT,
  end_date TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS experiment_variants (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT NOT NULL,
  traffic_percentage REAL DEFAULT 50,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS experiment_runs (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  run_id TEXT,
  result TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id) REFERENCES experiment_variants(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO settings (key, value, type, category, description) VALUES
  ('theme', 'system', 'string', 'ui', 'UI theme: light, dark, system'),
  ('default_model', 'claude-3-5-sonnet', 'string', 'ai', 'Default LLM model'),
  ('auto_run_agents', 'false', 'boolean', 'agents', 'Automatically run scheduled agents'),
  ('email_notifications', 'true', 'boolean', 'notifications', 'Send email notifications'),
  ('slack_notifications', 'false', 'boolean', 'notifications', 'Send Slack notifications'),
  ('compact_threshold', '50', 'number', 'ai', 'Message count before auto-compact'),
  ('max_tokens', '8000', 'number', 'ai', 'Maximum tokens per request'),
  ('temperature', '0.7', 'number', 'ai', 'LLM temperature');

CREATE VIEW IF NOT EXISTS v_agents_status AS
SELECT
  a.id, a.name, a.enabled, a.schedule,
  COUNT(r.id) as total_runs,
  MAX(r.started_at) as last_run_at,
  CASE
    WHEN r.status = 'running' THEN 'running'
    WHEN r.status = 'failed' AND r.started_at > datetime('now', '-1 day') THEN 'recently_failed'
    ELSE 'idle'
  END as current_status
FROM agents a
LEFT JOIN runs r ON a.id = r.agent_id
GROUP BY a.id;

CREATE VIEW IF NOT EXISTS v_usage_daily AS
SELECT date, metric, SUM(value) as total, unit
FROM usage
GROUP BY date, metric, unit
ORDER BY date DESC;

CREATE VIEW IF NOT EXISTS v_recent_errors AS
SELECT fingerprint, error_class, message, count, first_seen, last_seen, resolved,
  json_extract(context, '$.source') as error_source,
  json_extract(context, '$.toolName') as tool_name
FROM error_events
WHERE last_seen > datetime('now', '-7 days')
ORDER BY last_seen DESC;
    `.trim(),
  },
  {
    name: "001_usage_unique_constraint.sql",
    sql: `
-- Add unique constraint for usage table upserts (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_unique ON usage(date, metric, agent_id);
    `.trim(),
  },
  {
    name: "003_system_agent.sql",
    sql: `
-- Create system agent for daemon and system-level logs
INSERT OR IGNORE INTO agents (id, name, description, workflow_path, schedule, enabled, config, created_at, updated_at)
VALUES ('__daemon__', 'System Daemon', 'Internal system agent for daemon logs and system events', '', '', 0, '{}', datetime('now'), datetime('now'));
    `.trim(),
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDb(): Database.Database {
  const dbPath = path.join(ensureKaiDir(), "agents.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function getAppliedMigrations(db: Database.Database): string[] {
  ensureMigrationsTable(db);
  const rows = db.prepare("SELECT name FROM _migrations ORDER BY id").all() as { name: string }[];
  return rows.map(r => r.name);
}

function recordMigration(db: Database.Database, name: string): void {
  db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(name);
}

// ─── Session Migration (legacy) ───────────────────────────────────────────────

/**
 * Migrate sessions from old sessions.db to agents.db (one-time, legacy support).
 */
export function migrateSessions(): { copied: number; errors: number } {
  const kaiDir = ensureKaiDir();
  const sessionsPath = path.join(kaiDir, "sessions.db");

  if (!fs.existsSync(sessionsPath) || fs.statSync(sessionsPath).size === 0) {
    return { copied: 0, errors: 0 };
  }

  const db = getDb();
  let copied = 0;
  let errors = 0;

  try {
    db.exec(`ATTACH DATABASE '${sessionsPath}' AS sessions_db`);

    const hasTable = db.prepare(
      `SELECT name FROM sessions_db.sqlite_master WHERE type='table' AND name='sessions'`
    ).get();

    if (hasTable) {
      const result = db.prepare(`
        INSERT OR REPLACE INTO sessions (
          id, name, cwd, type, agent_id, model, tags, messages,
          compacted_at, original_message_count, created_at, updated_at
        )
        SELECT id, name, cwd, type, persona_id, model, tags, messages,
          compacted_at, original_message_count, created_at, updated_at
        FROM sessions_db.sessions
      `).run();
      copied = result.changes;

      db.prepare(`
        INSERT OR REPLACE INTO compacted_sessions (id, data, created_at)
        SELECT id, data, created_at FROM sessions_db.compacted_sessions
      `).run();

      db.exec(`DETACH DATABASE sessions_db`);
      fs.renameSync(sessionsPath, sessionsPath + ".bak");
      console.log(`✓ Migrated ${copied} sessions from sessions.db`);
    }
  } catch (e: any) {
    console.error("Failed to migrate sessions:", e.message);
    errors++;
  }

  db.close();
  return { copied, errors };
}

// ─── Main Migration Runner ────────────────────────────────────────────────────

/**
 * Run all pending migrations (bundled first, then ~/.kai/migrations/).
 * Safe to call on every startup — skips already-applied migrations.
 */
export function migrate(): { applied: number; skipped: number } {
  const db = getDb();
  const applied = getAppliedMigrations(db);

  let appliedCount = 0;
  let skippedCount = 0;

  // 1. Bundled migrations (always available, work on fresh install)
  for (const migration of BUNDLED_MIGRATIONS) {
    if (applied.includes(migration.name)) {
      skippedCount++;
      continue;
    }
    db.exec(migration.sql);
    recordMigration(db, migration.name);
    appliedCount++;
  }

  // 2. File-based migrations from ~/.kai/migrations/ (user-defined or legacy)
  if (fs.existsSync(MIGRATIONS_DIR)) {
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.includes(file)) {
        skippedCount++;
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
      db.exec(sql);
      recordMigration(db, file);
      appliedCount++;
    }
  }

  db.close();
  return { applied: appliedCount, skipped: skippedCount };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function resetDatabase(): void {
  const dbPath = path.join(ensureKaiDir(), "agents.db");
  const db = getDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_%'")
    .all() as { name: string }[];
  for (const { name } of tables) {
    db.exec(`DROP TABLE IF EXISTS "${name}"`);
  }
  db.close();
  console.log("Database reset complete");
}

export function status(): { applied: string[]; pending: string[] } {
  const db = getDb();
  const applied = getAppliedMigrations(db);
  db.close();

  const bundledNames = BUNDLED_MIGRATIONS.map(m => m.name);
  const fileNames = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort()
    : [];
  const allAvailable = [...new Set([...bundledNames, ...fileNames])];
  const pending = allAvailable.filter(m => !applied.includes(m));

  return { applied, pending };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const command = process.argv[2];
  switch (command) {
    case "reset":
      console.log("WARNING: This will delete all data!");
      resetDatabase();
      migrate();
      break;
    case "status": {
      const s = status();
      console.log(`Applied (${s.applied.length}):`, s.applied.join(", ") || "none");
      console.log(`Pending (${s.pending.length}):`, s.pending.join(", ") || "none");
      break;
    }
    default:
      migrate();
  }
}
