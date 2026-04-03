/**
 * Pattern Analyzer - Phase 3 Self-Improvement Loop
 * 
 * Analyzes run history to find patterns in successful vs failed runs.
 * Provides insights for agent optimization and recommendations.
 */

import type { RunMetrics, StepMetrics, AgentMetricsSummary } from "../metrics/types.js";
import {
  getAgentRuns,
  getStepMetrics,
  getRunMetrics,
  saveAgentMetricsSummary,
} from "../metrics/storage.js";

// ============================================================================
// Types
// ============================================================================

export interface PatternAnalysis {
  /** Pattern identifier */
  id: string;
  /** Pattern description */
  description: string;
  /** Pattern type */
  type: "success" | "failure" | "efficiency" | "quality";
  /** How confident we are in this pattern (0-1) */
  confidence: number;
  /** Data supporting this pattern */
  evidence: PatternEvidence[];
  /** Affected runs */
  runIds: string[];
}

export interface PatternEvidence {
  /** Metric field that shows the pattern */
  metric: string;
  /** Values for successful runs */
  successValues: number[];
  /** Values for failed runs */
  failureValues: number[];
  /** Statistical difference */
  difference: number;
}

export interface CommonError {
  /** Error type/category */
  type: string;
  /** Human-readable description */
  description: string;
  /** Number of occurrences */
  count: number;
  /** Percentage of failed runs */
  percentageOfFailures: number;
  /** When this error typically occurs (step index) */
  typicalStepIndex?: number;
  /** Whether this error is recoverable */
  isRecoverable: boolean;
  /** Suggested fixes */
  suggestions: string[];
}

export interface PerformanceRecommendation {
  /** Recommendation priority */
  priority: "critical" | "high" | "medium" | "low";
  /** Category of recommendation */
  category: "error_handling" | "prompt_optimization" | "resource_usage" | "workflow" | "quality";
  /** Brief title */
  title: string;
  /** Detailed description */
  description: string;
  /** Expected impact if implemented */
  expectedImpact: {
    successRateImprovement?: number;
    durationReductionMs?: number;
    costReduction?: number;
    qualityImprovement?: number;
  };
  /** How to implement this recommendation */
  implementation: string;
  /** Related patterns that support this */
  relatedPatterns: string[];
}

export interface AgentPerformanceAnalysis {
  /** Agent identifier */
  agentId: string;
  /** When analysis was performed */
  analyzedAt: number;
  /** Analysis window in hours */
  windowHours: number;
  /** Overall success rate (0-1) */
  successRate: number;
  /** Rate over previous period for comparison */
  previousSuccessRate: number | null;
  /** Most common errors encountered */
  commonErrors: CommonError[];
  /** Discovered patterns */
  patterns: PatternAnalysis[];
  /** Actionable recommendations */
  recommendations: PerformanceRecommendation[];
  /** Raw metrics summary */
  summary: {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    avgDurationMs: number;
    avgTokensPerRun: number;
    avgQualityScore?: number;
  };
}

// ============================================================================
// Main Analysis Function
// ============================================================================

/**
 * Analyze agent performance by examining run history.
 * 
 * @param agentId - The agent to analyze
 * @param options - Analysis options
 * @returns Comprehensive performance analysis
 */
export async function analyzeAgentPerformance(
  agentId: string,
  options: {
    windowHours?: number;
    minRunsForAnalysis?: number;
  } = {}
): Promise<AgentPerformanceAnalysis> {
  const windowHours = options.windowHours ?? 168; // 7 days default
  const minRunsForAnalysis = options.minRunsForAnalysis ?? 5;
  
  const since = Date.now() - (windowHours * 60 * 60 * 1000);
  
  // Fetch current period runs
  const runs = getAgentRuns(agentId, { since, limit: 1000 });
  
  // Fetch previous period for trend comparison
  const previousSince = since - (windowHours * 60 * 60 * 1000);
  const previousRuns = getAgentRuns(agentId, {
    since: previousSince,
    until: since,
  });
  
  // Calculate basic stats
  const totalRuns = runs.length;
  const successfulRuns = runs.filter(r => r.status === "completed").length;
  const failedRuns = runs.filter(r => r.status === "failed").length;
  const successRate = totalRuns > 0 ? successfulRuns / totalRuns : 0;
  
  const previousTotal = previousRuns.length;
  const previousSuccess = previousRuns.filter(r => r.status === "completed").length;
  const previousSuccessRate = previousTotal > 0 ? previousSuccess / previousTotal : null;
  
  // If not enough runs, return basic analysis
  if (totalRuns < minRunsForAnalysis) {
    return {
      agentId,
      analyzedAt: Date.now(),
      windowHours,
      successRate,
      previousSuccessRate,
      commonErrors: [],
      patterns: [],
      recommendations: [{
        priority: "medium",
        category: "workflow",
        title: "Insufficient Data for Analysis",
        description: `Only ${totalRuns} runs found in the last ${windowHours} hours. Need at least ${minRunsForAnalysis} runs for meaningful analysis.`,
        expectedImpact: {},
        implementation: "Run the agent more frequently to gather data for analysis.",
        relatedPatterns: [],
      }],
      summary: {
        totalRuns,
        successfulRuns,
        failedRuns,
        avgDurationMs: 0,
        avgTokensPerRun: 0,
      },
    };
  }
  
  // Calculate averages
  const avgDurationMs = runs.length > 0
    ? runs.reduce((sum, r) => sum + r.totalDurationMs, 0) / runs.length
    : 0;
  
  const avgTokensPerRun = runs.length > 0
    ? runs.reduce((sum, r) => sum + r.tokensUsed.total, 0) / runs.length
    : 0;
  
  const qualityScores = runs
    .filter(r => r.qualityScore !== undefined)
    .map(r => r.qualityScore!);
  const avgQualityScore = qualityScores.length > 0
    ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
    : undefined;
  
  // Analyze errors
  const commonErrors = analyzeErrors(runs);
  
  // Find patterns
  const patterns = findPatterns(runs);
  
  // Generate recommendations
  const recommendations = generateRecommendations(
    runs,
    commonErrors,
    patterns,
    successRate,
    avgDurationMs,
    avgTokensPerRun
  );
  
  const analysis: AgentPerformanceAnalysis = {
    agentId,
    analyzedAt: Date.now(),
    windowHours,
    successRate,
    previousSuccessRate,
    commonErrors,
    patterns,
    recommendations,
    summary: {
      totalRuns,
      successfulRuns,
      failedRuns,
      avgDurationMs,
      avgTokensPerRun,
      avgQualityScore,
    },
  };
  
  // Save/update summary
  updateAgentSummary(agentId, analysis);
  
  return analysis;
}

// ============================================================================
// Error Analysis
// ============================================================================

function analyzeErrors(runs: RunMetrics[]): CommonError[] {
  const failedRuns = runs.filter(r => r.status === "failed");
  if (failedRuns.length === 0) return [];
  
  // Group by error type
  const errorGroups = new Map<string, RunMetrics[]>();
  
  for (const run of failedRuns) {
    const errorType = run.errorType || "unknown";
    if (!errorGroups.has(errorType)) {
      errorGroups.set(errorType, []);
    }
    errorGroups.get(errorType)!.push(run);
  }
  
  // Convert to CommonError array
  const errors: CommonError[] = [];
  
  for (const [type, errorRuns] of errorGroups) {
    const count = errorRuns.length;
    const percentageOfFailures = (count / failedRuns.length) * 100;
    
    // Find typical step index
    const stepIndices = errorRuns
      .map(r => r.errorStepIndex)
      .filter((i): i is number => i !== undefined);
    
    const typicalStepIndex = stepIndices.length > 0
      ? Math.round(stepIndices.reduce((a, b) => a + b, 0) / stepIndices.length)
      : undefined;
    
    // Check if generally recoverable
    const recoverableCount = errorRuns.filter(r => r.errorRecoverable).length;
    const isRecoverable = recoverableCount / errorRuns.length > 0.5;
    
    // Generate description and suggestions based on error category
    const { description, suggestions } = getErrorInfo(type, errorRuns);
    
    errors.push({
      type,
      description,
      count,
      percentageOfFailures,
      typicalStepIndex,
      isRecoverable,
      suggestions,
    });
  }
  
  // Sort by count descending
  return errors.sort((a, b) => b.count - a.count);
}

function getErrorInfo(
  type: string, 
  runs: RunMetrics[]
): { description: string; suggestions: string[] } {
  // Get most common error category
  const categories: Array<NonNullable<RunMetrics["errorCategory"]>> = [];
  for (const run of runs) {
    if (run.errorCategory) {
      categories.push(run.errorCategory);
    }
  }
  
  const category: NonNullable<RunMetrics["errorCategory"]> = categories.length > 0
    ? getMostFrequent(categories) ?? "unknown"
    : "unknown";
  
  const errorTemplates: Record<string, { description: string; suggestions: string[] }> = {
    transient: {
      description: `Transient errors (network timeouts, rate limits) occurring during execution`,
      suggestions: [
        "Increase retry count with exponential backoff",
        "Implement circuit breaker pattern",
        "Add jitter to retry delays",
      ],
    },
    persistent: {
      description: `Persistent errors that repeat across multiple attempts`,
      suggestions: [
        "Review agent prompt for logical errors",
        "Check for external API changes",
        "Validate input data schemas",
      ],
    },
    config: {
      description: `Configuration-related errors (missing API keys, invalid settings)`,
      suggestions: [
        "Validate configuration on agent startup",
        "Add configuration health check",
        "Document required environment variables",
      ],
    },
    resource: {
      description: `Resource exhaustion (OOM, disk full, rate limits)`,
      suggestions: [
        "Implement resource limits and quotas",
        "Add resource cleanup between runs",
        "Optimize memory usage in prompts",
      ],
    },
    logic: {
      description: `Logic errors in agent workflow or tool usage`,
      suggestions: [
        "Review step dependencies and ordering",
        "Add input validation at each step",
        "Implement better error propagation",
      ],
    },
    unknown: {
      description: `Unclassified errors requiring investigation`,
      suggestions: [
        "Enable detailed logging for diagnosis",
        "Add error categorization to metrics",
        "Review recent code changes",
      ],
    },
  };
  
  return errorTemplates[category] || errorTemplates.unknown;
}

// ============================================================================
// Pattern Detection
// ============================================================================

function findPatterns(runs: RunMetrics[]): PatternAnalysis[] {
  const patterns: PatternAnalysis[] = [];
  
  const successfulRuns = runs.filter(r => r.status === "completed");
  const failedRuns = runs.filter(r => r.status === "failed");
  
  if (successfulRuns.length === 0 || failedRuns.length === 0) {
    return patterns;
  }
  
  // Pattern 1: Step count correlation
  const stepCountPattern = analyzeStepCountPattern(successfulRuns, failedRuns);
  if (stepCountPattern) patterns.push(stepCountPattern);
  
  // Pattern 2: Duration correlation
  const durationPattern = analyzeDurationPattern(successfulRuns, failedRuns);
  if (durationPattern) patterns.push(durationPattern);
  
  // Pattern 3: Token usage pattern
  const tokenPattern = analyzeTokenPattern(successfulRuns, failedRuns);
  if (tokenPattern) patterns.push(tokenPattern);
  
  // Pattern 4: Retry pattern
  const retryPattern = analyzeRetryPattern(successfulRuns, failedRuns);
  if (retryPattern) patterns.push(retryPattern);
  
  // Pattern 5: Checkpoint pattern
  const checkpointPattern = analyzeCheckpointPattern(successfulRuns, failedRuns);
  if (checkpointPattern) patterns.push(checkpointPattern);
  
  // Pattern 6: Quality score pattern (if available)
  const qualityPattern = analyzeQualityPattern(successfulRuns, failedRuns);
  if (qualityPattern) patterns.push(qualityPattern);
  
  return patterns.sort((a, b) => b.confidence - a.confidence);
}

function analyzeStepCountPattern(successful: RunMetrics[], failed: RunMetrics[]): PatternAnalysis | null {
  const successSteps = successful.map(r => r.stepCount);
  const failedSteps = failed.map(r => r.stepCount);
  
  const successAvg = average(successSteps);
  const failedAvg = average(failedSteps);
  
  // Significant difference threshold: 20%
  const diff = Math.abs(successAvg - failedAvg) / Math.max(successAvg, failedAvg);
  
  if (diff < 0.2) return null;
  
  const successHasMore = successAvg > failedAvg;
  
  return {
    id: "step-count-correlation",
    description: successHasMore
      ? `Successful runs complete more steps (${successAvg.toFixed(1)} vs ${failedAvg.toFixed(1)} avg)`
      : `Failed runs attempt more steps before failing (${failedAvg.toFixed(1)} vs ${successAvg.toFixed(1)} avg)`,
    type: successHasMore ? "success" : "failure",
    confidence: Math.min(diff, 1),
    evidence: [{
      metric: "stepCount",
      successValues: successSteps,
      failureValues: failedSteps,
      difference: diff,
    }],
    runIds: [...successful.map(r => r.runId), ...failed.map(r => r.runId)],
  };
}

function analyzeDurationPattern(successful: RunMetrics[], failed: RunMetrics[]): PatternAnalysis | null {
  const successDuration = successful.map(r => r.totalDurationMs);
  const failedDuration = failed.map(r => r.totalDurationMs);
  
  const successAvg = average(successDuration);
  const failedAvg = average(failedDuration);
  
  const diff = Math.abs(successAvg - failedAvg) / Math.max(successAvg, failedAvg);
  
  if (diff < 0.15) return null;
  
  const successLonger = successAvg > failedAvg;
  
  return {
    id: "duration-correlation",
    description: successLonger
      ? `Successful runs take longer to complete (${formatDuration(successAvg)} vs ${formatDuration(failedAvg)} avg)`
      : `Failed runs fail quickly (${formatDuration(failedAvg)} vs ${formatDuration(successAvg)} avg)`,
    type: successLonger ? "success" : "failure",
    confidence: Math.min(diff, 1),
    evidence: [{
      metric: "totalDurationMs",
      successValues: successDuration,
      failureValues: failedDuration,
      difference: diff,
    }],
    runIds: [...successful.map(r => r.runId), ...failed.map(r => r.runId)],
  };
}

function analyzeTokenPattern(successful: RunMetrics[], failed: RunMetrics[]): PatternAnalysis | null {
  const successTokens = successful.map(r => r.tokensUsed.total);
  const failedTokens = failed.map(r => r.tokensUsed.total);
  
  const successAvg = average(successTokens);
  const failedAvg = average(failedTokens);
  
  const diff = Math.abs(successAvg - failedAvg) / Math.max(successAvg, failedAvg);
  
  if (diff < 0.15) return null;
  
  const successUsesMore = successAvg > failedAvg;
  
  return {
    id: "token-usage-correlation",
    description: successUsesMore
      ? `Successful runs use more tokens (${successAvg.toFixed(0)} vs ${failedAvg.toFixed(0)} avg)`
      : `Failed runs waste tokens before failing (${failedAvg.toFixed(0)} vs ${successAvg.toFixed(0)} avg)`,
    type: successUsesMore ? "success" : "efficiency",
    confidence: Math.min(diff, 1),
    evidence: [{
      metric: "tokensUsed.total",
      successValues: successTokens,
      failureValues: failedTokens,
      difference: diff,
    }],
    runIds: [...successful.map(r => r.runId), ...failed.map(r => r.runId)],
  };
}

function analyzeRetryPattern(successful: RunMetrics[], failed: RunMetrics[]): PatternAnalysis | null {
  const successRetries = successful.map(r => r.retryCount);
  const failedRetries = failed.map(r => r.retryCount);
  
  const successAvg = average(successRetries);
  const failedAvg = average(failedRetries);
  
  // Retries indicate resilience
  if (successAvg < 0.1 && failedAvg < 0.1) return null;
  
  const diff = Math.abs(successAvg - failedAvg) / Math.max(successAvg, 1);
  
  return {
    id: "retry-resilience",
    description: successAvg > failedAvg
      ? `Successful runs recover from more retries (${successAvg.toFixed(1)} vs ${failedAvg.toFixed(1)} avg)`
      : `Failed runs don\'t benefit from retries (${failedAvg.toFixed(1)} vs ${successAvg.toFixed(1)} avg)`,
    type: "success",
    confidence: Math.min(diff, 1),
    evidence: [{
      metric: "retryCount",
      successValues: successRetries,
      failureValues: failedRetries,
      difference: diff,
    }],
    runIds: [...successful.map(r => r.runId), ...failed.map(r => r.runId)],
  };
}

function analyzeCheckpointPattern(successful: RunMetrics[], failed: RunMetrics[]): PatternAnalysis | null {
  const successCheckpoints = successful.map(r => r.checkpointCount);
  const failedCheckpoints = failed.map(r => r.checkpointCount);
  
  const successAvg = average(successCheckpoints);
  const failedAvg = average(failedCheckpoints);
  
  if (successAvg < 0.5 && failedAvg < 0.5) return null;
  
  const diff = Math.abs(successAvg - failedAvg) / Math.max(successAvg, 1);
  
  return {
    id: "checkpoint-usage",
    description: successAvg > failedAvg
      ? `Successful runs use more checkpoints (${successAvg.toFixed(1)} vs ${failedAvg.toFixed(1)} avg)`
      : `Consider adding more checkpoints (successful: ${successAvg.toFixed(1)}, failed: ${failedAvg.toFixed(1)})`,
    type: "success",
    confidence: Math.min(diff, 1),
    evidence: [{
      metric: "checkpointCount",
      successValues: successCheckpoints,
      failureValues: failedCheckpoints,
      difference: diff,
    }],
    runIds: [...successful.map(r => r.runId), ...failed.map(r => r.runId)],
  };
}

function analyzeQualityPattern(successful: RunMetrics[], failed: RunMetrics[]): PatternAnalysis | null {
  const successQuality = successful
    .map(r => r.qualityScore)
    .filter((q): q is number => q !== undefined);
  const failedQuality = failed
    .map(r => r.qualityScore)
    .filter((q): q is number => q !== undefined);
  
  if (successQuality.length === 0 || failedQuality.length === 0) return null;
  
  const successAvg = average(successQuality);
  const failedAvg = average(failedQuality);
  
  const diff = Math.abs(successAvg - failedAvg) / 100; // Quality is 0-100
  
  if (diff < 0.1) return null;
  
  return {
    id: "quality-score-correlation",
    description: `Quality scores differ between success/failure (${successAvg.toFixed(1)} vs ${failedAvg.toFixed(1)} avg)`,
    type: "quality",
    confidence: diff,
    evidence: [{
      metric: "qualityScore",
      successValues: successQuality,
      failureValues: failedQuality,
      difference: diff,
    }],
    runIds: [...successful.map(r => r.runId), ...failed.map(r => r.runId)],
  };
}

// ============================================================================
// Recommendation Generation
// ============================================================================

function generateRecommendations(
  runs: RunMetrics[],
  errors: CommonError[],
  patterns: PatternAnalysis[],
  successRate: number,
  avgDurationMs: number,
  avgTokensPerRun: number
): PerformanceRecommendation[] {
  const recommendations: PerformanceRecommendation[] = [];
  
  // Recommendation 1: Address common errors
  for (const error of errors.slice(0, 3)) {
    const priority = error.percentageOfFailures > 50 ? "critical" :
                   error.percentageOfFailures > 25 ? "high" : "medium";
    
    const category = error.type.includes("rate") || error.type.includes("timeout")
      ? "error_handling"
      : error.type.includes("config")
      ? "workflow"
      : "prompt_optimization";
    
    recommendations.push({
      priority,
      category,
      title: `Address ${error.type} errors`,
      description: `${error.count} occurrences (${error.percentageOfFailures.toFixed(1)}% of failures). ${error.description}`,
      expectedImpact: {
        successRateImprovement: error.percentageOfFailures / 100 * 0.5,
      },
      implementation: error.suggestions.join("; "),
      relatedPatterns: [],
    });
  }
  
  // Recommendation 2: Success rate improvement
  if (successRate < 0.7) {
    recommendations.push({
      priority: "high",
      category: "workflow",
      title: "Improve overall success rate",
      description: `Current success rate is ${(successRate * 100).toFixed(1)}%, below the 70% threshold`,
      expectedImpact: {
        successRateImprovement: 0.7 - successRate,
      },
      implementation: "Review failure patterns and implement targeted fixes based on error analysis",
      relatedPatterns: patterns.map(p => p.id),
    });
  }
  
  // Recommendation 3: Duration optimization
  const durationPattern = patterns.find(p => p.id === "duration-correlation");
  if (durationPattern && durationPattern.type === "success") {
    const successAvg = average(durationPattern.evidence[0]?.successValues || []);
    const failedAvg = average(durationPattern.evidence[0]?.failureValues || []);
    
    if (successAvg > 30000) { // More than 30 seconds
      recommendations.push({
        priority: "medium",
        category: "resource_usage",
        title: "Optimize run duration",
        description: `Successful runs average ${formatDuration(successAvg)}. Consider parallelization or caching.`,
        expectedImpact: {
          durationReductionMs: successAvg * 0.3,
        },
        implementation: "Profile slow steps, add caching for expensive operations, consider async where possible",
        relatedPatterns: ["duration-correlation"],
      });
    }
  }
  
  // Recommendation 4: Token efficiency
  const tokenPattern = patterns.find(p => p.id === "token-usage-correlation");
  if (tokenPattern && avgTokensPerRun > 50000) {
    recommendations.push({
      priority: "medium",
      category: "resource_usage",
      title: "Reduce token consumption",
      description: `Average ${avgTokensPerRun.toFixed(0)} tokens per run. Consider prompt optimization.`,
      expectedImpact: {
        costReduction: 0.2,
      },
      implementation: "Review prompt templates, remove redundant context, use shorter system prompts",
      relatedPatterns: ["token-usage-correlation"],
    });
  }
  
  // Recommendation 5: Checkpoint strategy
  const checkpointPattern = patterns.find(p => p.id === "checkpoint-usage");
  if (!checkpointPattern && runs.some(r => r.totalDurationMs > 60000)) {
    recommendations.push({
      priority: "low",
      category: "workflow",
      title: "Implement checkpoint strategy",
      description: "Long-running tasks would benefit from checkpoint/resume capability",
      expectedImpact: {
        successRateImprovement: 0.05,
      },
      implementation: "Add checkpoint calls at natural break points in the workflow",
      relatedPatterns: [],
    });
  }
  
  // Recommendation 6: Quality improvement
  const qualityPattern = patterns.find(p => p.id === "quality-score-correlation");
  const qualityScores = runs
    .filter(r => r.qualityScore !== undefined)
    .map(r => r.qualityScore!);
  
  if (qualityScores.length > 0) {
    const avgQuality = average(qualityScores);
    if (avgQuality < 80) {
      recommendations.push({
        priority: "medium",
        category: "quality",
        title: "Improve output quality",
        description: `Average quality score is ${avgQuality.toFixed(1)}/100. Review outputs and refine prompts.`,
        expectedImpact: {
          qualityImprovement: 80 - avgQuality,
        },
        implementation: "Add quality criteria to prompts, implement output validation, add self-review steps",
        relatedPatterns: qualityPattern ? ["quality-score-correlation"] : [],
      });
    }
  }
  
  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  return recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}

// ============================================================================
// Helper Functions
// ============================================================================

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function getMostFrequent<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  
  const counts = new Map<T, number>();
  for (const item of arr) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  
  let maxCount = 0;
  let mostFrequent: T | undefined;
  
  for (const [item, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      mostFrequent = item;
    }
  }
  
  return mostFrequent;
}

function updateAgentSummary(agentId: string, analysis: AgentPerformanceAnalysis): void {
  const summary: AgentMetricsSummary = {
    agentId,
    calculatedAt: Date.now(),
    windowHours: analysis.windowHours,
    totalRuns: analysis.summary.totalRuns,
    successfulRuns: analysis.summary.successfulRuns,
    failedRuns: analysis.summary.failedRuns,
    successRate: analysis.successRate,
    successRateTrend: analysis.previousSuccessRate !== null
      ? analysis.successRate > analysis.previousSuccessRate + 0.05
        ? "improving"
        : analysis.successRate < analysis.previousSuccessRate - 0.05
        ? "declining"
        : "stable"
      : "stable",
    successRateChange7d: analysis.previousSuccessRate !== null
      ? (analysis.successRate - analysis.previousSuccessRate) * 100
      : 0,
    avgDurationMs: analysis.summary.avgDurationMs,
    p50DurationMs: analysis.summary.avgDurationMs, // Simplified
    p95DurationMs: analysis.summary.avgDurationMs * 1.5, // Estimate
    p99DurationMs: analysis.summary.avgDurationMs * 2, // Estimate
    avgTokensPerRun: analysis.summary.avgTokensPerRun,
    avgCostPerRun: 0, // Would need pricing calculation
    avgQualityScore: analysis.summary.avgQualityScore,
    qualityScoreTrend: "stable",
    topErrors: analysis.commonErrors.slice(0, 5).map(e => ({
      type: e.type,
      count: e.count,
      trend: "stable" as const, // Would need historical comparison
    })),
    stepPerformance: {}, // Would need step-level analysis
  };
  
  saveAgentMetricsSummary(summary);
}

// ============================================================================
// Additional Analysis Functions
// ============================================================================

/**
 * Compare performance between two time periods
 */
export function comparePeriods(
  agentId: string,
  period1: { since: number; until: number },
  period2: { since: number; until: number }
): {
  period1: { successRate: number; avgDuration: number; runCount: number };
  period2: { successRate: number; avgDuration: number; runCount: number };
  improvements: string[];
  regressions: string[];
} {
  const runs1 = getAgentRuns(agentId, { since: period1.since, until: period1.until });
  const runs2 = getAgentRuns(agentId, { since: period2.since, until: period2.until });
  
  const success1 = runs1.filter(r => r.status === "completed").length;
  const success2 = runs2.filter(r => r.status === "completed").length;
  
  const stats1 = {
    successRate: runs1.length > 0 ? success1 / runs1.length : 0,
    avgDuration: runs1.length > 0 ? average(runs1.map(r => r.totalDurationMs)) : 0,
    runCount: runs1.length,
  };
  
  const stats2 = {
    successRate: runs2.length > 0 ? success2 / runs2.length : 0,
    avgDuration: runs2.length > 0 ? average(runs2.map(r => r.totalDurationMs)) : 0,
    runCount: runs2.length,
  };
  
  const improvements: string[] = [];
  const regressions: string[] = [];
  
  if (stats2.successRate > stats1.successRate + 0.05) {
    improvements.push(`Success rate improved from ${(stats1.successRate * 100).toFixed(1)}% to ${(stats2.successRate * 100).toFixed(1)}%`);
  } else if (stats2.successRate < stats1.successRate - 0.05) {
    regressions.push(`Success rate declined from ${(stats1.successRate * 100).toFixed(1)}% to ${(stats2.successRate * 100).toFixed(1)}%`);
  }
  
  if (stats2.avgDuration < stats1.avgDuration * 0.8) {
    improvements.push(`Duration improved from ${formatDuration(stats1.avgDuration)} to ${formatDuration(stats2.avgDuration)}`);
  } else if (stats2.avgDuration > stats1.avgDuration * 1.2) {
    regressions.push(`Duration increased from ${formatDuration(stats1.avgDuration)} to ${formatDuration(stats2.avgDuration)}`);
  }
  
  return {
    period1: stats1,
    period2: stats2,
    improvements,
    regressions,
  };
}

/**
 * Get step-level analysis for a specific run
 */
export async function analyzeRunSteps(runId: string): Promise<{
  runId: string;
  stepCount: number;
  bottleneckStep?: { index: number; name: string; durationMs: number };
  failedStep?: { index: number; name: string; errorType?: string };
  durationBreakdown: Array<{ stepIndex: number; name: string; durationMs: number; percentage: number }>;
} | null> {
  const run = getRunMetrics(runId);
  if (!run) return null;
  
  const steps = getStepMetrics(runId);
  if (steps.length === 0) return null;
  
  const totalDuration = steps.reduce((sum, s) => sum + s.durationMs, 0);
  
  // Find bottleneck (longest step)
  const sortedByDuration = [...steps].sort((a, b) => b.durationMs - a.durationMs);
  const bottleneckStep = sortedByDuration[0]?.durationMs > totalDuration * 0.3
    ? {
        index: sortedByDuration[0].stepIndex,
        name: sortedByDuration[0].stepName,
        durationMs: sortedByDuration[0].durationMs,
      }
    : undefined;
  
  // Find failed step
  const failedStep = steps.find(s => s.status === "failed");
  
  return {
    runId,
    stepCount: steps.length,
    bottleneckStep,
    failedStep: failedStep
      ? {
          index: failedStep.stepIndex,
          name: failedStep.stepName,
          errorType: run.errorType,
        }
      : undefined,
    durationBreakdown: steps.map(s => ({
      stepIndex: s.stepIndex,
      name: s.stepName,
      durationMs: s.durationMs,
      percentage: totalDuration > 0 ? (s.durationMs / totalDuration) * 100 : 0,
    })),
  };
}
