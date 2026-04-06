import { parseWorkflow, type WorkflowDefinition } from "../agents-core/workflow.js";
import { getAgent, addLog, getDb, type AgentRecord } from "../agents-core/db.js";
import { eventBus } from "./event-bus.js";
import type { AgentEvent } from "./types.js";

interface RunOptions {
  triggerEvent?: AgentEvent;
}

/**
 * Run an agent with event context.
 * Uses durable execution (Phase 2) for checkpoint/resume.
 */
export async function runAgent(
  agentId: string, 
  options?: RunOptions
): Promise<{ success: boolean; error?: string }> {
  // Use durable runner for checkpoint/resume capability
  const { runDurable } = await import("./runner-durable.js");
  
  const result = await runDurable(agentId, options);
  
  return { success: result.success, error: result.error };
}

/**
 * Load workflow from file or from bundled templates.
 */
export function loadWorkflow(pathOrId: string): WorkflowDefinition {
  // Check if it's a file path
  if (pathOrId.endsWith('.yaml') || pathOrId.endsWith('.yml') || pathOrId.includes('/')) {
    return parseWorkflow(pathOrId);
  }
  
  // Otherwise, try to load from bundled templates (Phase 4)
  // For now, just parse as file
  return parseWorkflow(pathOrId);
}
