# Kai Agent System: Deep Audit & Autonomy Roadmap

## Executive Summary

**Current State**: Kai has a functional but basic agent system that works for scheduled tasks. It has cron-based scheduling, YAML workflows, SQLite persistence, and basic self-healing. It "kind of works" but has fundamental limitations preventing true autonomy.

**Target State**: A self-improving, event-driven agent system that can:
1. React to events in real-time (not poll every 30s)
2. Coordinate multiple agents toward shared goals
3. Spawn new agents dynamically based on needs
4. Learn from past runs and improve workflows
5. Run as a single distributable executable

---

## Current Architecture Audit

### What Works Well

| Component | Status | Notes |
|-----------|--------|-------|
| **Workflow Engine** | Functional | YAML-defined steps with checkpointing after each step |
| **Self-Improvement Loop** | Basic | Review → feedback → re-run LLM steps (max 3 iterations) |
| **Heartbeat Conditions** | Functional | File change, webhook, memory, threshold, trend triggers |
| **Self-Healing** | Partial | Auto-retry failed runs (3 attempts), auto-fix common errors |
| **Tool Integration** | Good | Skills system, MCP bridge, bash, file ops |
| **Persona System** | Functional | Persistent agents with goals, scratchpad, memory tools |
| **Daemon Resilience** | Good | Auto-restart on crash (5x in 10 min window) |

### Critical Gaps

#### 1. **Polling-Based Triggers (Not Event-Driven)**
```typescript
// Current: Every 30 seconds, check all conditions
heartbeatInterval = setInterval(async () => {
  for (const agent of agents) {
    const results = await evaluateConditions(heartbeat.conditions);
    if (anyMet) await runAgent(agent.id);
  }
}, 30000);
```
- **Problem**: Inefficient, slow reaction time, waste of CPU/battery
- **Impact**: Can't react to events in real-time (e.g., "new email arrives")

#### 2. **No Cross-Agent Communication**
- Agents are isolated silos
- No shared memory or message bus
- Swarms run in parallel but don't coordinate
- Can't have "orchestrator → sub-agents → synthesize" patterns

#### 3. **SQLite = Single-Node Only**
- WAL mode helps with concurrency but not distribution
- No resumable execution if process dies mid-step
- Can't scale horizontally if needed

#### 4. **Limited Dynamic Agent Creation**
- Can create agents via `agent_create` or CLI
- But no template-based spawning with auto-configuration
- New agents don't inherit context from spawning agent

#### 5. **Self-Improvement Is Workflow-Scoped**
- Each workflow can review its own output
- But no system-level learning (e.g., "past 10 runs show this prompt doesn't work")
- No automatic workflow evolution

#### 6. **Single Executable Gap**
- Currently requires Node.js runtime + npm install
- Desktop app (Tauri) bundles Node but still has external files (SQLite, workflows)
- No true single-binary deployment

---

## Recommended Architecture: "Kai Agents V2"

### Core Philosophy

**Keep it simple, make it autonomous.**

Don't over-engineer with distributed systems. Instead:
1. Single-process, SQLite-backed (for now)
2. Event-driven architecture (no polling)
3. Durable execution with step-level checkpointing
4. Goal-based orchestration layer
5. Compile to single executable via `pkg` or similar

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     KAI AGENT SYSTEM                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Event Bus   │  │  Scheduler   │  │   State      │     │
│  │  (pub/sub)   │  │  (cron+evt)  │  │   (SQLite)   │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         └─────────────────┴─────────────────┘             │
│                            │                              │
│                     ┌──────┴──────┐                       │
│                     ▼             ▼                       │
│         ┌─────────────────┐ ┌─────────────────┐            │
│         │ Goal            │ │ Agent           │            │
│         │ Orchestrator    │ │ Runners         │            │
│         │                 │ │                 │            │
│         └────────┬────────┘ └─────────────────┘            │
│                  │                                        │
│         ┌────────┴────────┐                                │
│         ▼                 ▼                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ LLM Router   │  │ Tool Exec    │  │ Memory       │   │
│  │              │  │              │  │ (archival,   │   │
│  │              │  │              │  │  recall,     │   │
│  │              │  │              │  │  swarm pad)   │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Component Details

#### 1. Event Bus (In-Process)
```typescript
// src/agents-v2/event-bus.ts
interface EventBus {
  publish(event: AgentEvent): void;
  subscribe(filter: EventFilter, handler: EventHandler): Unsubscribe;
}

type AgentEvent =
  | { type: "file:changed"; path: string; mtime: number }
  | { type: "email:received"; messageId: string; subject: string }
  | { type: "webhook:called"; endpoint: string; payload: unknown }
  | { type: "memory:matched"; query: string; results: ArchivalEntry[] }
  | { type: "agent:completed"; agentId: string; runId: string; results: unknown }
  | { type: "goal:assigned"; goalId: string; description: string; priority: number }
  | { type: "error:detected"; fingerprint: string; source: string; error: Error };
```

- **File watcher**: Native Node.js `fs.watch()` → events
- **Email poller**: Already exists, convert to events
- **Webhook server**: HTTP endpoint → events
- **Memory listener**: Subscribe to archival inserts

#### 2. Scheduler (Event + Cron)
```typescript
// src/agents-v2/scheduler.ts
interface ScheduledAgent {
  id: string;
  trigger: { type: "cron"; expr: string }
           | { type: "event"; filter: EventFilter }
           | { type: "condition"; check: () => boolean };
  workflow: string | WorkflowFunction;
  config: Record<string, unknown>;
}
```

- Cron jobs register event emitters at schedule times
- Event-driven agents subscribe to event bus
- Both result in `agent:run-requested` event

#### 3. Durable Execution
```typescript
// src/agents-v2/runner.ts
interface DurableRun {
  runId: string;
  agentId: string;
  workflow: WorkflowDefinition;
  context: WorkflowContext;
  currentStepIndex: number;
  status: "pending" | "running" | "paused" | "completed" | "failed";
}

async function resumeRun(runId: string): Promise<void> {
  const run = loadRun(runId);
  for (let i = run.currentStepIndex; i < run.workflow.steps.length; i++) {
    await executeStepWithCheckpoint(run, i);
  }
}
```

- Before each step: save state to SQLite
- On crash: resume from last completed step
- No lost work, idempotent re-runs

#### 4. Goal Orchestrator
```typescript
// src/agents-v2/orchestrator.ts
interface Goal {
  id: string;
  description: string;
  priority: number;
  parentGoalId?: string;
  subGoals: string[];
  status: "pending" | "decomposed" | "in_progress" | "completed" | "failed";
}

async function orchestrateGoal(goal: Goal): Promise<void> {
  // Step 1: Decompose into sub-goals
  const subGoals = await llm.decompose(goal.description);
  
  // Step 2: Spawn agents for each sub-goal
  const childRunIds = await Promise.all(
    subGoals.map(sg => spawnAgentForGoal(sg, goal.id))
  );
  
  // Step 3: Wait for all children (event-driven)
  const results = await waitForChildCompletions(goal.id, childRunIds);
  
  // Step 4: Synthesize
  const synthesis = await llm.synthesize(results);
  
  // Step 5: Complete or escalate
  await completeGoal(goal.id, synthesis);
}
```

- Fan-out: Spawn N agents in parallel
- Fan-in: Wait for all "child:completed" events
- Recursive: Sub-goals can spawn their own sub-goals

#### 5. Template-Based Agent Spawning
```typescript
// src/agents-v2/templates.ts
const AGENT_TEMPLATES = {
  "youtube-scout": {
    name: "YouTube Trend Scout",
    workflow: loadWorkflow("youtube-scout"),
    defaultConfig: { max_results: 10 },
    requiredEnv: ["YOUTUBE_API_KEY"],
  },
  "code-reviewer": {
    name: "Code Review Agent", 
    workflow: loadWorkflow("code-review"),
    triggers: [{ type: "event", filter: { type: "git:pr:opened" } }],
  },
  // ... more templates
};

export async function spawnFromTemplate(
  templateId: string,
  overrides: Partial<AgentConfig>,
  parentContext?: WorkflowContext
): Promise<string> {
  const template = AGENT_TEMPLATES[templateId];
  const agentId = `${templateId}-${Date.now()}`;
  
  // Inherit parent context if provided
  const config = { ...template.defaultConfig, ...overrides };
  if (parentContext) {
    config.inherited = {
      parentAgentId: parentContext.agent_id,
      parentRunId: parentContext.run_id,
      parentGoalId: parentContext.config.goal_id,
    };
  }
  
  // Register agent
  await saveAgent(agentId, {
    ...template,
    config,
    status: "active",
  });
  
  // Register triggers
  for (const trigger of template.triggers || []) {
    await registerTrigger(agentId, trigger);
  }
  
  return agentId;
}
```

#### 6. System-Level Self-Improvement
```typescript
// src/agents-v2/meta-learner.ts
async function analyzeRunHistory(agentId: string, window: number = 30): Promise<void> {
  const runs = await getRuns(agentId, { limit: window, completed: true });
  
  // Analyze patterns
  const analysis = await llm.analyze({
    prompt: `Analyze these ${runs.length} runs for patterns:
    - Which steps often fail?
    - Which prompts produce low-quality output?
    - What config values work best?
    
    ${JSON.stringify(runs)}`,
  });
  
  // Suggest workflow improvements
  if (analysis.suggestedChanges.length > 0) {
    await createNotification({
      type: "workflow_improvement_suggested",
      title: `Improvements suggested for ${agentId}`,
      body: analysis.summary,
      data: { suggestions: analysis.suggestedChanges },
    });
    
    // Auto-apply if confidence > 0.9 and no destructive changes
    if (analysis.confidence > 0.9 && !analysis.hasDestructiveChanges) {
      await applyWorkflowChanges(agentId, analysis.suggestedChanges);
    }
  }
}

// Run this daily via cron agent
```

---

## Migration Plan

### Phase 1: Event Bus Foundation (Week 1)

**Tasks:**
1. Create `src/agents-v2/event-bus.ts` with pub/sub
2. Add file watcher → events
3. Convert email poller → events
4. Add webhook receiver → events
5. Convert heartbeat conditions → event subscriptions

**Result:** No more 30s polling. Immediate reaction to events.

### Phase 2: Durable Execution (Week 2)

**Tasks:**
1. Add `current_step_index` to runs table
2. Modify workflow runner to checkpoint before each step
3. Add `resumeRun()` function for crash recovery
4. Test: kill process mid-run, verify resume works

**Result:** Never lose work. Resume from exact crash point.

### Phase 3: Goal Orchestrator (Week 3)

**Tasks:**
1. Create goals table (id, description, status, parent_id, sub_goal_ids)
2. Implement `orchestrateGoal()` function
3. Add parent/child run tracking
4. Create event types: `goal:decomposed`, `child:spawned`, `child:completed`
5. Build synthesis step

**Result**: Can break down complex goals and coordinate multiple agents.

### Phase 4: Template System (Week 4)

**Tasks:**
1. Define `AGENT_TEMPLATES` registry
2. Implement `spawnFromTemplate()`
3. Convert existing built-in workflows to templates
4. Add CLI: `kai agent spawn <template> [config]`
5. Add API endpoint for web UI

**Result:** Dynamic agent creation with inheritance.

### Phase 5: Meta-Learning (Week 5)

**Tasks:**
1. Create `meta-learner.ts` module
2. Implement `analyzeRunHistory()`
3. Add daily cron job for self-analysis
4. Build workflow suggestion → approval → apply flow
5. Track improvement metrics

**Result:** System improves itself over time.

### Phase 6: Single Executable (Week 6)

**Tasks:**
1. Research: `pkg` vs `nexe` vs `sea` (Node.js Single Executable API)
2. Bundle Node.js + app + SQLite into single binary
3. Handle read-only executable scenarios (embedded workflows)
4. Test on macOS, Linux, Windows
5. Update CI/CD for release builds

**Result:** Single-file deployment. Download, run, done.

---

## Directory Structure

```
src/
├── agents-v2/
│   ├── index.ts              # Main exports
│   ├── event-bus.ts          # Pub/sub event system
│   ├── scheduler.ts          # Cron + event scheduling
│   ├── runner.ts             # Durable workflow execution
│   ├── orchestrator.ts       # Goal decomposition & coordination
│   ├── templates.ts          # Agent template registry
│   ├── meta-learner.ts       # System-level self-improvement
│   ├── api.ts                # HTTP API for web UI
│   ├── db-schema.ts          # Extended SQLite schema
│   └── templates/            # Built-in agent templates
│       ├── youtube-scout.ts
│       ├── code-reviewer.ts
│       └── self-heal.ts
├── agents/                   # OLD: Keep for backward compat
│   ├── daemon.ts
│   ├── workflow.ts
│   └── ...
└── web/
    └── routes/
        ├── agents.ts         # OLD API
        └── agents-v2.ts      # NEW API
```

---

## Technical Decisions

### Why Not Inngest (Yet)?

The Inngest proposal in `docs/agent-v2-architecture.md` is solid but adds complexity:
- Requires Inngest server (self-hosted or cloud)
- Adds network dependency
- More moving parts

**Decision**: Build in-process event bus first. If we need horizontal scaling later, we can add Inngest as an optional backend without changing the API.

### Why SQLite Over Postgres/Redis?

- Zero external dependencies
- Single-file deployment
- WAL mode gives reasonable concurrency
- Can migrate to libSQL (Turso) later for edge distribution

### Why pkg Over deno compile?

- Minimal code changes (stay in Node.js ecosystem)
- Better npm ecosystem compatibility
- SQLite native bindings work
- Mature tooling

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Trigger latency | 30s (polling) | <100ms (event-driven) |
| Crash recovery | Full restart | Resume from step |
| Cross-agent coordination | None | Goal orchestration |
| Dynamic agent creation | Manual | Template-based |
| System self-improvement | Per-workflow | Meta-learning |
| Deployment artifacts | Node + files | Single binary |

---

## Next Steps

1. **Review this plan** — Does it match your vision?
2. **Prioritize phases** — Which is most urgent?
3. **Begin Phase 1** — I can start implementing the event bus
4. **Define templates** — What agent templates do you need first?

Ready to proceed?
