import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import type { ParsedSource, LoggerInterface } from "../types/index.js";

/**
 * Default silent logger
 */
const silentLogger: LoggerInterface = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Parse a source string into its components
 *
 * Supported formats:
 * - npm:@scope/package@version  → npm package
 * - @scope/package@version      → npm package (shorthand)
 * - github:owner/repo           → GitHub repo
 * - git:https://...             → Git URL
 * - ./local-path                → Local path
 */
export function parseSource(source: string): ParsedSource {
  // NPM prefix
  if (source.startsWith("npm:")) {
    const rest = source.slice(4);
    return parseNpmSource(rest);
  }

  // GitHub prefix
  if (source.startsWith("github:")) {
    const rest = source.slice(7);
    const match = rest.match(/^([^/]+)\/([^/]+)(?:@(.+))?$/);
    if (!match) {
      throw new Error(`Invalid GitHub source format: ${source}. Expected: github:owner/repo[@ref]`);
    }
    return {
      type: "github",
      source,
      name: match[2],
      owner: match[1],
      repo: match[2],
      version: match[3],
    };
  }

  // Git prefix
  if (source.startsWith("git:")) {
    const url = source.slice(4);
    // Extract name from URL
    const nameMatch = url.match(/\/([^/]+)(?:\.git)?$/);
    const name = nameMatch?.[1] || "unknown";
    return {
      type: "git",
      source,
      name,
      path: url,
    };
  }

  // Local path (starts with . or /)
  if (source.startsWith(".") || source.startsWith("/")) {
    const resolved = path.resolve(source);
    const name = path.basename(resolved);
    return {
      type: "local",
      source,
      name,
      path: resolved,
    };
  }

  // Assume NPM shorthand (e.g., "@kai/skill-browser" or "skill-browser")
  return parseNpmSource(source);
}

/**
 * Parse NPM package source
 */
function parseNpmSource(source: string): ParsedSource {
  // Handle scoped packages: @scope/name@version
  const scopedMatch = source.match(/^(@[^/]+\/[^@]+)(?:@(.+))?$/);
  if (scopedMatch) {
    return {
      type: "npm",
      source,
      name: scopedMatch[1],
      version: scopedMatch[2],
    };
  }

  // Handle unscoped: name@version
  const match = source.match(/^([^@]+)(?:@(.+))?$/);
  if (match) {
    return {
      type: "npm",
      source,
      name: match[1],
      version: match[2],
    };
  }

  throw new Error(`Invalid NPM source format: ${source}`);
}

/**
 * NPM Registry - install skills from npm packages
 */
export class NpmRegistry {
  private logger: LoggerInterface;

  constructor(logger: LoggerInterface = silentLogger) {
    this.logger = logger;
  }

  /**
   * Download and extract an npm package to a temp directory
   */
  async download(
    parsed: ParsedSource,
    targetDir: string
  ): Promise<string> {
    if (parsed.type !== "npm") {
      throw new Error(`NpmRegistry can only handle npm sources, got: ${parsed.type}`);
    }

    const packageSpec = parsed.version
      ? `${parsed.name}@${parsed.version}`
      : parsed.name;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kai-skill-"));

    try {
      this.logger.info(`Downloading ${packageSpec} from npm...`);

      // Use npm pack to download tarball
      execSync(`npm pack ${packageSpec} --pack-destination ${tempDir}`, {
        stdio: "pipe",
        timeout: 60000,
      });

      // Find the tarball
      const files = fs.readdirSync(tempDir);
      const tarball = files.find((f) => f.endsWith(".tgz"));

      if (!tarball) {
        throw new Error("Failed to download package tarball");
      }

      // Extract
      const extractDir = path.join(tempDir, "extracted");
      fs.mkdirSync(extractDir, { recursive: true });
      execSync(`tar -xzf ${path.join(tempDir, tarball)} -C ${extractDir} --strip-components=1`, {
        stdio: "pipe",
      });

      // Clean up tarball
      fs.unlinkSync(path.join(tempDir, tarball));

      // Move to final location
      fs.cpSync(extractDir, targetDir, { recursive: true });

      // Clean up temp
      fs.rmSync(tempDir, { recursive: true, force: true });

      this.logger.info(`Downloaded ${packageSpec} to ${targetDir}`);
      return targetDir;
    } catch (err) {
      // Clean up on error
      fs.rmSync(tempDir, { recursive: true, force: true });
      throw err;
    }
  }

  /**
   * Check if a package exists on npm
   */
  async exists(packageName: string): Promise<boolean> {
    try {
      execSync(`npm view ${packageName} --json`, { stdio: "pipe", timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get package info from npm
   */
  async getInfo(packageName: string): Promise<any> {
    try {
      const output = execSync(`npm view ${packageName} --json`, {
        stdio: "pipe",
        encoding: "utf-8",
        timeout: 10000,
      });
      return JSON.parse(output);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to get package info: ${msg}`);
    }
  }
}

/**
 * GitHub Registry - install skills from GitHub repos
 */
export class GitHubRegistry {
  private logger: LoggerInterface;

  constructor(logger: LoggerInterface = silentLogger) {
    this.logger = logger;
  }

  /**
   * Clone a GitHub repo to target directory
   */
  async download(
    parsed: ParsedSource,
    targetDir: string
  ): Promise<string> {
    if (parsed.type !== "github") {
      throw new Error(`GitHubRegistry can only handle github sources, got: ${parsed.type}`);
    }

    if (!parsed.owner || !parsed.repo) {
      throw new Error("GitHub source must have owner and repo");
    }

    const url = `https://github.com/${parsed.owner}/${parsed.repo}.git`;
    const ref = parsed.version || "HEAD";

    this.logger.info(`Cloning ${url}@${ref}...`);

    try {
      // Clone with depth 1 for speed
      execSync(`git clone --depth 1 --branch ${ref} "${url}" "${targetDir}"`, {
        stdio: "pipe",
        timeout: 60000,
      });

      this.logger.info(`Cloned to ${targetDir}`);
      return targetDir;
    } catch (err: unknown) {
      // Try without branch (might be a SHA or tag)
      try {
        execSync(`git clone --depth 1 "${url}" "${targetDir}"`, {
          stdio: "pipe",
          timeout: 60000,
        });

        // Checkout specific ref if provided
        if (parsed.version) {
          execSync(`git -C "${targetDir}" checkout ${parsed.version}`, {
            stdio: "pipe",
            timeout: 30000,
          });
        }

        this.logger.info(`Cloned to ${targetDir}`);
        return targetDir;
      } catch (err2: unknown) {
        const msg = err2 instanceof Error ? err2.message : String(err2);
        throw new Error(`Failed to clone: ${msg}`);
      }
    }
  }

  /**
   * Get repo info from GitHub API
   */
  async getInfo(owner: string, repo: string): Promise<any> {
    try {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to get repo info: ${msg}`);
    }
  }
}

/**
 * Local Registry - install skills from local paths
 */
export class LocalRegistry {
  private logger: LoggerInterface;

  constructor(logger: LoggerInterface = silentLogger) {
    this.logger = logger;
  }

  /**
   * Copy local directory to target
   */
  async download(
    parsed: ParsedSource,
    targetDir: string
  ): Promise<string> {
    if (parsed.type !== "local") {
      throw new Error(`LocalRegistry can only handle local sources, got: ${parsed.type}`);
    }

    if (!parsed.path) {
      throw new Error("Local source must have a path");
    }

    if (!fs.existsSync(parsed.path)) {
      throw new Error(`Local path does not exist: ${parsed.path}`);
    }

    const stat = fs.statSync(parsed.path);
    if (!stat.isDirectory()) {
      throw new Error(`Local path must be a directory: ${parsed.path}`);
    }

    // Verify it has skill.yaml
    const manifestPath = path.join(parsed.path, "skill.yaml");
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`No skill.yaml found in ${parsed.path}`);
    }

    this.logger.info(`Copying from ${parsed.path}...`);

    // Copy directory
    fs.cpSync(parsed.path, targetDir, { recursive: true });

    this.logger.info(`Copied to ${targetDir}`);
    return targetDir;
  }
}
