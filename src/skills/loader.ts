import fs from "fs";
import path from "path";
import YAML from "yaml";
import chalk from "chalk";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { ensureKaiDir } from "../config.js";
import type { SkillManifest, SkillHandler, LoadedSkill } from "./types.js";

/**
 * Skill Loader
 *
 * Discovers, loads, validates, and hot-reloads skills from ~/.kai/skills/.
 * Each skill is a directory with:
 *   - skill.yaml  — manifest (id, name, tools, config schema)
 *   - handler.js  — exported actions
 */

const skills = new Map<string, LoadedSkill>();

/**
 * Get the skills directory path, creating it if needed.
 */
export function skillsDir(): string {
  const dir = path.join(ensureKaiDir(), "skills");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Load all skills from ~/.kai/skills/.
 */
export async function loadAllSkills(): Promise<void> {
  const dir = skillsDir();
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(dir, entry.name);
    try {
      await loadSkill(skillPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.yellow(`  Warning: Failed to load skill "${entry.name}": ${msg}`));
    }
  }
}

/**
 * Load a single skill from a directory.
 */
export async function loadSkill(skillPath: string): Promise<LoadedSkill> {
  const manifestPath = path.join(skillPath, "skill.yaml");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No skill.yaml found in ${skillPath}`);
  }

  // Parse manifest
  const raw = fs.readFileSync(manifestPath, "utf-8");
  const manifest = YAML.parse(raw) as SkillManifest;

  if (!manifest.id) throw new Error("Skill manifest must have an 'id' field");
  if (!manifest.name) throw new Error("Skill manifest must have a 'name' field");
  if (!manifest.version) manifest.version = "1.0.0";
  if (!manifest.tools) manifest.tools = [];

  // Load handler module - support both .js (compiled) and .ts (source)
  const handlerJsPath = path.join(skillPath, "handler.js");
  const handlerTsPath = path.join(skillPath, "handler.ts");
  let handlerPath: string | null = null;
  
  if (fs.existsSync(handlerJsPath)) {
    handlerPath = handlerJsPath;
  } else if (fs.existsSync(handlerTsPath)) {
    handlerPath = handlerTsPath;
  }
  
  let handler: SkillHandler;

  if (handlerPath) {
    // Use dynamic import with cache-busting for hot reload
    const moduleUrl = `file://${handlerPath}?t=${Date.now()}`;
    
    try {
      const mod = await import(moduleUrl);
      handler = mod.default || mod;
    } catch (importErr: any) {
      // Check if it's a TypeScript syntax error
      const errorMsg = importErr.message || String(importErr);
      
      if (errorMsg.includes("strict mode reserved word") || 
          errorMsg.includes("Unexpected identifier") ||
          errorMsg.includes("Cannot use import statement")) {
        throw new Error(
          `Skill "${manifest.id}" handler appears to be TypeScript that wasn't compiled. ` +
          `Please ensure the skill has a compiled handler.js file. ` +
          `Original error: ${errorMsg}`
        );
      }
      
      throw importErr;
    }

    if (!handler.actions || typeof handler.actions !== "object") {
      throw new Error(`Skill "${manifest.id}" handler must export an 'actions' object`);
    }
  } else {
    // No handler file — tools defined in manifest only (useful for MCP-bridge skills)
    handler = { actions: {} };
  }

  // Resolve config from environment variables
  // Check order: field.env → bare key (e.g. SMTP_HOST) → default
  const config: Record<string, any> = {};
  if (manifest.config_schema) {
    for (const [key, field] of Object.entries(manifest.config_schema)) {
      const value = (field.env && process.env[field.env]) || process.env[key];
      if (value !== undefined) {
        config[key] = value;
      } else if (field.default !== undefined) {
        config[key] = field.default;
      } else if (field.required) {
        console.warn(chalk.yellow(`  Skill "${manifest.id}": missing required config "${key}" (set ${key})`));
      }
    }
  }

  // Run install hook if present
  if (handler.install) {
    await handler.install(config);
  }

  const loaded: LoadedSkill = {
    manifest,
    handler,
    config,
    path: skillPath,
    loaded_at: Date.now(),
  };

  skills.set(manifest.id, loaded);
  return loaded;
}

/**
 * Unload a skill by ID.
 */
export async function unloadSkill(id: string): Promise<boolean> {
  const skill = skills.get(id);
  if (!skill) return false;

  if (skill.handler.uninstall) {
    await skill.handler.uninstall();
  }

  skills.delete(id);
  return true;
}

/**
 * Reload all skills (hot reload).
 */
export async function reloadAllSkills(): Promise<{ loaded: number; errors: string[] }> {
  const errors: string[] = [];

  // Unload all current skills
  for (const [id, skill] of skills) {
    try {
      if (skill.handler.uninstall) await skill.handler.uninstall();
    } catch {}
  }
  skills.clear();

  // Reload from disk
  const dir = skillsDir();
  if (!fs.existsSync(dir)) return { loaded: 0, errors };

  let loaded = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await loadSkill(path.join(dir, entry.name));
      loaded++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${entry.name}: ${msg}`);
    }
  }

  return { loaded, errors };
}

/**
 * Get all loaded skills.
 */
export function getLoadedSkills(): LoadedSkill[] {
  return [...skills.values()];
}

/**
 * Get a specific loaded skill by ID.
 */
export function getSkill(id: string): LoadedSkill | undefined {
  return skills.get(id);
}

/**
 * Set/register a skill directly (used for testing/mocking).
 */
export function setSkill(id: string, skill: LoadedSkill): void {
  skills.set(id, skill);
}

/**
 * Generate OpenAI-compatible tool definitions for all loaded skills.
 * Tools are namespaced as skill__<id>__<tool_name>.
 */
export function getSkillToolDefinitions(): ChatCompletionTool[] {
  const defs: ChatCompletionTool[] = [];

  for (const skill of skills.values()) {
    for (const tool of skill.manifest.tools) {
      // Build OpenAI-schema parameters from skill tool definition
      const properties: Record<string, any> = {};
      const required: string[] = tool.required || [];

      for (const [paramName, paramDef] of Object.entries(tool.parameters || {})) {
        properties[paramName] = {
          type: paramDef.type,
          description: paramDef.description || paramName,
        };
        if (paramDef.enum) {
          properties[paramName].enum = paramDef.enum;
        }
        if (paramDef.required && !required.includes(paramName)) {
          required.push(paramName);
        }
      }

      defs.push({
        type: "function",
        function: {
          name: skillToolName(skill.manifest.id, tool.name),
          description: `[Skill: ${skill.manifest.name}] ${tool.description}`,
          parameters: {
            type: "object",
            properties,
            ...(required.length > 0 ? { required } : {}),
          },
        },
      });
    }
  }

  return defs;
}

/**
 * Build a namespaced tool name: skill__<id>__<tool>
 */
export function skillToolName(skillId: string, toolName: string): string {
  return `skill__${skillId}__${toolName}`;
}

/**
 * Parse a namespaced tool name back into skill ID and tool name.
 */
export function parseSkillToolName(name: string): { skillId: string; toolName: string } | null {
  const match = name.match(/^skill__([^_]+(?:__[^_]+)*)__(.+)$/);
  if (!match) return null;

  // Handle skill IDs that might contain single underscores by being more careful
  // The format is skill__<id>__<toolname>
  const parts = name.substring(7).split("__"); // strip "skill__"
  if (parts.length < 2) return null;

  const toolName = parts[parts.length - 1];
  const skillId = parts.slice(0, -1).join("__");

  return { skillId, toolName };
}
