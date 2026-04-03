#!/usr/bin/env node
/**
 * Agent Workflow Migration Script
 *
 * Converts old integration-based workflows to new skill-based format.
 *
 * Usage: node migrate-agents.js [--dry-run]
 */

import fs from "fs";
import path from "path";
import YAML from "yaml";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = path.join(process.env.HOME, ".kai", "workflows");

const INTEGRATION_TO_SKILL = {
  data: "data",
  youtube: "youtube",
  browser: "browser",
  email: "email",
  web: "web-tools",
  mcp: null, // MCP requires special handling
};

function migrateStep(step) {
  if (step.type === "integration" && INTEGRATION_TO_SKILL[step.integration]) {
    return {
      ...step,
      type: "skill",
      skill: INTEGRATION_TO_SKILL[step.integration],
      integration: undefined, // Remove old field
    };
  }
  return step;
}

function migrateWorkflow(content) {
  const workflow = YAML.parse(content);
  
  if (!workflow.steps) return null;
  
  let modified = false;
  const newSteps = workflow.steps.map(step => {
    const migrated = migrateStep(step);
    if (migrated !== step) modified = true;
    return migrated;
  });
  
  if (!modified) return null;
  
  // Clean up undefined fields
  const cleanedSteps = newSteps.map(step => {
    const { integration, ...clean } = step;
    return clean;
  });
  
  return {
    ...workflow,
    steps: cleanedSteps,
  };
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  
  console.log(dryRun ? "🔍 DRY RUN - No changes will be made\n" : "🚀 Migrating workflows...\n");
  
  if (!fs.existsSync(WORKFLOWS_DIR)) {
    console.error("❌ Workflows directory not found:", WORKFLOWS_DIR);
    process.exit(1);
  }
  
  const files = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));
  
  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const file of files) {
    const filePath = path.join(WORKFLOWS_DIR, file);
    const content = fs.readFileSync(filePath, "utf-8");
    
    try {
      const newWorkflow = migrateWorkflow(content);
      
      if (!newWorkflow) {
        console.log(`⏭️  ${file} - No migration needed`);
        skipped++;
        continue;
      }
      
      const newYaml = YAML.stringify(newWorkflow);
      
      if (dryRun) {
        console.log(`📝 ${file} - Would migrate (preview):`);
        console.log(newYaml.split("\n").slice(0, 20).join("\n"));
        console.log("...\n");
      } else {
        // Backup original
        const backupPath = filePath + ".backup";
        fs.copyFileSync(filePath, backupPath);
        
        // Write migrated
        fs.writeFileSync(filePath, newYaml);
        console.log(`✅ ${file} - Migrated (backup: ${backupPath})`);
      }
      
      migrated++;
    } catch (err) {
      console.error(`❌ ${file} - Error: ${err.message}`);
      errors++;
    }
  }
  
  console.log("\n" + "=".repeat(50));
  console.log(`Total: ${files.length} workflows`);
  console.log(`Migrated: ${migrated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
  
  if (dryRun && migrated > 0) {
    console.log("\n💡 Run without --dry-run to apply changes");
  }
}

main();
