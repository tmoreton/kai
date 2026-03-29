import { exec, execSync } from "child_process";
import path from "path";
import fs from "fs";
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

  // If the command contains cd, wrap it to capture the final working directory
  const hasCd = /\bcd\s/.test(args.command);
  const marker = `__KAI_CWD_${Date.now()}__`;
  const wrappedCommand = hasCd
    ? `${args.command} && echo "${marker}" && pwd`
    : args.command;

  return new Promise((resolve) => {
    const child = exec(wrappedCommand, {
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
      // Extract new cwd from wrapped command output
      if (hasCd && code === 0 && stdout.includes(marker)) {
        const parts = stdout.split(marker);
        const newCwd = parts[1]?.trim();
        if (newCwd && fs.existsSync(newCwd)) {
          setCwd(newCwd);
        }
        // Remove marker and pwd output from visible output
        stdout = parts[0];
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
