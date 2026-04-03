/**
 * Meta-Learning System
 * 
 * Analyzes agent run history and suggests improvements.
 * Auto-applies high-confidence suggestions, notifies on low-confidence.
 */

import { getDb } from "../agents/db.js";
import { addLog, listAgents, type AgentRecord } from "../agents/db.js";
import { eventBus } from "./event-bus.js";

export interface RunAnalysis {
  agentId: string;
  totalRuns: number;
  successRate: number;
  commonErrors: Array<{ error: string; count: number }>;
  slowSteps: Array<{ step: string; avgMs: number }>;
  qualityTrend: "improving" | "declining" | "stable";
  suggestions: WorkflowSuggestion[];
}

export interface WorkflowSuggestion {
  type: "prompt-improvement" | "config-tuning" | "add-step" | "remove-step" | "schedule-change";
  target: string;
  reason: string;
  confidence: number; // 0-1
  proposedChange: unknown;
}

/**
 * Analyze an agent's run history.
 */
export async function analyzeAgent(agentId: string, window: number = 30): Promise<RunAnalysis> {
  const db = getDb();
  
  // Get recent runs
  const runs = db.prepare(`
    SELECT r.id, r.status, r.error, r.started_at, 
           s.step_name, s.status as step_status, s.started_at as step_start, s.completed_at as step_end
    FROM runs r
    LEFT JOIN steps s ON r.id = s.run_id
    WHERE r.agent_id = ?
    ORDER BY r.started_at DESC
    LIMIT ?
  `).all(agentId, window * 5) as any[]; // Get more rows since they're per-step

  // Group by run
  const runsMap = new Map<string, any>();
  for (const row of runs) {
    if (!runsMap.has(row.id)) {
      runsMap.set(row.id, {
        id: row.id,
        status: row.status,
        error: row.error,
        started_at: row.started_at,
        steps: [],
      });
    }
    if (row.step_name) {
      runsMap.get(row.id).steps.push({
        name: row.step_name,
        status: row.step_status,
        started_at: row.step_start,
        completed_at: row.step_end,
      });
    }
  }

  const runList = [...runsMap.values()].slice(0, window);
  const completed = runList.filter((r: any) => r.status === "completed");
  const failed = runList.filter((r: any) => r.status === "failed");

  // Calculate stats
  const errorCounts = new Map<string, number>();
  for (const run of failed) {
    const key = run.error?.split(":")[0] || "unknown";
    errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
  }

  const stepTimes = new Map<string, { total: number; count: number }>();
  for (const run of runList) {
    for (const step of run.steps) {
      if (step.completed_at && step.started_at) {
        const duration = new Date(step.completed_at).getTime() - new Date(step.started_at).getTime();
        const stat = stepTimes.get(step.name) || { total: 0, count: 0 };
        stat.total += duration;
        stat.count++;
        stepTimes.set(step.name, stat);
      }
    }
  }

  // LLM analysis for insights
  const { resolveProvider } = await import("../providers/index.js");
  const resolved = resolveProvider();

  const prompt = `Analyze this agent's run history and suggest improvements:

Agent: ${agentId}
Total runs analyzed: ${runList.length}
Success rate: ${completed.length}/${runList.length} (${(completed.length / runList.length * 100).toFixed(1)}%)

Common errors:
${JSON.stringify([...errorCounts.entries()].slice(0, 5))}

Step performance (avg ms):
${JSON.stringify([...stepTimes.entries()].map(([name, stat]) => [name, Math.round(stat.total / stat.count)]))}

Based on this data:
1. What patterns do you see?
2. What specific improvements would you suggest?
3. Rate your confidence in each suggestion (0.0-1.0)

Respond in JSON:
{
  "qualityTrend": "improving" | "declining" | "stable",
  "rootCauses": ["brief explanation"],
  "suggestions": [
    { "type": "prompt-improvement" | "config-tuning" | "schedule-change", "target": "step name or config key", "reason": "...", "confidence": 0.9, "proposedChange": "..." }
  ]
}`;

  try {
    const response = await resolved.client.chat.completions.create({
      model: resolved.model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    return {
      agentId,
      totalRuns: runList.length,
      successRate: completed.length / runList.length,
      commonErrors: [...errorCounts.entries()].map(([e, c]) => ({ error: e, count: c })),
      slowSteps: [...stepTimes.entries()].map(([step, stat]) => ({
        step,
        avgMs: Math.round(stat.total / stat.count),
      })),
      qualityTrend: parsed.qualityTrend || "stable",
      suggestions: (parsed.suggestions || []).map((s: any) => ({
        type: s.type,
        target: s.target,
        reason: s.reason,
        confidence: s.confidence,
        proposedChange: s.proposedChange,
      })),
    };
  } catch (err) {
    // Return basic analysis if LLM fails
    return {
      agentId,
      totalRuns: runList.length,
      successRate: completed.length / runList.length,
      commonErrors: [...errorCounts.entries()].map(([e, c]) => ({ error: e, count: c })),
      slowSteps: [...stepTimes.entries()].map(([step, stat]) => ({
        step,
        avgMs: Math.round(stat.total / stat.count),
      })),
      qualityTrend: "stable",
      suggestions: [],
    };
  }
}

/**
 * Apply workflow improvements.
 * High confidence (>0.9): Auto-apply
 * Medium confidence (0.7-0.9): Notify user
 * Low confidence (<0.7): Log only
 */
export async function applyImprovements(
  agentId: string, 
  suggestions: WorkflowSuggestion[]
): Promise<{ applied: number; notified: number; logged: number }> {
  let applied = 0;
  let notified = 0;
  let logged = 0;

  for (const suggestion of suggestions) {
    if (suggestion.confidence >= 0.9) {
      // Auto-apply
      try {
        await applySuggestion(agentId, suggestion);
        applied++;
        addLog(agentId, "info", `Auto-applied improvement: ${suggestion.type} on ${suggestion.target}`);
      } catch (err) {
        addLog(agentId, "error", `Failed to apply improvement: ${suggestion.type}`);
        notified++; // Notify on failure
      }
    } else if (suggestion.confidence >= 0.7) {
      // Notify user
      eventBus.publish({
        id: `suggestion-${Date.now()}`,
        type: "agent:completed",
        timestamp: Date.now(),
        payload: {
          type: "improvement_suggested",
          agentId,
          suggestion,
        },
        source: "meta-learner",
      });
      notified++;
    } else {
      // Log only
      addLog(agentId, "info", `Low-confidence suggestion: ${suggestion.type} (${suggestion.confidence})`);
      logged++;
    }
  }

  return { applied, notified, logged };
}

async function applySuggestion(agentId: string, suggestion: WorkflowSuggestion): Promise<void> {
  // Implementation depends on suggestion type
  switch (suggestion.type) {
    case "config-tuning":
      // Update agent config
      const { getAgent, saveAgent } = await import("../agents/db.js");
      const agent = getAgent(agentId);
      if (agent) {
        const config = JSON.parse(agent.config || "{}");
        config[suggestion.target] = suggestion.proposedChange;
        saveAgent({ ...agent, config: JSON.stringify(config) });
      }
      break;
    
    case "prompt-improvement":
    case "add-step":
    case "remove-step":
      // Would need to modify workflow YAML
      // For now, just log
      console.log(`[Meta] Would apply ${suggestion.type} to ${suggestion.target}`);
      break;
    
    case "schedule-change":
      // Update agent schedule
      const { getAgent: getAgent2, saveAgent: saveAgent2 } = await import("../agents/db.js");
      const agent2 = getAgent2(agentId);
      if (agent2 && typeof suggestion.proposedChange === "string") {
        saveAgent2({ ...agent2, schedule: suggestion.proposedChange });
      }
      break;
  }
}

/**
 * Run meta-learning on all enabled agents.
 * Call this from a daily cron agent.
 */
export async function runMetaLearning(): Promise<void> {
  console.log("[Meta-Learner] Starting daily analysis...");

  const agents = listAgents();
  
  for (const agent of agents) {
    if (!agent.enabled) continue;
    
    try {
      const analysis = await analyzeAgent(agent.id, 30);
      
      if (analysis.suggestions.length > 0) {
        const result = await applyImprovements(agent.id, analysis.suggestions);
        console.log(`[Meta-Learner] ${agent.id}: ${result.applied} applied, ${result.notified} notified`);
      }
    } catch (err) {
      console.error(`[Meta-Learner] Failed to analyze ${agent.id}:`, err);
    }
  }

  console.log("[Meta-Learner] Daily analysis complete");
}
