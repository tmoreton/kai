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
      const result = handler(event);
      if (result && typeof result.catch === 'function') {
        result.catch((err: unknown) => {
          console.error(`[EventBus] Handler error for ${event.type}:`, err);
        });
      }
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
