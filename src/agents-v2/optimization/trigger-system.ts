/**
 * Optimization Trigger System - Phase 3 Self-Improvement Loop
 * 
 * Automatically detects when an agent needs optimization and triggers the process.
 * 
 * Key exports:
 * - checkOptimizationNeeded(agentId): Analyzes metrics to determine if optimization is needed
 * - triggerOptimization(agentId): Runs pattern analysis and creates optimization suggestions
 */

import { getDb, addLog } from "../../agents/db.js";
import type { AgentRecord } from "../../agents/db.js";
import { eventBus } from "../event-bus.js";
import type { 
  RunMetrics, 
  AgentMetricsSummary,
  MetricEvent 
} from "../metrics/types.js";
import { analyzeAgent, type RunAnalysis, type WorkflowSuggestion } from "../meta-learner.js";

// ============================================================================
// Types
// ============================================================================

export interface OptimizationCheckResult {
  needsOptimization: boolean;
  reason: string;
  confidence: number; // 0-1
  factors: OptimizationFactor[];
  severity: "low" | "medium" | "high" | "critical";
}

export interface OptimizationFactor {
  name: string;
  score: number; // 0-1, higher means more concerning
  weight: number; // 0-1, how much this contributes to the decision
  details: string;
  threshold: number;
  currentValue: number;
}

export interface TriggeredOptimization {
  id: string;
  agentId: string;
  triggeredAt: number;
  triggerReason: string;
  confidence: number;
  status: "analyzing" | "suggesting" | "completed" | "failed";
  analysis?: RunAnalysis;
  suggestions: WorkflowSuggestion[];
  patternReport?: PatternAnalysisReport;
  applied: number;
  notified: number;
  logged: number;
  error?: string;
}

export interface PatternAnalysisReport {
  agentId: string;
  analyzedAt: number;
  totalRuns: number;
  patterns: DetectedPattern[];
  insights: string[];
  recommendations: string[];
}

export interface DetectedPattern {
  type: "error-cluster" | "performance-degradation" | "quality-decline" | "cost-spike" | "step-bottleneck";
  description: string;
  severity: "low" | "medium" | "high";
  frequency: number; // 0-1, how often this pattern appears
  affectedRuns: string[];
  metrics: Record<string, number>;
}

export interface TriggerConfig {
  // Success rate thresholds
  minSuccessRate: number; // Default: 0.7
  minSuccessRateTrend: number; // percentage points decline to trigger (default: -15)
  
  // Performance thresholds
  maxAvgDurationMs: number; // Default: 60000
  maxDurationTrend: number; // percentage increase to trigger (default: 30)
  
  // Cost thresholds
  maxCostPerRun: number; // Default: 0.5
  maxCostTrend: number; // percentage increase to trigger (default: 40)
  
  // Quality thresholds
  minQualityScore: number; // Default: 60
  minQualityTrend: number; // percentage decline to trigger (default: -20)
  
  // Error thresholds
  maxConsecutiveFailures: number; // Default: 3
  maxErrorRate: number; // Default: 0.3
  
  // Step performance
  maxStepFailureRate: number; // Default: 0.25
  maxStepDurationMs: number; // Default: 30000
  
  // Minimum data requirements
  minRunsForAnalysis: number; // Default: 5
  analysisWindowHours: number; // Default: 24
}

export const DEFAULT_TRIGGER_CONFIG: TriggerConfig = {
  minSuccessRate: 0.7,
  minSuccessRateTrend: -15,
  maxAvgDurationMs: 60000,
  maxDurationTrend: 30,
  maxCostPerRun: 0.5,
  maxCostTrend: 40,
  minQualityScore: 60,
  minQualityTrend: -20,
  maxConsecutiveFailures: 3,
  maxErrorRate: 0.3,
  maxStepFailureRate: 0.25,
  maxStepDurationMs: 30000,
  minRunsForAnalysis: 5,
  analysisWindowHours: 24,
};

// ============================================================================
// State Management
// ============================================================================

const activeOptimizations = new Map<string, TriggeredOptimization>();
const recentChecks = new Map<string, number>(); // agentId -> timestamp of last check
const consecutiveFailureCounts = new Map<string, { count: number; lastFailure: number }>();

// Minimum interval between checks for the same agent (5 minutes)
const MIN_CHECK_INTERVAL_MS = 5 * 60 * 1000;

// ============================================================================
// Main Export: Check if Optimization is Needed
// ============================================================================

/**
 * Analyzes agent metrics to determine if optimization is needed.
 * Returns a detailed assessment with confidence score and reasoning.
 */
export async function checkOptimizationNeeded(
  agentId: string,
  config: Partial<TriggerConfig> = {}
): Promise<OptimizationCheckResult> {
  const fullConfig = { ...DEFAULT_TRIGGER_CONFIG, ...config };
  const now = Date.now();
  
  // Rate limiting - don't check too frequently
  const lastCheck = recentChecks.get(agentId);
  if (lastCheck && now - lastCheck < MIN_CHECK_INTERVAL_MS) {
    return {
      needsOptimization: false,
      reason: "Check rate limited - last check was too recent",
      confidence: 0,
      factors: [],
      severity: "low",
    };
  }
  recentChecks.set(agentId, now);

  // Check if optimization is already in progress
  const existing = activeOptimizations.get(agentId);
  if (existing && existing.status !== "completed" && existing.status !== "failed") {
    return {
      needsOptimization: false,
      reason: `Optimization already in progress (status: ${existing.status})`,
      confidence: 0,
      factors: [],
      severity: "low",
    };
  }

  const factors: OptimizationFactor[] = [];
  
  // Get metrics data
  const metrics = await getAgentMetrics(agentId, fullConfig.analysisWindowHours);
  const recentRuns = await getRecentRuns(agentId, fullConfig.minRunsForAnalysis);
  
  if (recentRuns.length < fullConfig.minRunsForAnalysis) {
    return {
      needsOptimization: false,
      reason: `Insufficient data (${recentRuns.length}/${fullConfig.minRunsForAnalysis} runs)`,
      confidence: 0,
      factors: [],
      severity: "low",
    };
  }

  // Factor 1: Success rate
  const successRateFactor = evaluateSuccessRate(metrics, fullConfig);
  factors.push(successRateFactor);

  // Factor 2: Performance (duration)
  const performanceFactor = evaluatePerformance(metrics, fullConfig);
  factors.push(performanceFactor);

  // Factor 3: Quality score
  const qualityFactor = evaluateQuality(metrics, fullConfig);
  factors.push(qualityFactor);

  // Factor 4: Cost efficiency
  const costFactor = evaluateCost(metrics, fullConfig);
  factors.push(costFactor);

  // Factor 5: Error patterns
  const errorFactor = evaluateErrors(recentRuns, fullConfig);
  factors.push(errorFactor);

  // Factor 6: Consecutive failures
  const consecutiveFactor = evaluateConsecutiveFailures(agentId, recentRuns, fullConfig);
  factors.push(consecutiveFactor);

  // Factor 7: Step performance
  const stepFactor = evaluateStepPerformance(metrics, fullConfig);
  factors.push(stepFactor);

  // Calculate overall score
  const weightedScore = factors.reduce((sum, f) => sum + f.score * f.weight, 0);
  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  const normalizedScore = weightedScore / totalWeight;

  // Determine confidence based on data quality
  const dataConfidence = Math.min(1, recentRuns.length / (fullConfig.minRunsForAnalysis * 2));
  const confidence = normalizedScore * dataConfidence;

  // Determine severity
  let severity: "low" | "medium" | "high" | "critical" = "low";
  if (normalizedScore > 0.8) severity = "critical";
  else if (normalizedScore > 0.6) severity = "high";
  else if (normalizedScore > 0.4) severity = "medium";

  // Generate reason text
  const concerningFactors = factors
    .filter(f => f.score > 0.5)
    .sort((a, b) => b.score - a.score);
  
  const reason = concerningFactors.length > 0
    ? `Optimization needed: ${concerningFactors.map(f => f.name).join(", ")}`
    : normalizedScore > 0.3
      ? "Minor optimization opportunities detected"
      : "Agent performing within expected parameters";

  // Publish event for monitoring
  eventBus.publish({
    id: `opt-check-${Date.now()}`,
    type: "agent:completed",
    timestamp: now,
    payload: {
      type: "optimization_check",
      agentId,
      needsOptimization: normalizedScore > 0.5,
      confidence,
      severity,
      factorCount: concerningFactors.length,
    },
    source: "trigger-system",
  });

  return {
    needsOptimization: normalizedScore > 0.5,
    reason,
    confidence,
    factors,
    severity,
  };
}

// ============================================================================
// Main Export: Trigger Optimization
// ============================================================================

/**
 * Triggers the optimization process for an agent.
 * Runs pattern analysis and creates optimization suggestions.
 */
export async function triggerOptimization(
  agentId: string,
  options: { autoApply?: boolean; checkFirst?: boolean } = {}
): Promise<TriggeredOptimization> {
  const { autoApply = false, checkFirst = true } = options;
  const id = `opt-${agentId}-${Date.now()}`;
  
  // Create initial record
  const optimization: TriggeredOptimization = {
    id,
    agentId,
    triggeredAt: Date.now(),
    triggerReason: "Manual trigger",
    confidence: 0,
    status: "analyzing",
    suggestions: [],
    applied: 0,
    notified: 0,
    logged: 0,
  };
  
  activeOptimizations.set(agentId, optimization);

  try {
    // Optional: Check if optimization is actually needed
    if (checkFirst) {
      const check = await checkOptimizationNeeded(agentId);
      optimization.triggerReason = check.reason;
      optimization.confidence = check.confidence;
      
      if (!check.needsOptimization) {
        optimization.status = "completed";
        addLog(agentId, "info", `Optimization not triggered: ${check.reason}`);
        return optimization;
      }
    }

    addLog(agentId, "info", `Starting optimization (confidence: ${optimization.confidence.toFixed(2)})`);

    // Step 1: Pattern Analysis
    optimization.status = "analyzing";
    const patternReport = await analyzePatterns(agentId);
    optimization.patternReport = patternReport;

    // Step 2: Deep Analysis via Meta-Learner
    const analysis = await analyzeAgent(agentId, 30);
    optimization.analysis = analysis;

    // Step 3: Generate Suggestions
    optimization.status = "suggesting";
    
    // Combine meta-learner suggestions with pattern-based suggestions
    const patternSuggestions = generatePatternSuggestions(patternReport);
    const allSuggestions = [...analysis.suggestions, ...patternSuggestions];
    
    // Deduplicate by target
    const uniqueSuggestions = deduplicateSuggestions(allSuggestions);
    optimization.suggestions = uniqueSuggestions;

    // Step 4: Apply or Notify
    if (autoApply) {
      const { applyImprovements } = await import("../meta-learner.js");
      const result = await applyImprovements(agentId, uniqueSuggestions);
      optimization.applied = result.applied;
      optimization.notified = result.notified;
      optimization.logged = result.logged;
    } else {
      // Just notify for all suggestions
      for (const suggestion of uniqueSuggestions) {
        eventBus.publish({
          id: `suggestion-${Date.now()}-${Math.random()}`,
          type: "agent:completed",
          timestamp: Date.now(),
          payload: {
            type: "optimization_suggested",
            agentId,
            suggestion,
            patternContext: patternReport.patterns
              .filter(p => p.affectedRuns.length > 0)
              .map(p => p.type),
          },
          source: "trigger-system",
        });
      }
      optimization.notified = uniqueSuggestions.length;
    }

    optimization.status = "completed";
    addLog(agentId, "info", `Optimization complete: ${optimization.applied} applied, ${optimization.notified} notified`);

    // Publish completion event
    eventBus.publish({
      id: `opt-complete-${Date.now()}`,
      type: "agent:completed",
      timestamp: Date.now(),
      payload: {
        type: "optimization_complete",
        agentId,
        optimizationId: id,
        suggestionCount: uniqueSuggestions.length,
        applied: optimization.applied,
        notified: optimization.notified,
      },
      source: "trigger-system",
    });

  } catch (err) {
    optimization.status = "failed";
    optimization.error = err instanceof Error ? err.message : String(err);
    addLog(agentId, "error", `Optimization failed: ${optimization.error}`);
  }

  return optimization;
}

// ============================================================================
// Pattern Analysis
// ============================================================================

async function analyzePatterns(agentId: string): Promise<PatternAnalysisReport> {
  const db = getDb();
  const windowStart = Date.now() - 24 * 60 * 60 * 1000; // Last 24 hours
  
  // Get runs in the window
  const runs = db.prepare(`
    SELECT r.id, r.status, r.error, r.started_at, r.completed_at,
           s.step_name, s.status as step_status, s.duration_ms
    FROM runs r
    LEFT JOIN steps s ON r.id = s.run_id
    WHERE r.agent_id = ? AND r.started_at > ?
    ORDER BY r.started_at DESC
  `).all(agentId, windowStart) as any[];

  const patterns: DetectedPattern[] = [];
  const insights: string[] = [];
  const recommendations: string[] = [];

  // Group runs
  const runsMap = new Map<string, any>();
  for (const row of runs) {
    if (!runsMap.has(row.id)) {
      runsMap.set(row.id, {
        id: row.id,
        status: row.status,
        error: row.error,
        started_at: row.started_at,
        completed_at: row.completed_at,
        steps: [],
      });
    }
    if (row.step_name) {
      runsMap.get(row.id).steps.push({
        name: row.step_name,
        status: row.step_status,
        duration_ms: row.duration_ms,
      });
    }
  }

  const runList = [...runsMap.values()];
  const failed = runList.filter((r: any) => r.status === "failed");
  const completed = runList.filter((r: any) => r.status === "completed");

  // Pattern 1: Error clustering
  if (failed.length > 0) {
    const errorGroups = new Map<string, string[]>();
    for (const run of failed) {
      const errorType = run.error?.split(":")[0] || "unknown";
      if (!errorGroups.has(errorType)) errorGroups.set(errorType, []);
      errorGroups.get(errorType)!.push(run.id);
    }

    for (const [errorType, runIds] of errorGroups) {
      if (runIds.length >= 2) {
        patterns.push({
          type: "error-cluster",
          description: `Cluster of ${runIds.length} runs failing with "${errorType}"`,
          severity: runIds.length > 5 ? "high" : "medium",
          frequency: runIds.length / runList.length,
          affectedRuns: runIds,
          metrics: { failureCount: runIds.length },
        });
        insights.push(`Error pattern detected: ${errorType} affects ${(runIds.length / runList.length * 100).toFixed(1)}% of runs`);
        recommendations.push(`Investigate root cause of "${errorType}" errors`);
      }
    }
  }

  // Pattern 2: Performance degradation
  if (completed.length >= 3) {
    const durations = completed
      .filter((r: any) => r.completed_at && r.started_at)
      .map((r: any) => new Date(r.completed_at).getTime() - new Date(r.started_at).getTime())
      .sort((a: number, b: number) => a - b);
    
    if (durations.length >= 3) {
      const recent = durations.slice(-3);
      const earlier = durations.slice(0, 3);
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const earlierAvg = earlier.reduce((a, b) => a + b, 0) / earlier.length;
      
      if (recentAvg > earlierAvg * 1.5) {
        patterns.push({
          type: "performance-degradation",
          description: `Performance degraded ${((recentAvg / earlierAvg - 1) * 100).toFixed(0)}%`,
          severity: recentAvg > earlierAvg * 2 ? "high" : "medium",
          frequency: 1,
          affectedRuns: completed.slice(-3).map((r: any) => r.id),
          metrics: { earlierAvg, recentAvg },
        });
        insights.push(`Performance trending slower: ${earlierAvg.toFixed(0)}ms → ${recentAvg.toFixed(0)}ms`);
        recommendations.push("Review slow steps for optimization opportunities");
      }
    }
  }

  // Pattern 3: Step bottlenecks
  const stepStats = new Map<string, { durations: number[]; failures: number }>();
  for (const run of runList) {
    for (const step of run.steps) {
      if (!stepStats.has(step.name)) {
        stepStats.set(step.name, { durations: [], failures: 0 });
      }
      const stats = stepStats.get(step.name)!;
      if (step.duration_ms) stats.durations.push(step.duration_ms);
      if (step.status === "failed") stats.failures++;
    }
  }

  for (const [stepName, stats] of stepStats) {
    const failureRate = stats.failures / runList.length;
    const avgDuration = stats.durations.length > 0
      ? stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length
      : 0;

    if (failureRate > 0.2 || avgDuration > 30000) {
      patterns.push({
        type: "step-bottleneck",
        description: `Step "${stepName}" is a bottleneck (${(failureRate * 100).toFixed(0)}% failure, ${avgDuration.toFixed(0)}ms avg)`,
        severity: failureRate > 0.5 ? "high" : "medium",
        frequency: Math.max(failureRate, Math.min(1, avgDuration / 60000)),
        affectedRuns: runList
          .filter((r: any) => r.steps.some((s: any) => s.name === stepName && (s.status === "failed" || s.duration_ms > 30000)))
          .map((r: any) => r.id),
        metrics: { failureRate, avgDuration },
      });
      insights.push(`Step "${stepName}" shows performance issues`);
      recommendations.push(`Optimize step "${stepName}" - consider caching or simplification`);
    }
  }

  return {
    agentId,
    analyzedAt: Date.now(),
    totalRuns: runList.length,
    patterns,
    insights,
    recommendations,
  };
}

// ============================================================================
// Evaluation Functions
// ============================================================================

function evaluateSuccessRate(metrics: AgentMetricsSummary | null, config: TriggerConfig): OptimizationFactor {
  if (!metrics) {
    return {
      name: "success-rate",
      score: 0.5, // Unknown, moderate concern
      weight: 0.25,
      details: "No metrics data available",
      threshold: config.minSuccessRate,
      currentValue: 0,
    };
  }

  const successRate = metrics.successRate;
  const trend = metrics.successRateTrend;
  const trendChange = metrics.successRateChange7d;

  let score = 0;
  let details = "";

  if (successRate < config.minSuccessRate) {
    score = Math.max(0, 1 - successRate / config.minSuccessRate) * 0.6;
    details = `Success rate ${(successRate * 100).toFixed(1)}% below threshold ${(config.minSuccessRate * 100).toFixed(0)}%`;
  }

  if (trend === "declining" && trendChange < config.minSuccessRateTrend) {
    score += 0.4;
    details += details ? "; " : "";
    details += `Declining trend: ${trendChange.toFixed(1)}pp over 7 days`;
  }

  if (score === 0) {
    details = `Success rate ${(successRate * 100).toFixed(1)}% is healthy`;
  }

  return {
    name: "success-rate",
    score,
    weight: 0.25,
    details,
    threshold: config.minSuccessRate,
    currentValue: successRate,
  };
}

function evaluatePerformance(metrics: AgentMetricsSummary | null, config: TriggerConfig): OptimizationFactor {
  if (!metrics) {
    return {
      name: "performance",
      score: 0.5,
      weight: 0.2,
      details: "No metrics data available",
      threshold: config.maxAvgDurationMs,
      currentValue: 0,
    };
  }

  const avgDuration = metrics.avgDurationMs;
  const p95Duration = metrics.p95DurationMs;

  let score = 0;
  let details = "";

  if (avgDuration > config.maxAvgDurationMs) {
    score = Math.min(1, avgDuration / config.maxAvgDurationMs - 1) * 0.5;
    details = `Avg duration ${avgDuration.toFixed(0)}ms exceeds threshold ${config.maxAvgDurationMs}ms`;
  }

  // P95 being significantly higher is a concern
  if (p95Duration > config.maxAvgDurationMs * 2) {
    score += 0.3;
    details += details ? "; " : "";
    details += `P95 duration ${p95Duration.toFixed(0)}ms is very high`;
  }

  if (score === 0) {
    details = `Duration ${avgDuration.toFixed(0)}ms is within limits`;
  }

  return {
    name: "performance",
    score,
    weight: 0.2,
    details,
    threshold: config.maxAvgDurationMs,
    currentValue: avgDuration,
  };
}

function evaluateQuality(metrics: AgentMetricsSummary | null, config: TriggerConfig): OptimizationFactor {
  if (!metrics || metrics.avgQualityScore === undefined) {
    return {
      name: "quality",
      score: 0.3, // Low concern if no quality data
      weight: 0.15,
      details: "No quality metrics available",
      threshold: config.minQualityScore,
      currentValue: metrics?.avgQualityScore || 0,
    };
  }

  const qualityScore = metrics.avgQualityScore;
  const trend = metrics.qualityScoreTrend;

  let score = 0;
  let details = "";

  if (qualityScore < config.minQualityScore) {
    score = Math.max(0, 1 - qualityScore / config.minQualityScore) * 0.7;
    details = `Quality score ${qualityScore.toFixed(1)} below threshold ${config.minQualityScore}`;
  }

  if (trend === "declining") {
    score += 0.3;
    details += details ? "; " : "";
    details += "Quality trend is declining";
  }

  if (score === 0) {
    details = `Quality score ${qualityScore.toFixed(1)} is acceptable`;
  }

  return {
    name: "quality",
    score,
    weight: 0.15,
    details,
    threshold: config.minQualityScore,
    currentValue: qualityScore,
  };
}

function evaluateCost(metrics: AgentMetricsSummary | null, config: TriggerConfig): OptimizationFactor {
  if (!metrics) {
    return {
      name: "cost",
      score: 0.3,
      weight: 0.1,
      details: "No cost metrics available",
      threshold: config.maxCostPerRun,
      currentValue: 0,
    };
  }

  const avgCost = metrics.avgCostPerRun;

  let score = 0;
  let details = "";

  if (avgCost > config.maxCostPerRun) {
    score = Math.min(1, avgCost / config.maxCostPerRun - 1) * 0.8;
    details = `Avg cost $${avgCost.toFixed(3)} exceeds threshold $${config.maxCostPerRun}`;
  }

  if (score === 0) {
    details = `Cost $${avgCost.toFixed(3)} is within budget`;
  }

  return {
    name: "cost",
    score,
    weight: 0.1,
    details,
    threshold: config.maxCostPerRun,
    currentValue: avgCost,
  };
}

function evaluateErrors(recentRuns: any[], config: TriggerConfig): OptimizationFactor {
  if (recentRuns.length === 0) {
    return {
      name: "errors",
      score: 0,
      weight: 0.15,
      details: "No recent runs",
      threshold: config.maxErrorRate,
      currentValue: 0,
    };
  }

  const failed = recentRuns.filter(r => r.status === "failed");
  const errorRate = failed.length / recentRuns.length;

  // Group errors by type
  const errorTypes = new Map<string, number>();
  for (const run of failed) {
    const errorType = run.error?.split(":")[0] || "unknown";
    errorTypes.set(errorType, (errorTypes.get(errorType) || 0) + 1);
  }

  // Check for recurring error patterns
  const recurringErrors = [...errorTypes.entries()].filter(([_, count]) => count >= 2);

  let score = 0;
  let details = "";

  if (errorRate > config.maxErrorRate) {
    score = Math.min(1, errorRate / config.maxErrorRate) * 0.6;
    details = `Error rate ${(errorRate * 100).toFixed(1)}% exceeds threshold ${(config.maxErrorRate * 100).toFixed(0)}%`;
  }

  if (recurringErrors.length > 0) {
    score += 0.4;
    details += details ? "; " : "";
    details += `${recurringErrors.length} recurring error type(s)`;
  }

  if (score === 0) {
    details = `Error rate ${(errorRate * 100).toFixed(1)}% is acceptable`;
  }

  return {
    name: "errors",
    score,
    weight: 0.15,
    details,
    threshold: config.maxErrorRate,
    currentValue: errorRate,
  };
}

function evaluateConsecutiveFailures(
  agentId: string,
  recentRuns: any[],
  config: TriggerConfig
): OptimizationFactor {
  // Count consecutive failures from most recent
  let consecutiveFailures = 0;
  for (const run of recentRuns) {
    if (run.status === "failed") {
      consecutiveFailures++;
    } else {
      break;
    }
  }

  // Update stored count
  if (consecutiveFailures > 0) {
    consecutiveFailureCounts.set(agentId, {
      count: consecutiveFailures,
      lastFailure: Date.now(),
    });
  }

  const stored = consecutiveFailureCounts.get(agentId);
  const totalConsecutive = stored?.count || consecutiveFailures;

  let score = 0;
  let details = "";

  if (totalConsecutive >= config.maxConsecutiveFailures) {
    score = Math.min(1, totalConsecutive / (config.maxConsecutiveFailures * 2));
    details = `${totalConsecutive} consecutive failures (threshold: ${config.maxConsecutiveFailures})`;
  } else {
    details = `${totalConsecutive} consecutive failures, within threshold`;
  }

  return {
    name: "consecutive-failures",
    score,
    weight: 0.15,
    details,
    threshold: config.maxConsecutiveFailures,
    currentValue: totalConsecutive,
  };
}

function evaluateStepPerformance(metrics: AgentMetricsSummary | null, config: TriggerConfig): OptimizationFactor {
  if (!metrics || !metrics.stepPerformance) {
    return {
      name: "step-performance",
      score: 0,
      weight: 0.1,
      details: "No step performance data",
      threshold: config.maxStepFailureRate,
      currentValue: 0,
    };
  }

  const steps = Object.entries(metrics.stepPerformance);
  const problematicSteps = steps.filter(([_, stats]) => 
    stats.failureRate > config.maxStepFailureRate || 
    stats.avgDurationMs > config.maxStepDurationMs
  );

  let score = 0;
  let details = "";

  if (problematicSteps.length > 0) {
    score = Math.min(1, problematicSteps.length / steps.length + 0.3);
    details = `${problematicSteps.length}/${steps.length} steps have performance issues`;
  } else {
    details = "All steps performing within limits";
  }

  return {
    name: "step-performance",
    score,
    weight: 0.1,
    details,
    threshold: config.maxStepFailureRate,
    currentValue: problematicSteps.length / Math.max(1, steps.length),
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

async function getAgentMetrics(agentId: string, windowHours: number): Promise<AgentMetricsSummary | null> {
  const db = getDb();
  
  // Get recent runs for this agent
  const windowStart = Date.now() - windowHours * 60 * 60 * 1000;
  
  const runs = db.prepare(`
    SELECT id, status, started_at, completed_at, 
           (julianday(completed_at) - julianday(started_at)) * 24 * 60 * 60 * 1000 as duration_ms
    FROM runs
    WHERE agent_id = ? AND started_at > datetime(?, 'unixepoch')
    ORDER BY started_at DESC
  `).all(agentId, Math.floor(windowStart / 1000)) as any[];

  if (runs.length === 0) return null;

  const total = runs.length;
  const successful = runs.filter(r => r.status === "completed").length;
  const failed = runs.filter(r => r.status === "failed").length;
  const successRate = successful / total;

  // Calculate durations
  const durations = runs
    .filter(r => r.duration_ms && !isNaN(r.duration_ms))
    .map(r => r.duration_ms)
    .sort((a, b) => a - b);

  const avgDuration = durations.length > 0 
    ? durations.reduce((a, b) => a + b, 0) / durations.length 
    : 0;

  const p50 = durations[Math.floor(durations.length * 0.5)] || 0;
  const p95 = durations[Math.floor(durations.length * 0.95)] || p50;
  const p99 = durations[Math.floor(durations.length * 0.99)] || p95;

  // Get older runs for trend calculation (7 days ago)
  const olderWindowStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const olderRuns = db.prepare(`
    SELECT status FROM runs
    WHERE agent_id = ? AND started_at > datetime(?, 'unixepoch') AND started_at < datetime(?, 'unixepoch')
  `).all(agentId, Math.floor(olderWindowStart / 1000), Math.floor(windowStart / 1000)) as any[];

  const olderSuccessRate = olderRuns.length > 0 
    ? olderRuns.filter(r => r.status === "completed").length / olderRuns.length 
    : successRate;
  
  const successRateChange = (successRate - olderSuccessRate) * 100;
  const successRateTrend: "improving" | "declining" | "stable" = 
    successRateChange > 5 ? "improving" :
    successRateChange < -5 ? "declining" : "stable";

  // Error patterns
  const errorCounts = new Map<string, number>();
  const failedRuns = runs.filter(r => r.status === "failed");
  for (const run of failedRuns) {
    // We'd need to join with error info - simplified here
    const errorType = "unknown";
    errorCounts.set(errorType, (errorCounts.get(errorType) || 0) + 1);
  }

  return {
    agentId,
    calculatedAt: Date.now(),
    windowHours,
    totalRuns: total,
    successfulRuns: successful,
    failedRuns: failed,
    successRate,
    successRateTrend,
    successRateChange7d: successRateChange,
    avgDurationMs: avgDuration,
    p50DurationMs: p50,
    p95DurationMs: p95,
    p99DurationMs: p99,
    avgTokensPerRun: 0, // Not tracked in DB yet
    avgCostPerRun: 0, // Not tracked in DB yet
    topErrors: [...errorCounts.entries()].map(([type, count]) => ({
      type,
      count,
      trend: "stable" as const,
    })),
    stepPerformance: {}, // Would need step-level aggregation
  };
}

async function getRecentRuns(agentId: string, limit: number): Promise<any[]> {
  const db = getDb();
  
  return db.prepare(`
    SELECT id, status, error, started_at, completed_at
    FROM runs
    WHERE agent_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(agentId, limit) as any[];
}

function generatePatternSuggestions(patternReport: PatternAnalysisReport): WorkflowSuggestion[] {
  const suggestions: WorkflowSuggestion[] = [];

  for (const pattern of patternReport.patterns) {
    switch (pattern.type) {
      case "error-cluster":
        suggestions.push({
          type: "config-tuning",
          target: "error-handling",
          reason: `Frequent "${pattern.description}" errors suggest configuration issues`,
          confidence: 0.75,
          proposedChange: { retryPolicy: "exponential-backoff", maxRetries: 3 },
        });
        break;

      case "performance-degradation":
        suggestions.push({
          type: "config-tuning",
          target: "timeout",
          reason: "Performance degradation detected - may need timeout adjustments",
          confidence: 0.7,
          proposedChange: { stepTimeoutMs: 120000, enableCaching: true },
        });
        break;

      case "step-bottleneck":
        const stepName = pattern.description.match(/"([^"]+)"/)?.[1] || "unknown";
        if (pattern.metrics.failureRate > 0.3) {
          suggestions.push({
            type: "prompt-improvement",
            target: stepName,
            reason: `Step "${stepName}" has ${(pattern.metrics.failureRate * 100).toFixed(0)}% failure rate`,
            confidence: 0.8,
            proposedChange: "Add error handling and retry logic",
          });
        }
        if (pattern.metrics.avgDuration > 30000) {
          suggestions.push({
            type: "config-tuning",
            target: stepName,
            reason: `Step "${stepName}" is slow (${pattern.metrics.avgDuration.toFixed(0)}ms avg)`,
            confidence: 0.65,
            proposedChange: { parallelize: true, cacheResults: true },
          });
        }
        break;

      case "cost-spike":
        suggestions.push({
          type: "config-tuning",
          target: "model-selection",
          reason: "Cost spike detected - consider using a cheaper model",
          confidence: 0.7,
          proposedChange: { model: "gpt-3.5-turbo" },
        });
        break;
    }
  }

  return suggestions;
}

function deduplicateSuggestions(suggestions: WorkflowSuggestion[]): WorkflowSuggestion[] {
  const seen = new Map<string, WorkflowSuggestion>();
  
  for (const suggestion of suggestions) {
    const key = `${suggestion.type}:${suggestion.target}`;
    const existing = seen.get(key);
    
    if (!existing || suggestion.confidence > existing.confidence) {
      seen.set(key, suggestion);
    }
  }
  
  return [...seen.values()];
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the current optimization status for an agent.
 */
export function getOptimizationStatus(agentId: string): TriggeredOptimization | undefined {
  return activeOptimizations.get(agentId);
}

/**
 * List all active optimizations.
 */
export function listActiveOptimizations(): TriggeredOptimization[] {
  return [...activeOptimizations.values()].filter(
    opt => opt.status !== "completed" && opt.status !== "failed"
  );
}

/**
 * Clear completed optimizations from memory.
 */
export function clearCompletedOptimizations(): number {
  let cleared = 0;
  for (const [agentId, opt] of activeOptimizations) {
    if (opt.status === "completed" || opt.status === "failed") {
      activeOptimizations.delete(agentId);
      cleared++;
    }
  }
  return cleared;
}

/**
 * Run optimization check on all enabled agents.
 * This can be scheduled as a cron job.
 */
export async function runGlobalOptimizationCheck(
  autoTrigger: boolean = false,
  config?: Partial<TriggerConfig>
): Promise<{ checked: number; triggered: number; skipped: number }> {
  const { listAgents } = await import("../../agents/db.js");
  const agents = listAgents().filter((a: AgentRecord) => a.enabled);
  
  let checked = 0;
  let triggered = 0;
  let skipped = 0;

  for (const agent of agents) {
    try {
      checked++;
      const result = await checkOptimizationNeeded(agent.id, config);
      
      if (result.needsOptimization) {
        if (autoTrigger) {
          await triggerOptimization(agent.id, { checkFirst: false });
          triggered++;
        } else {
          // Just notify
          eventBus.publish({
            id: `opt-needed-${Date.now()}`,
            type: "agent:completed",
            timestamp: Date.now(),
            payload: {
              type: "optimization_needed",
              agentId: agent.id,
              reason: result.reason,
              confidence: result.confidence,
              severity: result.severity,
            },
            source: "trigger-system",
          });
          skipped++;
        }
      }
    } catch (err) {
      console.error(`[TriggerSystem] Failed to check ${agent.id}:`, err);
    }
  }

  return { checked, triggered, skipped };
}

/**
 * Subscribe to run completion events and automatically check for optimization needs.
 * Call this to enable automatic optimization triggering.
 */
export function enableAutoOptimization(config?: Partial<TriggerConfig>): () => void {
  const handler = async (event: { type: string; payload?: { agentId?: string; runId?: string } }) => {
    if (event.type === "agent:completed" || event.type === "agent:failed") {
      const agentId = event.payload?.agentId;
      if (!agentId) return;

      try {
        const check = await checkOptimizationNeeded(agentId, config);
        
        if (check.needsOptimization && check.confidence > 0.7) {
          // High confidence auto-trigger
          await triggerOptimization(agentId, { checkFirst: false });
        } else if (check.needsOptimization) {
          // Medium confidence - just notify
          eventBus.publish({
            id: `opt-auto-${Date.now()}`,
            type: "agent:completed",
            timestamp: Date.now(),
            payload: {
              type: "optimization_suggested_auto",
              agentId,
              reason: check.reason,
              confidence: check.confidence,
            },
            source: "trigger-system",
          });
        }
      } catch (err) {
        console.error(`[TriggerSystem] Auto-check failed for ${agentId}:`, err);
      }
    }
  };

  // Subscribe to both completion and failure events
  // Note: eventBus.subscribe returns an unsubscribe function
  const unsubscribe = eventBus.subscribe("agent:completed", handler as any);
  const unsubscribe2 = eventBus.subscribe("agent:failed", handler as any);

  return () => {
    unsubscribe();
    unsubscribe2();
  };
}

/**
 * Create a custom trigger configuration for an agent.
 */
export function createAgentTriggerConfig(
  agentId: string,
  overrides: Partial<TriggerConfig>
): TriggerConfig {
  // In a full implementation, this would be stored in the database
  // For now, we just merge with defaults
  return { ...DEFAULT_TRIGGER_CONFIG, ...overrides };
}
