# Phase 1 Implementation: Event Bus + File Watching

Complete, copy-pasteable implementation. Run this and you'll have event-driven agents in hours.

---

## Step 1: Types (`src/agents-v2/types.ts`)

```typescript
/**
 * Core types for Kai Agent System v2
 */

export type EventType = 
  | "file:changed" 
  | "email:received" 
  | "webhook:called"
  | "agent:run-requested"
  | "agent:completed"
  | "agent:failed"
  | "error:detected";

export interface AgentEvent {
  id: string;
  type: EventType;
  timestamp: number;
  payload: Record<string, unknown>;
  source?: string;
}

export type EventHandler = (event: AgentEvent) => void | Promise<void>;
export type EventFilter = EventType | ((event: AgentEvent) => boolean);

export interface TriggerConfig {
  type: "event" | "file" | "webhook" | "cron";
  filter?: EventFilter;
  path?: string;
  expr?: string;
}

export interface AgentRegistration {
  agentId: string;
  triggers: TriggerConfig[];
}
```

---

## Step 2: Event Bus (`src/agents-v2/event-bus.ts`)

```typescript
import type { AgentEvent, EventType, EventHandler, EventFilter } from "./types.js";

/**
 * Simple in-process event bus.
 * Zero dependencies. <1ms latency.
 */
export class EventBus {
  private handlers = new Map<EventType, Set<EventHandler>>();
  private wildcards: Array<{ filter: (e: AgentEvent) => boolean; handler: EventHandler }> = [];

  publish(event: AgentEvent): void {
    // Run type-specific handlers
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of [...handlers]) {
        this.runHandler(handler, event);
      }
    }

    // Run wildcard handlers
    for (const { filter, handler } of [...this.wildcards]) {
      if (filter(event)) {
        this.runHandler(handler, event);
      }
    }
  }

  subscribe(filter: EventFilter, handler: EventHandler): () => void {
    if (typeof filter === "function") {
      // Wildcard subscription with custom filter
      const entry = { filter: filter as (e: AgentEvent) => boolean, handler };
      this.wildcards.push(entry);
      
      return () => {
        const idx = this.wildcards.indexOf(entry);
        if (idx > -1) this.wildcards.splice(idx, 1);
      };
    } else {
      // Type-specific subscription
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
        console.error(`[EventBus] Handler error for ${event.type}:`, err);
      });
    });
  }

  // Debug helper
  getStats(): { types: number; wildcards: number } {
    let handlerCount = 0;
    for (const handlers of this.handlers.values()) {
      handlerCount += handlers.size;
    }
    return { types: handlerCount, wildcards: this.wildcards.length };
  }
}

// Singleton instance for the application
export const eventBus = new EventBus();
```

---

## Step 3: File Watcher (`src/agents-v2/watchers/file.ts`)

```typescript
import { watch, type FSWatcher } from "fs";
import { eventBus } from "../event-bus.js";
import { expandHome } from "../../utils.js";

const activeWatchers = new Map<string, () => void>();

/**
 * Watch a file for changes. Emits `file:changed` events.
 * Returns unsubscribe function.
 */
export function watchFile(filePath: string): () => void {
  const resolvedPath = expandHome(filePath);
  
  // Don't double-watch
  if (activeWatchers.has(resolvedPath)) {
    return activeWatchers.get(resolvedPath)!;
  }

  let watcher: FSWatcher;
  
  try {
    watcher = watch(resolvedPath, (eventType, filename) => {
      if (eventType === "change") {
        eventBus.publish({
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: "file:changed",
          timestamp: Date.now(),
          payload: { 
            path: filePath, 
            resolvedPath, 
            eventType,
            filename: filename || null
          },
          source: "file-watcher",
        });
      }
    });
  } catch (err) {
    console.error(`[FileWatcher] Failed to watch ${resolvedPath}:`, err);
    throw err;
  }

  const unwatch = () => {
    watcher.close();
    activeWatchers.delete(resolvedPath);
  };

  activeWatchers.set(resolvedPath, unwatch);
  return unwatch;
}

/**
 * Unwatch a specific file.
 */
export function unwatchFile(filePath: string): void {
  const resolvedPath = expandHome(filePath);
  const unwatch = activeWatchers.get(resolvedPath);
  if (unwatch) {
    unwatch();
  }
}

/**
 * Unwatch all files. Call on shutdown.
 */
export function unwatchAll(): void {
  for (const [path, unwatch] of activeWatchers) {
    unwatch();
  }
  activeWatchers.clear();
}

/**
 * Get list of currently watched files.
 */
export function getWatchedFiles(): string[] {
  return [...activeWatchers.keys()];
}
```

---

## Step 4: Email Watcher (`src/agents-v2/watchers/email.ts`)

```typescript
import { eventBus } from "../event-bus.js";

let emailInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start polling for new emails and emit events.
 * Converts existing email-poller.ts to event-driven.
 */
export async function startEmailWatcher(pollIntervalMs: number = 60000): Promise<void> {
  if (emailInterval) {
    console.log("[EmailWatcher] Already running");
    return;
  }

  // Initial check
  await checkAndEmitEmails();

  // Set up polling
  emailInterval = setInterval(checkAndEmitEmails, pollIntervalMs);
  
  console.log(`[EmailWatcher] Started (poll: ${pollIntervalMs}ms)`);
}

/**
 * Stop the email watcher.
 */
export function stopEmailWatcher(): void {
  if (emailInterval) {
    clearInterval(emailInterval);
    emailInterval = null;
    console.log("[EmailWatcher] Stopped");
  }
}

async function checkAndEmitEmails(): Promise<void> {
  try {
    // Import existing email checking logic
    const { checkForNewEmails } = await import("../../agents/email-poller.js");
    const emails = await checkForNewEmails();

    for (const email of emails) {
      eventBus.publish({
        id: `email-${email.messageId || Date.now()}`,
        type: "email:received",
        timestamp: Date.now(),
        payload: email,
        source: "email-watcher",
      });
    }

    if (emails.length > 0) {
      console.log(`[EmailWatcher] Emitted ${emails.length} new email(s)`);
    }
  } catch (err) {
    console.error("[EmailWatcher] Error checking emails:", err);
  }
}
```

---

## Step 5: Scheduler (`src/agents-v2/scheduler.ts`)

```typescript
import cron from "node-cron";
import { eventBus } from "./event-bus.js";
import { watchFile } from "./watchers/file.js";
import type { TriggerConfig, AgentRegistration, EventFilter, AgentEvent } from "./types.js";

const registeredAgents = new Map<string, Array<() => void>>();

/**
 * Register triggers for an agent. Call on daemon startup.
 */
export function registerAgentTriggers(reg: AgentRegistration): void {
  // Clean up existing
  unregisterAgentTriggers(reg.agentId);
  
  const unsubs: Array<() => void> = [];
  
  for (const trigger of reg.triggers) {
    const unsub = registerTrigger(reg.agentId, trigger);
    if (unsub) unsubs.push(unsub);
  }
  
  registeredAgents.set(reg.agentId, unsubs);
  console.log(`[Scheduler] Registered ${unsubs.length} trigger(s) for ${reg.agentId}`);
}

/**
 * Unregister all triggers for an agent.
 */
export function unregisterAgentTriggers(agentId: string): void {
  const unsubs = registeredAgents.get(agentId);
  if (unsubs) {
    for (const unsub of unsubs) {
      unsub();
    }
    registeredAgents.delete(agentId);
  }
}

function registerTrigger(agentId: string, trigger: TriggerConfig): (() => void) | null {
  switch (trigger.type) {
    case "event": {
      const filter = trigger.filter || (() => true);
      return eventBus.subscribe(filter, async (event) => {
        await handleTrigger(agentId, event);
      });
    }
    
    case "file": {
      if (!trigger.path) return null;
      
      // Watch the file
      const unwatch = watchFile(trigger.path);
      
      // Also subscribe to events (for matching)
      const filter: EventFilter = (e: AgentEvent) => 
        e.type === "file:changed" && 
        (e.payload.path === trigger.path || e.payload.resolvedPath === trigger.path);
      
      const unsub = eventBus.subscribe(filter, async (event) => {
        await handleTrigger(agentId, event);
      });
      
      return () => {
        unwatch();
        unsub();
      };
    }
    
    case "cron": {
      if (!trigger.expr || !cron.validate(trigger.expr)) {
        console.warn(`[Scheduler] Invalid cron: ${trigger.expr}`);
        return null;
      }
      
      const task = cron.schedule(trigger.expr, () => {
        eventBus.publish({
          id: `cron-${Date.now()}`,
          type: "agent:run-requested",
          timestamp: Date.now(),
          payload: { agentId, triggerType: "cron", expr: trigger.expr },
          source: "scheduler",
        });
      });
      
      return () => task.stop();
    }
    
    case "webhook": {
      // Webhook events come through HTTP API (implemented later)
      // For now, just subscribe to webhook:called events
      const filter: EventFilter = (e: AgentEvent) => 
        e.type === "webhook:called" && 
        e.payload.agentId === agentId;
      
      return eventBus.subscribe(filter, async (event) => {
        await handleTrigger(agentId, event);
      });
    }
    
    default:
      return null;
  }
}

async function handleTrigger(agentId: string, event: AgentEvent): Promise<void> {
  console.log(`[Scheduler] Triggered ${agentId} via ${event.type}`);
  
  // Import runner dynamically to avoid circular deps
  const { runAgent } = await import("./runner.js");
  
  try {
    await runAgent(agentId, { triggerEvent: event });
  } catch (err) {
    console.error(`[Scheduler] Failed to run ${agentId}:`, err);
  }
}

/**
 * Convert old heartbeat conditions to new triggers.
 */
export function convertHeartbeatToTriggers(conditions: any[]): TriggerConfig[] {
  const triggers: TriggerConfig[] = [];
  
  for (const condition of conditions) {
    switch (condition.type) {
      case "file_changed":
        triggers.push({ type: "file", path: condition.check });
        break;
      case "webhook":
        triggers.push({ type: "webhook" });
        break;
      case "shell":
        // Shell conditions become custom event filters
        triggers.push({
          type: "event",
          filter: (e: AgentEvent) => e.type === "shell:result" && e.payload.check === condition.check
        });
        break;
      // threshold, trend, memory conditions need custom handling
    }
  }
  
  return triggers;
}
```

---

## Step 6: Runner (`src/agents-v2/runner.ts`)

```typescript
import { parseWorkflow, executeWorkflow } from "../agents/workflow.js";
import { getAgent, addLog } from "../agents/db.js";
import { eventBus } from "./event-bus.js";
import type { AgentEvent } from "./types.js";

interface RunOptions {
  triggerEvent?: AgentEvent;
}

/**
 * Run an agent with event context.
 * Wraps existing workflow engine for now.
 */
export async function runAgent(
  agentId: string, 
  options?: RunOptions
): Promise<{ success: boolean; error?: string }> {
  const agent = getAgent(agentId);
  if (!agent) {
    return { success: false, error: `Agent ${agentId} not found` };
  }

  console.log(`[Runner] Starting ${agent.name} (trigger: ${options?.triggerEvent?.type || "manual"})`);
  
  addLog(agentId, "info", `Agent triggered via ${options?.triggerEvent?.type || "manual"}`);

  try {
    const workflow = parseWorkflow(agent.workflow_path);
    
    // Merge trigger event into config
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

    return { success: result.success, error: result.error };
    
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
    
    return { success: false, error: msg };
  }
}
```

---

## Step 7: Index File (`src/agents-v2/index.ts`)

```typescript
/**
 * Kai Agent System v2 - Public API
 */

export { eventBus, EventBus } from "./event-bus.js";
export type { AgentEvent, EventType, EventHandler, EventFilter, TriggerConfig, AgentRegistration } from "./types.js";

export { watchFile, unwatchFile, unwatchAll, getWatchedFiles } from "./watchers/file.js";
export { startEmailWatcher, stopEmailWatcher } from "./watchers/email.js";

export { registerAgentTriggers, unregisterAgentTriggers, convertHeartbeatToTriggers } from "./scheduler.js";

export { runAgent } from "./runner.js";
```

---

## Step 8: Integrate with Daemon

Modify `src/agents/daemon.ts`:

```typescript
// Add at top
import {
  eventBus,
  registerAgentTriggers,
  convertHeartbeatToTriggers,
  startEmailWatcher,
} from "../agents-v2/index.js";

// Modify startDaemonInner()
async function startDaemonInner(): Promise<void> {
  console.log(chalk.bold.cyan("\n  ⚡ Kai Agent Daemon starting...\n"));

  // Error handling
  process.on("uncaughtException", (err) => {
    console.error(chalk.red(`  Uncaught: ${err.message}`));
    addLog("__daemon__", "error", `Uncaught: ${err.message}`);
  });

  // Load skills
  await loadAllSkills();
  await registerAllIntegrations();

  // Load agents and register event triggers
  const agents = listAgents();
  console.log(chalk.dim(`  Found ${agents.length} agents\n`));

  for (const agent of agents) {
    if (!agent.enabled) continue;
    
    const triggers: any[] = [];
    
    // Add cron schedule
    if (agent.schedule) {
      triggers.push({ type: "cron", expr: agent.schedule });
    }
    
    // Convert heartbeat conditions
    let config: Record<string, any>;
    try {
      config = JSON.parse(agent.config || "{}");
    } catch { continue; }
    
    if (config.heartbeat?.enabled && config.heartbeat.conditions) {
      const heartbeatTriggers = convertHeartbeatToTriggers(config.heartbeat.conditions);
      triggers.push(...heartbeatTriggers);
    }
    
    if (triggers.length > 0) {
      registerAgentTriggers({ agentId: agent.id, triggers });
    }
  }

  // Subscribe to manual run requests
  eventBus.subscribe("agent:run-requested", async (event) => {
    const { agentId } = event.payload;
    const { runAgent } = await import("../agents-v2/runner.js");
    await runAgent(agentId as string);
  });

  // Start email watcher
  try {
    await startEmailWatcher(60000);
  } catch (err) {
    console.log(chalk.dim("  Email watcher not started (no config)"));
  }

  // Simplified heartbeat (just for self-healing)
  startProactiveHeartbeat();
  
  console.log(chalk.dim("  Daemon running. Press Ctrl+C to stop.\n"));
}

// Simplify startProactiveHeartbeat()
function startProactiveHeartbeat(): void {
  let checkCount = 0;
  
  heartbeatInterval = setInterval(async () => {
    checkCount++;
    
    if (checkCount % 10 === 0) {
      addLog("__daemon__", "info", `Heartbeat: ${eventBus.getStats().types} handlers`);
    }
    
    // Only do self-healing (no condition polling)
    if (checkCount % 6 === 3) {
      await checkAndRetryFailedRuns();
    }
  }, HEARTBEAT_CHECK_INTERVAL);
}
```

---

## Step 9: Test It

Create test workflow:

```bash
mkdir -p ~/.kai/workflows

cat > ~/.kai/workflows/test-event.yaml << 'EOF'
name: test-event-trigger
description: Test event-driven agent
steps:
  - name: log
    type: shell
    command: echo "Triggered by ${config.trigger_event.type} at $(date)"
  - name: notify
    type: integration
    integration: notify
    action: create
    params:
      title: "Event Triggered!"
      body: "Type: ${config.trigger_event.type}"
EOF
```

Register agent:

```bash
# Via CLI (assuming kai agent create exists)
kai agent create test-event ~/.kai/workflows/test-event.yaml --trigger file:~/test-file.txt
```

Or manually via code:

```typescript
import { registerAgentTriggers } from "./agents-v2/index.js";

registerAgentTriggers({
  agentId: "test-event",
  triggers: [
    { type: "file", path: "~/test-file.txt" }
  ]
});
```

Test:

```bash
# Start daemon
kai agent daemon

# In another terminal, trigger it
echo "test" >> ~/test-file.txt

# Should see agent run within 100ms (not 30s!)
```

---

## Success Metrics

| Metric | Target | How to Test |
|--------|--------|-------------|
| Trigger latency | <100ms | `time echo "test" >> file` |
| CPU (idle) | Near zero | `top` when daemon running |
| Events/sec | 1000+ | Load test with many file changes |
| Memory | <50MB | `ps aux` |

---

## Next Steps

After Phase 1 works:
1. **Phase 2**: Add checkpoint/resume for durable execution
2. **Phase 3**: Build goal orchestrator
3. **Phase 4**: Template system
4. **Phase 5**: Meta-learning
5. **Phase 6**: Single executable

Ready to implement?
