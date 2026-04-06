/**
 * Token usage tracking across all sessions — stored in SQLite.
 * Replaces legacy JSON file storage (usage.json) with proper relational data.
 */

import Database from "better-sqlite3";
import path from "path";
import { ensureKaiDir } from "./config.js";

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  const dbPath = path.join(ensureKaiDir(), "agents.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  return db;
}

export interface UsageRecord {
  date: string;       // YYYY-MM-DD
  metric: string;     // 'input_tokens', 'output_tokens', 'total_tokens'
  value: number;
  unit: string;
}

export interface DailyUsage {
  date: string;
  input: number;
  output: number;
  total: number;
}

/**
 * Record token usage for the current day.
 * Inserts into the 'usage' table (schema defined in db/migrate.ts).
 */
export function recordUsage(input: number, output: number): void {
  if (input === 0 && output === 0) return;

  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const stmt = db.prepare(`
    INSERT INTO usage (date, metric, value, unit)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date, metric, agent_id) DO UPDATE SET
      value = value + excluded.value,
      created_at = datetime('now')
  `);

  // Try-catch because unit tests may not have the table
  try {
    stmt.run(today, "input_tokens", input, "tokens");
    stmt.run(today, "output_tokens", output, "tokens");
    stmt.run(today, "total_tokens", input + output, "tokens");
  } catch {
    // Table may not exist yet — ignore silently
  }
}

/**
 * Get total usage stats (all time + last 30 days).
 */
export function getUsageStats(): { totalInput: number; totalOutput: number; daily: DailyUsage[] } {
  const db = getDb();

  try {
    const totalStmt = db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN metric = 'input_tokens' THEN value ELSE 0 END), 0) as totalInput,
        COALESCE(SUM(CASE WHEN metric = 'output_tokens' THEN value ELSE 0 END), 0) as totalOutput
      FROM usage
    `);
    const totals = totalStmt.get() as { totalInput: number; totalOutput: number };

    const dailyStmt = db.prepare(`
      SELECT 
        date,
        COALESCE(SUM(CASE WHEN metric = 'input_tokens' THEN value ELSE 0 END), 0) as input,
        COALESCE(SUM(CASE WHEN metric = 'output_tokens' THEN value ELSE 0 END), 0) as output,
        COALESCE(SUM(CASE WHEN metric = 'total_tokens' THEN value ELSE 0 END), 0) as total
      FROM usage
      WHERE date > date('now', '-30 days')
      GROUP BY date
      ORDER BY date DESC
    `);
    const daily = dailyStmt.all() as DailyUsage[];

    return {
      totalInput: totals.totalInput,
      totalOutput: totals.totalOutput,
      daily,
    };
  } catch {
    // Table may not exist yet
    return { totalInput: 0, totalOutput: 0, daily: [] };
  }
}

/**
 * Legacy migration: copy usage.json into SQLite (one-time).
 */
export function migrateUsageFromJson(): { imported: number } {
  const fs = require("fs");
  const path = require("path");
  const kaiDir = ensureKaiDir();
  const usagePath = path.join(kaiDir, "usage.json");

  if (!fs.existsSync(usagePath)) {
    return { imported: 0 };
  }

  try {
    const data = JSON.parse(fs.readFileSync(usagePath, "utf-8"));
    if (!data.daily || !Array.isArray(data.daily)) {
      return { imported: 0 };
    }

    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO usage (date, metric, value, unit)
      VALUES (?, ?, ?, ?)
    `);

    let imported = 0;
    for (const day of data.daily) {
      if (day.input > 0) {
        stmt.run(day.date, "input_tokens", day.input, "tokens");
        imported++;
      }
      if (day.output > 0) {
        stmt.run(day.date, "output_tokens", day.output, "tokens");
        imported++;
      }
    }

    // Rename old file to prevent re-import
    fs.renameSync(usagePath, `${usagePath}.migrated`);
    return { imported };
  } catch {
    return { imported: 0 };
  }
}
