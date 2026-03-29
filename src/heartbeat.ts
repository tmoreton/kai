import chalk from "chalk";

/**
 * Heartbeat System
 *
 * Enables multi-step autonomous actions. After a tool call, the agent
 * can request another turn (heartbeat) instead of returning to the user.
 * This enables chains like: think → search → update memory → search again → respond.
 *
 * The heartbeat counter limits how many consecutive autonomous steps
 * the agent can take before it must respond to the user.
 */

export const MAX_HEARTBEATS = 20; // Max consecutive autonomous steps per user message

let heartbeatCount = 0;
let innerMonologue: string[] = [];

export function resetHeartbeat(): void {
  heartbeatCount = 0;
  innerMonologue = [];
}

export function getHeartbeatCount(): number {
  return heartbeatCount;
}

export function incrementHeartbeat(): number {
  return ++heartbeatCount;
}

export function canHeartbeat(): boolean {
  return heartbeatCount < MAX_HEARTBEATS;
}

export function addThought(thought: string): void {
  innerMonologue.push(thought);
}

export function getInnerMonologue(): string[] {
  return [...innerMonologue];
}

export function formatHeartbeatStatus(): string {
  if (heartbeatCount === 0) return "";
  return chalk.dim(`  💓 ${heartbeatCount} heartbeats`);
}
