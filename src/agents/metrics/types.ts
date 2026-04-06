/**
 * Self-Improvement Metrics System - Core Types
 * 
 * Comprehensive performance tracking for agent runs and experiments.
 */

// ============================================================================
// Run-level Metrics
// ============================================================================

export interface RunMetrics {
  runId: string;
  agentId: string;
  variantId?: string; // For A/B testing
  
  // Timing
  startedAt: number;
  completedAt?: number;
  totalDurationMs: number;
  
  // Execution
  status: "completed" | "failed" | "paused" | "cancelled";
  stepCount: number;
  retryCount: number;
  checkpointCount: number;
  
  // Resource usage
  tokensUsed: {
    prompt: number;
    completion: number;
    total: number;
  };
  tokensPerStep: Record<string, number>;
  costEstimate?: number; // USD
  
  // Quality scores (0-100)
  qualityScore?: number; // Overall output quality
  coherenceScore?: number; // Logical consistency
  correctnessScore?: number; // Factual accuracy
  completenessScore?: number; // Coverage of requirements
  
  // Failure analysis
  errorType?: string;
  errorCategory?: "transient" | "persistent" | "config" | "resource" | "logic" | "unknown";
  errorRecoverable?: boolean;
  errorStepIndex?: number;
  
  // Context
  triggerType: string;
  goalId?: string;
  parentRunId?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Step-level Metrics
// ============================================================================

export interface StepMetrics {
  stepId: string;
  runId: string;
  agentId: string;
  
  stepIndex: number;
  stepName: string;
  stepType: string;
  
  // Timing
  startedAt: number;
  completedAt?: number;
  durationMs: number;
  
  // Execution
  status: "completed" | "failed" | "skipped" | "retrying";
  attemptNumber: number;
  
  // LLM-specific metrics (for llm/skill steps)
  llmMetrics?: LLMStepMetrics;
  
  // Tool-specific metrics
  toolMetrics?: ToolStepMetrics;
  
  // Quality
  outputQuality?: number;
  outputLength?: number;
}

export interface LLMStepMetrics {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  
  // Performance
  ttftMs: number; // Time to first token
  generationRate?: number; // tokens/sec
  
  // Quality indicators
  finishReason: string;
  retryCount: number;
  
  // Response analysis
  responseLength: number;
  estimatedQuality?: number; // 0-100, from heuristics
}

export interface ToolStepMetrics {
  toolName: string;
  args?: Record<string, unknown>;
  
  // Execution
  executionTimeMs: number;
  cacheHit: boolean;
  
  // Result
  resultType: "success" | "error" | "partial";
  resultSize?: number;
}

// ============================================================================
// Agent-level Aggregates
// ============================================================================

export interface AgentMetricsSummary {
  agentId: string;
  calculatedAt: number;
  windowHours: number;
  
  // Success metrics
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  successRate: number; // 0-1
  
  // Trend
  successRateTrend: "improving" | "declining" | "stable";
  successRateChange7d: number; // percentage points
  
  // Performance
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  
  // Efficiency
  avgTokensPerRun: number;
  avgCostPerRun: number;
  
  // Quality (if available)
  avgQualityScore?: number;
  qualityScoreTrend?: "improving" | "declining" | "stable";
  
  // Error patterns
  topErrors: Array<{
    type: string;
    count: number;
    trend: "increasing" | "decreasing" | "stable";
  }>;
  
  // Step performance
  stepPerformance: Record<string, {
    avgDurationMs: number;
    failureRate: number;
    avgQuality: number;
  }>;
}

// ============================================================================
// Quality Scoring
// ============================================================================

export interface QualityCriteria {
  name: string;
  weight: number; // 0-1, sum of all weights = 1
  evaluator: "heuristic" | "llm" | "user" | "comparison" | "custom";
  config?: Record<string, unknown>;
}

export interface QualityScoreRequest {
  runId: string;
  agentId: string;
  outputs: Record<string, string>; // step name -> output
  criteria: QualityCriteria[];
  referenceOutputs?: Record<string, string>; // For comparison scoring
}

export interface QualityScoreResult {
  runId: string;
  overallScore: number; // 0-100
  criteriaScores: Record<string, number>;
  reasoning: string;
  evaluatedAt: number;
}

// ============================================================================
// Metric Events (for real-time streaming)
// ============================================================================

export type MetricEventType =
  | "run:started"
  | "run:completed"
  | "run:failed"
  | "step:started"
  | "step:completed"
  | "step:failed"
  | "quality:scored"
  | "experiment:variant_assigned"
  | "metric:threshold_breached";

export interface MetricEvent {
  id: string;
  type: MetricEventType;
  timestamp: number;
  payload: Record<string, unknown>;
}

// ============================================================================
// Collection Configuration
// ============================================================================

export interface MetricsConfig {
  enabled: boolean;
  
  // Storage
  retentionDays: number;
  aggregationWindowHours: number;
  
  // Quality scoring
  qualityScoring: {
    enabled: boolean;
    autoScoreCompletedRuns: boolean;
    criteria: QualityCriteria[];
    llmEvaluatorModel?: string;
  };
  
  // Real-time metrics
  streamingEnabled: boolean;
  metricEventBufferSize: number;
  
  // Thresholds for alerts
  thresholds: {
    minSuccessRate: number; // 0-1, alert below this
    maxAvgDurationMs: number;
    maxCostPerRun: number;
    maxConsecutiveFailures: number;
  };
}

export const DEFAULT_METRICS_CONFIG: MetricsConfig = {
  enabled: true,
  retentionDays: 90,
  aggregationWindowHours: 24,
  qualityScoring: {
    enabled: true,
    autoScoreCompletedRuns: true,
    criteria: [
      { name: "coherence", weight: 0.3, evaluator: "heuristic" },
      { name: "completeness", weight: 0.4, evaluator: "heuristic" },
      { name: "correctness", weight: 0.3, evaluator: "heuristic" },
    ],
  },
  streamingEnabled: true,
  metricEventBufferSize: 1000,
  thresholds: {
    minSuccessRate: 0.7,
    maxAvgDurationMs: 60000,
    maxCostPerRun: 0.5,
    maxConsecutiveFailures: 3,
  },
};
