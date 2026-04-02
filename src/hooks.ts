import { exec } from "child_process";
import { getConfig } from "./config.js";
import { getCwd } from "./tools/bash.js";
import chalk from "chalk";

/**
 * Hooks System
 *
 * Run shell commands before/after specific tool calls.
 * Configured in settings.json:
 *
 * {
 *   "hooks": {
 *     "after:write_file": "prettier --write {{file_path}}",
 *     "after:edit_file": "prettier --write {{file_path}}",
 *     "before:bash": "echo 'Running: {{command}}'",
 *     "after:commit": "git push"
 *   }
 * }
 *
 * Supports {{arg_name}} interpolation from tool arguments.
 *
 * Hook behavior:
 * - before hooks: if the command exits non-zero, the tool call is DENIED
 * - after hooks: stdout is captured and can override the tool result
 *   Use the "override:" prefix in settings to enable output override:
 *   "after:write_file:override": "cat {{file_path}} | wc -l"
 */

export interface HookConfig {
  [trigger: string]: string; // "before:tool_name" or "after:tool_name" → shell command
}

export interface HookResult {
  allowed: boolean;      // false = tool call should be denied
  reason?: string;       // denial reason (from before hooks)
  output?: string;       // captured stdout (from after hooks)
  overrideOutput?: string; // if set, replaces the tool result
}

function getHooks(): HookConfig {
  const config = getConfig();
  return config.hooks || {};
}

function interpolateHook(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = args[key];
    return val !== undefined ? String(val) : "";
  });
}

function runShellHook(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(command, {
      cwd: getCwd(),
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    }, (err, stdout, stderr) => {
      resolve({
        exitCode: err ? (err as any).code || 1 : 0,
        stdout: stdout?.trim() || "",
        stderr: stderr?.trim() || "",
      });
    });
  });
}

/**
 * Run before-hooks for a tool call.
 * Returns { allowed: false, reason } if the hook denies execution.
 */
export async function runBeforeHooks(
  toolName: string,
  args: Record<string, unknown>
): Promise<HookResult> {
  const hooks = getHooks();
  const key = `before:${toolName}`;
  const command = hooks[key];

  if (!command) return { allowed: true };

  const resolved = interpolateHook(command, args);
  const result = await runShellHook(resolved);

  if (result.exitCode !== 0) {
    const reason = result.stderr || result.stdout || `Hook "${key}" denied execution (exit code ${result.exitCode})`;
    console.log(chalk.yellow(`  hook ${key}: DENIED — ${reason.substring(0, 100)}`));
    return { allowed: false, reason };
  }

  if (result.stdout) {
    console.log(chalk.dim(`  hook ${key}: ${result.stdout.substring(0, 100)}`));
  }

  return { allowed: true, output: result.stdout || undefined };
}

/**
 * Run after-hooks for a tool call.
 * Returns { overrideOutput } if the hook provides output override.
 */
export async function runAfterHooks(
  toolName: string,
  args: Record<string, unknown>,
  toolResult: string
): Promise<HookResult> {
  const hooks = getHooks();
  const key = `after:${toolName}`;
  const overrideKey = `after:${toolName}:override`;
  const command = hooks[key];
  const overrideCommand = hooks[overrideKey];

  const result: HookResult = { allowed: true };

  // Run regular after hook (side-effect only)
  if (command) {
    const resolved = interpolateHook(command, { ...args, _result: toolResult });
    const hookResult = await runShellHook(resolved);

    if (hookResult.stdout) {
      console.log(chalk.dim(`  hook ${key}: ${hookResult.stdout.substring(0, 100)}`));
      result.output = hookResult.stdout;
    }
    if (hookResult.exitCode !== 0 && hookResult.stderr) {
      console.log(chalk.yellow(`  hook ${key}: ${hookResult.stderr.substring(0, 100)}`));
    }
  }

  // Run override hook — its stdout replaces the tool result
  if (overrideCommand) {
    const resolved = interpolateHook(overrideCommand, { ...args, _result: toolResult });
    const hookResult = await runShellHook(resolved);

    if (hookResult.exitCode === 0 && hookResult.stdout) {
      result.overrideOutput = hookResult.stdout;
      console.log(chalk.dim(`  hook ${overrideKey}: output overridden`));
    }
  }

  return result;
}

/**
 * Legacy compatibility — runs hooks without deny/override semantics.
 * Used by code that hasn't been updated to the new hook flow.
 */
export async function runHooks(
  trigger: "before" | "after",
  toolName: string,
  args: Record<string, unknown>
): Promise<boolean> {
  if (trigger === "before") {
    const result = await runBeforeHooks(toolName, args);
    return result.allowed;
  } else {
    await runAfterHooks(toolName, args, "");
    return true;
  }
}
