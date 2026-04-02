import fs from "fs";

interface CacheEntry {
  content: string;
  mtimeMs: number;
  cachedAt: number;      // Timestamp when cached
  lastAccessedAt: number; // Timestamp of last access (for LRU)
  size: number;           // Content byte length
}

const cache = new Map<string, CacheEntry>();

// Cache configuration
const CACHE_TTL_MS = 5 * 60 * 1000;        // 5 minutes before expiry
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB total cache limit
const MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024;   // Don't cache files > 1MB
const CLEANUP_INTERVAL_MS = 60_000;           // Sweep expired entries every 60s
let currentCacheSize = 0;

/**
 * Composite cache key that includes path + offset + limit.
 * Prevents misses when same file is read with different ranges.
 */
function cacheKey(fullPath: string, offset: number, limit: number): string {
  return `${fullPath}:${offset}:${limit}`;
}

/**
 * Check cache for a file read. Returns cached content if still valid.
 * Uses composite key (path:offset:limit) and time-based expiry.
 */
export function getCachedRead(
  fullPath: string,
  offset: number,
  limit: number
): string | null {
  const key = cacheKey(fullPath, offset, limit);
  const entry = cache.get(key);
  if (!entry) return null;

  // Time-based expiry — no stat() call needed
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    currentCacheSize -= entry.size;
    cache.delete(key);
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

  const key = cacheKey(fullPath, offset, limit);

  // Evict least-recently-used entries if adding would exceed limit
  while (currentCacheSize + size > MAX_CACHE_SIZE_BYTES && cache.size > 0) {
    let lruKey: string | null = null;
    let lruTime = Infinity;
    for (const [k, entry] of cache) {
      if (entry.lastAccessedAt < lruTime) {
        lruTime = entry.lastAccessedAt;
        lruKey = k;
      }
    }
    if (!lruKey) break;
    currentCacheSize -= cache.get(lruKey)!.size;
    cache.delete(lruKey);
  }

  // Remove old entry for this key if it exists
  const existing = cache.get(key);
  if (existing) {
    currentCacheSize -= existing.size;
    cache.delete(key);
  }

  try {
    const now = Date.now();
    const stat = fs.statSync(fullPath);
    cache.set(key, {
      content,
      mtimeMs: stat.mtimeMs,
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
 * Invalidate all cache entries for a specific file (call after write/edit).
 * Removes entries for all offset/limit combinations of this path.
 */
export function invalidateCache(fullPath: string): void {
  const prefix = `${fullPath}:`;
  for (const [key, entry] of cache) {
    if (key.startsWith(prefix) || key === fullPath) {
      currentCacheSize -= entry.size;
      cache.delete(key);
    }
  }
}

/**
 * Get list of all files currently in the cache with metadata.
 * Used by context compaction to preserve a file read index.
 */
export function getCachedFileIndex(): Array<{ path: string; lines: number }> {
  const index: Array<{ path: string; lines: number }> = [];
  const seen = new Set<string>();
  for (const [key, entry] of cache) {
    // Extract the file path from the composite key
    const filePath = key.replace(/:\d+:\d+$/, "");
    if (seen.has(filePath)) continue;
    seen.add(filePath);
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

/**
 * Periodic cleanup of expired entries to prevent memory bloat.
 * Runs automatically in the background.
 */
function sweepExpired(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.cachedAt > CACHE_TTL_MS) {
      currentCacheSize -= entry.size;
      cache.delete(key);
    }
  }
}

// Start background cleanup — unref'd so it doesn't keep the process alive
const _cleanupTimer = setInterval(sweepExpired, CLEANUP_INTERVAL_MS);
_cleanupTimer.unref();
