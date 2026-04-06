/**
 * Database migration runner for Kai
 * Consolidates all migrations into a single source of truth
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { ensureKaiDir } from "../config.js";

const MIGRATIONS_DIR = path.join(ensureKaiDir(), "migrations");

interface MigrationRecord {
  id: number;
  name: string;
  applied_at: string;
}

function getDb(): Database.Database {
  const dbPath = path.join(ensureKaiDir(), "agents.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function getAppliedMigrations(db: Database.Database): string[] {
  ensureMigrationsTable(db);
  const stmt = db.prepare("SELECT name FROM _migrations ORDER BY id");
  const rows = stmt.all() as { name: string }[];
  return rows.map(r => r.name);
}

function recordMigration(db: Database.Database, name: string): void {
  const stmt = db.prepare("INSERT INTO _migrations (name) VALUES (?)");
  stmt.run(name);
}

/**
 * Migrate sessions from old sessions.db to agents.db
 */
export function migrateSessions(): { copied: number; errors: number } {
  const kaiDir = ensureKaiDir();
  const sessionsPath = path.join(kaiDir, "sessions.db");
  const agentsPath = path.join(kaiDir, "agents.db");
  
  if (!fs.existsSync(sessionsPath)) {
    console.log("No sessions.db to migrate");
    return { copied: 0, errors: 0 };
  }
  
  const db = getDb();
  let copied = 0;
  let errors = 0;
  
  try {
    // Attach sessions.db
    db.exec(`ATTACH DATABASE '${sessionsPath}' AS sessions_db`);
    
    // Check if sessions table exists in sessions.db
    const checkTable = db.prepare(`
      SELECT name FROM sessions_db.sqlite_master 
      WHERE type='table' AND name='sessions'
    `);
    const hasTable = checkTable.get();
    
    if (hasTable) {
      // Copy sessions
      const copySessions = db.prepare(`
        INSERT OR REPLACE INTO sessions (
          id, name, cwd, type, agent_id, model, tags, messages,
          compacted_at, original_message_count, created_at, updated_at
        )
        SELECT 
          id, name, cwd, type, persona_id, model, tags, messages,
          compacted_at, original_message_count, created_at, updated_at
        FROM sessions_db.sessions
      `);
      const sessionsResult = copySessions.run();
      copied += sessionsResult.changes;
      
      // Copy compacted sessions
      const copyCompacted = db.prepare(`
        INSERT OR REPLACE INTO compacted_sessions (id, data, created_at)
        SELECT id, data, created_at FROM sessions_db.compacted_sessions
      `);
      copyCompacted.run();
      
      console.log(`✓ Migrated ${sessionsResult.changes} sessions from sessions.db`);
      
      // Detach
      db.exec(`DETACH DATABASE sessions_db`);
      
      // Rename sessions.db to sessions.db.bak
      fs.renameSync(sessionsPath, sessionsPath + ".bak");
      console.log(`✓ Renamed sessions.db to sessions.db.bak`);
    }
  } catch (e: any) {
    console.error("Failed to migrate sessions:", e.message);
    errors++;
  }
  
  db.close();
  return { copied, errors };
}

/**
 * Run a single SQL file migration
 */
function runSqlMigration(db: Database.Database, filepath: string, name: string): void {
  console.log(`Applying migration: ${name}`);
  const sql = fs.readFileSync(filepath, "utf-8");
  db.exec(sql);
  recordMigration(db, name);
  console.log(`✓ Applied: ${name}`);
}

/**
 * Get list of available migration files (sorted)
 */
function getAvailableMigrations(): Array<{ name: string; path: string; isSql: boolean }> {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }
  
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') || f.endsWith('.js') || f.endsWith('.ts'))
    .sort();
  
  return files.map(f => ({
    name: f,
    path: path.join(MIGRATIONS_DIR, f),
    isSql: f.endsWith('.sql'),
  }));
}

/**
 * Run all pending migrations
 */
export function migrate(): { applied: number; skipped: number } {
  const db = getDb();
  const applied = getAppliedMigrations(db);
  const available = getAvailableMigrations();
  
  let appliedCount = 0;
  let skippedCount = 0;
  
  for (const migration of available) {
    if (applied.includes(migration.name)) {
      skippedCount++;
      continue;
    }
    
    if (migration.isSql) {
      runSqlMigration(db, migration.path, migration.name);
      appliedCount++;
    }
    // JS/TS migrations could be added here if needed
  }
  
  db.close();
  
  if (appliedCount === 0) {
    console.log(`Database up to date (${skippedCount} migrations applied)`);
  } else {
    console.log(`Applied ${appliedCount} migrations, skipped ${skippedCount}`);
  }
  
  return { applied: appliedCount, skipped: skippedCount };
}

/**
 * Reset database (DANGER: deletes all data)
 */
export function resetDatabase(): void {
  const dbPath = path.join(ensureKaiDir(), "agents.db");
  const db = getDb();
  
  // Get all table names
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_%'").all() as { name: string }[];
  
  // Drop all tables
  for (const { name } of tables) {
    db.exec(`DROP TABLE IF EXISTS "${name}"`);
  }
  
  db.close();
  
  // Vacuum to reclaim space
  const db2 = new Database(dbPath);
  db2.exec("VACUUM");
  db2.close();
  
  console.log("Database reset complete");
}

/**
 * Get migration status
 */
export function status(): { applied: string[]; pending: string[] } {
  const db = getDb();
  const applied = getAppliedMigrations(db);
  db.close();
  
  const available = getAvailableMigrations().map(m => m.name);
  const pending = available.filter(m => !applied.includes(m));
  
  return { applied, pending };
}

// CLI usage
if (import.meta.main) {
  const command = process.argv[2];
  
  switch (command) {
    case 'reset':
      console.log("WARNING: This will delete all data!");
      resetDatabase();
      migrate();
      break;
    case 'status':
      const s = status();
      console.log(`Applied (${s.applied.length}):`, s.applied.join(', ') || 'none');
      console.log(`Pending (${s.pending.length}):`, s.pending.join(', ') || 'none');
      break;
    case 'migrate':
    default:
      migrate();
      break;
  }
}
