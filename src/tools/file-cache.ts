import fs from "fs";

interface CacheEntry {
  content: string;
  mtimeMs: number;
  offset: number;
  limit: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Check cache for a file read. Returns cached content if the file
 * hasn't been modified since last read with the same offset/limit.
 * Returns null on cache miss.
 */
export function getCachedRead(
  fullPath: string,
  offset: number,
  limit: number
): string | null {
  const entry = cache.get(fullPath);
  if (!entry) return null;

  // Check if offset/limit match
  if (entry.offset !== offset || entry.limit !== limit) return null;

  // Check if file has been modified since we cached it
  try {
    const stat = fs.statSync(fullPath);
    if (stat.mtimeMs !== entry.mtimeMs) {
      cache.delete(fullPath);
      return null;
    }
  } catch {
    cache.delete(fullPath);
    return null;
  }

  return entry.content;
}

/**
 * Store a file read result in the cache.
 */
export function setCachedRead(
  fullPath: string,
  offset: number,
  limit: number,
  content: string
): void {
  try {
    const stat = fs.statSync(fullPath);
    cache.set(fullPath, {
      content,
      mtimeMs: stat.mtimeMs,
      offset,
      limit,
    });
  } catch {
    // Can't stat — don't cache
  }
}

/**
 * Invalidate cache for a specific file (call after write/edit).
 */
export function invalidateCache(fullPath: string): void {
  cache.delete(fullPath);
}

/**
 * Get list of all files currently in the cache with metadata.
 * Used by context compaction to preserve a file read index.
 */
export function getCachedFileIndex(): Array<{ path: string; lines: number }> {
  const index: Array<{ path: string; lines: number }> = [];
  for (const [filePath, entry] of cache) {
    const lineCount = entry.content.split("\n").length;
    index.push({ path: filePath, lines: lineCount });
  }
  return index;
}

/**
 * Clear the entire cache (e.g. on session reset).
 */
export function clearFileCache(): void {
  cache.clear();
}
