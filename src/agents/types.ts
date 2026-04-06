/**
 * Core types for Kai Agent System
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
