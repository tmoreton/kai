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
 */
export async function resumeRun(runId: string): Promise<DurableRun> {
  const run = getRun(runId);
  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }
  
  if (run.status === "completed") {
    throw new Error(`Run ${runId} already completed`);
  }
  
  return runDurable(run.agent_id, { resumeFrom: runId });
}

/**
 * Find and resume all interrupted runs.
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
