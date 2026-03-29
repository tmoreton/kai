import { execSync } from "child_process";
import path from "path";
import { getCwd } from "./bash.js";
import { glob as globFn } from "glob";

export async function globTool(args: {
  pattern: string;
  path?: string;
}): Promise<string> {
  const searchDir = args.path
    ? path.resolve(getCwd(), args.path)
    : getCwd();

  try {
    const matches = await globFn(args.pattern, {
      cwd: searchDir,
      nodir: true,
      dot: false,
      ignore: ["node_modules/**", ".git/**", "dist/**"],
    });

    if (matches.length === 0) {
      return "No files matched the pattern.";
    }

    return matches.slice(0, 100).join("\n");
  } catch (err: any) {
    return `Error: ${err.message}`;
  }
}

export async function grepTool(args: {
  pattern: string;
  path?: string;
  include?: string;
  context?: number;
  ignore_case?: boolean;
}): Promise<string> {
  const searchPath = args.path
    ? path.resolve(getCwd(), args.path)
    : getCwd();

  try {
    const flags = ["-rn", "--color=never"];
    if (args.ignore_case) flags.push("-i");
    if (args.context) flags.push(`-C${args.context}`);
    if (args.include) flags.push(`--include=${args.include}`);

    // Exclude common noisy dirs
    flags.push("--exclude-dir=node_modules");
    flags.push("--exclude-dir=.git");
    flags.push("--exclude-dir=dist");

    const cmd = `grep ${flags.join(" ")} ${JSON.stringify(args.pattern)} ${JSON.stringify(searchPath)}`;
    const result = execSync(cmd, {
      maxBuffer: 5 * 1024 * 1024,
      timeout: 15000,
      encoding: "utf-8",
    });

    const lines = result.trim().split("\n");
    if (lines.length > 100) {
      return (
        lines.slice(0, 100).join("\n") +
        `\n... (${lines.length} matches total, showing first 100)`
      );
    }
    return result.trim() || "No matches found.";
  } catch (err: any) {
    if (err.status === 1) return "No matches found.";
    return `Error: ${err.message}`;
  }
}
