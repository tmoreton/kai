# Phase 3: Self-Improvement System Integration Design

## Overview

This document defines how the self-improvement system integrates with existing Kai components. The design prioritizes:

1. **Minimal invasiveness** - Don't break existing functionality
2. **Event-driven** - Use EventBus for loose coupling
3. **Checkpoint-resilient** - All state survives crashes
4. **Backward compatible** - Existing workflows work unchanged

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Self-Improvement Integration Layer              │
└─────────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Workflow   │    │  Durable Runner │    │   Meta-Learner │
│   Engine     │◄──►│  (runner-       │◄──►│   (meta-        │
│(workflow.ts) │    │   durable.ts)   │    │   learner.ts)   │
└──────────────┘    └─────────────────┘    └─────────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │    Event Bus    │
                    │  (event-bus.ts) │
                    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   Checkpoints   │
                    │ (checkpoint.ts) │
                    └─────────────────┘
```

## 1. Integration with Workflow Engine

### 1.1 Current State
The workflow engine (`src/agents/workflow.ts`) already has a self-improvement review loop (lines 417-476):

```typescript
// --- Self-improvement review loop ---
if (workflow.review?.enabled) {
  const maxIter = workflow.review.max_iterations || 3;
  const improveSteps = workflow.review.improve_steps
    || workflow.steps.filter((s) => s.type === "llm").map((s) => s.name);

  for (let iter = 0; iter < maxIter; iter++) {
    const reviewResult = await runReviewStep(workflow, ctx, iter);
    // ... re-run improveSteps with feedback
  }
}
```

### 1.2 Integration Points

#### A. New Event Types
Add to `src/agents-v2/types.ts`:

```typescript
export type EventType = 
  | "file:changed" 
  | "email:received" 
  | "webhook:called"
  | "agent:run-requested"
  | "agent:completed"
  | "agent:failed"
  | "error:detected"
  // New Phase 3 events:
  | "agent:review-started"
  | "agent:review-completed"
  | "agent:improvement-applied"
  | "agent:iteration-complete"
  | "agent:learning-available";

export interface ReviewPayload {
  agentId: string;
  runId: string;
  iteration: number;
  maxIterations: number;
  verdict: "PASS" | "NEEDS_IMPROVEMENT" | "FAIL";
  feedback?: string;
  improvedSteps: string[];
  qualityScore?: number; // 0-100, optional
}
```

#### B. Workflow Engine Modification
Modify `executeWorkflow` to emit events during the review loop:

```typescript
// --- Self-improvement review loop ---
if (workflow.review?.enabled) {
  const maxIter = workflow.review.max_iterations || 3;
  const improveSteps = workflow.review.improve_steps
    || workflow.steps.filter((s) => s.type === "llm").map((s) => s.name);

  for (let iter = 0; iter < maxIter; iter++) {
    onProgress?.("review", `Reviewing output (iteration ${iter + 1}/${maxIter})`);
    addLog(agentId, "info", `Review iteration ${iter + 1}/${maxIter}`, runId);

    // NEW: Emit review started event
    eventBus?.publish({
      id: `review-start-${runId}-${iter}`,
      type: "agent:review-started",
      timestamp: Date.now(),
      payload: {
        agentId,
        runId,
        iteration: iter,
        maxIterations: maxIter,
        improvedSteps: improveSteps,
      },
      source: "workflow-engine",
    });

    const reviewResult = await runReviewStep(workflow, ctx, iter);

    // NEW: Emit review completed event
    eventBus?.publish({
      id: `review-complete-${runId}-${iter}`,
      type: "agent:review-completed",
      timestamp: Date.now(),
      payload: {
        agentId,
        runId,
        iteration: iter,
        maxIterations: maxIter,
        verdict: reviewResult.verdict,
        feedback: reviewResult.feedback,
        improvedSteps: improveSteps,
        qualityScore: reviewResult.qualityScore, // optional
      } as ReviewPayload,
      source: "workflow-engine",
    });

    if (reviewResult.verdict === "PASS") {
      addLog(agentId, "info", `Review PASSED: ${reviewResult.summary}`, runId);
      ctx.vars.__review = reviewResult;
      break;
    }

    if (reviewResult.verdict === "FAIL") {
      addLog(agentId, "warn", `Review FAILED: ${reviewResult.summary}`, runId);
      break;
    }

    // NEEDS_IMPROVEMENT — re-run specified LLM steps with feedback
    addLog(agentId, "info", `Review: needs improvement — ${reviewResult.feedback}`, runId);

    for (const stepName of improveSteps) {
      // ... improvement logic
      
      // NEW: Emit improvement applied event
      eventBus?.publish({
        id: `improve-${runId}-${iter}-${stepName}`,
        type: "agent:improvement-applied",
        timestamp: Date.now(),
        payload: {
          agentId,
          runId,
          iteration: iter,
          stepName,
          feedback: reviewResult.feedback,
        },
        source: "workflow-engine",
      });
    }
  }

  // NEW: Emit iteration complete event
  eventBus?.publish({
    id: `iter-complete-${runId}`,
    type: "agent:iteration-complete",
    timestamp: Date.now(),
    payload: {
      agentId,
      runId,
      totalIterations: iter + 1,
      finalVerdict: reviewResult?.verdict || "PASS",
    },
    source: "workflow-engine",
  });
}
```

#### C. Optional EventBus Parameter
Add optional `eventBus` parameter to `executeWorkflow`:

```typescript
export async function executeWorkflow(
  workflow: WorkflowDefinition,
  agentId: string,
  configOverrides?: Record<string, any>,
  onProgress?: (step: string, status: string) => void,
  options?: { 
    resumeFrom?: string;
    eventBus?: EventBus; // NEW: Optional for event emission
  }
): Promise<{ success: boolean; results: Record<string, any>; error?: string; runId?: string }>
```

## 2. Integration with Durable Runner

### 2.1 Current State
The durable runner (`src/agents-v2/runner-durable.ts`) wraps the workflow engine and provides checkpoint/resume.

### 2.2 Integration Points

#### A. Pass EventBus to Workflow
Modify `runDurable` to pass the event bus:

```typescript
import { eventBus } from "./event-bus.js";

export async function runDurable(
  agentId: string,
  options?: RunOptions
): Promise<DurableRun> {
  // ... setup code ...

  try {
    const result = await executeWorkflow(
      workflow,
      agentId,
      { ...context, __run_id: runId },
      (step, status) => {
        // ... progress tracking ...
      },
      { eventBus } // NEW: Pass event bus for review events
    );

    // Publish completion event with review data
    if (result.success) {
      const reviewData = result.results.__review;
      
      eventBus.publish({
        id: `complete-${runId}`,
        type: "agent:completed",
        timestamp: Date.now(),
        payload: { 
          agentId, 
          runId, 
          results: result.results,
          hadReview: !!reviewData,
          reviewVerdict: reviewData?.verdict,
          iterations: reviewData?.iterations || 1,
        },
        source: "durable-runner",
      });
    }

    // ... rest of logic ...
  }
}
```

#### B. Store Review State in Checkpoints
Ensure review iteration state survives crashes:

```typescript
// In runDurable, save checkpoint with review state
function createContext(
  agent: AgentRecord,
  options?: RunOptions
): Record<string, unknown> {
  return {
    ...JSON.parse(agent.config || "{}"),
    trigger_event: options?.triggerEvent,
    parent_run_id: options?.parentRunId,
    goal_id: options?.goalId,
    // NEW: Track review state for resume
    __review_state: {
      iteration: 0,
      lastVerdict: null,
      improvedSteps: [],
    },
  };
}
```

#### C. Resume with Review State
When resuming, restore review state:

```typescript
if (options?.resumeFrom) {
  const checkpoint = getLatestCheckpoint(runId);
  if (checkpoint) {
    context = JSON.parse(checkpoint.context);
    // Restore review state if present
    if (context.__review_state) {
      console.log(`[Durable] Restoring review state: iteration ${context.__review_state.iteration}`);
    }
  }
}
```

## 3. Integration with Event Bus

### 3.1 Current State
Simple, fast in-process event bus (`src/agents-v2/event-bus.ts`) with <1ms latency.

### 3.2 Integration Points

#### A. Event Types (already defined in section 1.2A)

#### B. Wildcard Subscriptions for Patterns
Enable pattern-based subscriptions for learning:

```typescript
// In meta-learner or integration layer
import { eventBus } from "./event-bus.js";

// Subscribe to all review events
const unsubscribe = eventBus.subscribe(
  (event) => event.type.startsWith("agent:review"),
  async (event) => {
    // Store for pattern analysis
    await storeReviewEvent(event);
  }
);

// Subscribe to completed runs with reviews
eventBus.subscribe(
  (event) => event.type === "agent:completed" && event.payload.hadReview,
  async (event) => {
    // Trigger real-time learning
    await analyzeReviewPatterns(event.payload.agentId);
  }
);
```

#### C. Event Persistence (Optional)
For long-term pattern learning, persist events:

```typescript
// Add to event-bus.ts (optional enhancement)
export class EventBus {
  private persistence?: EventPersistence;
  
  enablePersistence(persistence: EventPersistence) {
    this.persistence = persistence;
  }
  
  publish(event: AgentEvent): void {
    // Persist if enabled
    this.persistence?.store(event);
    
    // ... existing publish logic ...
  }
}
```

## 4. Integration with Meta-Learner

### 4.1 Current State
Batch/daily analysis (`src/agents-v2/meta-learner.ts`) with auto-apply for high-confidence suggestions.

### 4.2 Integration Points

#### A. Real-Time Pattern Detection
Subscribe to review events for immediate analysis:

```typescript
// In meta-learner.ts or new self-improvement-integration.ts

export function enableRealTimeLearning(): () => void {
  // Track review patterns as they happen
  const unsubReview = eventBus.subscribe(
    "agent:review-completed",
    async (event) => {
      const { agentId, verdict, qualityScore, iteration } = event.payload;
      
      // Store for trend analysis
      await storeReviewMetrics(agentId, {
        timestamp: event.timestamp,
        verdict,
        qualityScore,
        iteration,
      });
      
      // Alert on concerning patterns
      if (verdict === "FAIL" && iteration > 2) {
        await flagForAttention(agentId, "repeated_review_failures");
      }
    }
  );

  // Analyze successful improvements
  const unsubImprove = eventBus.subscribe(
    "agent:improvement-applied",
    async (event) => {
      const { agentId, stepName, feedback } = event.payload;
      
      // Correlate with final outcome
      await trackImprovementEffectiveness(agentId, stepName, feedback);
    }
  );

  // Return cleanup function
  return () => {
    unsubReview();
    unsubImprove();
  };
}
```

#### B. Trigger Learning on Significant Events

```typescript
// Trigger immediate analysis on repeated failures
eventBus.subscribe(
  "agent:failed",
  async (event) => {
    const { agentId } = event.payload;
    
    // Check recent failure rate
    const recentFailures = await getRecentFailureCount(agentId, 24);
    
    if (recentFailures >= 3) {
      // Trigger immediate analysis
      console.log(`[Meta-Learner] High failure rate for ${agentId}, analyzing...`);
      
      const analysis = await analyzeAgent(agentId, 10);
      
      if (analysis.suggestions.length > 0) {
        await applyImprovements(agentId, analysis.suggestions);
        
        // Notify that learning was triggered
        eventBus.publish({
          id: `learning-${Date.now()}`,
          type: "agent:learning-available",
          timestamp: Date.now(),
          payload: {
            agentId,
            trigger: "high_failure_rate",
            suggestionsCount: analysis.suggestions.length,
            autoApplied: analysis.suggestions.filter(s => s.confidence >= 0.9).length,
          },
          source: "meta-learner",
        });
      }
    }
  }
);
```

#### C. Workflow Integration Layer
Create a new file `src/agents-v2/self-improvement-integration.ts`:

```typescript
/**
 * Self-Improvement Integration Layer
 * 
 * Orchestrates feedback between workflow review, durable execution,
 * and meta-learning systems.
 */

import { eventBus } from "./event-bus.js";
import { analyzeAgent, applyImprovements } from "./meta-learner.js";
import type { AgentEvent, ReviewPayload } from "./types.js";

interface IntegrationConfig {
  // Trigger analysis after N reviews
  analysisThreshold: number;
  // Minimum quality score to consider "good"
  qualityThreshold: number;
  // Enable real-time pattern detection
  realTimeLearning: boolean;
}

const defaultConfig: IntegrationConfig = {
  analysisThreshold: 5,
  qualityThreshold: 70,
  realTimeLearning: true,
};

let config: IntegrationConfig = { ...defaultConfig };
const reviewHistory = new Map<string, ReviewPayload[]>();
let cleanupFns: Array<() => void> = [];

/**
 * Initialize the self-improvement integration.
 * Call this once at system startup.
 */
export function initializeSelfImprovement(
  userConfig?: Partial<IntegrationConfig>
): void {
  config = { ...defaultConfig, ...userConfig };
  
  if (config.realTimeLearning) {
    cleanupFns.push(subscribeToReviewEvents());
    cleanupFns.push(subscribeToFailureEvents());
    cleanupFns.push(subscribeToLearningOpportunities());
  }
  
  console.log("[Self-Improvement] Integration initialized");
}

/**
 * Shutdown and cleanup.
 */
export function shutdownSelfImprovement(): void {
  for (const cleanup of cleanupFns) {
    cleanup();
  }
  cleanupFns = [];
  reviewHistory.clear();
}

function subscribeToReviewEvents(): () => void {
  return eventBus.subscribe(
    "agent:review-completed",
    async (event) => {
      const payload = event.payload as ReviewPayload;
      const { agentId } = payload;
      
      // Store review in history
      const history = reviewHistory.get(agentId) || [];
      history.push(payload);
      reviewHistory.set(agentId, history);
      
      // Check if we should trigger analysis
      if (history.length >= config.analysisThreshold) {
        await triggerIncrementalAnalysis(agentId, history);
        // Clear history after analysis
        reviewHistory.set(agentId, []);
      }
      
      // Track quality trends
      if (payload.qualityScore !== undefined) {
        await trackQualityTrend(agentId, payload.qualityScore);
      }
    }
  );
}

function subscribeToFailureEvents(): () => void {
  return eventBus.subscribe(
    "agent:failed",
    async (event) => {
      const { agentId, runId, error } = event.payload;
      
      // Don't trigger on transient errors
      if (isTransientError(error)) return;
      
      // Incremental analysis on failure
      const analysis = await analyzeAgent(agentId, 10);
      
      if (analysis.suggestions.some(s => s.confidence >= 0.8)) {
        console.log(`[Self-Improvement] High-confidence suggestions for ${agentId}`);
        
        // Publish learning available event
        eventBus.publish({
          id: `learning-${Date.now()}`,
          type: "agent:learning-available",
          timestamp: Date.now(),
          payload: {
            agentId,
            runId,
            trigger: "failure_post_mortem",
            analysis,
          },
          source: "self-improvement-integration",
        });
      }
    }
  );
}

function subscribeToLearningOpportunities(): () => void {
  return eventBus.subscribe(
    "agent:learning-available",
    async (event) => {
      const { agentId, analysis, trigger } = event.payload;
      
      // Auto-apply high-confidence suggestions
      if (analysis?.suggestions) {
        const result = await applyImprovements(agentId, analysis.suggestions);
        
        console.log(
          `[Self-Improvement] ${agentId}: ${result.applied} applied, ` +
          `${result.notified} notified, ${result.logged} logged ` +
          `(trigger: ${trigger})`
        );
      }
    }
  );
}

async function triggerIncrementalAnalysis(
  agentId: string,
  reviews: ReviewPayload[]
): Promise<void> {
  // Quick analysis of recent reviews
  const passRate = reviews.filter(r => r.verdict === "PASS").length / reviews.length;
  const avgQuality = reviews.reduce((sum, r) => sum + (r.qualityScore || 0), 0) / reviews.length;
  
  console.log(
    `[Self-Improvement] ${agentId} review stats: ` +
    `${(passRate * 100).toFixed(0)}% pass rate, ` +
    `avg quality ${avgQuality.toFixed(0)}`
  );
  
  // Trigger full analysis if quality is declining
  if (avgQuality < config.qualityThreshold) {
    const analysis = await analyzeAgent(agentId, 30);
    
    eventBus.publish({
      id: `declining-${Date.now()}`,
      type: "agent:learning-available",
      timestamp: Date.now(),
      payload: {
        agentId,
        trigger: "declining_quality",
        analysis,
        metrics: { passRate, avgQuality },
      },
      source: "self-improvement-integration",
    });
  }
}

async function trackQualityTrend(agentId: string, qualityScore: number): Promise<void> {
  // Store in DB for long-term trend analysis
  const { getDb } = await import("../agents/db.js");
  const db = getDb();
  
  db.prepare(`
    INSERT INTO quality_metrics (agent_id, score, recorded_at)
    VALUES (?, ?, datetime('now'))
  `).run(agentId, qualityScore);
}

function isTransientError(error: string): boolean {
  const transientPatterns = [
    "timeout",
    "rate limit",
    "temporary",
    "ECONNRESET",
    "ETIMEDOUT",
  ];
  
  return transientPatterns.some(p => error.toLowerCase().includes(p));
}

/**
 * Get review statistics for an agent.
 */
export function getReviewStats(agentId: string): {
  total: number;
  passRate: number;
  avgQuality: number;
} {
  const history = reviewHistory.get(agentId) || [];
  
  if (history.length === 0) {
    return { total: 0, passRate: 0, avgQuality: 0 };
  }
  
  const passed = history.filter(r => r.verdict === "PASS").length;
  const totalQuality = history.reduce((sum, r) => sum + (r.qualityScore || 0), 0);
  
  return {
    total: history.length,
    passRate: passed / history.length,
    avgQuality: totalQuality / history.length,
  };
}
```

## 5. Checkpoint Integration

### 5.1 Review State Persistence

The checkpoint system (`src/agents-v2/checkpoint.ts`) already handles workflow state. We extend it to include review state:

```typescript
// In workflow.ts, when saving checkpoint during review
interface ReviewCheckpointState {
  iteration: number;
  lastVerdict: "PASS" | "NEEDS_IMPROVEMENT" | "FAIL" | null;
  improvedSteps: string[];
  accumulatedFeedback: string[];
  originalOutputs: Record<string, string>; // Store pre-improvement outputs
}

// When checkpointing during review loop
const checkpointContext = {
  config: ctx.config,
  vars: ctx.vars,
  env: ctx.env,
  agent_id: ctx.agent_id,
  run_id: ctx.run_id,
  trigger_reason: ctx.trigger_reason,
  // NEW: Review state
  __review_state: {
    iteration: iter,
    lastVerdict: reviewResult.verdict,
    improvedSteps: improveSteps,
    accumulatedFeedback: [...(ctx.vars.__accumulated_feedback || []), reviewResult.feedback],
    originalOutputs: ctx.vars.__original_outputs || {},
  },
};

saveCheckpoint(runId, i, checkpointContext);
```

### 5.2 Resume Logic

When resuming, restore review state and continue from the right iteration:

```typescript
// In workflow.ts executeWorkflow
if (isResuming && checkpoint) {
  const savedCtx = JSON.parse(checkpoint.context);
  
  // Restore review state
  if (savedCtx.__review_state) {
    const reviewState = savedCtx.__review_state;
    
    // If we were mid-review, continue from the next iteration
    if (workflow.review?.enabled && reviewState.lastVerdict === "NEEDS_IMPROVEMENT") {
      console.log(`[Workflow] Resuming review from iteration ${reviewState.iteration + 1}`);
      
      // Inject accumulated feedback into context
      ctx.vars.__accumulated_feedback = reviewState.accumulatedFeedback;
      ctx.vars.__original_outputs = reviewState.originalOutputs;
      
      // Adjust loop to start from saved iteration
      startIteration = reviewState.iteration + 1;
    }
  }
}
```

## 6. Database Schema Extensions

### 6.1 New Tables

```sql
-- Quality metrics for trend analysis
CREATE TABLE quality_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  score INTEGER, -- 0-100
  recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Review events for pattern analysis
CREATE TABLE review_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  iteration INTEGER,
  verdict TEXT, -- PASS, NEEDS_IMPROVEMENT, FAIL
  feedback TEXT,
  quality_score INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES runs(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Applied improvements audit log
CREATE TABLE applied_improvements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  suggestion_type TEXT,
  target TEXT,
  reason TEXT,
  confidence REAL,
  applied_at TEXT DEFAULT CURRENT_TIMESTAMP,
  success BOOLEAN,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);
```

### 6.2 Migration

```typescript
// In agents/db.ts, add to setupDatabase()
export function setupDatabase() {
  // ... existing tables ...
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS quality_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      score INTEGER,
      recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_quality_agent ON quality_metrics(agent_id, recorded_at);
    
    CREATE TABLE IF NOT EXISTS review_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      iteration INTEGER,
      verdict TEXT,
      feedback TEXT,
      quality_score INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (run_id) REFERENCES runs(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_review_run ON review_events(run_id);
    CREATE INDEX IF NOT EXISTS idx_review_agent ON review_events(agent_id, created_at);
    
    CREATE TABLE IF NOT EXISTS applied_improvements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      suggestion_type TEXT,
      target TEXT,
      reason TEXT,
      confidence REAL,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP,
      success BOOLEAN,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_improvements_agent ON applied_improvements(agent_id, applied_at);
  `);
}
```

## 7. Usage Examples

### 7.1 Basic Setup

```typescript
// At application startup
import { initializeSelfImprovement } from "./agents-v2/self-improvement-integration.js";

initializeSelfImprovement({
  analysisThreshold: 5,
  qualityThreshold: 70,
  realTimeLearning: true,
});
```

### 7.2 Workflow with Review

```yaml
# my-agent.yaml
name: content-generator
description: Generates blog posts with self-review

review:
  enabled: true
  max_iterations: 3
  improve_steps: ["generate_draft", "refine_content"]

steps:
  - name: generate_draft
    type: llm
    prompt: "Write a draft blog post about ${config.topic}"
    output_var: draft
    
  - name: refine_content
    type: llm
    prompt: "Refine this draft: ${vars.draft}"
    output_var: refined
    
  - name: review
    type: llm
    prompt: "Review this content for quality and accuracy: ${vars.refined}"
    output_var: review_result
```

### 7.3 Event Subscription

```typescript
// Subscribe to learning events
import { eventBus } from "./agents-v2/event-bus.js";

eventBus.subscribe("agent:learning-available", async (event) => {
  const { agentId, trigger, analysis } = event.payload;
  
  console.log(`Learning available for ${agentId} (trigger: ${trigger})`);
  console.log(`Suggestions: ${analysis.suggestions.length}`);
  
  // Custom handling - e.g., notify Slack, update dashboard
  await notifyTeam(agentId, analysis);
});
```

### 7.4 Monitoring Review Stats

```typescript
import { getReviewStats } from "./agents-v2/self-improvement-integration.js";

// Get real-time stats
const stats = getReviewStats("my-agent");
console.log(`Pass rate: ${(stats.passRate * 100).toFixed(1)}%`);
console.log(`Average quality: ${stats.avgQuality.toFixed(0)}/100`);
```

## 8. Testing Strategy

### 8.1 Unit Tests

```typescript
// self-improvement-integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { 
  initializeSelfImprovement, 
  shutdownSelfImprovement,
  getReviewStats 
} from "./self-improvement-integration.js";
import { eventBus } from "./event-bus.js";

describe("Self-Improvement Integration", () => {
  beforeEach(() => {
    initializeSelfImprovement({ realTimeLearning: true });
  });
  
  afterEach(() => {
    shutdownSelfImprovement();
  });
  
  it("should track review events", () => {
    eventBus.publish({
      id: "test-1",
      type: "agent:review-completed",
      timestamp: Date.now(),
      payload: {
        agentId: "test-agent",
        runId: "run-1",
        iteration: 0,
        verdict: "PASS",
        qualityScore: 85,
      },
      source: "test",
    });
    
    const stats = getReviewStats("test-agent");
    expect(stats.total).toBe(1);
    expect(stats.passRate).toBe(1);
    expect(stats.avgQuality).toBe(85);
  });
});
```

### 8.2 Integration Tests

```typescript
// Test full flow: workflow → events → learning
import { executeWorkflow } from "../agents/workflow.js";
import { eventBus } from "./event-bus.js";

it("should emit review events during workflow", async () => {
  const events: any[] = [];
  
  eventBus.subscribe("agent:review-completed", (e) => events.push(e));
  
  const workflow = {
    name: "test",
    review: { enabled: true, max_iterations: 2 },
    steps: [
      { name: "step1", type: "llm", prompt: "test" },
    ],
  };
  
  await executeWorkflow(workflow, "test-agent", {}, undefined, { eventBus });
  
  expect(events.length).toBeGreaterThan(0);
  expect(events[0].payload.verdict).toBeDefined();
});
```

## 9. Rollout Plan

### Phase 1: Event Infrastructure
1. Add new event types to `types.ts`
2. Add optional `eventBus` parameter to `executeWorkflow`
3. Emit basic review events (no persistence)

### Phase 2: Integration Layer
1. Create `self-improvement-integration.ts`
2. Implement real-time pattern detection
3. Wire up meta-learner triggers

### Phase 3: Checkpoint Resilience
1. Extend checkpoint with review state
2. Test resume mid-review
3. Add database migrations

### Phase 4: Optimization
1. Performance tuning
2. Dashboard/monitoring
3. Advanced pattern detection

## 10. Backward Compatibility

All changes are backward compatible:

- `eventBus` parameter is optional - existing code works unchanged
- Review loop behavior unchanged if no event bus provided
- Database migrations are additive only
- Meta-learner batch process continues to work independently

## Summary

This integration design enables:

1. **Observable workflows** - Review events can be monitored and logged
2. **Real-time learning** - Pattern detection happens during execution
3. **Crash resilience** - Review state survives restarts
4. **Loose coupling** - Components communicate via events
5. **Incremental adoption** - Can be enabled per-agent or globally
