import * as readline from "readline";
import chalk from "chalk";
import { getConfig } from "./config.js";

export type PermissionRule = {
  tool: string;
  pattern?: string;
  action: "allow" | "deny" | "ask";
};

// Default rules: dangerous operations require confirmation
const DEFAULT_RULES: PermissionRule[] = [
  // Always allow read-only tools
  { tool: "read_file", action: "allow" },
  { tool: "glob", action: "allow" },
  { tool: "grep", action: "allow" },

  // Ask for write operations
  { tool: "write_file", action: "ask" },
  { tool: "edit_file", action: "ask" },

  // Dangerous bash patterns — block destructive system commands
  { tool: "bash", pattern: "rm -rf /", action: "deny" },
  { tool: "bash", pattern: "rm -rf ~", action: "deny" },
  { tool: "bash", pattern: "rm -rf /*", action: "deny" },
  { tool: "bash", pattern: "> /dev/sd", action: "deny" },
  { tool: "bash", pattern: "> /dev/nv", action: "deny" },
  { tool: "bash", pattern: "mkfs", action: "deny" },
  { tool: "bash", pattern: "dd if=", action: "deny" },
  { tool: "bash", pattern: ":(){ :|:& };:", action: "deny" },
  { tool: "bash", pattern: "chmod -R 777 /", action: "deny" },
  { tool: "bash", pattern: "shutdown", action: "deny" },
  { tool: "bash", pattern: "reboot", action: "deny" },
  { tool: "bash", pattern: "curl|sh", action: "deny" },
  { tool: "bash", pattern: "curl|bash", action: "deny" },
  { tool: "bash", pattern: "wget|sh", action: "deny" },

  // Git destructive ops need confirmation
  { tool: "bash", pattern: "git push --force", action: "ask" },
  { tool: "bash", pattern: "git reset --hard", action: "ask" },
  { tool: "bash", pattern: "git clean -f", action: "ask" },
  { tool: "bash", pattern: "git branch -D", action: "ask" },

  // General bash is allowed
  { tool: "bash", action: "allow" },

  // Git tools — read is safe, write needs confirmation
  { tool: "git_log", action: "allow" },
  { tool: "git_diff_session", action: "allow" },
  { tool: "git_undo", action: "ask" },
  { tool: "git_stash", action: "ask" },

  // Web tools — always allow
  { tool: "web_fetch", action: "allow" },
  { tool: "web_search", action: "allow" },

  // Image generation — always allow
  { tool: "generate_image", action: "allow" },
];

let permissionMode: "default" | "auto" | "deny_all" = "auto";
let sessionAllowed = new Set<string>();

export function setPermissionMode(mode: "default" | "auto" | "deny_all") {
  permissionMode = mode;
}

export function getPermissionMode() {
  return permissionMode;
}

export function getPermissionRules(): PermissionRule[] {
  const config = getConfig();
  const customRules = config.permissions || [];
  return [...customRules, ...DEFAULT_RULES];
}

function matchRule(
  toolName: string,
  args: Record<string, unknown>,
  rule: PermissionRule
): boolean {
  if (rule.tool !== toolName) return false;
  if (!rule.pattern) return true;

  // For bash, match against the command
  if (toolName === "bash") {
    const cmd = String(args.command || "");
    return cmd.includes(rule.pattern);
  }

  // For file tools, match against file path
  const filePath = String(args.file_path || "");
  return filePath.includes(rule.pattern);
}

export async function checkPermission(
  toolName: string,
  args: Record<string, unknown>
): Promise<"allow" | "deny"> {
  if (permissionMode === "auto") return "allow";

  const rules = getPermissionRules();

  // Check rules in order (first match wins)
  for (const rule of rules) {
    if (matchRule(toolName, args, rule)) {
      if (rule.action === "allow") return "allow";
      if (rule.action === "deny") {
        console.log(
          chalk.red(`  ✗ Blocked: ${toolName} — matches deny rule`)
        );
        return "deny";
      }
      if (rule.action === "ask") {
        // Check if already approved this session
        const key = `${toolName}:${summarizeForPermission(toolName, args)}`;
        if (sessionAllowed.has(key)) return "allow";

        const approved = await promptUser(toolName, args);
        if (approved) {
          sessionAllowed.add(key);
          return "allow";
        }
        return "deny";
      }
    }
  }

  // Default: allow
  return "allow";
}

function summarizeForPermission(
  toolName: string,
  args: Record<string, unknown>
): string {
  switch (toolName) {
    case "bash":
      return String(args.command || "").substring(0, 100);
    case "write_file":
    case "edit_file":
    case "read_file":
      return String(args.file_path || "");
    default:
      return JSON.stringify(args).substring(0, 80);
  }
}

function promptUser(
  toolName: string,
  args: Record<string, unknown>
): Promise<boolean> {
  return new Promise((resolve) => {
    const summary = summarizeForPermission(toolName, args);
    console.log(
      chalk.yellow(`\n  ⚠ Permission required: ${toolName}`)
    );
    console.log(chalk.dim(`    ${summary}`));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(
      chalk.yellow("  Allow? [y/N/a(always)] "),
      (answer) => {
        rl.close();
        const a = answer.trim().toLowerCase();
        if (a === "a" || a === "always") {
          permissionMode = "auto";
          console.log(chalk.dim("  Auto-approve enabled for this session.\n"));
          resolve(true);
        } else {
          resolve(a === "y" || a === "yes");
        }
      }
    );
  });
}
