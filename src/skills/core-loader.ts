import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";
import chalk from "chalk";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { SkillManifest, SkillHandler, LoadedSkill } from "./types.js";

/**
 * Core Skills Loader
 *
 * Loads bundled core skills from src/skills/core/ (built into dist/skills/core/).
 * These are always available, bundled with the app, and loaded before user skills.
 * Unlike user skills in ~/.kai/skills/, core skills cannot be uninstalled.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Core skills are bundled in dist/skills/core/
const CORE_SKILLS_DIR = path.join(__dirname, "core");

// Cache of loaded core skills
const coreSkills = new Map<string, LoadedSkill>();

/**
 * Load all core skills from the bundled core/ directory.
 * Called once at startup, before user skills.
 */
export async function loadCoreSkills(): Promise<void> {
  if (!fs.existsSync(CORE_SKILLS_DIR)) {
    return; // No core skills directory (shouldn't happen in production)
  }

  const entries = fs.readdirSync(CORE_SKILLS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillPath = path.join(CORE_SKILLS_DIR, entry.name);
    const manifestPath = path.join(skillPath, "skill.yaml");

    if (!fs.existsSync(manifestPath)) continue;

    try {
      const raw = fs.readFileSync(manifestPath, "utf-8");
      const manifest = YAML.parse(raw) as SkillManifest;

      if (!manifest.id) throw new Error(`Core skill in ${entry.name} missing 'id'`);
      if (!manifest.name) throw new Error(`Core skill ${manifest.id} missing 'name'`);
      if (!manifest.version) manifest.version = "1.0.0";
      if (!manifest.tools) manifest.tools = [];

      // Load handler
      const handlerPath = path.join(skillPath, "handler.js");
      let handler: SkillHandler;

      if (fs.existsSync(handlerPath)) {
        const mod = await import(`file://${handlerPath}`);
        handler = mod.default || mod;

        if (!handler.actions || typeof handler.actions !== "object") {
          throw new Error(`Core skill "${manifest.id}" handler must export an 'actions' object`);
        }
      } else {
        handler = { actions: {} };
      }

      const loaded: LoadedSkill = {
        manifest,
        handler,
        config: {}, // Core skills don't use env-based config
        path: skillPath,
        loaded_at: Date.now(),
      };

      coreSkills.set(manifest.id, loaded);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.yellow(`  Warning: Failed to load core skill "${entry.name}": ${msg}`));
    }
  }
}

/**
 * Get all loaded core skills.
 */
export function getCoreSkills(): LoadedSkill[] {
  return [...coreSkills.values()];
}

/**
 * Get a specific core skill by ID.
 */
export function getCoreSkill(id: string): LoadedSkill | undefined {
  return coreSkills.get(id);
}

/**
 * Generate OpenAI-compatible tool definitions for all core skills.
 * Same format as user skills: skill__<id>__<tool_name>
 */
export function getCoreSkillToolDefinitions(): ChatCompletionTool[] {
  const defs: ChatCompletionTool[] = [];

  for (const skill of coreSkills.values()) {
    for (const tool of skill.manifest.tools) {
      const properties: Record<string, any> = {};
      const required: string[] = tool.required || [];

      for (const [paramName, paramDef] of Object.entries(tool.parameters)) {
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
          name: `skill__${skill.manifest.id}__${tool.name}`,
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
 * Try to execute a tool call on a core skill.
 * Returns null if not a core skill tool.
 */
export async function tryExecuteCoreSkillTool(
  name: string,
  args: Record<string, unknown>
): Promise<string | null> {
  // Parse skill__<id>__<tool> format
  const match = name.match(/^skill__([^_]+(?:__[^_]+)*)__(.+)$/);
  if (!match) return null;

  const parts = name.substring(7).split("__");
  if (parts.length < 2) return null;

  const toolName = parts.pop()!;
  const skillId = parts.join("__");

  const skill = coreSkills.get(skillId);
  if (!skill) return null;

  const actionFn = skill.handler.actions[toolName];
  if (!actionFn) {
    throw new Error(
      `Core skill "${skillId}" has no action "${toolName}". Available: ${Object.keys(skill.handler.actions).join(", ")}`
    );
  }

  return await actionFn(args);
}
