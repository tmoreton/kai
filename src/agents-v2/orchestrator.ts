/**
 * Goal Orchestrator
 * 
 * Decomposes high-level goals into sub-goals and coordinates
 * multiple agents to achieve them.
 * 
 * Pattern: Fan-out (spawn sub-agents) → Fan-in (wait for all) → Synthesize
 */

import { eventBus } from "./event-bus.js";
import { runDurable } from "./runner-durable.js";
import { spawnFromTemplate } from "./templates.js";
import type { AgentEvent } from "./types.js";
import crypto from "crypto";
import { getDb } from "../agents/db.js";

export interface Goal {
  id: string;
  description: string;
  priority: 1 | 2 | 3 | 4 | 5;
  status: "pending" | "decomposing" | "in_progress" | "completed" | "failed";
  parentGoalId?: string;
  subGoalIds: string[];
  createdAt: string;
  completedAt?: string;
  result?: string;
  context?: string; // JSON
}

export interface SubGoal {
  id: string;
  description: string;
  agentType: string;
  config: Record<string, unknown>;
  dependencies: string[]; // sub-goal IDs that must complete first
}

interface GoalRun {
  goalId: string;
  runId: string;
  agentId: string;
  subGoalId: string;
  status: "pending" | "running" | "completed" | "failed";
}

/**
 * Create a new high-level goal.
 */
export async function createGoal(
  description: string, 
  priority: 1 | 2 | 3 | 4 | 5 = 3,
  parentGoalId?: string
): Promise<string> {
  const goalId = `goal-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`;
  
  const db = getDb();
  db.prepare(`
    INSERT INTO goals (id, description, priority, status, parent_goal_id, sub_goal_ids, created_at)
    VALUES (?, ?, ?, 'pending', ?, '[]', datetime('now'))
  `).run(goalId, description, priority, parentGoalId || null);

  console.log(`[Goal] Created: ${goalId} - ${description.substring(0, 50)}`);

  // Emit event for orchestrator to pick up
  eventBus.publish({
    id: `goal-${goalId}`,
    type: "agent:run-requested", // Reuse existing type for now
    timestamp: Date.now(),
    payload: { 
      goalId, 
      description, 
      priority,
      isGoal: true 
    },
    source: "goal-orchestrator",
  });

  return goalId;
}

/**
 * Decompose a goal into sub-goals using LLM.
 */
export async function decomposeGoal(goalId: string): Promise<SubGoal[]> {
  const goal = loadGoal(goalId);
  if (!goal) throw new Error(`Goal ${goalId} not found`);

  // Use LLM to decompose
  const { resolveProvider } = await import("../providers/index.js");
  const resolved = resolveProvider();

  const prompt = `Decompose this goal into 2-5 specific, actionable sub-goals:

Goal: ${goal.description}

For each sub-goal, provide:
1. description: What needs to be done (be specific)
2. agentType: Which agent type should handle it (youtube-scout, researcher, writer, code-reviewer, etc.)
3. dependencies: Which other sub-goal indexes (0-based) must complete before this one (if any)

Respond in this exact JSON format:
{
  "subGoals": [
    {
      "description": "...",
      "agentType": "...",
      "dependencies": []
    }
  ]
}`;

  const response = await resolved.client.chat.completions.create({
    model: resolved.model,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_tokens: 2000,
  });

  const content = response.choices[0]?.message?.content || "{\"subGoals\":[]}";
  const parsed = JSON.parse(content);
  
  // Convert to SubGoal format with IDs
  const subGoals: SubGoal[] = (parsed.subGoals || []).map((sg: any, idx: number) => ({
    id: `${goalId}-sub-${idx}`,
    description: sg.description,
    agentType: sg.agentType,
    config: {}, // Can be extended based on agent type
    dependencies: (sg.dependencies || []).map((d: number) => `${goalId}-sub-${d}`),
  }));

  console.log(`[Goal] Decomposed ${goalId} into ${subGoals.length} sub-goal(s)`);

  return subGoals;
}

/**
 * Orchestrate a goal: decompose → spawn → wait → synthesize.
 */
export async function orchestrateGoal(goalId: string): Promise<void> {
  const goal = loadGoal(goalId);
  if (!goal) throw new Error(`Goal ${goalId} not found`);

  console.log(`[Orchestrator] Starting goal: ${goalId}`);

  // 1. Mark as decomposing
  updateGoalStatus(goalId, "decomposing");

  // 2. Decompose into sub-goals
  const subGoals = await decomposeGoal(goalId);

  if (subGoals.length === 0) {
    completeGoal(goalId, "No sub-goals generated");
    return;
  }

  // 3. Save sub-goals
  saveSubGoals(goalId, subGoals);

  // 4. Mark as in progress
  updateGoalStatus(goalId, "in_progress");

  // 5. Execute with dependency resolution
  const results = await executeSubGoalsWithDeps(goalId, subGoals);

  // 6. Synthesize results
  const synthesis = await synthesizeResults(goal.description, results);

  // 7. Complete goal
  completeGoal(goalId, synthesis);

  console.log(`[Orchestrator] Completed goal: ${goalId}`);
}

/**
 * Execute sub-goals respecting dependencies.
 * Uses topological sort + parallel execution where possible.
 */
async function executeSubGoalsWithDeps(
  goalId: string,
  subGoals: SubGoal[]
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  const completed = new Set<string>();
  const running = new Set<string>();
  const pending = new Set(subGoals.map(sg => sg.id));

  // Build dependency graph
  const depsMap = new Map<string, string[]>();
  for (const sg of subGoals) {
    depsMap.set(sg.id, sg.dependencies);
  }

  // Set up event listener for completions
  const completionPromises: Promise<void>[] = [];

  while (pending.size > 0 || running.size > 0) {
    // Find sub-goals that are ready (all dependencies met)
    const ready: SubGoal[] = [];
    
    for (const subGoal of subGoals) {
      if (!pending.has(subGoal.id)) continue;
      if (running.has(subGoal.id)) continue;
      
      const deps = depsMap.get(subGoal.id) || [];
      const depsMet = deps.every(d => completed.has(d));
      
      if (depsMet) {
        ready.push(subGoal);
      }
    }

    // Spawn ready sub-goals
    for (const subGoal of ready) {
      pending.delete(subGoal.id);
      running.add(subGoal.id);

      const promise = spawnAndWait(subGoal, goalId).then(result => {
        results[subGoal.id] = result;
        running.delete(subGoal.id);
        completed.add(subGoal.id);
      });

      completionPromises.push(promise);
    }

    // If nothing is running and nothing is ready, we have a cycle
    if (running.size === 0 && pending.size > 0 && ready.length === 0) {
      throw new Error(`Dependency cycle detected in goal ${goalId}`);
    }

    // Wait a bit for something to complete
    if (running.size > 0) {
      await Promise.race(completionPromises);
    }
  }

  return results;
}

/**
 * Spawn an agent for a sub-goal and wait for completion.
 */
async function spawnAndWait(subGoal: SubGoal, parentGoalId: string): Promise<unknown> {
  // Spawn agent from template
  const agentId = await spawnFromTemplate(subGoal.agentType, {
    ...subGoal.config,
    parent_goal_id: parentGoalId,
    sub_goal_id: subGoal.id,
    sub_goal_description: subGoal.description,
  });

  console.log(`[Orchestrator] Spawned ${subGoal.agentType} for ${subGoal.id}`);

  // Run and wait
  const result = await runDurable(agentId);

  // Record the run
  saveGoalRun(parentGoalId, result.runId, agentId, subGoal.id, result.success ? "completed" : "failed");

  return result.success ? result.results : { error: result.error };
}

/**
 * Synthesize sub-goal results into final answer.
 */
async function synthesizeResults(goalDescription: string, results: Record<string, unknown>): Promise<string> {
  const { resolveProvider } = await import("../providers/index.js");
  const resolved = resolveProvider();

  const prompt = `Synthesize these sub-goal results into a final answer:

Original Goal: ${goalDescription}

Sub-goal Results:
${JSON.stringify(results, null, 2)}

Provide a concise synthesis that addresses the original goal.`;

  const response = await resolved.client.chat.completions.create({
    model: resolved.model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 2000,
  });

  return response.choices[0]?.message?.content || "Synthesis failed";
}

// --- Database Helpers ---

function loadGoal(goalId: string): Goal | undefined {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, description, priority, status, parent_goal_id as parentGoalId,
           sub_goal_ids as subGoalIds, created_at as createdAt, 
           completed_at as completedAt, result, context
    FROM goals WHERE id = ?
  `).get(goalId) as any;

  if (!row) return undefined;

  return {
    ...row,
    subGoalIds: JSON.parse(row.subGoalIds || "[]"),
    priority: row.priority as 1 | 2 | 3 | 4 | 5,
  };
}

function updateGoalStatus(goalId: string, status: Goal["status"]): void {
  const db = getDb();
  db.prepare(`UPDATE goals SET status = ? WHERE id = ?`).run(status, goalId);
}

function saveSubGoals(goalId: string, subGoals: SubGoal[]): void {
  const db = getDb();
  db.prepare(`
    UPDATE goals SET sub_goal_ids = ? WHERE id = ?
  `).run(JSON.stringify(subGoals.map(sg => sg.id)), goalId);

  // Also store full sub-goal data in context
  const goal = loadGoal(goalId);
  const context = goal?.context ? JSON.parse(goal.context) : {};
  context.subGoals = subGoals;
  
  db.prepare(`UPDATE goals SET context = ? WHERE id = ?`)
    .run(JSON.stringify(context), goalId);
}

function saveGoalRun(
  goalId: string, 
  runId: string, 
  agentId: string, 
  subGoalId: string,
  status: string
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO goal_runs (goal_id, run_id, agent_id, sub_goal_id, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(goalId, runId, agentId, subGoalId, status);
}

function completeGoal(goalId: string, result: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE goals 
    SET status = 'completed', completed_at = datetime('now'), result = ?
    WHERE id = ?
  `).run(result, goalId);

  eventBus.publish({
    id: `goal-complete-${goalId}`,
    type: "agent:completed",
    timestamp: Date.now(),
    payload: { goalId, result },
    source: "goal-orchestrator",
  });
}
