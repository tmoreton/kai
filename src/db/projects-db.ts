/**
 * SQLite persistence for projects, profiles, and settings.
 * Replaces JSON file storage with proper relational data.
 */
import Database from "better-sqlite3";
import path from "path";
import { ensureKaiDir } from "../config.js";

let db: Database.Database | null = null;

export function getProjectDb(): Database.Database {
  if (db) return db;

  const dbPath = path.join(ensureKaiDir(), "agents.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  // Ensure tables exist (idempotent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      last_accessed TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      type TEXT DEFAULT 'string',
      category TEXT DEFAULT 'general',
      description TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profiles (
      project_id TEXT PRIMARY KEY,
      context TEXT,
      preferences TEXT,
      custom_instructions TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
    CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);
  `);

  return db;
}

// ============================================
// PROJECTS
// ============================================

export interface ProjectInfo {
  id: string;
  path: string;
  name: string;
  lastAccessed: string;
}

export function listProjects(): ProjectInfo[] {
  const db = getProjectDb();
  const stmt = db.prepare("SELECT id, path, name, last_accessed as lastAccessed FROM projects ORDER BY last_accessed DESC");
  return stmt.all() as ProjectInfo[];
}

export function getProject(id: string): ProjectInfo | null {
  const db = getProjectDb();
  const stmt = db.prepare("SELECT id, path, name, last_accessed as lastAccessed FROM projects WHERE id = ?");
  const row = stmt.get(id) as ProjectInfo | undefined;
  return row || null;
}

export function getProjectByPath(projectPath: string): ProjectInfo | null {
  const db = getProjectDb();
  const stmt = db.prepare("SELECT id, path, name, last_accessed as lastAccessed FROM projects WHERE path = ?");
  const row = stmt.get(projectPath) as ProjectInfo | undefined;
  return row || null;
}

export function saveProject(project: ProjectInfo): void {
  const db = getProjectDb();
  const stmt = db.prepare(`
    INSERT INTO projects (id, path, name, last_accessed, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      path = excluded.path,
      name = excluded.name,
      last_accessed = excluded.last_accessed,
      updated_at = datetime('now')
  `);
  stmt.run(project.id, project.path, project.name, project.lastAccessed);
}

export function touchProject(id: string): void {
  const db = getProjectDb();
  const stmt = db.prepare("UPDATE projects SET last_accessed = datetime('now'), updated_at = datetime('now') WHERE id = ?");
  stmt.run(id);
}

// ============================================
// SETTINGS
// ============================================

export function getSetting<T = string>(key: string, defaultValue?: T): T | undefined {
  const db = getProjectDb();
  const stmt = db.prepare("SELECT value, type FROM settings WHERE key = ?");
  const row = stmt.get(key) as { value: string; type: string } | undefined;
  if (!row) return defaultValue;
  
  try {
    if (row.type === 'json') return JSON.parse(row.value) as T;
    if (row.type === 'number') return parseFloat(row.value) as unknown as T;
    if (row.type === 'boolean') return (row.value === 'true') as unknown as T;
    return row.value as unknown as T;
  } catch {
    return defaultValue;
  }
}

export function setSetting<T>(key: string, value: T, type?: string, category?: string, description?: string): void {
  const db = getProjectDb();
  const valueType = type || (typeof value === 'object' ? 'json' : typeof value);
  const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
  
  const stmt = db.prepare(`
    INSERT INTO settings (key, value, type, category, description, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      type = excluded.type,
      updated_at = datetime('now')
  `);
  stmt.run(key, valueStr, valueType, category || 'general', description || null);
}

export function listSettings(category?: string): Array<{ key: string; value: string; type: string; category: string }> {
  const db = getProjectDb();
  if (category) {
    const stmt = db.prepare("SELECT key, value, type, category FROM settings WHERE category = ? ORDER BY key");
    return stmt.all(category) as any[];
  }
  const stmt = db.prepare("SELECT key, value, type, category FROM settings ORDER BY category, key");
  return stmt.all() as any[];
}

// ============================================
// PROFILES
// ============================================

export interface ProjectProfile {
  name: string;
  path: string;
  techStack: string[];
  packageManager: string;
  language: string;
  framework: string;
  keyFiles: string[];
  structure: string;
  scripts: Record<string, string>;
  notes: string[];
  generatedAt: string;
  updatedAt: string;
}

export interface ProfileRow {
  project_id: string;
  context: string | null;
  preferences: string | null;
  custom_instructions: string | null;
}

export function loadProfile(projectId: string): ProfileRow | null {
  const db = getProjectDb();
  const stmt = db.prepare("SELECT project_id, context, preferences, custom_instructions FROM profiles WHERE project_id = ?");
  const row = stmt.get(projectId) as ProfileRow | undefined;
  return row || null;
}

export function saveProfile(projectId: string, context: string, preferences: Record<string, any>, customInstructions: string): void {
  const db = getProjectDb();
  const stmt = db.prepare(`
    INSERT INTO profiles (project_id, context, preferences, custom_instructions, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(project_id) DO UPDATE SET
      context = excluded.context,
      preferences = excluded.preferences,
      custom_instructions = excluded.custom_instructions,
      updated_at = datetime('now')
  `);
  stmt.run(projectId, context, JSON.stringify(preferences), customInstructions);
}

// ============================================
// MIGRATION: JSON → SQLite (one-time, deletes after migration)
// ============================================

export function migrateFromJson(): { projects: number; settings: number; profiles: number } {
  const fs = require("fs");
  const results = { projects: 0, settings: 0, profiles: 0 };
  const kaiDir = ensureKaiDir();

  // Migrate projects.json
  try {
    const projectsPath = path.join(kaiDir, "projects.json");
    if (fs.existsSync(projectsPath)) {
      const data = JSON.parse(fs.readFileSync(projectsPath, "utf-8"));
      for (const p of Object.values(data) as ProjectInfo[]) {
        saveProject(p);
        results.projects++;
      }
      fs.unlinkSync(projectsPath); // Delete after migration
    }
  } catch (e) {
    console.error("Failed to migrate projects.json:", e);
  }

  // Migrate settings.json
  try {
    const settingsPath = path.join(kaiDir, "settings.json");
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      for (const [key, val] of Object.entries(data)) {
        setSetting(key, val);
        results.settings++;
      }
      fs.unlinkSync(settingsPath); // Delete after migration
    }
  } catch (e) {
    console.error("Failed to migrate settings.json:", e);
  }

  // Migrate profile/projects/*/profile.json
  try {
    const profileDir = path.join(kaiDir, "profile", "projects");
    if (fs.existsSync(profileDir)) {
      for (const dir of fs.readdirSync(profileDir)) {
        const profilePath = path.join(profileDir, dir, "profile.json");
        if (fs.existsSync(profilePath)) {
          const profile = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
          saveProfile(dir, profile.context || "", profile.preferences || {}, profile.custom_instructions || "");
          results.profiles++;
          fs.unlinkSync(profilePath); // Delete after migration
        }
      }
      // Remove empty profile directory
      try {
        fs.rmdirSync(profileDir, { recursive: true });
      } catch {}
    }
  } catch (e) {
    console.error("Failed to migrate profiles:", e);
  }

  return results;
}
