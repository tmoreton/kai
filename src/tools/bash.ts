import { execSync, exec } from "child_process";
import path from "path";

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
  const timeout = Math.min(args.timeout || 30000, 120000);

  return new Promise((resolve) => {
    const child = exec(args.command, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB
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
      const cdMatch = args.command.match(
        /^cd\s+(.+?)(?:\s*&&|\s*;|\s*$)/
      );
      if (cdMatch && code === 0) {
        const target = cdMatch[1].replace(/["']/g, "").trim();
        setCwd(path.resolve(cwd, target));
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
      resolve(`Error: ${err.message}`);
    });
  });
}
