#!/usr/bin/env node
/**
 * Test config-driven bootstrap system
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

console.log("=== Config-Driven Bootstrap Test ===\n");

// Test 1: Config files exist
console.log("1. Checking config files...");
const skillsConfigPath = path.join(rootDir, "config", "builtin-skills.json");
const agentsConfigPath = path.join(rootDir, "config", "builtin-agents.json");

if (fs.existsSync(skillsConfigPath)) {
  const skills = JSON.parse(fs.readFileSync(skillsConfigPath, "utf-8"));
  console.log(`   ✓ Skills config: ${skills.skills.length} skills defined`);
  skills.skills.forEach(s => console.log(`     - ${s.id}: ${s.name}`));
} else {
  console.log("   ✗ Skills config not found");
}

if (fs.existsSync(agentsConfigPath)) {
  const agents = JSON.parse(fs.readFileSync(agentsConfigPath, "utf-8"));
  console.log(`   ✓ Agents config: ${agents.agents.length} agents defined`);
  agents.agents.forEach(a => console.log(`     - ${a.id}: ${a.name}`));
} else {
  console.log("   ✗ Agents config not found");
}

// Test 2: Import modules
console.log("\n2. Testing module imports...");
try {
  const { bootstrapBuiltinSkills } = await import("../dist/skills/builtin.js");
  console.log("   ✓ Skills bootstrap module imported");
} catch (e) {
  console.log("   ✗ Skills import failed:", e.message);
}

try {
  const { bootstrapBuiltinAgents } = await import("../dist/agents-core/bootstrap.js");
  console.log("   ✓ Agents bootstrap module imported");
} catch (e) {
  console.log("   ✗ Agents import failed:", e.message);
}

// Test 3: Run bootstraps
console.log("\n3. Running bootstrap functions...");
try {
  const { bootstrapBuiltinSkills } = await import("../dist/skills/builtin.js");
  console.log("   Running skills bootstrap...");
  bootstrapBuiltinSkills();
  console.log("   ✓ Skills bootstrap completed");
} catch (e) {
  console.log("   ✗ Skills bootstrap failed:", e.message);
}

try {
  const { bootstrapBuiltinAgents } = await import("../dist/agents-core/bootstrap.js");
  console.log("   Running agents bootstrap...");
  const count = bootstrapBuiltinAgents();
  console.log(`   ✓ Agents bootstrap completed (${count} installed)`);
} catch (e) {
  console.log("   ✗ Agents bootstrap failed:", e.message);
}

console.log("\n=== Test Complete ===");
