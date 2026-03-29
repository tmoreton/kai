import fs from "fs";
import path from "path";
import { ensureKaiDir } from "./config.js";

/**
 * Custom Slash Commands
 *
 * Users create markdown files in:
 *   .kai/commands/   (project-level, higher priority)
 *   ~/.kai/commands/  (global)
 *
 * File name becomes the command: review.md → /review
 * The file content is injected as the user prompt.
 * Supports {{args}} placeholder for arguments passed after the command.
 */

export interface CustomCommand {
  name: string;
  description: string;
  prompt: string;
  source: "project" | "global";
  filePath: string;
}

function globalCommandsDir(): string {
  return path.join(ensureKaiDir(), "commands");
}

function projectCommandsDir(): string {
  return path.resolve(process.cwd(), ".kai/commands");
}

function loadCommandsFromDir(dir: string, source: "project" | "global"): CustomCommand[] {
  if (!fs.existsSync(dir)) return [];

  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const filePath = path.join(dir, f);
        const name = f.replace(/\.md$/, "");
        const content = fs.readFileSync(filePath, "utf-8");

        // Extract description from first line if it starts with #
        const firstLine = content.split("\n")[0];
        const description = firstLine.startsWith("#")
          ? firstLine.replace(/^#+\s*/, "").trim()
          : `Custom command from ${source}`;

        return { name, description, prompt: content, source, filePath };
      });
  } catch {
    return [];
  }
}

/**
 * Load all custom commands. Project commands override global ones.
 */
export function loadCustomCommands(): CustomCommand[] {
  const globalCmds = loadCommandsFromDir(globalCommandsDir(), "global");
  const projectCmds = loadCommandsFromDir(projectCommandsDir(), "project");

  // Project commands override global by name
  const merged = new Map<string, CustomCommand>();
  for (const cmd of globalCmds) merged.set(cmd.name, cmd);
  for (const cmd of projectCmds) merged.set(cmd.name, cmd);

  return [...merged.values()];
}

/**
 * Find a custom command by name.
 */
export function findCustomCommand(name: string): CustomCommand | undefined {
  const commands = loadCustomCommands();
  return commands.find((c) => c.name === name);
}

/**
 * Resolve a custom command with arguments.
 * Replaces {{args}} in the prompt with the provided arguments.
 */
export function resolveCommand(cmd: CustomCommand, args: string): string {
  let prompt = cmd.prompt;
  prompt = prompt.replace(/\{\{args\}\}/g, args || "");
  prompt = prompt.replace(/\{\{cwd\}\}/g, process.cwd());
  prompt = prompt.replace(/\{\{date\}\}/g, new Date().toISOString().split("T")[0]);
  return prompt.trim();
}

/**
 * Format custom commands for help display.
 */
export function formatCustomCommands(): string {
  const commands = loadCustomCommands();
  if (commands.length === 0) return "";

  const lines = commands.map(
    (c) => `    /${c.name.padEnd(14)} ${c.description} (${c.source})`
  );
  return "\n  Custom Commands:\n" + lines.join("\n");
}
