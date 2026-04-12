import { bashTool, bashBackgroundTool } from "./bash.js";
import { readFile, writeFile, editFile } from "./files.js";
import { globTool, grepTool } from "./search.js";
import { findSymbol, gotoDefinition, findReferences, listSymbols } from "../lsp/tools.js";
import { webFetch, webSearch } from "./web.js";

import { spawnAgent } from "../subagent.js";
import { runSwarm, handleScratchpadTool } from "../swarm.js";

import { getAgent, saveAgent, listAgents } from "../agents-core/db.js";
import { checkPermission } from "../permissions.js";
import { runBeforeHooks, runAfterHooks } from "../hooks.js";
import { ToolError, PermissionError } from "../errors.js";
import { updateCoreMemory, readCoreMemory } from "../soul.js";
import { searchRecall } from "../recall.js";
import { archivalInsert, archivalSearch } from "../archival.js";
import { tryExecuteMcpTool } from "./mcp.js";
import { tryExecuteSkillTool } from "../skills/executor.js";
import { skillsDir, loadSkill, unloadSkill, getLoadedSkills, getSkill } from "../skills/loader.js";
import fs from "fs";
import path from "path";
import { validateToolArgs } from "./validation.js";
import { isToolAllowedInPlanMode, isPlanMode } from "../plan-mode.js";
import { takeScreenshot } from "./screenshot.js";
import { analyzeImage } from "./vision.js";
import { recordError } from "../error-tracker.js";
import { sleep } from "../utils.js";

export type ToolResult = string;

// Track recent tool executions to prevent infinite self-heal loops
const recentSelfHeals = new Map<string, number>();
const MAX_SELF_HEALS_PER_TOOL = 3;
const SELF_HEAL_WINDOW_MS = 60_000; // 1 minute window

interface SelfHealStrategy {
  pattern: RegExp;
  description: string;
  fix: (name: string, args: Record<string, unknown>, error: string) => Promise<{ name: string; args: Record<string, unknown> } | null>;
}

const SELF_HEAL_STRATEGIES: SelfHealStrategy[] = [
  // 1. File not found - try with different path patterns
  {
    pattern: /(?:ENOENT|no such file|not found|File not found)/i,
    description: "File not found - trying alternative paths",
    fix: async (name, args, error) => {
      if (!args.file_path && !args.path) return null;
      
      const originalPath = String(args.file_path || args.path);
      const alternatives = [
        originalPath.replace(/^\/~/, process.env.HOME || ""), // Expand ~
        originalPath.replace(/^\.\//, ""), // Remove leading ./
        `./${originalPath}`, // Add leading ./
        originalPath.replace(/\\/g, "/"), // Normalize backslashes to forward slashes
      ];
      
      // Try each alternative
      for (const alt of alternatives) {
        if (alt !== originalPath) {
          try {
            const fs = await import("fs");
            if (fs.existsSync(alt)) {
              return { name, args: { ...args, file_path: alt, path: alt } };
            }
          } catch {}
        }
      }
      return null;
    }
  },
  
  // 2. Permission denied - try with sudo or different approach
  {
    pattern: /(?:EACCES|permission denied|Permission denied|access denied)/i,
    description: "Permission denied - attempting workaround",
    fix: async (name, args, error) => {
      if (name === "bash" && args.command) {
        const cmd = String(args.command);
        // Try with sudo for common permission issues
        if (!cmd.startsWith("sudo") && (cmd.includes("npm") || cmd.includes("global") || cmd.includes("/usr/local"))) {
          return { name, args: { ...args, command: `sudo ${cmd}` } };
        }
      }
      return null;
    }
  },
  
  // 3. Network timeout - retry with exponential backoff built in
  {
    pattern: /(?:ETIMEDOUT|ECONNRESET|socket hang up|fetch failed|timeout|network error)/i,
    description: "Network error - will retry",
    fix: async (name, args, error) => {
      // Just trigger a retry - the wrapper handles the delay
      return { name, args };
    }
  },
  
  // 4. Directory doesn't exist for write - create it first
  {
    pattern: /(?:directory.*not.*exist|ENOENT.*directory)/i,
    description: "Directory missing - creating parent directories",
    fix: async (name, args, error) => {
      if (args.file_path) {
        const path = await import("path");
        const fs = await import("fs");
        const dir = path.dirname(String(args.file_path));
        try {
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            return { name, args }; // Retry with directory now existing
          }
        } catch {}
      }
      return null;
    }
  },
  
  // 5. JSON parse error - try to fix malformed JSON arguments
  {
    pattern: /(?:Unexpected token|JSON.*parse|invalid json|malformed)/i,
    description: "JSON parse error - arguments may be malformed",
    fix: async (name, args, error) => {
      // This shouldn't happen with Zod validation, but handle it gracefully
      return null; // Let the normal error flow handle this
    }
  },
  
  // 6. Process already running (port in use) - try to kill or use different port
  {
    pattern: /(?:EADDRINUSE|address already in use|port.*in use|Port \d+ is already)/i,
    description: "Port in use - attempting to free it",
    fix: async (name, args, error) => {
      if (name === "bash" && args.command) {
        const cmd = String(args.command);
        const portMatch = error.match(/port (\d+)/i) || cmd.match(/:(\d+)/);
        if (portMatch) {
          const port = portMatch[1];
          // Try to kill process on that port first
          try {
            const { execSync } = await import("child_process");
            execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: "ignore" });
          } catch {}
          // Return same command to retry after kill attempt
          return { name, args };
        }
      }
      return null;
    }
  },
];

/**
 * Attempt to self-heal a failed tool execution.
 * Returns { healed: true, result } if fixed, { healed: false, error } if not.
 */
async function attemptToolSelfHeal(
  name: string,
  args: Record<string, unknown>,
  error: unknown,
  originalExecute: (name: string, args: Record<string, unknown>) => Promise<ToolResult>
): Promise<{ healed: boolean; result: ToolResult }> {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const healKey = `${name}:${errorMsg.substring(0, 100)}`;
  
  // Check heal rate limit
  const now = Date.now();
  const recentCount = recentSelfHeals.get(healKey) || 0;
  if (recentCount >= MAX_SELF_HEALS_PER_TOOL) {
    return { healed: false, result: `Tool "${name}" failed after max self-heal attempts: ${errorMsg}` };
  }
  
  // Find matching strategy
  for (const strategy of SELF_HEAL_STRATEGIES) {
    if (strategy.pattern.test(errorMsg)) {
      // Update heal counter
      recentSelfHeals.set(healKey, recentCount + 1);
      setTimeout(() => recentSelfHeals.delete(healKey), SELF_HEAL_WINDOW_MS);
      
      // Apply fix strategy
      const fixed = await strategy.fix(name, args, errorMsg);
      if (fixed) {
        try {
          // Wait briefly for network fixes
          if (strategy.description.includes("Network")) {
            await sleep(2000);
          }
          
          // Retry with fixed args
          const result = await originalExecute(fixed.name, fixed.args);
          return { healed: true, result };
        } catch (retryErr: unknown) {
          // Self-heal attempt failed, return original error
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          return { healed: false, result: `Tool "${name}" failed (self-heal attempted: ${strategy.description}): ${retryMsg}` };
        }
      }
      break; // Found matching strategy but no fix applied
    }
  }
  
  // No matching strategy
  return { healed: false, result: `Tool "${name}" failed: ${errorMsg}` };
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  toolCallId?: string
): Promise<ToolResult> {
  // Plan mode check - block write operations
  if (!isToolAllowedInPlanMode(name)) {
    throw new PermissionError(
      name, 
      "plan_mode", 
      `Plan mode active: "${name}" is a write operation and is blocked.\n\n` +
      `In plan mode, only read-only tools are allowed:\n` +
      `  - read_file, glob, grep - explore code\n` +
      `  - web_search, web_fetch - research\n` +
      `  - spawn_agent/spawn_swarm - use explorer/planner agents\n\n` +
      `Once you have a plan, present it to the user and tell them:\n` +
      `  "Type /plan to exit plan mode and I'll implement these changes."`
    );
  }

  // Validate tool arguments with Zod
  const validation = validateToolArgs(name, args);
  if (!validation.valid) {
    throw ToolError.validationFailed(name, validation.error!);
  }
  args = validation.args;

  const permission = await checkPermission(name, args);
  if (permission === "deny") {
    throw new PermissionError(name, "user", `Permission denied for ${name}. The user blocked this action.`);
  }

  // Run before-hooks - can deny execution
  const beforeHook = await runBeforeHooks(name, args);
  if (!beforeHook.allowed) {
    throw new PermissionError(name, "hook", `Hook denied ${name}: ${beforeHook.reason || "blocked by before-hook"}`);
  }

  let result: string;
  let selfHealAttempted = false;
  
  const executeToolInternal = async (toolName: string, toolArgs: Record<string, unknown>): Promise<ToolResult> => {
    switch (toolName) {
      case "bash":
        return await bashTool(toolArgs as { command: string; timeout?: number });
      case "bash_background":
        return await bashBackgroundTool(toolArgs as { command: string; wait_seconds?: number });
      case "read_file":
        return await readFile(toolArgs as { file_path: string; offset?: number; limit?: number });
      case "write_file":
        return await writeFile(toolArgs as { file_path: string; content: string }, toolCallId);
      case "edit_file":
        return await editFile(toolArgs as { file_path: string; old_string: string; new_string: string; replace_all?: boolean }, toolCallId);
      case "glob":
        return await globTool(toolArgs as { pattern: string; path?: string });
      case "grep":
        return await grepTool(toolArgs as { pattern: string; path?: string; include?: string; context?: number; ignore_case?: boolean });
      case "find_symbol":
        return await findSymbol(toolArgs as { name: string; type?: "function" | "class" | "interface" | "variable" | "constant" | "import"; file?: string; path?: string });
      case "goto_definition":
        return await gotoDefinition(toolArgs as { name: string; file?: string; path?: string });
      case "find_references":
        return await findReferences(toolArgs as { name: string; file?: string; path?: string });
      case "list_symbols":
        return await listSymbols(toolArgs as { file: string; type?: "function" | "class" | "interface" | "variable"; path?: string });
      case "web_fetch":
        return await webFetch(toolArgs as { url: string; method?: string; headers?: Record<string, string> });
      case "web_search":
        return await webSearch(toolArgs as { query: string; max_results?: number });
      case "core_memory_read":
        return readCoreMemory((toolArgs as { block?: "personality" | "human" | "goals" | "scratchpad" }).block);
      case "core_memory_update":
        return updateCoreMemory(
          (toolArgs as { block: "personality" | "human" | "goals" | "scratchpad" }).block,
          (toolArgs as { operation: "replace" | "append" }).operation,
          String(toolArgs.content)
        );
      case "recall_search": {
        const results = searchRecall(String(toolArgs.query), (toolArgs as { limit?: number }).limit);
        return results.length === 0
          ? "No matching past conversations found."
          : results.map((r) => `[${r.timestamp}] ${r.role}: ${r.content.substring(0, 300)}`).join("\n\n");
      }
      case "archival_insert":
        return archivalInsert(toolArgs as { content: string; tags?: string[]; source?: string });
      case "archival_search":
        return archivalSearch(toolArgs as { query: string; tags?: string[]; limit?: number });
      case "spawn_agent":
        return await spawnAgent(toolArgs as { agent: string; task: string });
      case "spawn_swarm":
        return await runSwarm(toolArgs.tasks as Array<{ agent: "explorer" | "planner" | "worker"; task: string }>);
      case "agent_memory_read": {
        const field = toolArgs.field as string | undefined;
        const agentId = toolArgs._agent_id as string;
        if (!agentId) {
          const agents = listAgents();
          return agents.map((a) => {
            const config = typeof a.config === "string" ? JSON.parse(a.config) : (a.config ?? {});
            return `**${a.name}** (${a.id})\n  Role: ${config.role || "N/A"}\n  Goals: ${(config.goals || "").substring(0, 200)}`;
          }).join("\n\n");
        }
        const agent = getAgent(agentId);
        if (!agent) return `Agent "${agentId}" not found.`;
        const config = typeof agent.config === "string" ? JSON.parse(agent.config) : (agent.config ?? {});
        if (field && field in config) {
          return `[${field}]: ${config[field]}`;
        }
        return `[goals]: ${config.goals || "(empty)"}\n\n[scratchpad]: ${config.scratchpad || "(empty)"}\n\n[personality]: ${config.personality || "(empty)"}\n\n[role]: ${config.role || "(empty)"}`;
      }
      case "agent_memory_update": {
        const agentId = toolArgs._agent_id as string;
        if (!agentId) return "No agent context - this tool is for agents with memory.";
        const agent = getAgent(agentId);
        if (!agent) return `Agent "${agentId}" not found.`;
        const config = typeof agent.config === "string" ? JSON.parse(agent.config) : (agent.config ?? {});
        const field = toolArgs.field as "goals" | "scratchpad" | "personality" | "role";
        const operation = toolArgs.operation as "replace" | "append";
        const content = String(toolArgs.content);
        if (operation === "append") {
          config[field] = (config[field] || "") + "\n" + content;
        } else {
          config[field] = content;
        }
        saveAgent({ ...agent, config });
        return `Updated ${field} (${operation}).`;
      }
      case "agent_create": {
        const agentId = String(toolArgs.id);
        const config = {
          role: String(toolArgs.role),
          personality: String(toolArgs.personality),
          goals: String(toolArgs.goals),
          scratchpad: "",
          tools: toolArgs.tools as string[] | undefined,
          maxTurns: toolArgs.max_turns as number | undefined,
        };
        saveAgent({
          id: agentId,
          name: String(toolArgs.name),
          description: `Agent created via agent_create tool`,
          workflow_path: "",
          schedule: "",
          enabled: 0,
          config: JSON.stringify(config),
        });
        return `Created agent "${toolArgs.name}" (${agentId}).`;
      }
      case "agent_list": {
        const agents = listAgents();
        if (agents.length === 0) {
          return "No agents defined. Use agent_create to define one.";
        }
        return agents.map((a) => {
          const config = typeof a.config === "string" ? JSON.parse(a.config) : (a.config ?? {});
          return `• **${a.name}** (${a.id}) - ${config.role || "N/A"}\n  Goals: ${(config.goals || "").substring(0, 150)}`;
        }).join("\n\n");
      }
      case "swarm_scratchpad_read":
      case "swarm_scratchpad_write": {
        const scratchResult = handleScratchpadTool(toolName, toolArgs as Record<string, any>);
        return scratchResult ?? `Scratchpad tool "${toolName}" returned no result.`;
      }
      case "generate_image": {
        const skillResult = await tryExecuteSkillTool("skill__openrouter__generate_image", toolArgs);
        if (skillResult !== null && !skillResult.includes("not installed")) {
          return skillResult;
        }
        throw new Error('Image generation requires the openrouter skill. Install with: kai skill install openrouter');
      }
      case "take_screenshot":
        return await takeScreenshot(toolArgs as { region?: "full" | "window" | "selection" });
      case "analyze_image":
        return await analyzeImage(toolArgs as { image_path: string; question?: string });
      // Skill management tools
      case "skill_create": {
        const { name, description, code } = toolArgs as { name: string; description: string; code: string };
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const dir = skillsDir();
        const skillPath = path.join(dir, id);
        
        if (fs.existsSync(skillPath)) {
          return `Skill "${id}" already exists. Use skill_update to modify it.`;
        }
        
        fs.mkdirSync(skillPath, { recursive: true });
        const manifest = `id: ${id}\nname: ${name}\nversion: 1.0.0\ndescription: ${description || ""}\nauthor: llm\ntools: []\n`;
        fs.writeFileSync(path.join(skillPath, "skill.yaml"), manifest, "utf-8");
        fs.writeFileSync(path.join(skillPath, "handler.js"), code, "utf-8");
        
        await loadSkill(skillPath);
        return `Created skill "${name}" (${id}) with ${code.split('\\n').length} lines of code. Available immediately.`;
      }
      case "skill_list": {
        const skills = getLoadedSkills();
        if (skills.length === 0) return "No skills installed.";
        return skills.map(s => {
          const toolCount = s.manifest.tools?.length || 0;
          const source = s.source ? ` [source: ${s.source}]` : " [custom]";
          return `• **${s.manifest.name}** (${s.manifest.id})${source}\n  ${s.manifest.description || "No description"}\n  ${toolCount} tools`;
        }).join("\\n\\n");
      }
      case "skill_read": {
        const { skill_id } = toolArgs as { skill_id: string };
        const skill = getSkill(skill_id);
        if (!skill) return `Skill "${skill_id}" not found.`;
        
        const handlerPath = path.join(skill.path, "handler.js");
        const code = fs.existsSync(handlerPath) ? fs.readFileSync(handlerPath, "utf-8") : "// No handler.js found";
        return `## ${skill.manifest.name} (${skill_id})\\n\\n${code}`;
      }
      case "skill_update": {
        const { skill_id, code, description } = toolArgs as { skill_id: string; code: string; description?: string };
        const skill = getSkill(skill_id);
        if (!skill) return `Skill "${skill_id}" not found.`;
        if (skill.source) return `Cannot update "${skill_id}" - it was installed from ${skill.source}. Use skill_create to make a new skill.`;
        
        const handlerPath = path.join(skill.path, "handler.js");
        fs.writeFileSync(handlerPath, code, "utf-8");
        
        if (description) {
          const manifestPath = path.join(skill.path, "skill.yaml");
          const YAML = await import("yaml");
          const manifest = YAML.parse(fs.readFileSync(manifestPath, "utf-8"));
          manifest.description = description;
          fs.writeFileSync(manifestPath, YAML.stringify(manifest), "utf-8");
        }
        
        await unloadSkill(skill_id);
        await loadSkill(skill.path);
        return `Updated skill "${skill_id}". Changes are live immediately.`;
      }
      default: {
        const mcpResult = await tryExecuteMcpTool(toolName, toolArgs);
        if (mcpResult !== null) return mcpResult;
        const skillResult = await tryExecuteSkillTool(toolName, toolArgs);
        if (skillResult !== null) return skillResult;
        throw ToolError.unknown(toolName);
      }
    }
  };

  try {
    result = await executeToolInternal(name, args);
  } catch (err: unknown) {
    // Try self-heal before giving up (but only once per execution)
    if (!selfHealAttempted) {
      selfHealAttempted = true;
      const healed = await attemptToolSelfHeal(name, args, err, executeToolInternal);
      if (healed.healed) {
        result = healed.result;
      } else {
        // Self-heal failed or wasn't applicable - return error message
        if (err instanceof PermissionError || err instanceof ToolError) {
          result = err.message;
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          result = `Tool "${name}" failed: ${msg}`;
        }
      }
    } else {
      // Already tried self-heal, just return error
      if (err instanceof PermissionError || err instanceof ToolError) {
        result = err.message;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        result = `Tool "${name}" failed: ${msg}`;
      }
    }
    recordError({ source: "tool", error: err, context: { toolName: name, args, selfHealed: result.includes("self-heal") } });
  }

  // Run after-hooks - can override output
  const afterHook = await runAfterHooks(name, args, result);
  if (afterHook.overrideOutput) {
    result = afterHook.overrideOutput;
  }

  return result;
}
