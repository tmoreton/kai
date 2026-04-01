/**
 * Plan Mode
 *
 * When enabled, restricts tool usage to read-only operations.
 * This prevents premature code changes while the model is still
 * researching and planning an approach.
 */

let _planMode = false;

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
  "task_create",
  "task_update",
  "task_list",
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
}

export function togglePlanMode(): boolean {
  _planMode = !_planMode;
  return _planMode;
}

/**
 * Check if a tool is allowed in plan mode.
 * In plan mode, only read-only and analysis tools are permitted.
 */
export function isToolAllowedInPlanMode(toolName: string): boolean {
  if (!_planMode) return true;
  return READ_ONLY_TOOLS.has(toolName);
}
