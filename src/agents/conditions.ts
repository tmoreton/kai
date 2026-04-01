import { exec } from "child_process";
import fs from "fs";
import { expandHome } from "../utils.js";
import { archivalSearch } from "../archival.js";

/**
 * Heartbeat Condition Evaluator
 *
 * Evaluates conditions that determine whether an agent should be triggered.
 * Supports: shell commands, file change detection, and webhook polling.
 */

export interface HeartbeatCondition {
  type: "shell" | "file_changed" | "webhook" | "memory" | "threshold" | "trend";
  check: string; // shell command, file path, URL, query, key, etc.
  expected?: string; // expected output (truthy if omitted)
  threshold?: number; // numeric threshold for comparison
  operator?: ">" | "<" | ">=" | "<=" | "==="; // comparison operator
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

// Track previous values for trend detection
const trendValues = new Map<string, number>();

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
    case "memory":
      return evaluateMemoryCondition(condition);
    case "threshold":
      return evaluateThresholdCondition(condition);
    case "trend":
      return evaluateTrendCondition(condition);
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

/**
 * Memory condition: check if archival contains knowledge matching a query.
 * Useful for triggering agents when certain topics/concepts are in memory.
 */
async function evaluateMemoryCondition(condition: HeartbeatCondition): Promise<ConditionResult> {
  try {
    const result = archivalSearch({ query: condition.check, limit: 1 });
    const hasMatch = result !== "No archival memories found." && result !== "No matching archival memories found.";
    return { met: hasMatch, value: hasMatch ? result : "no match", condition };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { met: false, value: `error: ${msg}`, condition };
  }
}

/**
 * Threshold condition: parse output from command/URL as number and compare.
 */
async function evaluateThresholdCondition(condition: HeartbeatCondition): Promise<ConditionResult> {
  if (condition.threshold === undefined) {
    return { met: false, value: "threshold required", condition };
  }

  // Try to get a numeric value - either from a shell command or the check string itself
  let value: number;
  try {
    if (condition.check.match(/^https?:\/\//)) {
      // It's a URL - poll it and parse response as number
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(condition.check, { signal: controller.signal });
      clearTimeout(timeout);
      const body = await response.text();
      value = parseFloat(body.trim());
    } else {
      // Treat as a shell command that outputs a number
      const output = await new Promise<string>((resolve, reject) => {
        exec(condition.check, { timeout: 10_000 }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim());
        });
      });
      value = parseFloat(output);
    }

    if (isNaN(value)) {
      return { met: false, value: "not a number", condition };
    }

    const operator = condition.operator || ">";
    let met = false;
    switch (operator) {
      case ">": met = value > condition.threshold; break;
      case "<": met = value < condition.threshold; break;
      case ">=": met = value >= condition.threshold; break;
      case "<=": met = value <= condition.threshold; break;
      case "===": met = value === condition.threshold; break;
    }

    return { met, value: `${value} ${operator} ${condition.threshold}`, condition };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { met: false, value: `error: ${msg}`, condition };
  }
}

/**
 * Trend condition: detect if a numeric value is increasing over time.
 * The check should output a number (via shell command or URL).
 */
async function evaluateTrendCondition(condition: HeartbeatCondition): Promise<ConditionResult> {
  const key = `trend-${condition.check}`;

  try {
    let value: number;
    if (condition.check.match(/^https?:\/\//)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(condition.check, { signal: controller.signal });
      clearTimeout(timeout);
      const body = await response.text();
      value = parseFloat(body.trim());
    } else {
      const output = await new Promise<string>((resolve, reject) => {
        exec(condition.check, { timeout: 10_000 }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim());
        });
      });
      value = parseFloat(output);
    }

    if (isNaN(value)) {
      return { met: false, value: "not a number", condition };
    }

    const lastValue = trendValues.get(key);
    trendValues.set(key, value);

    // First check establishes baseline
    if (lastValue === undefined) {
      return { met: false, value: `baseline: ${value}`, condition };
    }

    // Trigger if value increased (trending up)
    const trendExpected = condition.expected || "up";
    let met = false;
    if (trendExpected === "up") {
      met = value > lastValue;
    } else if (trendExpected === "down") {
      met = value < lastValue;
    } else if (trendExpected === "changed") {
      met = value !== lastValue;
    }

    return { met, value: `${lastValue} → ${value}`, condition };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { met: false, value: `error: ${msg}`, condition };
  }
}
