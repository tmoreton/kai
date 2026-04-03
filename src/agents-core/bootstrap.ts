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
  yamlFile: string; // Filename in builtin-workflows/
}

const BUILTIN_AGENTS: BuiltinAgent[] = [
  {
    id: "agent-kai-backup",
    name: "Kai Backup",
    description: "Nightly git backup of ~/.kai — auto-commits changes so you can always revert",
    schedule: "0 23 * * *",
    yamlFile: "kai-backup.yaml",
  },
  {
    id: "agent-kai-memory-cleanup",
    name: "Kai Memory Cleanup",
    description: "Weekly maintenance — prunes old recall, deduplicates archival, reports memory usage",
    schedule: "0 4 * * 0",
    yamlFile: "kai-memory-cleanup.yaml",
  },
  {
    id: "agent-kai-self-diagnosis",
    name: "Kai Self-Diagnosis",
    description: "Daily error analysis — reviews accumulated errors and generates structured diagnoses for self-healing",
    schedule: "0 3 * * *",
    yamlFile: "kai-self-diagnosis.yaml",
  },
  {
    id: "agent-kai-self-heal",
    name: "Kai Self-Heal",
    description: "Applies high-confidence fixes from diagnosis reports on a git branch with build/test gates",
    schedule: "30 3 * * *",
    yamlFile: "kai-self-heal.yaml",
  },
];

/**
 * Marker file that tracks which built-in agents have been offered.
 * Once an agent ID appears here, it won't be re-created even if deleted.
 */
function markerPath(): string {
  return path.join(ensureKaiDir(), ".builtin-agents-installed");
}

function loadMarker(): Set<string> {
  try {
    const p = markerPath();
    if (fs.existsSync(p)) {
      const ids = fs.readFileSync(p, "utf-8").trim().split("\n").filter(Boolean);
      return new Set(ids);
    }
  } catch {}
  return new Set();
}

function saveMarker(installed: Set<string>): void {
  fs.writeFileSync(markerPath(), [...installed].join("\n") + "\n", "utf-8");
}

/**
 * Install any built-in agents that haven't been installed yet.
 * Call this once during startup. It's idempotent and fast.
 */
export function bootstrapBuiltinAgents(): number {
  const installed = loadMarker();
  let count = 0;

  for (const agent of BUILTIN_AGENTS) {
    // Skip if already offered (even if user deleted it)
    if (installed.has(agent.id)) continue;

    // Skip if somehow already exists in DB
    if (getAgent(agent.id)) {
      installed.add(agent.id);
      continue;
    }

    // Copy workflow YAML to ~/.kai/workflows/
    const srcYaml = path.join(__dirname, "builtin-workflows", agent.yamlFile);
    if (!fs.existsSync(srcYaml)) continue;

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
      enabled: 1,
      config: "{}",
    });

    installed.add(agent.id);
    count++;
  }

  saveMarker(installed);
  return count;
}
