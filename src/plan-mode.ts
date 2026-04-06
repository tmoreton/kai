/**
 * Plan Mode
 *
 * When enabled, restricts tool usage to read-only operations.
 * This prevents premature code changes while the model is still
 * researching and planning an approach.
 */

let _planMode = false;
let _currentPlan: string | null = null;

const READ_ONLY_TOOLS = new Set([
  "read_file",
  "glob",
  "grep",
  "web_fetch",
  "web_search",
  "core_memory_read",
  "recall_search",
  "archival_search",
  "archival_insert",
  "spawn_agent", // explorer/planner agents are allowed
  "spawn_swarm", // swarm of read-only agents allowed
  "git_log",
  "git_diff_session",
]);

export function isPlanMode(): boolean {
  return _planMode;
}

export function setPlanMode(enabled: boolean): void {
  _planMode = enabled;
  if (!enabled) {
    // Clear plan when exiting
    _currentPlan = null;
  }
}

export function togglePlanMode(): boolean {
  _planMode = !_planMode;
  return _planMode;
}

/**
 * Get the current plan being developed in plan mode.
 */
export function getCurrentPlan(): string | null {
  return _currentPlan;
}

/**
 * Set/update the current plan.
 */
export function setCurrentPlan(plan: string): void {
  _currentPlan = plan;
}

/**
 * Check if a tool is allowed in plan mode.
 * In plan mode, only read-only and analysis tools are permitted.
 */
export function isToolAllowedInPlanMode(toolName: string): boolean {
  if (!_planMode) return true;
  return READ_ONLY_TOOLS.has(toolName);
}
