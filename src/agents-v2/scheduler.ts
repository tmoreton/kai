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
      // Webhook events come through HTTP API
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
          filter: (e: AgentEvent) => e.payload?.check === condition.check && e.payload?.type === "shell"
        });
        break;
      // threshold, trend, memory conditions need custom handling
    }
  }
  
  return triggers;
}
