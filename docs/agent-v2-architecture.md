# Kai Event-Driven Agent System: Architecture

## Overview

Build an in-house, event-driven agent system that achieves autonomy without external dependencies. Single-process, SQLite-backed, compiles to one executable.

---

## Core Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     KAI AGENT SYSTEM                        │
├─────────────────────────────────────────────────────────────┤
│  EVENT LAYER                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Event Bus   │  │  Watchers    │  │  Scheduler   │     │
│  │  (pub/sub)   │  │  (file,email)│  │  (cron)      │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         └─────────────────┴─────────────────┘             │
│                            │                                │
├────────────────────────────┼────────────────────────────────┤
│  ORCHESTRATION LAYER       │                                │
│  ┌────────────────┐       │  ┌────────────────┐           │
│  │ Goal           │       │  │ Agent          │           │
│  │ Orchestrator   │◄──────┘  │ Runner         │           │
│  │                │          │ (durable)      │           │
│  └────────┬───────┘          └────────────────┘           │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────────────────────────────────┐           │
│  │ Template Spawner                            │           │
│  └─────────────────────────────────────────────┘           │
├─────────────────────────────────────────────────────────────┤
│  EXECUTION LAYER                                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │ LLM Router  │  │ Tool Exec   │  │ Memory      │       │
│  │ (multi-     │  │ (skills,    │  │ (archival,  │       │
│  │  provider)  │  │  MCP, bash) │  │  recall)    │       │
│  └─────────────┘  └─────────────┘  └─────────────┘       │
├─────────────────────────────────────────────────────────────┤
│  PERSISTENCE LAYER                                          │
│  ┌─────────────────────────────────────────────┐           │
│  │ SQLite (single file)                        │           │
│  │ • agents, runs, steps, checkpoints          │           │
│  │ • goals, events, logs, notifications        │           │
│  └─────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Components

### 1. Event Bus (In-Process Pub/Sub)

Simple, fast, zero dependencies:

```typescript
// No Redis, no network, just Maps and function calls
class EventBus {
  private handlers = new Map<EventType, Set<EventHandler>>();
  publish(event: AgentEvent) { /* ... */ }
  subscribe(filter, handler) { /* ... */ }
}
```

**Why in-process?**
- Latency: <1ms vs network round-trip
- Zero dependencies: No Redis/Postgres to configure
- Single executable: Everything in one binary

### 2. Event Sources

| Source | Implementation | Triggers |
|--------|---------------|----------|
| **File Watcher** | Node.js `fs.watch()` | File changes, config updates |
| **Email Poller** | `setInterval` + IMAP | New emails, replies |
| **HTTP Server** | Hono routes | Webhooks, API calls |
| **Cron** | `node-cron` | Scheduled tasks |
| **Memory Listener** | Archival hooks | Knowledge matches |
| **Error Handler** | Process `uncaughtException` | Auto-healing triggers |

All emit to the same Event Bus → Agents subscribe → Immediate execution.

### 3. Durable Execution

Every workflow run is checkpointed after each step:

```typescript
interface RunState {
  runId: string;
  agentId: string;
  workflow: WorkflowDefinition;
  currentStep: number;        // Resume here
  context: WorkflowContext;  // Variables, config
  status: "pending" | "running" | "paused" | "completed" | "failed";
}
```

**Crash Recovery:**
1. Process starts → Check for interrupted runs
2. Load last checkpoint → Resume from `currentStep`
3. No lost work, idempotent re-runs

### 4. Goal Orchestrator

Break down complex goals into sub-goals:

```
Goal: "Launch YouTube channel"
  └─ Sub-goal 1: "Research trending topics" → [yt-scout agent]
  └─ Sub-goal 2: "Create content calendar" → [calendar agent]
  └─ Sub-goal 3: "Set up branding" → [design agent]
       └─ Synthesis: Combine all results
```

**Fan-out/Fan-in Pattern:**
- Spawn N agents in parallel
- Each emits `agent:completed` event
- Orchestrator waits for all → Synthesizes → Completes goal

### 5. Template System

Pre-defined agent blueprints:

```typescript
const TEMPLATES = {
  "youtube-scout": {
    workflow: youtubeScoutWorkflow,
    defaultConfig: { max_results: 10 },
    triggers: [{ type: "cron", expr: "0 8 * * *" }],
  },
  "code-reviewer": {
    workflow: codeReviewWorkflow,
    triggers: [{ type: "event", filter: "git:pr:opened" }],
  },
};
```

Spawn in one line:
```typescript
const agentId = await spawnFromTemplate("youtube-scout", { topics: ["AI", "coding"] });
```

### 6. Meta-Learning

System analyzes its own run history:

```typescript
async function analyzeAgentHistory(agentId: string) {
  const runs = await getRuns({ agentId, limit: 30 });
  
  // Ask LLM: "What patterns do you see?"
  const analysis = await llm({
    prompt: `Analyze these runs: ${JSON.stringify(runs)}`,
    output: { suggestions: ["prompt-improvement", "config-tuning"] }
  });
  
  // Auto-apply if confidence > 0.9
  if (analysis.confidence > 0.9) {
    await applyImprovements(agentId, analysis.suggestions);
  }
}
```

---

## Data Flow

### Scenario: File Change Triggers Agent

```
1. User edits ~/content-board.json
   ↓
2. File Watcher detects change
   ↓
3. Event Bus receives: { type: "file:changed", path: "..." }
   ↓
4. Scheduler matches to subscribed agent
   ↓
5. Agent Runner loads checkpoint (or starts new)
   ↓
6. Execute workflow steps with checkpointing
   ↓
7. Emit: { type: "agent:completed", results: {...} }
   ↓
8. If part of goal → Orchestrator notified → Spawns next agents
```

**Latency:** File change → Agent start = ~50-100ms (vs 30s polling)

---

## SQLite Schema

```sql
-- Core tables
CREATE TABLE agents (id, name, workflow, config, triggers, enabled);
CREATE TABLE runs (id, agent_id, status, current_step, context, created_at);
CREATE TABLE steps (id, run_id, name, index, status, output, error);
CREATE TABLE checkpoints (id, run_id, step_index, context, created_at);

-- Goal orchestration
CREATE TABLE goals (id, description, status, parent_id, sub_goal_ids, result);
CREATE TABLE goal_runs (goal_id, run_id, agent_id, role);

-- Events (for debugging/analysis)
CREATE TABLE events (id, type, payload, timestamp, processed);

-- Meta-learning
CREATE TABLE improvements (id, agent_id, type, reason, applied, created_at);
```

---

## Directory Structure

```
src/
├── agents-v2/
│   ├── index.ts              # Public API
│   ├── event-bus.ts          # Core pub/sub
│   ├── watchers/
│   │   ├── file.ts           # fs.watch wrapper
│   │   ├── email.ts          # IMAP poller → events
│   │   └── webhook.ts        # HTTP → events
│   ├── scheduler.ts          # Trigger registration
│   ├── runner.ts             # Durable workflow execution
│   ├── orchestrator.ts       # Goal decomposition
│   ├── templates/
│   │   ├── index.ts          # Template registry
│   │   ├── youtube-scout.ts  # Pre-built workflows
│   │   ├── code-reviewer.ts
│   │   └── self-heal.ts
│   ├── spawner.ts            # spawnFromTemplate()
│   ├── meta-learner.ts       # Self-improvement
│   ├── db.ts                 # SQLite operations
│   └── api.ts                # HTTP routes
├── agents/                   # OLD: Keep for compat
└── web/routes/
    └── agents-v2.ts          # REST API
```

---

## Why This Beats External Orchestrators

| Criteria | In-House Event-Driven | Inngest | Temporal |
|----------|----------------------|---------|----------|
| **Single executable** | ✅ Yes | ❌ No (needs server) | ❌ No |
| **Zero dependencies** | ✅ SQLite only | ❌ Redis + server | ❌ PG + ES + server |
| **Latency** | ✅ <1ms | ⚠️ Network RTT | ⚠️ Network RTT |
| **Setup complexity** | ✅ None | ⚠️ Moderate | ❌ High |
| **Horizontal scale** | ❌ Single node | ✅ Yes | ✅ Yes |
| **Learning curve** | ✅ Your code | ⚠️ New concepts | ❌ High |
| **Vendor lock-in** | ✅ None | ⚠️ Moderate | ⚠️ High |

**Bottom line:** For a personal/1-3 person indie hacker setup, the in-house approach wins on every metric that matters. You can always migrate to Inngest later if you need multi-node scaling.

---

## Implementation Phases

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| 1 | 3 days | Event bus + file watching + email polling |
| 2 | 3 days | Durable execution with checkpoint/resume |
| 3 | 4 days | Goal orchestrator with fan-out/fan-in |
| 4 | 3 days | Template system for dynamic agent spawning |
| 5 | 3 days | Meta-learning (analyze → suggest → improve) |
| 6 | 2 days | Single executable build with `pkg` |
| **Total** | **18 days** | Fully autonomous agent system |

Each phase builds on previous. Can stop at any point and still have working system.

---

## Success Metrics

| Metric | Current (Polling) | Target (Event-Driven) |
|--------|-------------------|------------------------|
| Trigger latency | 30s | <100ms |
| CPU usage (idle) | Moderate (polling loops) | Near zero |
| Crash recovery | Restart from scratch | Resume exact step |
| Dynamic agents | Manual CLI spawn | Template-based |
| Cross-agent coordination | None | Goal orchestration |
| Self-improvement | Per-workflow review | System-wide analysis |
| Deployment | Node + files | Single binary |

---

## Migration Strategy

1. **Parallel operation**: Run both old and new systems during transition
2. **Auto-migrate**: On startup, convert v1 agents to v2 templates
3. **Gradual cutover**: Move agents one at a time
4. **Fallback**: Can always revert to v1 daemon

---

## Open Questions

1. **Max goal depth?** Recommend 3 levels (goal → sub-goal → task)
2. **Workflow format?** TypeScript functions (bundleable) + optional YAML for user custom
3. **Auto-improve threshold?** Start at 0.9 confidence, adjust after testing
4. **Error retention?** Keep 30 days of run history for analysis

Ready to proceed with detailed implementation plan?
