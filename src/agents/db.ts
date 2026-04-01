import Database from "better-sqlite3";
import path from "path";
import { ensureKaiDir } from "../config.js";

/**
 * SQLite database for agent state persistence.
 * Stores: workflow runs, step results, agent configs, scheduled jobs.
 */

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = path.join(ensureKaiDir(), "agents.db");
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent access
  db.pragma("journal_mode = WAL");

  // Create tables
  db.exec(`
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

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      started_at TEXT,
      completed_at TEXT,
      error TEXT,
      trigger TEXT DEFAULT 'manual',
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

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
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT,
      run_id TEXT,
      level TEXT DEFAULT 'info',
      message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT DEFAULT 'agent_run',
      title TEXT NOT NULL,
      body TEXT,
      agent_id TEXT,
      run_id TEXT,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_steps_run ON steps(run_id);
    CREATE INDEX IF NOT EXISTS idx_logs_agent ON logs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);

    -- Pending approvals table for human-in-the-loop
    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      step_name TEXT NOT NULL,
      prompt TEXT,        -- what the agent is asking
      context TEXT,       -- JSON with current workflow state
      approved INTEGER,   -- NULL = pending, 0 = rejected, 1 = approved
      response TEXT,      -- user feedback if any
      created_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_approvals_run ON approvals(run_id);
    CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(approved);
  `);

  // Migrations for existing databases
  try { db.exec("ALTER TABLE runs ADD COLUMN recap TEXT"); } catch {}

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// --- Agent CRUD ---

export interface AgentRecord {
  id: string;
  name: string;
  description: string;
  workflow_path: string;
  schedule: string;
  enabled: number;
  config: string;
  created_at: string;
  updated_at: string;
}

export function saveAgent(agent: Omit<AgentRecord, "created_at" | "updated_at">): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO agents (id, name, description, workflow_path, schedule, enabled, config, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(agent.id, agent.name, agent.description, agent.workflow_path, agent.schedule, agent.enabled, agent.config);
}


export function getAgent(id: string): AgentRecord | undefined {
  return getDb().prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRecord | undefined;
}

export function listAgents(): AgentRecord[] {
  return getDb().prepare("SELECT * FROM agents ORDER BY updated_at DESC").all() as AgentRecord[];
}

export function deleteAgent(id: string): void {
  const db = getDb();
  const deleteAll = db.transaction(() => {
    db.prepare("DELETE FROM steps WHERE run_id IN (SELECT id FROM runs WHERE agent_id = ?)").run(id);
    db.prepare("DELETE FROM runs WHERE agent_id = ?").run(id);
    db.prepare("DELETE FROM logs WHERE agent_id = ?").run(id);
    db.prepare("DELETE FROM agents WHERE id = ?").run(id);
  });
  deleteAll();
}

// --- Run CRUD ---

export interface RunRecord {
  id: string;
  agent_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  trigger: string;
  recap: string | null;
}

export function createRun(runId: string, agentId: string, trigger = "manual"): void {
  getDb().prepare(`
    INSERT INTO runs (id, agent_id, status, started_at, trigger)
    VALUES (?, ?, 'running', datetime('now'), ?)
  `).run(runId, agentId, trigger);
}

export function completeRun(runId: string, status: "completed" | "failed" | "paused", error?: string): void {
  getDb().prepare(`
    UPDATE runs SET status = ?, completed_at = datetime('now'), error = ? WHERE id = ?
  `).run(status, error || null, runId);
}

export function getLatestRuns(agentId: string, limit = 10): RunRecord[] {
  return getDb().prepare(
    "SELECT * FROM runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT ?"
  ).all(agentId, limit) as RunRecord[];
}

// --- Step CRUD ---

export interface StepRecord {
  id: number;
  run_id: string;
  step_name: string;
  step_index: number;
  status: string;
  input: string | null;
  output: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  tokens_used: number;
}

export function createStep(runId: string, stepName: string, stepIndex: number): number {
  const result = getDb().prepare(`
    INSERT INTO steps (run_id, step_name, step_index, status, started_at)
    VALUES (?, ?, ?, 'running', datetime('now'))
  `).run(runId, stepName, stepIndex);
  return Number(result.lastInsertRowid);
}

export function completeStep(
  stepId: number,
  status: "completed" | "failed" | "pending",
  output?: string,
  error?: string,
  tokensUsed = 0
): void {
  getDb().prepare(`
    UPDATE steps SET status = ?, output = ?, error = ?, tokens_used = ?, completed_at = datetime('now')
    WHERE id = ?
  `).run(status, output || null, error || null, tokensUsed, stepId);
}

export function getSteps(runId: string): StepRecord[] {
  return getDb().prepare(
    "SELECT * FROM steps WHERE run_id = ? ORDER BY step_index"
  ).all(runId) as StepRecord[];
}

// --- Logs ---

export function addLog(agentId: string, level: string, message: string, runId?: string): void {
  getDb().prepare(`
    INSERT INTO logs (agent_id, run_id, level, message)
    VALUES (?, ?, ?, ?)
  `).run(agentId, runId || null, level, message);
}

export function getAgentLogs(agentId: string, limit = 50): { level: string; message: string; created_at: string }[] {
  return getDb().prepare(
    "SELECT level, message, created_at FROM logs WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(agentId, limit) as any[];
}

// --- Run recap ---

export function saveRunRecap(runId: string, recap: string): void {
  getDb().prepare("UPDATE runs SET recap = ? WHERE id = ?").run(recap, runId);
}

// --- Run history for trend analysis ---

export function getPreviousRuns(agentId: string, currentRunId: string, limit = 5): RunRecord[] {
  return getDb().prepare(
    "SELECT * FROM runs WHERE agent_id = ? AND id != ? AND status = 'completed' ORDER BY started_at DESC LIMIT ?"
  ).all(agentId, currentRunId, limit) as RunRecord[];
}

export function getRunOutputsForComparison(agentId: string, stepName: string, limit = 5): Array<{ output: string; created_at: string }> {
  const db = getDb();
  return db.prepare(`
    SELECT s.output, r.started_at as created_at
    FROM steps s
    JOIN runs r ON s.run_id = r.id
    WHERE r.agent_id = ? AND s.step_name = ? AND s.status = 'completed' AND s.output IS NOT NULL
    ORDER BY r.started_at DESC
    LIMIT ?
  `).all(agentId, stepName, limit) as any[];
}

export interface TrendPoint {
  value: number;
  timestamp: string;
  runId: string;
}

/**
 * Extract numeric values from step outputs over multiple runs.
 * Useful for tracking metrics like "views", "subscribers", "errors".
 */
export function getNumericTrend(
  agentId: string,
  stepName: string,
  extractor: (output: string) => number | null
): TrendPoint[] {
  const outputs = getRunOutputsForComparison(agentId, stepName, 20);
  const points: TrendPoint[] = [];

  for (const { output, created_at } of outputs) {
    const value = extractor(output);
    if (value !== null) {
      points.push({ value, timestamp: created_at, runId: "" });
    }
  }

  return points.reverse(); // Chronological order
}

/**
 * Calculate simple trend direction and change percentage.
 */
export function calculateTrend(points: TrendPoint[]): {
  direction: "up" | "down" | "flat";
  changePercent: number;
  current: number;
  previous: number;
} {
  if (points.length < 2) {
    return { direction: "flat", changePercent: 0, current: 0, previous: 0 };
  }

  const current = points[points.length - 1].value;
  const previous = points[points.length - 2].value;

  if (previous === 0) {
    return { direction: current > 0 ? "up" : "flat", changePercent: 0, current, previous };
  }

  const changePercent = ((current - previous) / previous) * 100;
  const direction = changePercent > 1 ? "up" : changePercent < -1 ? "down" : "flat";

  return { direction, changePercent, current, previous };
}

/**
 * Compare today's output to yesterday's for the same agent/step.
 */
export function compareToYesterday(
  agentId: string,
  stepName: string
): { yesterday?: string; today?: string; changed: boolean } {
  const outputs = getRunOutputsForComparison(agentId, stepName, 2);
  if (outputs.length < 2) return { changed: false };

  const [mostRecent, second] = outputs;
  const changed = mostRecent.output !== second.output;

  return {
    yesterday: second.output,
    today: mostRecent.output,
    changed,
  };
}

// --- Approvals (human-in-the-loop) ---

export interface ApprovalRecord {
  id: number;
  run_id: string;
  step_index: number;
  step_name: string;
  prompt: string | null;
  context: string | null;
  approved: number | null;
  response: string | null;
  created_at: string;
  resolved_at: string | null;
}

export function createApproval(args: {
  runId: string;
  stepIndex: number;
  stepName: string;
  prompt?: string;
  context?: Record<string, any>;
}): number {
  const result = getDb().prepare(`
    INSERT INTO approvals (run_id, step_index, step_name, prompt, context, approved, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, datetime('now'))
  `).run(args.runId, args.stepIndex, args.stepName, args.prompt || null, JSON.stringify(args.context || {}));
  return Number(result.lastInsertRowid);
}

export function getPendingApprovals(runId: string): ApprovalRecord[] {
  return getDb().prepare(
    "SELECT * FROM approvals WHERE run_id = ? AND approved IS NULL ORDER BY step_index"
  ).all(runId) as ApprovalRecord[];
}

export function resolveApproval(id: number, approved: boolean, response?: string): void {
  getDb().prepare(`
    UPDATE approvals SET approved = ?, response = ?, resolved_at = datetime('now') WHERE id = ?
  `).run(approved ? 1 : 0, response || null, id);
}

export function getApprovalById(id: number): ApprovalRecord | undefined {
  return getDb().prepare("SELECT * FROM approvals WHERE id = ?").get(id) as ApprovalRecord | undefined;
}

export function hasPendingApprovals(runId: string): boolean {
  const row = getDb().prepare("SELECT COUNT(*) as count FROM approvals WHERE run_id = ? AND approved IS NULL").get(runId) as any;
  return (row?.count || 0) > 0;
}

// --- Notifications ---

export interface NotificationRecord {
  id: number;
  type: string;
  title: string;
  body: string | null;
  agent_id: string | null;
  run_id: string | null;
  read: number;
  created_at: string;
}

export function createNotification(n: { type?: string; title: string; body?: string; agentId?: string; runId?: string }): number {
  const result = getDb().prepare(`
    INSERT INTO notifications (type, title, body, agent_id, run_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(n.type || "agent_run", n.title, n.body || null, n.agentId || null, n.runId || null);
  return Number(result.lastInsertRowid);
}

export function listNotifications(limit = 30): NotificationRecord[] {
  return getDb().prepare(
    "SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?"
  ).all(limit) as NotificationRecord[];
}

export function listNotificationsSince(hours = 24): NotificationRecord[] {
  const db = getDb();
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  return db.prepare(
    "SELECT * FROM notifications WHERE created_at > ? ORDER BY created_at DESC"
  ).all(cutoff) as NotificationRecord[];
}

export function listUnreadNotifications(limit = 30): NotificationRecord[] {
  return getDb().prepare(
    "SELECT * FROM notifications WHERE read = 0 ORDER BY created_at DESC LIMIT ?"
  ).all(limit) as NotificationRecord[];
}

export function unreadNotificationCount(): number {
  const row = getDb().prepare("SELECT COUNT(*) as count FROM notifications WHERE read = 0").get() as any;
  return row?.count || 0;
}

export function markNotificationRead(id: number): void {
  getDb().prepare("UPDATE notifications SET read = 1 WHERE id = ?").run(id);
}

export function markAllNotificationsRead(): void {
  getDb().prepare("UPDATE notifications SET read = 1 WHERE read = 0").run();
}
