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
 */

export interface HookConfig {
  [trigger: string]: string; // "before:tool_name" or "after:tool_name" → shell command
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

/**
 * Run hooks for a given trigger point.
 * Returns true if all hooks succeeded, false if any failed.
 */
export async function runHooks(
  trigger: "before" | "after",
  toolName: string,
  args: Record<string, unknown>
): Promise<boolean> {
  const hooks = getHooks();
  const key = `${trigger}:${toolName}`;
  const command = hooks[key];

  if (!command) return true;

  const resolved = interpolateHook(command, args);

  try {
    await new Promise<void>((resolve, reject) => {
      exec(resolved, {
        cwd: getCwd(),
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      }, (err, stdout, stderr) => {
        if (err) {
          console.log(chalk.yellow(`  hook ${key}: ${err.message}`));
          reject(err);
        } else {
          if (stdout.trim()) {
            console.log(chalk.dim(`  hook ${key}: ${stdout.trim().substring(0, 100)}`));
          }
          resolve();
        }
      });
    });
    return true;
  } catch {
    return false;
  }
}
