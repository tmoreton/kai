import { exec, spawn } from "child_process";
import path from "path";
import fs from "fs";
import {
  BASH_DEFAULT_TIMEOUT,
  BASH_MAX_TIMEOUT,
  BASH_MAX_BUFFER,
} from "../constants.js";
import chalk from "chalk";

let cwd = process.cwd();

// Track background processes so we can clean them up
const backgroundProcesses: { pid: number; label: string }[] = [];

export function getCwd(): string {
  return cwd;
}

export function setCwd(dir: string): void {
  cwd = path.resolve(dir);
}

export function cleanupBackgroundProcesses(): void {
  for (const proc of backgroundProcesses) {
    try {
      process.kill(proc.pid);
    } catch {
      // already dead
    }
  }
  backgroundProcesses.length = 0;
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
      shell: "/bin/bash", // Use bash instead of zsh — more predictable for scripting
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on("data", (data: string | Buffer) => {
      stdoutChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    });

    child.stderr?.on("data", (data: string | Buffer) => {
      stderrChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    });

    child.on("close", (code) => {
      let stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");

      // Extract new cwd from wrapped command output
      if (hasCd && code === 0 && stdout.includes(marker)) {
        const parts = stdout.split(marker);
        const newCwd = parts[1]?.trim();
        if (newCwd && fs.existsSync(newCwd)) {
          setCwd(newCwd);
        }
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

/**
 * Start a background process (like a dev server) that persists.
 * Returns immediately with the PID and initial output.
 */
export async function bashBackgroundTool(args: {
  command: string;
  wait_seconds?: number;
}): Promise<string> {
  const waitMs = (args.wait_seconds || 3) * 1000;

  return new Promise((resolve) => {
    const child = spawn("/bin/bash", ["-c", args.command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    const outputChunks: Buffer[] = [];
    const pid = child.pid;

    child.stdout?.on("data", (data: Buffer) => {
      outputChunks.push(data);
    });

    child.stderr?.on("data", (data: Buffer) => {
      outputChunks.push(data);
    });

    // Unref so it doesn't block process exit
    child.unref();

    if (pid) {
      backgroundProcesses.push({ pid, label: args.command.substring(0, 60) });
    }

    // Wait a bit for initial output (e.g., "Server ready on port 5173")
    setTimeout(() => {
      const output = Buffer.concat(outputChunks).toString("utf-8").trim();
      const result = output || "(started in background)";
      resolve(
        `Background process started (PID: ${pid})\n${result}`
      );
    }, waitMs);
  });
}
