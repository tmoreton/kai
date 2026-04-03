# Kai Agent V2: Quick Start - Phase 1 Implementation

This is a concrete, implementable guide for Phase 1 (Event Bus). You can start coding this immediately.

## Phase 1 Goal

Replace the 30-second polling heartbeat with an event-driven system. Result: agents react to file changes, emails, webhooks within 100ms instead of 30s.

---

## Step 1: Create Event Bus (2 hours)

### File: `src/agents-v2/event-bus.ts`

```typescript
/**
 * Kai Agent Event Bus
 * 
 * In-process pub/sub for agent events.
 * No external dependencies. Works with single process.
 */

type EventType = 
  | "file:changed" 
  | "email:received" 
  | "webhook:called"
  | "agent:run-requested"
  | "agent:completed"
  | "agent:failed"
  | "error:detected";

interface AgentEvent {
  id: string;
  type: EventType;
  timestamp: number;
  payload: Record<string, unknown>;
  source?: string;
}

type EventHandler = (event: AgentEvent) => void | Promise<void>;
type EventFilter = EventType | ((event: AgentEvent) => boolean);

class EventBus {
  private handlers = new Map<EventType, Set<EventHandler>>();
  private wildcards: EventHandler[] = [];

  publish(event: AgentEvent): void {
    // Run type-specific handlers
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        this.runHandler(handler, event);
      }
    }

    // Run wildcard handlers
    for (const handler of this.wildcards) {
      this.runHandler(handler, event);
    }
  }

  subscribe(filter: EventFilter, handler: EventHandler): () => void {
    if (typeof filter === "function") {
      // Wildcard - handler receives all events, filter decides
      const wrapped: EventHandler = (e) => {
        if (filter(e)) this.runHandler(handler, e);
      };
      this.wildcards.push(wrapped);
      
      return () => {
        const idx = this.wildcards.indexOf(wrapped);
        if (idx > -1) this.wildcards.splice(idx, 1);
      };
    } else {
      // Type-specific
      if (!this.handlers.has(filter)) {
        this.handlers.set(filter, new Set());
      }
      this.handlers.get(filter)!.add(handler);

      return () => {
        this.handlers.get(filter)?.delete(handler);
      };
    }
  }

  private runHandler(handler: EventHandler, event: AgentEvent): void {
    Promise.resolve().then(() => {
      handler(event).catch(err => {
        console.error(`Event handler error for ${event.type}:`, err);
      });
    });
  }
}

// Singleton export
export const eventBus = new EventBus();
export type { AgentEvent, EventType, EventHandler, EventFilter };
```

---

## Step 2: File Watcher (1 hour)

### File: `src/agents-v2/watchers/file-watcher.ts`

```typescript
import { watch } from "fs";
import { eventBus } from "../event-bus.js";
import { expandHome } from "../../utils.js";

const watchers = new Map<string, ReturnType<typeof watch>>();

export function watchFile(filePath: string): () => void {
  const resolvedPath = expandHome(filePath);
  
  // Don't double-watch
  if (watchers.has(resolvedPath)) {
    return watchers.get(resolvedPath)!;
  }

  const watcher = watch(resolvedPath, (eventType) => {
    if (eventType === "change") {
      eventBus.publish({
        id: `file-${Date.now()}`,
        type: "file:changed",
        timestamp: Date.now(),
        payload: { path: filePath, resolvedPath, eventType },
        source: "file-watcher",
      });
    }
  });

  const unwatch = () => watcher.close();
  watchers.set(resolvedPath, unwatch);
  
  return unwatch;
}

export function unwatchFile(filePath: string): void {
  const resolvedPath = expandHome(filePath);
  const unwatch = watchers.get(resolvedPath);
  if (unwatch) {
    unwatch();
    watchers.delete(resolvedPath);
  }
}

export function unwatchAll(): void {
  for (const [path, unwatch] of watchers) {
    unwatch();
  }
  watchers.clear();
}
```

---

## Step 3: Agent Trigger Registration (2 hours)

### File: `src/agents-v2/scheduler.ts`

```typescript
import { eventBus, type AgentEvent } from "./event-bus.js";
import { watchFile } from "./watchers/file-watcher.js";
import { runAgent } from "./runner.js"; // We'll create this
import type { HeartbeatCondition } from "../agents/conditions.js";

interface TriggerConfig {
  type: "event" | "file" | "webhook" | "cron";
  filter?: string | ((event: AgentEvent) => boolean);
  path?: string;
  expr?: string; // cron expression
}

interface AgentRegistration {
  agentId: string;
  triggers: TriggerConfig[];
}

const registeredTriggers = new Map<string, (() => void)[]>();

export function registerAgentTriggers(reg: AgentRegistration): void {
  // Unregister any existing
  unregisterAgentTriggers(reg.agentId);
  
  const unsubs: (() => void)[] = [];
  
  for (const trigger of reg.triggers) {
    switch (trigger.type) {
      case "event": {
        const filter = typeof trigger.filter === "function" 
          ? trigger.filter 
          : (e: AgentEvent) => e.type === trigger.filter;
        
        const unsub = eventBus.subscribe(filter, async (event) => {
          await runAgent(reg.agentId, { triggerEvent: event });
        });
        unsubs.push(unsub);
        break;
      }
      
      case "file": {
        if (trigger.path) {
          const unwatch = watchFile(trigger.path);
          
          // Also subscribe to the event
          const unsub = eventBus.subscribe("file:changed", async (event) => {
            if (event.payload.path === trigger.path || event.payload.resolvedPath === trigger.path) {
              await runAgent(reg.agentId, { triggerEvent: event });
            }
          });
          
          unsubs.push(unwatch, unsub);
        }
        break;
      }
      
      case "webhook": {
        // For now, webhook events come through HTTP API
        // We'll implement webhook server in later step
        break;
      }
      
      case "cron": {
        // Keep using node-cron for now, but emit event
        import("node-cron").then(cron => {
          if (trigger.expr && cron.validate(trigger.expr)) {
            const task = cron.schedule(trigger.expr, () => {
              eventBus.publish({
                id: `cron-${Date.now()}`,
                type: "agent:run-requested",
                timestamp: Date.now(),
                payload: { agentId: reg.agentId, triggerType: "cron", expr: trigger.expr },
                source: "cron",
              });
            });
            unsubs.push(() => task.stop());
          }
        });
        break;
      }
    }
  }
  
  registeredTriggers.set(reg.agentId, unsubs);
}

export function unregisterAgentTriggers(agentId: string): void {
  const unsubs = registeredTriggers.get(agentId);
  if (unsubs) {
    for (const unsub of unsubs) {
      unsub();
    }
    registeredTriggers.delete(agentId);
  }
}

// Convert old heartbeat config to new triggers
export function heartbeatToTriggers(conditions: HeartbeatCondition[]): TriggerConfig[] {
  return conditions.map(c => {
    switch (c.type) {
      case "file_changed":
        return { type: "file", path: c.check };
      case "webhook":
        return { type: "webhook" }; // webhook endpoint handles this
      case "shell":
        // For shell conditions, we keep polling for now
        // Or emit custom events from a poller
        return { type: "event", filter: (e: AgentEvent) => e.type === "shell:result" && e.payload.check === c.check };
      default:
        return { type: "event", filter: "agent:run-requested" };
    }
  });
}
```

---

## Step 4: Integrate with Existing Daemon (2 hours)

### Modify: `src/agents/daemon.ts`

Add to the top of the file:

```typescript
import { eventBus } from "../agents-v2/event-bus.js";
import { registerAgentTriggers, heartbeatToTriggers } from "../agents-v2/scheduler.js";
```

Modify `startDaemonInner()` to use event-driven triggers:

```typescript
async function startDaemonInner(): Promise<void> {
  // ... existing setup ...
  
  // Load all skills and integrations
  await loadAllSkills();
  await registerAllIntegrations();

  // NEW: Register event-driven triggers for all agents
  const agents = listAgents();
  console.log(chalk.dim(`  Found ${agents.length} agents\n`));

  for (const agent of agents) {
    if (!agent.enabled) continue;
    
    // Parse config for heartbeat conditions
    let config: Record<string, any>;
    try {
      config = JSON.parse(agent.config || "{}");
    } catch {
      continue;
    }
    
    const triggers: TriggerConfig[] = [];
    
    // Add cron schedule if exists
    if (agent.schedule) {
      triggers.push({ type: "cron", expr: agent.schedule });
    }
    
    // Convert heartbeat conditions to triggers
    if (config.heartbeat?.enabled && config.heartbeat.conditions) {
      const heartbeatTriggers = heartbeatToTriggers(config.heartbeat.conditions);
      triggers.push(...heartbeatTriggers);
    }
    
    if (triggers.length > 0) {
      registerAgentTriggers({
        agentId: agent.id,
        triggers,
      });
      console.log(chalk.dim(`  ✓ Registered ${triggers.length} trigger(s) for "${agent.name}"`));
    }
  }

  // NEW: Subscribe to agent:run-requested events
  eventBus.subscribe("agent:run-requested", async (event) => {
    const agentId = event.payload.agentId as string;
    await runAgent(agentId);
  });

  // Keep the proactive heartbeat but simplify it
  // It now just does self-healing checks, not condition polling
  startProactiveHeartbeat();
  
  // ... rest of setup ...
}
```

Modify `startProactiveHeartbeat()` to remove polling:

```typescript
function startProactiveHeartbeat(): void {
  let checkCount = 0;

  heartbeatInterval = setInterval(async () => {
    checkCount++;

    // Log status every 10 checks (~5 minutes)
    if (checkCount % 10 === 0) {
      addLog("__daemon__", "info", `Heartbeat: daemon healthy`);
    }

    // Self-healing: check for failed/stuck runs and auto-retry
    if (checkCount % 6 === 3) {
      await checkAndRetryFailedRuns();
    }
    
    // REMOVED: Heartbeat condition polling - now event-driven
  }, HEARTBEAT_CHECK_INTERVAL);
}
```

---

## Step 5: Create Minimal Runner (1 hour)

### File: `src/agents-v2/runner.ts`

For Phase 1, just wrap the existing workflow engine:

```typescript
import { parseWorkflow, executeWorkflow } from "../agents/workflow.js";
import { getAgent, addLog, createRun, completeRun } from "../agents/db.js";
import { eventBus } from "./event-bus.js";

interface RunOptions {
  triggerEvent?: { type: string; payload: Record<string, unknown> };
}

export async function runAgent(agentId: string, options?: RunOptions): Promise<{ success: boolean }> {
  const agent = getAgent(agentId);
  if (!agent) {
    console.error(`Agent ${agentId} not found`);
    return { success: false };
  }

  console.log(`Running agent: ${agent.name}`);
  addLog(agentId, "info", `Agent triggered via ${options?.triggerEvent?.type || "manual"}`);

  try {
    const workflow = parseWorkflow(agent.workflow_path);
    
    const config = {
      ...JSON.parse(agent.config || "{}"),
      trigger_event: options?.triggerEvent,
    };

    const result = await executeWorkflow(
      workflow,
      agentId,
      config,
      (step, status) => {
        console.log(`  ${step}: ${status}`);
      }
    );

    if (result.success) {
      eventBus.publish({
        id: `complete-${Date.now()}`,
        type: "agent:completed",
        timestamp: Date.now(),
        payload: { agentId, results: result.results },
        source: "runner",
      });
    } else {
      eventBus.publish({
        id: `fail-${Date.now()}`,
        type: "agent:failed",
        timestamp: Date.now(),
        payload: { agentId, error: result.error },
        source: "runner",
      });
    }

    return { success: result.success };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog(agentId, "error", `Run failed: ${msg}`);
    
    eventBus.publish({
      id: `fail-${Date.now()}`,
      type: "agent:failed",
      timestamp: Date.now(),
      payload: { agentId, error: msg },
      source: "runner",
    });
    
    return { success: false };
  }
}
```

---

## Step 6: Test It (30 minutes)

Create a test agent that watches a file:

```bash
# Create a test workflow
cat > ~/.kai/workflows/test-file-trigger.yaml << 'EOF'
name: test-file-trigger
description: Test file change detection
steps:
  - name: notify
    type: notify
    params:
      title: File Changed!
      body: The watched file was modified
EOF

# Register agent with file trigger
kai agent create test-file-trigger ~/.kai/workflows/test-file-trigger.yaml --trigger file:~/test-watched.txt

# Start daemon
kai agent daemon
```

In another terminal:
```bash
# Touch the file - should trigger immediately
# (Not 30 seconds later!)
echo "test" >> ~/test-watched.txt
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/agents-v2/event-bus.ts` | NEW: Core event bus |
| `src/agents-v2/watchers/file-watcher.ts` | NEW: File watching |
| `src/agents-v2/scheduler.ts` | NEW: Trigger registration |
| `src/agents-v2/runner.ts` | NEW: Minimal runner wrapper |
| `src/agents/daemon.ts` | MODIFY: Use event triggers instead of polling |

---

## Expected Results

1. **Latency**: File change → agent run should be <100ms (not 30s)
2. **CPU usage**: Should drop significantly (no 30s polling loops)
3. **Scalability**: Can handle more agents without linear CPU increase

---

## Next Steps After Phase 1

- Phase 2: Add durable execution (checkpoint/resume)
- Phase 3: Add goal orchestrator
- Phase 4: Template system
- Phase 5: Meta-learning
- Phase 6: Single executable

Ready to implement?
