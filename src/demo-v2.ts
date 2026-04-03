#!/usr/bin/env node
/**
 * Real working demo: Research → Calendar pipeline
 * 
 * This demonstrates:
 * 1. Event-driven triggers
 * 2. Agent spawning from templates
 * 3. Goal orchestration (simple version)
 * 4. Result synthesis
 */

import {
  eventBus,
  spawnFromTemplate,
  runDurable,
  watchFile,
} from "./agents/index.js";
import { ensureKaiDir } from "./config.js";
import path from "path";
import os from "os";
import fs from "fs";

async function runDemo() {
  console.log("=== Kai Agent v2: Working Demo ===\n");
  
  const kaiDir = ensureKaiDir();
  const outputDir = path.join(kaiDir, "demo-output");
  fs.mkdirSync(outputDir, { recursive: true });
  
  // Step 1: Research
  console.log("Step 1: Research trending content...");
  const researcherId = await spawnFromTemplate("content-researcher", {
    topic: "AI coding tools",
    output_dir: outputDir,
  }, { oneTime: true });
  
  console.log(`  Spawned researcher: ${researcherId}`);
  
  const researchResult = await runDurable(researcherId);
  
  if (!researchResult.success) {
    console.log("  ✗ Research failed:", researchResult.error);
    process.exit(1);
  }
  
  console.log("  ✓ Research complete");
  
  // Find the research output file
  const researchFile = path.join(outputDir, "research-AI coding tools.json");
  
  if (!fs.existsSync(researchFile)) {
    console.log("  ✗ Research file not created");
    process.exit(1);
  }
  
  // Step 2: Create Calendar
  console.log("\nStep 2: Creating content calendar...");
  const calendarId = await spawnFromTemplate("content-calendar", {
    research_file: researchFile,
    output_dir: outputDir,
  }, { oneTime: true });
  
  console.log(`  Spawned calendar agent: ${calendarId}`);
  
  const calendarResult = await runDurable(calendarId);
  
  if (!calendarResult.success) {
    console.log("  ✗ Calendar creation failed:", calendarResult.error);
    process.exit(1);
  }
  
  console.log("  ✓ Calendar created");
  
  // Show results
  console.log("\n=== Results ===");
  const calendarFile = path.join(outputDir, "content-calendar.md");
  
  if (fs.existsSync(calendarFile)) {
    const content = fs.readFileSync(calendarFile, "utf-8");
    console.log(content.substring(0, 500) + "...");
  }
  
  console.log("\n✓ Demo complete!");
  console.log(`Output: ${outputDir}`);
  
  process.exit(0);
}

runDemo().catch(err => {
  console.error("Demo failed:", err);
  process.exit(1);
});
