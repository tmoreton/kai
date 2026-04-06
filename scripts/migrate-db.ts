#!/usr/bin/env node
/**
 * Run database migrations manually
 */
import { migrate, migrateSessions } from "../src/db/migrate.js";
import { ensureKaiDir } from "../src/config.js";
import fs from "fs";
import path from "path";

console.log("Kai Database Migration Tool");
console.log("============================\n");

// First, ensure schema is up to date
console.log("1. Running schema migrations...");
const result = migrate();
console.log(`   Applied: ${result.applied}, Skipped: ${result.skipped}\n`);

// Then migrate sessions if sessions.db exists
console.log("2. Checking for sessions.db migration...");
const sessionsPath = path.join(ensureKaiDir(), "sessions.db");
if (fs.existsSync(sessionsPath)) {
  const sessionResult = migrateSessions();
  console.log(`   Migrated: ${sessionResult.copied} sessions, Errors: ${sessionResult.errors}\n`);
} else {
  console.log("   No sessions.db found (already migrated or never existed)\n");
}

console.log("✓ Migration complete!");
