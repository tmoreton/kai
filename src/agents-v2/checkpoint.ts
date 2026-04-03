/**
 * Checkpoint system for durable workflow execution.
 * 
 * Saves run state after each step so we can resume on crash.
 */

import { getDb } from "../agents/db.js";

export interface Checkpoint {
  id: number;
  runId: string;
  stepIndex: number;
  context: string; // JSON serialized WorkflowContext
  createdAt: string;
}

/**
 * Create checkpoint before executing a step.
 */
export function saveCheckpoint(
  runId: string,
  stepIndex: number,
  context: object
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO checkpoints (run_id, step_index, context, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(runId, stepIndex, JSON.stringify(context));
}

/**
 * Get latest checkpoint for a run.
 */
export function getLatestCheckpoint(runId: string): Checkpoint | undefined {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, run_id as runId, step_index as stepIndex, context, created_at as createdAt
    FROM checkpoints
    WHERE run_id = ?
    ORDER BY step_index DESC
    LIMIT 1
  `).get(runId) as Checkpoint | undefined;
  
  return row;
}

/**
 * Get all checkpoints for a run (for debugging/analysis).
 */
export function getCheckpoints(runId: string): Checkpoint[] {
  const db = getDb();
  return db.prepare(`
    SELECT id, run_id as runId, step_index as stepIndex, context, created_at as createdAt
    FROM checkpoints
    WHERE run_id = ?
    ORDER BY step_index ASC
  `).all(runId) as Checkpoint[];
}

/**
 * Clean up old checkpoints (keep only last 2 per run).
 */
export function cleanupCheckpoints(runId: string): void {
  const db = getDb();
  db.prepare(`
    DELETE FROM checkpoints
    WHERE run_id = ?
    AND id NOT IN (
      SELECT id FROM checkpoints
      WHERE run_id = ?
      ORDER BY step_index DESC
      LIMIT 2
    )
  `).run(runId, runId);
}

/**
 * Delete all checkpoints for a run.
 */
export function deleteCheckpoints(runId: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM checkpoints WHERE run_id = ?`).run(runId);
}
