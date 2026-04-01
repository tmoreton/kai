import fs from "fs";
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
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(getCwd(), filePath);
  if (fs.existsSync(resolved)) return resolved;

  // macOS screenshot filenames use U+202F (narrow no-break space) before AM/PM,
  // but users and LLMs type regular ASCII spaces. Try alternate space variants.
  const withNarrowNbsp = resolved.replace(/ /g, " \u202F").replace(/ \u202F/g, (_, i) => {
    // Only replace spaces that could be the AM/PM space — try all combos via glob
    return " ";
  });

  // Try: replace all regular spaces with the Unicode variants macOS uses
  const variants = [
    resolved.replace(/ (?=AM|PM)/gi, "\u202F"),  // narrow no-break space before AM/PM
    resolved.replace(/ (?=AM|PM)/gi, "\u00A0"),   // no-break space before AM/PM
  ];
  for (const variant of variants) {
    if (fs.existsSync(variant)) return variant;
  }

  return resolved;
}

/**
 * Expand ~ to the user's home directory.
 */
export function expandHome(filePath: string): string {
  return filePath.replace(/^~/, process.env.HOME || "~");
}
