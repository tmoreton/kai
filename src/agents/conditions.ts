import { exec } from "child_process";
import fs from "fs";
import { expandHome } from "../utils.js";

/**
 * Heartbeat Condition Evaluator
 *
 * Evaluates conditions that determine whether an agent should be triggered.
 * Supports: shell commands, file change detection, and webhook polling.
 */

export interface HeartbeatCondition {
  type: "shell" | "file_changed" | "webhook";
  check: string; // shell command, file path, or URL
  expected?: string; // expected output (truthy if omitted)
}

export interface HeartbeatConfig {
  enabled: boolean;
  interval_ms?: number; // default 60000 (1 min)
  cooldown_ms?: number; // default 300000 (5 min)
  conditions: HeartbeatCondition[];
}

export interface ConditionResult {
  met: boolean;
  value: any;
  condition: HeartbeatCondition;
}

// Track file modification times for file_changed conditions
const fileMtimes = new Map<string, number>();

/**
 * Evaluate a single heartbeat condition.
 */
export async function evaluateCondition(condition: HeartbeatCondition): Promise<ConditionResult> {
  switch (condition.type) {
    case "shell":
      return evaluateShellCondition(condition);
    case "file_changed":
      return evaluateFileChangedCondition(condition);
    case "webhook":
      return evaluateWebhookCondition(condition);
    default:
      return { met: false, value: null, condition };
  }
}

/**
 * Evaluate all conditions. Returns results for each.
 */
export async function evaluateConditions(
  conditions: HeartbeatCondition[]
): Promise<ConditionResult[]> {
  return Promise.all(conditions.map(evaluateCondition));
}

/**
 * Shell condition: run a command, truthy if exit code 0 and non-empty output.
 */
async function evaluateShellCondition(condition: HeartbeatCondition): Promise<ConditionResult> {
  return new Promise((resolve) => {
    exec(condition.check, { timeout: 10_000 }, (err, stdout) => {
      const output = stdout?.trim() || "";
      let met = !err && output.length > 0;

      // If expected value specified, compare output
      if (met && condition.expected) {
        met = output === condition.expected;
      }

      resolve({ met, value: output, condition });
    });
  });
}

/**
 * File changed condition: check if file mtime has changed since last check.
 */
async function evaluateFileChangedCondition(condition: HeartbeatCondition): Promise<ConditionResult> {
  const filePath = expandHome(condition.check);

  if (!fs.existsSync(filePath)) {
    return { met: false, value: "file not found", condition };
  }

  const stat = fs.statSync(filePath);
  const currentMtime = stat.mtimeMs;
  const lastMtime = fileMtimes.get(filePath);

  // First check: store baseline, don't trigger
  if (lastMtime === undefined) {
    fileMtimes.set(filePath, currentMtime);
    return { met: false, value: "baseline set", condition };
  }

  const changed = currentMtime !== lastMtime;
  fileMtimes.set(filePath, currentMtime);

  return { met: changed, value: changed ? "modified" : "unchanged", condition };
}

/**
 * Webhook condition: poll a URL, truthy if response is 200 and body is non-empty.
 */
async function evaluateWebhookCondition(condition: HeartbeatCondition): Promise<ConditionResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(condition.check, { signal: controller.signal });
    clearTimeout(timeout);

    const body = await response.text();
    let met = response.ok && body.trim().length > 0;

    if (met && condition.expected) {
      met = body.trim() === condition.expected;
    }

    return { met, value: body.trim().substring(0, 500), condition };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { met: false, value: `error: ${msg}`, condition };
  }
}
