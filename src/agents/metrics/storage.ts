/**
 * Metrics Storage - Full implementation for Phase 3
 * 
 * Provides storage and retrieval for run and step metrics
 * using JSON file storage in the workspace.
 */

import * as fs from "fs";
import * as path from "path";
import type { RunMetrics, StepMetrics, MetricEvent, AgentMetricsSummary } from "./types.js";

const METRICS_DIR = process.env.METRICS_DIR || path.join(process.cwd(), ".kai", "metrics");
const RUNS_DIR = path.join(METRICS_DIR, "runs");
const STEPS_DIR = path.join(METRICS_DIR, "steps");
const EVENTS_FILE = path.join(METRICS_DIR, "events.jsonl");
const SUMMARIES_FILE = path.join(METRICS_DIR, "summaries.json");

// Ensure directories exist
function ensureDirs(): void {
  if (!fs.existsSync(METRICS_DIR)) fs.mkdirSync(METRICS_DIR, { recursive: true });
  if (!fs.existsSync(RUNS_DIR)) fs.mkdirSync(RUNS_DIR, { recursive: true });
  if (!fs.existsSync(STEPS_DIR)) fs.mkdirSync(STEPS_DIR, { recursive: true });
}

/**
 * Save run metrics to storage
 */
export function saveRunMetrics(metrics: RunMetrics): void {
  ensureDirs();
  const filePath = path.join(RUNS_DIR, `${metrics.runId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(metrics, null, 2));
}

/**
 * Save step metrics to storage
 */
export function saveStepMetrics(metrics: StepMetrics): void {
  ensureDirs();
  const filePath = path.join(STEPS_DIR, `${metrics.stepId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(metrics, null, 2));
}

/**
 * Save a metric event (appended to JSONL file)
 */
export function saveMetricEvent(event: MetricEvent): void {
  ensureDirs();
  const line = JSON.stringify(event) + "\n";
  fs.appendFileSync(EVENTS_FILE, line);
}

/**
 * Get a single run by ID
 */
export function getRunMetrics(runId: string): RunMetrics | null {
  const filePath = path.join(RUNS_DIR, `${runId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as RunMetrics;
}

/**
 * Get step metrics for a specific run
 */
export function getStepMetrics(runId: string): StepMetrics[] {
  // Steps are stored individually; we need to filter by runId
  if (!fs.existsSync(STEPS_DIR)) return [];
  
  const files = fs.readdirSync(STEPS_DIR);
  const steps: StepMetrics[] = [];
  
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = path.join(STEPS_DIR, file);
    const step = JSON.parse(fs.readFileSync(filePath, "utf-8")) as StepMetrics;
    if (step.runId === runId) {
      steps.push(step);
    }
  }
  
  return steps.sort((a, b) => a.stepIndex - b.stepIndex);
}

/**
 * Get all run metrics for an agent
 */
export function getAgentRuns(agentId: string, options: {
  limit?: number;
  since?: number;
  until?: number;
  status?: RunMetrics["status"][];
} = {}): RunMetrics[] {
  if (!fs.existsSync(RUNS_DIR)) return [];
  
  const files = fs.readdirSync(RUNS_DIR);
  const runs: RunMetrics[] = [];
  
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = path.join(RUNS_DIR, file);
    const run = JSON.parse(fs.readFileSync(filePath, "utf-8")) as RunMetrics;
    if (run.agentId !== agentId) continue;
    
    // Apply filters
    if (options.since && run.startedAt < options.since) continue;
    if (options.until && run.startedAt > options.until) continue;
    if (options.status && !options.status.includes(run.status)) continue;
    
    runs.push(run);
  }
  
  // Sort by startedAt descending (most recent first)
  runs.sort((a, b) => b.startedAt - a.startedAt);
  
  if (options.limit) {
    return runs.slice(0, options.limit);
  }
  return runs;
}

/**
 * Get all run metrics (for analysis purposes)
 */
export function getAllRuns(options: {
  limit?: number;
  since?: number;
  until?: number;
  status?: RunMetrics["status"][];
} = {}): RunMetrics[] {
  if (!fs.existsSync(RUNS_DIR)) return [];
  
  const files = fs.readdirSync(RUNS_DIR);
  const runs: RunMetrics[] = [];
  
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = path.join(RUNS_DIR, file);
    const run = JSON.parse(fs.readFileSync(filePath, "utf-8")) as RunMetrics;
    
    // Apply filters
    if (options.since && run.startedAt < options.since) continue;
    if (options.until && run.startedAt > options.until) continue;
    if (options.status && !options.status.includes(run.status)) continue;
    
    runs.push(run);
  }
  
  // Sort by startedAt descending
  runs.sort((a, b) => b.startedAt - a.startedAt);
  
  if (options.limit) {
    return runs.slice(0, options.limit);
  }
  return runs;
}

/**
 * Get metric events with optional filtering
 */
export function getMetricEvents(options: {
  type?: string;
  since?: number;
  limit?: number;
} = {}): MetricEvent[] {
  if (!fs.existsSync(EVENTS_FILE)) return [];
  
  const content = fs.readFileSync(EVENTS_FILE, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  
  const events: MetricEvent[] = [];
  
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]) as MetricEvent;
      
      if (options.type && event.type !== options.type) continue;
      if (options.since && event.timestamp < options.since) continue;
      
      events.push(event);
      
      if (options.limit && events.length >= options.limit) break;
    } catch {
      // Skip malformed lines
    }
  }
  
  return events.reverse(); // Return chronological order
}

/**
 * Save agent metrics summary
 */
export function saveAgentMetricsSummary(summary: AgentMetricsSummary): void {
  ensureDirs();
  let summaries: AgentMetricsSummary[] = [];
  
  if (fs.existsSync(SUMMARIES_FILE)) {
    summaries = JSON.parse(fs.readFileSync(SUMMARIES_FILE, "utf-8"));
  }
  
  // Replace existing summary for this agent or add new
  const index = summaries.findIndex(s => s.agentId === summary.agentId);
  if (index >= 0) {
    summaries[index] = summary;
  } else {
    summaries.push(summary);
  }
  
  fs.writeFileSync(SUMMARIES_FILE, JSON.stringify(summaries, null, 2));
}

/**
 * Get agent metrics summary
 */
export function getAgentMetricsSummary(agentId: string): AgentMetricsSummary | null {
  if (!fs.existsSync(SUMMARIES_FILE)) return null;
  
  const summaries = JSON.parse(fs.readFileSync(SUMMARIES_FILE, "utf-8")) as AgentMetricsSummary[];
  return summaries.find(s => s.agentId === agentId) || null;
}

/**
 * Get all agent summaries
 */
export function getAllAgentSummaries(): AgentMetricsSummary[] {
  if (!fs.existsSync(SUMMARIES_FILE)) return [];
  return JSON.parse(fs.readFileSync(SUMMARIES_FILE, "utf-8")) as AgentMetricsSummary[];
}

/**
 * Delete old metrics beyond retention period
 */
export function cleanupOldMetrics(retentionDays: number): number {
  if (!fs.existsSync(RUNS_DIR)) return 0;
  
  const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
  const files = fs.readdirSync(RUNS_DIR);
  let deleted = 0;
  
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = path.join(RUNS_DIR, file);
    const run = JSON.parse(fs.readFileSync(filePath, "utf-8")) as RunMetrics;
    
    if (run.startedAt < cutoff) {
      fs.unlinkSync(filePath);
      deleted++;
      
      // Also delete associated steps
      const steps = getStepMetrics(run.runId);
      for (const step of steps) {
        const stepPath = path.join(STEPS_DIR, `${step.stepId}.json`);
        if (fs.existsSync(stepPath)) {
          fs.unlinkSync(stepPath);
        }
      }
    }
  }
  
  return deleted;
}
