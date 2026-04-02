/**
 * Sessions module - re-exports from manager for backward compatibility
 * and new enhanced features.
 */
export {
  // Core session operations
  generateSessionId,
  saveSession,
  saveSessionSync,
  loadSession,
  loadCompactedSession,
  deleteSession,
  getMostRecentSession,
  findSessionByPersona,
  findSessionByTag,
  listSessions,
  cleanupSessions,
  formatSessionList,

  // Compaction features
  compactAndSave,
  autoCompact,
  compactSession,
  shouldCompact,
  getSessionStats,

  // Types
  type Session,
  type SessionMetadata,
} from "./manager.js";

// For backward compatibility with old sessions.ts
export * from "./manager.js";
