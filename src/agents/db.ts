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

    CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_steps_run ON steps(run_id);
    CREATE INDEX IF NOT EXISTS idx_logs_agent ON logs(agent_id);
  `);

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
}

export function createRun(runId: string, agentId: string, trigger = "manual"): void {
  getDb().prepare(`
    INSERT INTO runs (id, agent_id, status, started_at, trigger)
    VALUES (?, ?, 'running', datetime('now'), ?)
  `).run(runId, agentId, trigger);
}

export function completeRun(runId: string, status: "completed" | "failed", error?: string): void {
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
  status: "completed" | "failed",
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
