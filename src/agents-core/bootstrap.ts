/**
 * Bootstrap built-in agents on first startup.
 *
 * Copies bundled workflow YAMLs to ~/.kai/workflows/ and registers them
 * in the agent database — but only if they haven't been registered before.
 * Users can delete these agents freely; they won't be re-created once
 * the marker file exists.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ensureKaiDir } from "../config.js";
import { getAgent, saveAgent } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface BuiltinAgent {
  id: string;
  name: string;
  description: string;
  schedule: string;
  workflowFile: string;
  enabled: boolean;
  category: string;
}

interface AgentsConfig {
  agents: BuiltinAgent[];
  settings: {
    markerFile: string;
    workflowsDir: string;
    skipIfInMarker: boolean;
    skipIfInDatabase: boolean;
  };
}

function loadAgentsConfig(): AgentsConfig {
  const configPath = path.join(process.cwd(), "config", "builtin-agents.json");
  const defaultConfig: AgentsConfig = {
    agents: [],
    settings: {
      markerFile: ".builtin-agents-installed",
      workflowsDir: "builtin-workflows",
      skipIfInMarker: true,
      skipIfInDatabase: true
    }
  };
  
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch {
    console.warn("[agents] Could not load builtin-agents.json, using defaults");
  }
  return defaultConfig;
}

function markerPath(config: AgentsConfig): string {
  return path.join(ensureKaiDir(), config.settings.markerFile);
}

function loadMarker(config: AgentsConfig): Set<string> {
  try {
    const p = markerPath(config);
    if (fs.existsSync(p)) {
      const ids = fs.readFileSync(p, "utf-8").trim().split("\n").filter(Boolean);
      return new Set(ids);
    }
  } catch {}
  return new Set();
}

function saveMarker(config: AgentsConfig, installed: Set<string>): void {
  fs.writeFileSync(markerPath(config), [...installed].join("\n") + "\n", "utf-8");
}

export function bootstrapBuiltinAgents(): number {
  const config = loadAgentsConfig();
  const installed = loadMarker(config);
  let count = 0;

  for (const agent of config.agents) {
    // Skip if already offered (even if user deleted it)
    if (config.settings.skipIfInMarker && installed.has(agent.id)) continue;

    // Skip if somehow already exists in DB
    if (config.settings.skipIfInDatabase && getAgent(agent.id)) {
      installed.add(agent.id);
      continue;
    }

    // Copy workflow YAML to ~/.kai/workflows/
    const srcYaml = path.join(__dirname, config.settings.workflowsDir, agent.workflowFile);
    if (!fs.existsSync(srcYaml)) {
      console.warn(`[agents] Workflow not found: ${srcYaml}`);
      continue;
    }

    const workflowsDir = path.join(ensureKaiDir(), "workflows");
    if (!fs.existsSync(workflowsDir)) {
      fs.mkdirSync(workflowsDir, { recursive: true });
    }

    const destYaml = path.join(workflowsDir, `${agent.id}.yaml`);
    fs.copyFileSync(srcYaml, destYaml);

    // Register in agent database
    saveAgent({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      workflow_path: destYaml,
      schedule: agent.schedule,
      enabled: agent.enabled ? 1 : 0,
      config: "{}",
    });

    installed.add(agent.id);
    count++;
    console.log(`[agents] Bootstrapped: ${agent.name}`);
  }

  saveMarker(config, installed);
  
  if (count > 0) {
    console.log(`[agents] Bootstrap complete: ${count} agents installed`);
  }
  
  return count;
}
