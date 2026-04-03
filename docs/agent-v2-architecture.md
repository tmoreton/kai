# Kai Agent System v2 Architecture

## Executive Summary

Replace the custom cron-based daemon with **Ingest** as the workflow orchestration layer. Kai becomes an "AI-native workflow platform" where:
- **Ingest** handles: scheduling, retries, concurrency, state persistence, event routing
- **Kai** handles: LLM calls, tool execution, memory, reasoning, custom logic

This gives us production-grade orchestration without building it ourselves.

---

## Current vs. Proposed Architecture

### Current (Custom Implementation)
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Cron Jobs  │────▶│  Workflow   │────▶│   SQLite    │
│  (node-cron)│     │   Engine    │     │   State     │
└─────────────┘     └─────────────┘     └─────────────┘
                            │
                    ┌───────┴───────┐
                    ▼               ▼
              ┌─────────┐      ┌──────────┐
              │  LLM    │      │  Skills  │
              │  Calls  │      │  (MCP)   │
              └─────────┘      └──────────┘
```

**Problems:**
- Custom scheduler (reliability, scaling concerns)
- No native event-driven triggers
- Manual retry/backoff logic
- No distributed execution
- SQLite is single-node only

### Proposed (Ingest + Kai)
```
┌─────────────────────────────────────────────────────────┐
│                    INNGEST PLATFORM                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │ Event Bus   │  │ Scheduler   │  │ State Store │   │
│  │ (Redis/Pg)  │  │ (cron +     │  │ (durable    │   │
│  │             │  │  event)     │  │  execution) │   │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘   │
│         └─────────────────┴─────────────────┘         │
│                          │                              │
│                   ┌──────┴──────┐                       │
│                   ▼             ▼                       │
│         ┌──────────────┐ ┌─────────────┐              │
│         │  KAI AGENT   │ │  KAI AGENT  │  ...         │
│         │   RUNNERS    │ │   RUNNERS   │              │
│         └──────────────┘ └─────────────┘              │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    KAI INTELLIGENCE                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │ LLM Router  │  │ Tool Exec   │  │  Memory     │   │
│  │ (multi-     │  │ (skills,    │  │  (archival, │   │
│  │  provider)  │  │  MCP, bash) │  │  recall)    │   │
│  └─────────────┘  └─────────────┘  └─────────────┘   │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │ Personas    │  │ Planning    │  │ Self-Heal   │   │
│  │ (identity)  │  │ (goal dec.) │  │ (diagnosis) │   │
│  └─────────────┘  └─────────────┘  └─────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Key Components

### 1. Ingest Integration Layer

```typescript
// src/agents-v2/ingest/client.ts
import { Inngest } from "inngest";

export const ingest = new Inngest({
  id: "kai-agents",
  eventKey: process.env.INNGEST_EVENT_KEY,
});

// Event definitions
export const AgentEvents = {
  AGENT_RUN_REQUESTED: "agent/run.requested",
  AGENT_STEP_COMPLETED: "agent/step.completed",
  AGENT_STEP_FAILED: "agent/step.failed",
  AGENT_HUMAN_APPROVAL: "agent/human.approval",
  AGENT_SCHEDULE_CREATE: "agent/schedule.create",
  KNOWLEDGE_NEW: "knowledge/new",           // trigger learning agents
  ERROR_DETECTED: "error/detected",         // trigger diagnosis
  GOAL_ASSIGNED: "goal/assigned",           // trigger orchestrator
} as const;
```

### 2. Workflow Functions

Replace YAML workflows with TypeScript functions:

```typescript
// src/agents-v2/workflows/content-calendar.ts
import { ingest } from "../ingest/client";

export const contentCalendarWorkflow = ingest.createFunction(
  { id: "content-calendar-generator" },
  { cron: "0 7 * * *" }, // Daily at 7am
  async ({ step, runId }) => {
    // Step 1: Gather intel
    const intel = await step.run("fetch-intel", async () => {
      return await fetchYouTubeIntel();
    });

    // Step 2: Read content board
    const board = await step.run("read-board", async () => {
      return await readData("content-board.json");
    });

    // Step 3: Generate calendar (LLM call)
    const calendar = await step.run("generate-calendar", async () => {
      return await llmCall({
        prompt: buildCalendarPrompt(intel, board),
        persona: "youtube-strategist",
      });
    });

    // Step 4: Write output
    await step.run("save-calendar", async () => {
      await writeFile("~/content-calendar.md", calendar);
    });

    // Step 5: Notify (optional approval)
    await step.run("notify-user", async () => {
      await createNotification({
        title: "Content Calendar Ready",
        body: calendar.summary,
        requiresApproval: false,
      });
    });
  }
);
```

### 3. Event-Driven Agent Triggers

```typescript
// src/agents-v2/workflows/orchestrator.ts
export const goalOrchestrator = ingest.createFunction(
  { id: "goal-orchestrator" },
  { event: "goal/assigned" },
  async ({ event, step }) => {
    const { goalId, goalDescription, priority } = event.data;

    // Step 1: Decompose goal into sub-goals
    const plan = await step.run("create-plan", async () => {
      return await llmCall({
        prompt: `Decompose this goal into actionable sub-goals: ${goalDescription}`,
        persona: "strategist",
        outputSchema: z.array(z.object({
          agentType: z.enum(["youtube", "code", "research"]),
          task: z.string(),
          dependencies: z.array(z.string()).optional(),
        })),
      });
    });

    // Step 2: Spawn child agents
    for (const task of plan) {
      await step.sendEvent(`spawn-${task.agentType}`, {
        name: AgentEvents.AGENT_RUN_REQUESTED,
        data: {
          goalId,
          taskId: generateId(),
          agentType: task.agentType,
          task: task.task,
          parentRunId: runId,
        },
      });
    }

    // Step 3: Wait for all children (fan-out/fan-in)
    const results = await step.waitForEvent("all-children-complete", {
      event: AgentEvents.AGENT_STEP_COMPLETED,
      timeout: "1h",
      match: { "data.parentRunId": runId },
    });

    // Step 4: Synthesize results
    await step.run("synthesize", async () => {
      return await llmCall({
        prompt: `Synthesize these sub-task results into goal progress: ${JSON.stringify(results)}`,
      });
    });
  }
);
```

### 4. Self-Healing with Ingest

```typescript
// src/agents-v2/workflows/self-heal.ts
export const selfHealWorkflow = ingest.createFunction(
  { id: "kai-self-heal", retries: 0 }, // No auto-retry, we handle it
  [
    { cron: "0 3 * * *" },              // Daily check
    { event: "error/detected" },         // Or on-demand
  ],
  async ({ step, runId }) => {
    // Step 1: Gather recent errors
    const errors = await step.run("collect-errors", async () => {
      return await getRecentErrors({ hours: 24, unresolved: true });
    });

    // Step 2: AI diagnosis
    const diagnosis = await step.run("diagnose", async () => {
      return await llmCall({
        prompt: buildDiagnosisPrompt(errors),
        persona: "debugger",
        outputSchema: DiagnosisSchema,
      });
    });

    // Step 3: For fixable issues, create branch and apply
    if (diagnosis.fixable) {
      await step.run("create-branch", async () => {
        return await createGitBranch(`kai/heal-${runId}`);
      });

      // Step 4: Generate and apply fixes
      const fixes = await step.run("generate-fixes", async () => {
        return await llmCall({
          prompt: buildFixPrompt(diagnosis),
          outputSchema: FixesSchema,
        });
      });

      // Step 5: Apply edits
      await step.run("apply-fixes", async () => {
        for (const fix of fixes) {
          await applyEdit(fix);
        }
      });

      // Step 6: Build gate
      const buildResult = await step.run("build-check", async () => {
        return await runBuild();
      });

      if (!buildResult.success) {
        // Step 7: Auto-revert on failure
        await step.run("revert", async () => {
          await revertBranch();
        });
        throw new Error("Build failed, reverted changes");
      }

      // Step 8: Human approval for commit
      const approval = await step.waitForEvent("human-approval", {
        event: AgentEvents.AGENT_HUMAN_APPROVAL,
        timeout: "24h",
      });

      if (approval?.data?.approved) {
        await step.run("commit", async () => {
          await commitChanges("Self-heal: auto-fix");
        });
      }
    }
  }
);
```

### 5. Dynamic Agent Spawning

```typescript
// src/agents-v2/spawner.ts
interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  baseWorkflow: string;
  defaultSchedule?: string;
  requiredConfig: string[];
}

const agentTemplates: Record<string, AgentTemplate> = {
  "youtube-scout": {
    id: "youtube-scout",
    name: "YouTube Trend Scout",
    description: "Monitors trending content in niche",
    baseWorkflow: "youtube-scout-workflow",
    requiredConfig: ["channel_id", "topics"],
  },
  "code-reviewer": {
    id: "code-reviewer",
    name: "Code Review Agent",
    description: "Reviews PRs and suggests improvements",
    baseWorkflow: "code-review-workflow",
  },
  // ... more templates
};

export async function spawnAgent(
  templateId: string,
  config: Record<string, any>,
  options?: {
    oneTime?: boolean;
    schedule?: string;
    triggerOn?: string[]; // event types
  }
): Promise<string> {
  const template = agentTemplates[templateId];
  if (!template) throw new Error(`Unknown template: ${templateId}`);

  const agentId = `${templateId}-${Date.now()}`;

  // Register with Ingest
  await ingest.send({
    name: AgentEvents.AGENT_SCHEDULE_CREATE,
    data: {
      agentId,
      workflow: template.baseWorkflow,
      config,
      schedule: options?.schedule || template.defaultSchedule,
      triggerOn: options?.triggerOn,
    },
  });

  // Save agent config to Kai's memory
  await saveAgentConfig(agentId, {
    templateId,
    config,
    createdAt: new Date(),
    runs: [],
  });

  return agentId;
}
```

---

## Migration Strategy

### Phase 1: Ingest Setup (Week 1)
1. Add Ingest dependencies
2. Create `src/agents-v2/` directory structure
3. Set up local Ingest dev server
4. Port 2-3 simple agents as proof of concept

### Phase 2: Feature Parity (Weeks 2-3)
1. Port all built-in agents (self-heal, backup, etc.)
2. Implement persona integration in new workflow runner
3. Port skill/MCP integrations
4. Web UI updates for new API

### Phase 3: New Capabilities (Week 4)
1. Event-driven triggers
2. Agent templates and spawner
3. Goal orchestrator
4. Cross-agent memory/knowledge graph

### Phase 4: Deprecation (Week 5)
1. Migration tool for existing agents
2. Deprecate old daemon (keep for 1 release)
3. Update documentation

---

## Directory Structure

```
src/
├── agents-v2/              # NEW: Ingest-based system
│   ├── ingest/
│   │   ├── client.ts       # Ingest client setup
│   │   ├── events.ts       # Event type definitions
│   │   └── middleware.ts   # Auth, logging, etc.
│   ├── workflows/          # Workflow function definitions
│   │   ├── content-calendar.ts
│   │   ├── self-heal.ts
│   │   ├── goal-orchestrator.ts
│   │   └── index.ts        # Registration
│   ├── runners/            # Kai-specific execution logic
│   │   ├── llm-runner.ts   # LLM call with fallback
│   │   ├── tool-runner.ts  # Skill/MCP execution
│   │   └── memory-runner.ts # Archival/recall integration
│   ├── spawner.ts          # Dynamic agent creation
│   ├── templates.ts        # Agent template registry
│   └── api.ts              # HTTP API for web UI
├── agents/                 # OLD: Keep for migration
│   └── (existing files)
└── web/routes/
    └── agents-v2.ts        # New REST API
```

---

## Configuration

```json
// ~/.kai/settings.json
{
  "agents": {
    "version": "v2",
    "ingest": {
      "mode": "self-hosted",  // or "cloud"
      "eventKey": "...",
      "signingKey": "...",
      "redisUrl": "redis://localhost:6379"
    },
    "orchestrator": {
      "enabled": true,
      "autoSpawn": false,      // Require approval for new agents
      "maxConcurrent": 5,
      "costBudget": {
        "daily": 10.00,        // USD
        "alertAt": 8.00
      }
    }
  }
}
```

---

## Benefits of This Architecture

1. **Reliability**: Ingest handles retries, timeouts, idempotency
2. **Observability**: Built-in tracing, step-by-step visibility
3. **Scalability**: Can distribute workers across multiple machines
4. **Event-Driven**: Real-time reactions to errors, new knowledge, etc.
5. **Type Safety**: Full TypeScript across workflows
6. **Dev Experience**: Local dev server, step replay, time travel debugging
7. **Ecosystem**: Connect to 400+ integrations via Ingest

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Learning curve | Start with simple cron workflows, expand gradually |
| Self-hosting complexity | Use Ingest Cloud for testing, migrate to self-hosted later |
| Migration downtime | Run v1 and v2 in parallel during transition |
| Vendor lock-in | Workflow logic stays in Kai, Ingest is swappable |

---

## Next Steps

1. **Validate approach** - Does this match your vision?
2. **Spike** - Build a minimal proof-of-concept (2-3 days)
3. **Decide** - Proceed with full migration or adjust
4. **Execute** - Follow 5-week migration plan

Ready to start the spike, or want to adjust the architecture first?
