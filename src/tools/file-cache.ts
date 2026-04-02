import fs from "fs";

interface CacheEntry {
  content: string;
  mtimeMs: number;
  offset: number;
  limit: number;
  cachedAt: number;      // Timestamp when cached
  lastAccessedAt: number; // Timestamp of last access (for LRU)
  size: number;           // Content byte length
}

const cache = new Map<string, CacheEntry>();

// Cache configuration
const CACHE_TTL_MS = 5 * 60 * 1000;        // 5 minutes before expiry
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB total cache limit
const MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024;   // Don't cache files > 1MB
let currentCacheSize = 0;

/**
 * Check cache for a file read. Returns cached content if still valid.
 * Uses time-based expiry instead of stat() on every hit.
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

  // Time-based expiry — no stat() call needed
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    currentCacheSize -= entry.size;
    cache.delete(fullPath);
    return null;
  }

  // Update access time for LRU eviction
  entry.lastAccessedAt = Date.now();
  return entry.content;
}

/**
 * Store a file read result in the cache with LRU eviction.
 */
export function setCachedRead(
  fullPath: string,
  offset: number,
  limit: number,
  content: string
): void {
  const size = Buffer.byteLength(content, "utf-8");

  // Don't cache very large files (PDFs, images, etc.)
  if (size > MAX_FILE_SIZE_BYTES) return;

  // Evict least-recently-used entries if adding would exceed limit
  while (currentCacheSize + size > MAX_CACHE_SIZE_BYTES && cache.size > 0) {
    let lruKey: string | null = null;
    let lruTime = Infinity;
    for (const [key, entry] of cache) {
      if (entry.lastAccessedAt < lruTime) {
        lruTime = entry.lastAccessedAt;
        lruKey = key;
      }
    }
    if (!lruKey) break;
    currentCacheSize -= cache.get(lruKey)!.size;
    cache.delete(lruKey);
  }

  // Remove old entry for this path if it exists
  const existing = cache.get(fullPath);
  if (existing) {
    currentCacheSize -= existing.size;
    cache.delete(fullPath);
  }

  try {
    const now = Date.now();
    const stat = fs.statSync(fullPath);
    cache.set(fullPath, {
      content,
      mtimeMs: stat.mtimeMs,
      offset,
      limit,
      cachedAt: now,
      lastAccessedAt: now,
      size,
    });
    currentCacheSize += size;
  } catch {
    // Can't stat — don't cache
  }
}

/**
 * Invalidate cache for a specific file (call after write/edit).
 */
export function invalidateCache(fullPath: string): void {
  const entry = cache.get(fullPath);
  if (entry) {
    currentCacheSize -= entry.size;
    cache.delete(fullPath);
  }
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
  currentCacheSize = 0;
}
