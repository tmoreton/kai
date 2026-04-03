# Kai Event-Driven Agents: Implementation Plan

## Phase 1: Event Bus Foundation (3 days)

### Day 1: Core Event Bus
**Files to create:**
- `src/agents-v2/event-bus.ts` - Pub/sub system
- `src/agents-v2/types.ts` - Shared type definitions

**Implementation:**
```typescript
// event-bus.ts - Simple, fast, in-process
export class EventBus {
  private handlers = new Map<EventType, Set<EventHandler>>();
  private wildcards: Array<{ filter: (e: AgentEvent) => boolean; handler: EventHandler }> = [];
  
  publish(event: AgentEvent): void {
    // Specific handlers
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const h of handlers) this.runHandler(h, event);
    }
    // Wildcard handlers
    for (const { filter, handler } of this.wildcards) {
      if (filter(event)) this.runHandler(handler, event);
    }
  }
  
  subscribe(filter: EventFilter, handler: EventHandler): () => void {
    // Return unsubscribe function
  }
}

// Singleton instance
export const eventBus = new EventBus();
```

**Test:** Publish/subscribe basic events, verify async handlers run in parallel.

### Day 2: File Watcher + Email Poller
**Files to create:**
- `src/agents-v2/watchers/file.ts` - fs.watch wrapper
- `src/agents-v2/watchers/email.ts` - Convert existing poller to events
- `src/agents-v2/watchers/index.ts` - Watcher registry

**Implementation:**
```typescript
// file.ts
export function watchFile(path: string): () => void {
  const watcher = fs.watch(path, () => {
    eventBus.publish({
      id: `file-${Date.now()}`,
      type: "file:changed",
      timestamp: Date.now(),
      payload: { path }
    });
  });
  return () => watcher.close();
}

// email.ts - Modify existing email-poller.ts
export function startEmailWatcher(): void {
  setInterval(async () => {
    const emails = await checkNewEmails();
    for (const email of emails) {
      eventBus.publish({ type: "email:received", payload: email });
    }
  }, 60000);
}
```

**Test:** Touch file → event emitted within 100ms.

### Day 3: Scheduler + Integration
**Files to modify:**
- `src/agents/daemon.ts` - Replace polling with event subscriptions
- `src/agents-v2/scheduler.ts` - Trigger registration system

**Implementation:**
```typescript
// scheduler.ts
interface TriggerConfig {
  type: "event" | "file" | "webhook" | "cron";
  filter?: EventFilter;
  path?: string;
  expr?: string;
}

export function registerTriggers(agentId: string, triggers: TriggerConfig[]): void {
  for (const trigger of triggers) {
    const handler = async (event: AgentEvent) => {
      await runAgent(agentId, { triggerEvent: event });
    };
    
    switch (trigger.type) {
      case "event":
        eventBus.subscribe(trigger.filter!, handler);
        break;
      case "file":
        watchFile(trigger.path!);
        eventBus.subscribe("file:changed", handler);
        break;
      case "cron":
        cron.schedule(trigger.expr!, () => {
          eventBus.publish({ type: "agent:run-requested", payload: { agentId } });
        });
        break;
    }
  }
}
```

**Integration:** In daemon startup, convert existing agents' heartbeat configs to triggers.

**Deliverable:** Agents run via events instead of 30s polling.

---

## Phase 2: Durable Execution (3 days)

### Day 4: Checkpoint System
**Files to modify:**
- `src/agents/db.ts` - Add checkpoint table
- `src/agents-v2/db.ts` - Extended DB operations

**Schema additions:**
```sql
ALTER TABLE runs ADD COLUMN current_step INTEGER DEFAULT 0;
ALTER TABLE runs ADD COLUMN context TEXT DEFAULT '{}';

CREATE TABLE checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  context TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Day 5: Durable Runner
**Files to create:**
- `src/agents-v2/runner.ts` - Checkpoint-aware workflow runner

**Implementation:**
```typescript
export async function runDurable(
  workflow: WorkflowDefinition,
  agentId: string,
  options?: { resumeFrom?: string }
): Promise<{ success: boolean; runId: string }> {
  // Load or create run
  const runId = options?.resumeFrom || createRun(agentId);
  const run = loadRun(runId);
  
  // Load context from checkpoint
  const ctx: WorkflowContext = run.context 
    ? JSON.parse(run.context) 
    : createFreshContext(agentId, runId);
  
  // Resume from last completed step
  const startStep = run.current_step || 0;
  
  try {
    for (let i = startStep; i < workflow.steps.length; i++) {
      // Save checkpoint BEFORE executing
      saveCheckpoint(runId, i, ctx);
      
      const step = workflow.steps[i];
      const result = await executeStep(step, ctx);
      
      // Update context with result
      ctx.vars[step.output_var || step.name] = result;
      
      // Update progress
      updateRunProgress(runId, i + 1, ctx);
    }
    
    completeRun(runId, "completed");
    return { success: true, runId };
    
  } catch (error) {
    // Run remains in "running" state with checkpoint
    // Can be resumed later
    throw error;
  }
}
```

### Day 6: Crash Recovery
**Files to create:**
- `src/agents-v2/recovery.ts` - Resume interrupted runs

**Implementation:**
```typescript
export async function recoverInterruptedRuns(): Promise<void> {
  const interrupted = getRuns({ 
    status: ["running", "pending"],
    startedBefore: Date.now() - 60000 // Older than 1 min
  });
  
  for (const run of interrupted) {
    console.log(`Recovering run ${run.id} from step ${run.current_step}`);
    try {
      await runDurable(loadWorkflow(run.agent_id), run.agent_id, {
        resumeFrom: run.id
      });
    } catch (err) {
      console.error(`Recovery failed for ${run.id}:`, err);
      failRun(run.id, err.message);
    }
  }
}
```

**Test:** Kill process mid-run, restart, verify resumes from exact step.

---

## Phase 3: Goal Orchestrator (4 days)

### Day 7: Goal Types + Decomposition
**Files to create:**
- `src/agents-v2/orchestrator/types.ts`
- `src/agents-v2/orchestrator/decompose.ts`

**Types:**
```typescript
interface Goal {
  id: string;
  description: string;
  priority: 1 | 2 | 3 | 4 | 5;
  status: "pending" | "decomposing" | "in_progress" | "completed" | "failed";
  parentGoalId?: string;
  subGoalIds: string[];
  result?: unknown;
}

interface SubGoal {
  id: string;
  description: string;
  agentType: string;
  config: Record<string, unknown>;
  dependencies: string[];
}
```

**Decomposition:**
```typescript
export async function decomposeGoal(goalId: string): Promise<SubGoal[]> {
  const goal = loadGoal(goalId);
  
  const subGoals = await llm({
    prompt: `Decompose into sub-goals: ${goal.description}`,
    schema: z.array(z.object({
      description: z.string(),
      agentType: z.enum(TEMPLATE_IDS),
      dependencies: z.array(z.number()).optional(),
    }))
  });
  
  return subGoals.map((sg, idx) => ({
    id: `${goalId}-sub-${idx}`,
    ...sg,
    dependencies: sg.dependencies?.map(d => `${goalId}-sub-${d}`) || [],
  }));
}
```

### Day 8: Fan-Out Pattern
**Files to create:**
- `src/agents-v2/orchestrator/fanout.ts`

**Implementation:**
```typescript
export async function spawnSubGoals(
  goalId: string, 
  subGoals: SubGoal[]
): Promise<string[]> {
  const runIds: string[] = [];
  
  for (const subGoal of subGoals) {
    // Spawn from template
    const agentId = await spawnFromTemplate(subGoal.agentType, {
      ...subGoal.config,
      goal_id: goalId,
      sub_goal_id: subGoal.id,
    });
    
    // Run immediately (dependencies checked later)
    const { runId } = await runDurable(
      loadTemplate(subGoal.agentType),
      agentId
    );
    
    runIds.push(runId);
    
    // Link goal to run
    linkGoalRun(goalId, runId, agentId, subGoal.id);
  }
  
  return runIds;
}
```

### Day 9: Fan-In + Synthesis
**Files to create:**
- `src/agents-v2/orchestrator/fanin.ts`

**Implementation:**
```typescript
export async function waitForSubGoals(
  goalId: string, 
  timeoutMs: number = 3600000
): Promise<Record<string, unknown>> {
  const startTime = Date.now();
  const results: Record<string, unknown> = {};
  const pending = new Set(loadSubGoalIds(goalId));
  
  return new Promise((resolve, reject) => {
    const unsub = eventBus.subscribe("agent:completed", (event) => {
      const { agentId, results: agentResults } = event.payload;
      const subGoalId = getSubGoalIdForAgent(goalId, agentId);
      
      if (subGoalId && pending.has(subGoalId)) {
        results[subGoalId] = agentResults;
        pending.delete(subGoalId);
        
        if (pending.size === 0) {
          unsub();
          resolve(results);
        }
      }
    });
    
    // Timeout
    setTimeout(() => {
      unsub();
      reject(new Error(`Goal ${goalId} timed out`));
    }, timeoutMs);
  });
}

export async function synthesizeResults(
  goalId: string, 
  results: Record<string, unknown>
): Promise<unknown> {
  const goal = loadGoal(goalId);
  
  return await llm({
    prompt: `Synthesize these results for goal: ${goal.description}
    
Results: ${JSON.stringify(results, null, 2)}`,
  });
}
```

### Day 10: Orchestrator Controller
**Files to create:**
- `src/agents-v2/orchestrator/index.ts`

**Implementation:**
```typescript
export async function orchestrateGoal(goalId: string): Promise<void> {
  // 1. Decompose
  updateGoalStatus(goalId, "decomposing");
  const subGoals = await decomposeGoal(goalId);
  
  // 2. Save sub-goals
  for (const sg of subGoals) {
    saveSubGoal(goalId, sg);
  }
  
  // 3. Update goal
  updateGoalStatus(goalId, "in_progress");
  updateGoalSubGoals(goalId, subGoals.map(sg => sg.id));
  
  // 4. Spawn and wait
  const runIds = await spawnSubGoals(goalId, subGoals);
  const results = await waitForSubGoals(goalId);
  
  // 5. Synthesize
  const synthesis = await synthesizeResults(goalId, results);
  
  // 6. Complete
  completeGoal(goalId, synthesis);
  
  // 7. Notify
  eventBus.publish({
    type: "goal:completed",
    payload: { goalId, result: synthesis }
  });
}
```

**Test:** Create goal → Watch it decompose → Agents run → Results synthesized.

---

## Phase 4: Template System (3 days)

### Day 11: Template Registry
**Files to create:**
- `src/agents-v2/templates/index.ts` - Registry
- `src/agents-v2/templates/types.ts`

**Implementation:**
```typescript
export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  workflow: WorkflowDefinition;
  defaultConfig: Record<string, unknown>;
  requiredEnv?: string[];
  defaultTriggers?: TriggerConfig[];
}

export const TEMPLATES: Record<string, AgentTemplate> = {};

export function registerTemplate(template: AgentTemplate): void {
  TEMPLATES[template.id] = template;
}

export function getTemplate(id: string): AgentTemplate {
  const t = TEMPLATES[id];
  if (!t) throw new Error(`Unknown template: ${id}`);
  return t;
}
```

### Day 12: Built-in Templates
**Files to create:**
- `src/agents-v2/templates/youtube-scout.ts`
- `src/agents-v2/templates/self-heal.ts`
- `src/agents-v2/templates/code-reviewer.ts`

**Example (youtube-scout):**
```typescript
import { registerTemplate } from "./index.js";

registerTemplate({
  id: "youtube-scout",
  name: "YouTube Trend Scout",
  description: "Monitors trending content in a niche",
  workflow: {
    name: "youtube-scout",
    steps: [
      {
        name: "fetch-trending",
        type: "integration",
        integration: "youtube",
        action: "search",
        params: { query: "${config.topics.join(' OR ')}" },
        output_var: "videos",
      },
      {
        name: "analyze",
        type: "llm",
        prompt: "Analyze trends in: ${vars.videos}",
        output_var: "analysis",
      },
    ],
  },
  defaultConfig: { max_results: 10, topics: [] },
  requiredEnv: ["YOUTUBE_API_KEY"],
  defaultTriggers: [{ type: "cron", expr: "0 8 * * *" }],
});
```

### Day 13: Spawner + CLI
**Files to create:**
- `src/agents-v2/spawner.ts`

**Implementation:**
```typescript
export async function spawnFromTemplate(
  templateId: string,
  config: Record<string, unknown>,
  options?: { oneTime?: boolean; parentContext?: WorkflowContext }
): Promise<string> {
  const template = getTemplate(templateId);
  
  // Check required env
  for (const env of template.requiredEnv || []) {
    if (!process.env[env]) {
      throw new Error(`Missing required env var: ${env}`);
    }
  }
  
  const agentId = `${templateId}-${Date.now()}`;
  const mergedConfig = { 
    ...template.defaultConfig, 
    ...config,
    ...(options?.parentContext && {
      parent_run_id: options.parentContext.run_id,
      inherited_vars: options.parentContext.vars,
    })
  };
  
  // Save agent
  saveAgent({
    id: agentId,
    name: `${template.name} (${new Date().toISOString()})`,
    description: template.description,
    workflow: JSON.stringify(template.workflow),
    config: JSON.stringify(mergedConfig),
    enabled: 1,
  });
  
  // Register triggers
  if (!options?.oneTime && template.defaultTriggers) {
    registerTriggers(agentId, template.defaultTriggers);
  }
  
  return agentId;
}
```

**CLI:** `kai agent spawn youtube-scout --config topics=AI,coding`

---

## Phase 5: Meta-Learning (3 days)

### Day 14: Run Analysis
**Files to create:**
- `src/agents-v2/meta/analyze.ts`

**Implementation:**
```typescript
export interface RunAnalysis {
  agentId: string;
  successRate: number;
  commonErrors: Array<{ error: string; count: number }>;
  slowSteps: Array<{ step: string; avgMs: number }>;
  suggestions: WorkflowSuggestion[];
}

export async function analyzeAgent(agentId: string, window: number = 30): Promise<RunAnalysis> {
  const runs = await getRuns({ agentId, limit: window, includeSteps: true });
  
  const completed = runs.filter(r => r.status === "completed");
  const failed = runs.filter(r => r.status === "failed");
  
  // Statistical analysis
  const errorCounts = countBy(failed, r => r.error?.split(":")[0] || "unknown");
  const stepTimes = calculateStepTimes(runs);
  
  // LLM insight
  const llmAnalysis = await llm({
    prompt: `Analyze run patterns:
Agent: ${agentId}
Success: ${completed.length}/${runs.length}
Errors: ${JSON.stringify(errorCounts)}
Step times: ${JSON.stringify(stepTimes)}

What patterns and improvements do you suggest?`,
    schema: z.object({
      qualityTrend: z.enum(["improving", "declining", "stable"]),
      rootCauses: z.array(z.string()),
      suggestions: z.array(z.object({
        type: z.enum(["prompt-improvement", "config-tuning", "add-step", "remove-step"]),
        target: z.string(),
        reason: z.string(),
        confidence: z.number(),
        proposedChange: z.any(),
      })),
    }),
  });
  
  return {
    agentId,
    successRate: completed.length / runs.length,
    commonErrors: Object.entries(errorCounts).map(([e, c]) => ({ error: e, count: c })),
    slowSteps: stepTimes,
    suggestions: llmAnalysis.suggestions,
  };
}
```

### Day 15: Improvement Application
**Files to create:**
- `src/agents-v2/meta/improve.ts`

**Implementation:**
```typescript
export async function applyImprovement(
  agentId: string, 
  suggestion: WorkflowSuggestion
): Promise<boolean> {
  // Require high confidence for auto-apply
  if (suggestion.confidence < 0.9) {
    await notifyUser({
      type: "improvement_suggested",
      title: `Improvement for ${agentId}`,
      body: `${suggestion.type}: ${suggestion.reason}`,
      data: { agentId, suggestion },
    });
    return false;
  }
  
  switch (suggestion.type) {
    case "prompt-improvement":
      await improvePrompt(agentId, suggestion.target, suggestion.proposedChange);
      break;
    case "config-tuning":
      await updateConfig(agentId, suggestion.target, suggestion.proposedChange);
      break;
    case "add-step":
      await addStep(agentId, suggestion.proposedChange);
      break;
    case "remove-step":
      await removeStep(agentId, suggestion.target);
      break;
  }
  
  await addLog(agentId, "info", `Auto-applied: ${suggestion.type}`);
  return true;
}
```

### Day 16: Daily Meta-Learner Agent
**Files to create:**
- `src/agents-v2/meta/daily.ts`
- `src/agents-v2/templates/meta-learner.ts`

**Template:**
```typescript
registerTemplate({
  id: "meta-learner",
  name: "Meta-Learning Agent",
  description: "Analyzes agent performance and suggests improvements",
  workflow: {
    steps: [
      {
        name: "list-agents",
        type: "shell",
        command: "kai agent list --json",
        output_var: "agents",
      },
      {
        name: "analyze-each",
        type: "integration",
        integration: "meta",
        action: "analyzeAll",
        params: { agents: "${vars.agents}", window: 30 },
        output_var: "analyses",
      },
      {
        name: "apply-improvements",
        type: "integration",
        integration: "meta",
        action: "applyAll",
        params: { analyses: "${vars.analyses}" },
      },
    ],
  },
  defaultTriggers: [{ type: "cron", expr: "0 2 * * *" }], // Daily at 2am
});
```

---

## Phase 6: Single Executable (2 days)

### Day 17: Build Configuration
**Files to modify:**
- `package.json` - Add build scripts
- `src/config.ts` - Handle packaged paths

**Package.json:**
```json
{
  "scripts": {
    "build:exe": "npm run build && pkg dist/index.js --targets node20-macos-arm64,node20-linux-x64,node20-win-x64 --out-path ./releases --compress GZip",
    "build:exe:mac": "npm run build && pkg dist/index.js --target node20-macos-arm64 --out-path ./releases"
  }
}
```

**Config:**
```typescript
export function ensureKaiDir(): string {
  // In packaged executable, use user's home
  if (process.pkg) {
    const kaiDir = path.join(os.homedir(), ".kai");
    fs.mkdirSync(kaiDir, { recursive: true });
    return kaiDir;
  }
  // Development: use CWD
  return path.join(process.cwd(), ".kai");
}
```

### Day 18: Testing + Release
**Tasks:**
- Build for all platforms
- Test on clean VM (no Node.js installed)
- Verify: SQLite creates DB, agents run, file watching works
- Create GitHub release workflow

**Verification checklist:**
- [ ] Binary starts without Node.js
- [ ] First run creates `~/.kai/` directory
- [ ] Can spawn agent from template
- [ ] File change triggers agent in <100ms
- [ ] Process kill + restart resumes from checkpoint
- [ ] Goal orchestration works end-to-end

---

## Summary

| Phase | Days | Key Deliverable |
|-------|------|-----------------|
| 1 | 3 | Event-driven triggers (no polling) |
| 2 | 3 | Durable execution (crash recovery) |
| 3 | 4 | Goal orchestration (fan-out/fan-in) |
| 4 | 3 | Template system (dynamic spawning) |
| 5 | 3 | Meta-learning (self-improvement) |
| 6 | 2 | Single executable |
| **Total** | **18 days** | Fully autonomous agent system |

**Dependencies:** Only SQLite (bundled) and existing Kai infrastructure.

**Risk mitigation:** Each phase is independently useful. Can stop at any point.

Ready to start Phase 1?
