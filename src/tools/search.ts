import { execSync } from "child_process";
import path from "path";
import { getCwd } from "./bash.js";
import { glob as globFn } from "glob";
import { EXCLUDED_DIRS, MAX_SEARCH_RESULTS } from "../constants.js";

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
      ignore: EXCLUDED_DIRS.map((d) => `${d}/**`),
    });

    if (matches.length === 0) {
      return "No files matched the pattern.";
    }

    return matches.slice(0, MAX_SEARCH_RESULTS).join("\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error: ${msg}`;
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

    for (const dir of EXCLUDED_DIRS) {
      flags.push(`--exclude-dir=${dir}`);
    }

    const cmd = `grep ${flags.join(" ")} ${JSON.stringify(args.pattern)} ${JSON.stringify(searchPath)}`;
    const result = execSync(cmd, {
      maxBuffer: 5 * 1024 * 1024,
      timeout: 15000,
      encoding: "utf-8",
    });

    const lines = result.trim().split("\n");
    if (lines.length > MAX_SEARCH_RESULTS) {
      return (
        lines.slice(0, MAX_SEARCH_RESULTS).join("\n") +
        `\n... (${lines.length} matches total, showing first ${MAX_SEARCH_RESULTS})`
      );
    }
    return result.trim() || "No matches found.";
  } catch (err: unknown) {
    if (err && typeof err === "object" && "status" in err && err.status === 1) {
      return "No matches found.";
    }
    const msg = err instanceof Error ? err.message : String(err);
    return `Error: ${msg}`;
  }
}
