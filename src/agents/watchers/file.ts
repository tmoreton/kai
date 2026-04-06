import { watch, type FSWatcher } from "fs";
import { eventBus } from "../event-bus.js";
import { expandHome } from "../../utils.js";

const activeWatchers = new Map<string, () => void>();

/**
 * Watch a file for changes. Emits `file:changed` events.
 * Returns unsubscribe function.
 */
export function watchFile(filePath: string): () => void {
  const resolvedPath = expandHome(filePath);
  
  // Don't double-watch
  if (activeWatchers.has(resolvedPath)) {
    return activeWatchers.get(resolvedPath)!;
  }

  let watcher: FSWatcher;
  
  try {
    watcher = watch(resolvedPath, (eventType, filename) => {
      if (eventType === "change") {
        eventBus.publish({
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: "file:changed",
          timestamp: Date.now(),
          payload: { 
            path: filePath, 
            resolvedPath, 
            eventType,
            filename: filename || null
          },
          source: "file-watcher",
        });
      }
    });
  } catch (err) {
    console.error(`[FileWatcher] Failed to watch ${resolvedPath}:`, err);
    throw err;
  }

  const unwatch = () => {
    watcher.close();
    activeWatchers.delete(resolvedPath);
  };

  activeWatchers.set(resolvedPath, unwatch);
  return unwatch;
}

/**
 * Unwatch a specific file.
 */
export function unwatchFile(filePath: string): void {
  const resolvedPath = expandHome(filePath);
  const unwatch = activeWatchers.get(resolvedPath);
  if (unwatch) {
    unwatch();
  }
}

/**
 * Unwatch all files. Call on shutdown.
 */
export function unwatchAll(): void {
  for (const [path, unwatch] of activeWatchers) {
    unwatch();
  }
  activeWatchers.clear();
}

/**
 * Get list of currently watched files.
 */
export function getWatchedFiles(): string[] {
  return [...activeWatchers.keys()];
}
