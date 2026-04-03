/**
 * Simplified Durable Workflow Runner
 * 
 * Wraps existing workflow engine with checkpoint/resume.
 */

import { parseWorkflow, executeWorkflow, type WorkflowDefinition } from "../agents/workflow.js";
import { 
  getAgent, 
  addLog, 
  createRun, 
  completeRun, 
  getRun,
  getDb,
  updateRunStep,
  saveRunContext,
  type AgentRecord 
} from "../agents/db.js";
import { saveCheckpoint, getLatestCheckpoint, cleanupCheckpoints } from "./checkpoint.js";
import { eventBus } from "./event-bus.js";
import type { AgentEvent } from "./types.js";
import crypto from "crypto";

interface RunOptions {
  triggerEvent?: AgentEvent;
  resumeFrom?: string;
  parentRunId?: string;
  goalId?: string;
}

interface DurableRun {
  runId: string;
  success: boolean;
  error?: string;
  results: Record<string, unknown>;
}

/**
 * Run an agent with durable execution (checkpoint/resume).
 * 
 * For now, this is a simplified version that:
 * 1. Creates checkpoints before starting
 * 2. Uses existing workflow engine
 * 3. Updates step progress
 * 
 * Full step-level checkpointing requires workflow engine modification.
 */
export async function runDurable(
  agentId: string,
  options?: RunOptions
): Promise<DurableRun> {
  const agent = getAgent(agentId);
  if (!agent) {
    throw new Error(`Agent ${agentId} not found`);
  }

  // Load or create run
  let runId: string;
  let context: Record<string, unknown>;

  if (options?.resumeFrom) {
    // Resume from checkpoint
    const run = getRun(options.resumeFrom);
    if (!run) throw new Error(`Run ${options.resumeFrom} not found`);
    
    runId = run.id;
    
    // Load context from checkpoint
    const checkpoint = getLatestCheckpoint(runId);
    if (checkpoint) {
      context = JSON.parse(checkpoint.context);
      console.log(`[Durable] Resuming ${runId} from checkpoint`);
    } else {
      context = createContext(agent, options);
    }
    
    addLog(agentId, "info", `Resuming run ${runId}`, runId);
  } else {
    // New run
    runId = `run-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
    createRun(runId, agentId);
    context = createContext(agent, options);
    
    console.log(`[Durable] Starting new run ${runId} for ${agent.name}`);
    addLog(agentId, "info", `Starting run ${runId}`, runId);
  }

  // Save initial checkpoint
  saveCheckpoint(runId, 0, context);

  const workflow = parseWorkflow(agent.workflow_path);

  try {
    // Execute workflow with progress tracking
    const result = await executeWorkflow(
      workflow,
      agentId,
      { ...context, __run_id: runId },
      (step, status) => {
        console.log(`  ${step}: ${status}`);
        
        // Update step progress
        const stepIndex = workflow.steps.findIndex(s => s.name === step);
        if (stepIndex >= 0 && status === "completed") {
          updateRunStep(runId, stepIndex + 1);
        }
      }
    );

    if (result.success) {
      completeRun(runId, "completed");
      
      eventBus.publish({
        id: `complete-${Date.now()}`,
        type: "agent:completed",
        timestamp: Date.now(),
        payload: { agentId, runId, results: result.results },
        source: "durable-runner",
      });
      
      // Cleanup checkpoints on success
      cleanupCheckpoints(runId);
      
      return { runId, success: true, results: result.results };
    } else {
      // Save error context for potential retry
      saveCheckpoint(runId, -1, { ...context, __error: result.error });
      
      eventBus.publish({
        id: `fail-${Date.now()}`,
        type: "agent:failed",
        timestamp: Date.now(),
        payload: { agentId, runId, error: result.error },
        source: "durable-runner",
      });
      
      return { runId, success: false, error: result.error, results: result.results };
    }
    
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    addLog(agentId, "error", `Run ${runId} crashed: ${msg}`, runId);
    
    // Save checkpoint so we can resume
    saveCheckpoint(runId, -1, { ...context, __error: msg, __crashed: true });
    
    // Don't mark as failed - leave in "running" for recovery
    
    eventBus.publish({
      id: `crash-${Date.now()}`,
      type: "agent:failed",
      timestamp: Date.now(),
      payload: { agentId, runId, error: msg, crashed: true },
      source: "durable-runner",
    });
    
    return { runId, success: false, error: msg, results: {} };
  }
}

/**
 * Resume an interrupted run from its last checkpoint.
 * This is the canonical implementation used by both daemon and web routes.
 */
export async function resumeRun(
  runId: string,
  onProgress?: (step: string, status: string) => void
): Promise<DurableRun> {
  const run = getRun(runId);
  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  if (run.status === "completed") {
    throw new Error(`Run ${runId} already completed`);
  }

  // Use the agent's workflow to resume
  const agent = getAgent(run.agent_id);
  if (!agent) {
    throw new Error(`Agent ${run.agent_id} not found for run ${runId}`);
  }

  const workflow = parseWorkflow(agent.workflow_path);

  // Resume via durable runner
  return runDurable(run.agent_id, { resumeFrom: runId });
}

/**
 * Find all interrupted runs that have checkpoints.
 * These are runs that can be resumed.
 * @internal Used by recoverAll
 */
function findInterruptedRuns(): Array<{
  id: string;
  agent_id: string;
  started_at: string;
  step_index: number;
}> {
  const db = getDb();

  // Find runs with status 'running' or 'paused' that have checkpoints
  const runs = db.prepare(`
    SELECT r.id, r.agent_id, r.started_at, MAX(c.step_index) as step_index
    FROM runs r
    JOIN checkpoints c ON r.id = c.run_id
    WHERE r.status IN ('running', 'paused')
    GROUP BY r.id
    ORDER BY r.started_at ASC
  `).all() as Array<{
    id: string;
    agent_id: string;
    started_at: string;
    step_index: number;
  }>;

  return runs;
}

/**
 * Recover all interrupted runs.
 * Called by the daemon on startup.
 * @deprecated Use recoverInterruptedRuns() instead
 */
export async function recoverAll(
  options?: { olderThanMinutes?: number; onProgress?: (runId: string, status: string) => void }
): Promise<{ recovered: string[]; failed: string[] }> {
  const recovered: string[] = [];
  const failed: string[] = [];

  // Filter by age if specified
  let runsToRecover = await findInterruptedRuns();
  if (options?.olderThanMinutes) {
    const cutoff = new Date(Date.now() - options.olderThanMinutes * 60 * 1000);
    runsToRecover = runsToRecover.filter((r: { started_at: string }) => new Date(r.started_at) < cutoff);
  }

  for (const run of runsToRecover) {
    console.log(`[Recovery] Resuming ${run.id} from step ${run.step_index}`);
    try {
      await resumeRun(run.id, (step, status) => {
        options?.onProgress?.(run.id, `${step}: ${status}`);
      });
      recovered.push(run.id);
      console.log(`[Recovery] ✓ ${run.id} completed`);
    } catch (err: any) {
      failed.push(run.id);
      console.error(`[Recovery] ✗ ${run.id} failed:`, err.message);
    }
  }

  return { recovered, failed };
}

/**
 * Find interrupted runs with optional filtering for display.
 * Used by the web UI to show resumable runs.
 */
export async function findInterruptedRunsForDisplay(
  filter?: { agentId?: string; limit?: number }
): Promise<Array<{
  id: string;
  agent_id: string;
  status: string;
  current_step: number;
  started_at: string;
  checkpoint_step: number;
}>> {
  const { getDb } = await import("../agents/db.js");
  const db = getDb();

  let query = `
    SELECT r.id, r.agent_id, r.status, r.current_step, r.started_at,
           MAX(c.step_index) as checkpoint_step
    FROM runs r
    JOIN checkpoints c ON r.id = c.run_id
    WHERE r.status IN ('running', 'paused')
  `;

  const params: string[] = [];
  if (filter?.agentId) {
    query += " AND r.agent_id = ?";
    params.push(filter.agentId);
  }

  query += " GROUP BY r.id ORDER BY r.started_at ASC";

  if (filter?.limit) {
    query += " LIMIT ?";
    params.push(String(filter.limit));
  }

  return db.prepare(query).all(...params) as any[];
}

/**
 * Get resume status for a specific run.
 * Used by the web UI to check if a run can be resumed.
 */
export function getResumeStatus(runId: string): {
  canResume: boolean;
  status: string;
  lastCheckpoint?: {
    stepIndex: number;
    createdAt: string;
  };
} {
  const run = getRun(runId);
  if (!run) {
    return { canResume: false, status: "not_found" };
  }

  if (run.status === "completed") {
    return { canResume: false, status: "completed" };
  }

  const checkpoint = getLatestCheckpoint(runId);
  if (!checkpoint) {
    return { canResume: false, status: run.status };
  }

  return {
    canResume: true,
    status: run.status,
    lastCheckpoint: {
      stepIndex: checkpoint.stepIndex,
      createdAt: checkpoint.createdAt,
    },
  };
}

/**
 * Find and resume all interrupted runs.
 * This is the newer implementation used by the v2 system.
 */
export async function recoverInterruptedRuns(): Promise<string[]> {
  const { getDb } = await import("../agents/db.js");
  const db = getDb();
  
  // Find runs that are "running" but have checkpoints older than 2 minutes
  const twoMinutesAgo = new Date(Date.now() - 120000).toISOString();
  
  const interrupted = db.prepare(`
    SELECT r.id, r.agent_id, r.current_step
    FROM runs r
    JOIN checkpoints c ON r.id = c.run_id
    WHERE r.status IN ('pending', 'running')
    AND c.created_at < ?
    GROUP BY r.id
  `).all(twoMinutesAgo) as Array<{ id: string; agent_id: string; current_step: number }>;
  
  const recovered: string[] = [];
  
  for (const run of interrupted) {
    console.log(`[Recovery] Found interrupted run ${run.id}`);
    
    try {
      await resumeRun(run.id);
      recovered.push(run.id);
    } catch (err) {
      console.error(`[Recovery] Failed to resume ${run.id}:`, err);
    }
  }
  
  if (recovered.length > 0) {
    console.log(`[Recovery] Recovered ${recovered.length} run(s)`);
  }
  
  return recovered;
}

function createContext(
  agent: AgentRecord,
  options?: RunOptions
): Record<string, unknown> {
  return {
    ...JSON.parse(agent.config || "{}"),
    trigger_event: options?.triggerEvent,
    parent_run_id: options?.parentRunId,
    goal_id: options?.goalId,
  };
}
