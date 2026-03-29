import { exec } from "child_process";
import path from "path";
import {
  BASH_DEFAULT_TIMEOUT,
  BASH_MAX_TIMEOUT,
  BASH_MAX_BUFFER,
} from "../constants.js";

let cwd = process.cwd();

export function getCwd(): string {
  return cwd;
}

export function setCwd(dir: string): void {
  cwd = path.resolve(dir);
}

export async function bashTool(args: {
  command: string;
  timeout?: number;
}): Promise<string> {
  const timeout = Math.min(args.timeout || BASH_DEFAULT_TIMEOUT, BASH_MAX_TIMEOUT);

  return new Promise((resolve) => {
    const child = exec(args.command, {
      cwd,
      timeout,
      maxBuffer: BASH_MAX_BUFFER,
      shell: "/bin/zsh",
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data;
    });

    child.stderr?.on("data", (data) => {
      stderr += data;
    });

    child.on("close", (code) => {
      // Track cd commands to persist working directory
      // Handles: cd path, cd "path with spaces", cd 'path'
      const cdMatch = args.command.match(
        /^cd\s+["']?([^"';&|]+?)["']?\s*(?:&&|;|$)/
      );
      if (cdMatch && code === 0) {
        const target = cdMatch[1].trim();
        try {
          const resolved = path.resolve(cwd, target);
          // Verify it's a real directory before changing
          setCwd(resolved);
        } catch {
          // Ignore invalid paths
        }
      }

      let result = "";
      if (stdout.trim()) result += stdout.trim();
      if (stderr.trim()) {
        if (result) result += "\n";
        result += stderr.trim();
      }
      if (code !== 0 && code !== null) {
        result += `\n(exit code: ${code})`;
      }
      resolve(result || "(no output)");
    });

    child.on("error", (err) => {
      resolve(`Error executing command: ${err.message}`);
    });
  });
}
