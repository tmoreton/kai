/**
 * Template System
 * 
 * Pre-defined agent blueprints for dynamic spawning.
 */

import { saveAgent, getAgent, type AgentRecord } from "../agents/db.js";
import { parseWorkflow, type WorkflowDefinition } from "../agents/workflow.js";
import { registerAgentTriggers } from "./scheduler.js";
import type { TriggerConfig } from "./types.js";
import crypto from "crypto";

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  workflow: WorkflowDefinition | string; // Can be inline or path
  defaultConfig: Record<string, unknown>;
  requiredEnv?: string[];
  defaultTriggers?: TriggerConfig[];
}

// Template registry
const TEMPLATES = new Map<string, AgentTemplate>();

/**
 * Register a template.
 */
export function registerTemplate(template: AgentTemplate): void {
  TEMPLATES.set(template.id, template);
}

/**
 * Get a template by ID.
 */
export function getTemplate(id: string): AgentTemplate {
  const template = TEMPLATES.get(id);
  if (!template) {
    throw new Error(`Template not found: ${id}`);
  }
  return template;
}

/**
 * List all registered templates.
 */
export function listTemplates(): AgentTemplate[] {
  return [...TEMPLATES.values()];
}

/**
 * Spawn a new agent from a template.
 */
export async function spawnFromTemplate(
  templateId: string,
  config: Record<string, unknown>,
  options?: {
    oneTime?: boolean;
    parentContext?: {
      run_id: string;
      agent_id: string;
      vars: Record<string, unknown>;
    };
    goalId?: string;
  }
): Promise<string> {
  const template = getTemplate(templateId);
  
  // Check required env vars
  for (const envVar of template.requiredEnv || []) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }
  
  // Generate unique agent ID
  const agentId = `${templateId}-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`;
  
  // Merge configs
  const mergedConfig = {
    ...template.defaultConfig,
    ...config,
    ...(options?.parentContext && {
      parent_run_id: options.parentContext.run_id,
      parent_agent_id: options.parentContext.agent_id,
      inherited_vars: options.parentContext.vars,
    }),
    ...(options?.goalId && { goal_id: options.goalId }),
  };
  
  // Determine workflow path/content
  let workflowPath: string;
  if (typeof template.workflow === "string") {
    // It's a file path
    workflowPath = template.workflow;
  } else {
    // It's inline workflow - we'd need to save it to a file
    // For now, serialize to a temp location
    workflowPath = `/tmp/kai-workflow-${agentId}.yaml`;
    // TODO: Serialize workflow to YAML
  }
  
  // Save agent
  saveAgent({
    id: agentId,
    name: `${template.name} (${new Date().toISOString().slice(0, 10)})`,
    description: template.description,
    workflow_path: workflowPath,
    schedule: "",
    enabled: 1,
    config: JSON.stringify(mergedConfig),
  });
  
  // Register triggers (unless one-time)
  if (!options?.oneTime && template.defaultTriggers) {
    registerAgentTriggers({
      agentId,
      triggers: template.defaultTriggers,
    });
  }
  
  console.log(`[Template] Spawned ${agentId} from ${templateId}`);
  
  return agentId;
}

// --- Built-in Templates ---

// Register default templates
registerTemplate({
  id: "content-researcher",
  name: "Content Researcher",
  description: "Researches trending content topics for YouTube",
  workflow: "~/.kai/templates/content-researcher.yaml",
  defaultConfig: {
    topic: "",
    output_dir: "~/.kai/output",
  },
  requiredEnv: ["YOUTUBE_API_KEY"],
});

registerTemplate({
  id: "content-calendar",
  name: "Content Calendar",
  description: "Creates a content calendar from research",
  workflow: "~/.kai/templates/content-calendar.yaml",
  defaultConfig: {
    research_file: "",
    output_dir: "~/.kai/output",
  },
});

registerTemplate({
  id: "self-heal",
  name: "Self-Healing Agent",
  description: "Monitors errors and attempts fixes",
  workflow: "~/.kai/templates/self-heal.yaml",
  defaultConfig: {
    auto_fix: false,
    notify_on_fix: true,
  },
  defaultTriggers: [
    { type: "cron", expr: "0 3 * * *" }, // Daily at 3am
    { type: "event", filter: "error:detected" },
  ],
});

registerTemplate({
  id: "code-reviewer",
  name: "Code Review Agent",
  description: "Reviews PRs and suggests improvements",
  workflow: "~/.kai/templates/code-reviewer.yaml",
  defaultConfig: {
    auto_approve_minor: false,
  },
  defaultTriggers: [{ type: "event", filter: (e) => e.payload?.eventType === "git:pr:opened" }],
});

registerTemplate({
  id: "researcher",
  name: "Research Agent",
  description: "Gathers information on a topic",
  workflow: "~/.kai/templates/researcher.yaml",
  defaultConfig: {
    depth: "medium", // shallow, medium, deep
    sources: ["web", "archival"],
  },
});

registerTemplate({
  id: "writer",
  name: "Content Writer",
  description: "Writes content based on research",
  workflow: "~/.kai/templates/writer.yaml",
  defaultConfig: {
    tone: "professional",
    format: "markdown",
  },
});
