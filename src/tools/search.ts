import { execFileSync } from "child_process";
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

  // Safety: prevent scanning massive directories like $HOME
  const homeDir = process.env.HOME || "/Users";
  if (searchDir === homeDir || searchDir === "/") {
    return "Error: Cannot glob from home directory or root — too many files. Use a more specific path.";
  }

  try {
    const matches = await globFn(args.pattern, {
      cwd: searchDir,
      nodir: true,
      dot: false,
      ignore: EXCLUDED_DIRS.map((d) => `${d}/**`),
      maxDepth: 10,
      signal: AbortSignal.timeout(10000),
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

/** Check if ripgrep is available on the system */
let _rgAvailable: boolean | null = null;

function hasRipgrep(): boolean {
  if (_rgAvailable !== null) return _rgAvailable;
  try {
    execFileSync("rg", ["--version"], { timeout: 3000, encoding: "utf-8" });
    _rgAvailable = true;
  } catch {
    _rgAvailable = false;
  }
  return _rgAvailable;
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
    if (hasRipgrep()) {
      return runRipgrep(args, searchPath);
    }
    return runSystemGrep(args, searchPath);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "status" in err && err.status === 1) {
      return "No matches found.";
    }
    // If grep fails due to regex syntax (e.g. unbalanced braces), retry with fixed-string mode
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("braces not balanced") || msg.includes("Invalid regex") || msg.includes("Unmatched")) {
      try {
        return runSystemGrep({ ...args, _fixedString: true } as any, searchPath);
      } catch (retryErr: unknown) {
        if (retryErr && typeof retryErr === "object" && "status" in retryErr && retryErr.status === 1) {
          return "No matches found.";
        }
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        return `Error: ${retryMsg}`;
      }
    }
    return `Error: ${msg}`;
  }
}

function runRipgrep(
  args: { pattern: string; include?: string; context?: number; ignore_case?: boolean },
  searchPath: string
): string {
  const rgArgs = ["-n", "--no-heading", "--color=never"];
  if (args.ignore_case) rgArgs.push("-i");
  if (args.context) rgArgs.push(`-C`, String(args.context));
  if (args.include) rgArgs.push("--glob", args.include);

  // ripgrep respects .gitignore by default, but also exclude common dirs
  for (const dir of EXCLUDED_DIRS) {
    rgArgs.push("--glob", `!${dir}`);
  }

  rgArgs.push("--", args.pattern, searchPath);

  const result = execFileSync("rg", rgArgs, {
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
}

function runSystemGrep(
  args: { pattern: string; include?: string; context?: number; ignore_case?: boolean; _fixedString?: boolean },
  searchPath: string
): string {
  const grepArgs = ["-rn", "--color=never"];
  if (args._fixedString) grepArgs.push("-F");
  if (args.ignore_case) grepArgs.push("-i");
  if (args.context) grepArgs.push(`-C${args.context}`);
  if (args.include) grepArgs.push(`--include=${args.include}`);

  for (const dir of EXCLUDED_DIRS) {
    grepArgs.push(`--exclude-dir=${dir}`);
  }

  grepArgs.push("--", args.pattern, searchPath);

  const result = execFileSync("grep", grepArgs, {
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
}
