import path from "path";
import { getCwd } from "./tools/bash.js";
import { RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS } from "./constants.js";

/**
 * Calculate exponential backoff delay for retries.
 */
export function backoffDelay(attempt: number, baseMs = RETRY_BASE_DELAY_MS, maxMs = RETRY_MAX_DELAY_MS): number {
  return Math.min(baseMs * Math.pow(2, attempt), maxMs);
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Resolve a file path relative to the current working directory.
 * Absolute paths are returned as-is.
 */
export function resolveFilePath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(getCwd(), filePath);
}

/**
 * Expand ~ to the user's home directory.
 */
export function expandHome(filePath: string): string {
  return filePath.replace(/^~/, process.env.HOME || "~");
}
