import fs from "fs";
import path from "path";
import YAML from "yaml";
import chalk from "chalk";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { ensureKaiDir } from "../config.js";
import type { SkillManifest, SkillHandler, LoadedSkill } from "./types.js";
import { installSkill } from "./installer.js";

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
 * Load environment variables from ~/.kai/.env file
 * This makes vars set via the web UI available to skills
 */
function loadEnvFile(): Record<string, string> {
  const envPath = path.join(ensureKaiDir(), ".env");
  const vars: Record<string, string> = {};
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq > 0) {
          const key = trimmed.slice(0, eq).trim();
          const value = trimmed.slice(eq + 1).trim();
          vars[key] = value;
        }
      }
    }
  } catch {}
  return vars;
}

/**
 * Get the skills directory path, creating it if needed.
 */
export function skillsDir(): string {
  const dir = path.join(ensureKaiDir(), "skills");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Ensure lib/credentials.js exists for skills that need it.
 * Clones just the lib directory from kai-skills repo.
 */
async function ensureLibCredentials(): Promise<void> {
  const libDir = path.join(ensureKaiDir(), "lib");
  const credPath = path.join(libDir, "credentials.js");

  if (fs.existsSync(credPath)) return;

  try {
    const { execSync } = await import("child_process");
    const tempDir = path.join(ensureKaiDir(), `.temp-lib-${Date.now()}`);

    // Clone just the lib directory
    execSync(
      `git clone --depth 1 --filter=blob:none --sparse "https://github.com/tmoreton/kai-skills.git" "${tempDir}"`,
      { timeout: 60_000, stdio: "pipe" }
    );
    execSync(
      `cd "${tempDir}" && git sparse-checkout set lib`,
      { timeout: 30_000, stdio: "pipe" }
    );

    // Copy lib directory
    const libSource = path.join(tempDir, "lib");
    if (fs.existsSync(libSource)) {
      fs.mkdirSync(libDir, { recursive: true });
      fs.cpSync(libSource, libDir, { recursive: true, force: true });
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Silent fail - manual install will work
  }
}

/**
 * Load all skills from ~/.kai/skills/.
 * Auto-installs default skills (openrouter) if API key is present.
 */
export async function loadAllSkills(): Promise<void> {
  const dir = skillsDir();

  // Ensure lib/credentials.js exists before installing skills
  await ensureLibCredentials();

  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const skillPath = path.join(dir, entry.name);
    try {
      await loadSkill(skillPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.yellow(`  Warning: Failed to load skill "${entry.name}": ${msg}`));
    }
  }

  // Auto-install skills that don't require API keys
  const noKeySkills = ["git", "data-storage", "docker", "database", "webhook", "browser"];

  for (const id of noKeySkills) {
    if (!skills.has(id)) {
      try {
        console.log(chalk.blue(`  Auto-installing ${id} skill...`));
        await installSkill(id);
        // Load the newly installed skill
        const skillPath = path.join(dir, id);
        if (fs.existsSync(skillPath)) {
          await loadSkill(skillPath);
        }
      } catch {
        // Silent fail - lib/ may not be ready yet
      }
    }
  }

  // Auto-install skills based on detected API keys
  const apiKeySkills: { id: string; envKey: string }[] = [
    { id: "openrouter", envKey: "OPENROUTER_API_KEY" },
    { id: "youtube", envKey: "YOUTUBE_API_KEY" },
    { id: "twitter", envKey: "X_API_KEY" },
  ];

  for (const { id, envKey } of apiKeySkills) {
    if (process.env[envKey] && !skills.has(id)) {
      try {
        console.log(chalk.blue(`  Auto-installing ${id} skill (API key detected)...`));
        await installSkill(id);
        const skillPath = path.join(dir, id);
        if (fs.existsSync(skillPath)) {
          await loadSkill(skillPath);
        }
      } catch {
        // Silent fail
      }
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
  
  // Normalize config_schema from array to object format for API consistency
  if (manifest.config_schema && Array.isArray(manifest.config_schema)) {
    const schemaObj: Record<string, any> = {};
    for (const field of manifest.config_schema) {
      const key = field.key || field.name || field.env;
      if (key) schemaObj[key] = field;
    }
    manifest.config_schema = schemaObj;
  }

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

  // Resolve config from environment variables and ~/.kai/.env file
  // Check order: field.env → bare key → env file → default
  const envFileVars = loadEnvFile();
  const config: Record<string, any> = {};
  if (manifest.config_schema) {
    // Handle both array format ([{key, ...}]) and object format ({key: {...}})
    const schemaEntries = Array.isArray(manifest.config_schema)
      ? manifest.config_schema.map((field: any) => [field.key || field.name, field])
      : Object.entries(manifest.config_schema);
    
    for (const [key, field] of schemaEntries) {
      const fieldEnv = field.env || field.key || key;
      const value = (fieldEnv && (process.env[fieldEnv] || envFileVars[fieldEnv])) || 
                    process.env[key] || 
                    envFileVars[key];
      if (value !== undefined) {
        config[key] = value;
      } else if (field.default !== undefined) {
        config[key] = field.default;
      } else if (field.required) {
        console.warn(chalk.yellow(`  Skill "${manifest.id}": set ${fieldEnv || key} to enable`));
      }
    }
  }

  // Run install hook if present
  if (handler.install) {
    await handler.install(config);
  }

  // Check for source tracking file
  const sourcePath = path.join(skillPath, ".source");
  let source: string | undefined;
  try {
    if (fs.existsSync(sourcePath)) {
      source = fs.readFileSync(sourcePath, "utf-8").trim();
    }
  } catch {}

  const loaded: LoadedSkill = {
    manifest,
    handler,
    config,
    path: skillPath,
    loaded_at: Date.now(),
    source,
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
 * Generate OpenAI-compatible tool definitions for skills.
 * Tools are namespaced as skill__<id>__<tool_name>.
 * If relevantCategories is provided, only skills matching those categories are included.
 */
export function getSkillToolDefinitions(relevantCategories?: string[] | null): ChatCompletionTool[] {
  const defs: ChatCompletionTool[] = [];

  for (const skill of skills.values()) {
    // Filter by category if specified
    if (relevantCategories && !shouldLoadSkill(skill.manifest.id, relevantCategories)) {
      continue;
    }

    for (const tool of skill.manifest.tools) {
      // Build OpenAI-schema parameters from skill tool definition
      const properties: Record<string, any> = {};
      const required: string[] = tool.required || [];

      for (const [paramName, paramDef] of Object.entries(tool.parameters || {})) {
        properties[paramName] = {
          type: paramDef.type,
          // Truncate verbose parameter descriptions
          description: truncateParamDescription(paramDef.description || "", paramName),
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
          description: truncateSkillDescription(`[${skill.manifest.name}] ${tool.description}`),
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

// Truncate parameter descriptions aggressively - types are self-documenting
function truncateParamDescription(desc: string, paramName: string): string {
  if (!desc || desc.length <= 20) return desc || paramName;
  // Remove obvious phrases and filler words
  const cleaned = desc
    .replace(/\b(The|A|An|This|That)\s+/gi, "")
    .replace(/\b(optional|required|the|to|for|of|in)\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= 20) return cleaned;
  return cleaned.slice(0, 17) + "...";
}

/**
 * Build a namespaced tool name: skill__<id>__<tool>
 */
export function skillToolName(skillId: string, toolName: string): string {
  return `skill__${skillId}__${toolName}`;
}

const MAX_SKILL_DESCRIPTION_LENGTH = 60;

// Skill categories for intent-based filtering
export const SKILL_CATEGORIES: Record<string, string[]> = {
  coding: ["git", "docker", "database", "data-storage"],
  social: ["youtube", "twitter", "instagram", "linkedin", "facebook", "tiktok", "threads", "bluesky", "slack"],
  web: ["browser", "web-tools", "webhook"],
  content: ["notion", "google-sheets", "email"],
  ai: ["openrouter"],
  dashboard: ["dashboard"],
};

// Map skill IDs to their categories for quick lookup
export function getSkillCategory(skillId: string): string | null {
  for (const [category, skills] of Object.entries(SKILL_CATEGORIES)) {
    if (skills.includes(skillId)) return category;
  }
  return null;
}

// Intent keywords that trigger specific skill categories
const CATEGORY_INTENT_KEYWORDS: Record<string, RegExp> = {
  social: /\b(post|tweet|youtube|twitter|instagram|linkedin|social|upload|video|schedule|analytics|followers|engagement)\b/i,
  web: /\b(browser|scrape|navigate|click|screenshot|web page|login|form|automation)\b/i,
  content: /\b(notion|sheet|spreadsheet|email|send mail|document|draft)\b/i,
  ai: /\b(image|generate|art|create image|draw|illustration)\b/i,
  dashboard: /\b(dashboard|analytics|metrics|charts|stats|overview)\b/i,
  coding: /\b(git|database|db|docker|container|sql|query|backup)\b/i,
};

/**
 * Determine which skill categories are relevant based on user message intent.
 * Returns array of category names, or null for all categories (no filter).
 */
export function getRelevantSkillCategories(message: string): string[] | null {
  const content = message.toLowerCase();
  const relevant: string[] = [];

  // Check for social media keywords
  if (CATEGORY_INTENT_KEYWORDS.social.test(content)) relevant.push("social");
  if (CATEGORY_INTENT_KEYWORDS.web.test(content)) relevant.push("web");
  if (CATEGORY_INTENT_KEYWORDS.content.test(content)) relevant.push("content");
  if (CATEGORY_INTENT_KEYWORDS.ai.test(content)) relevant.push("ai");
  if (CATEGORY_INTENT_KEYWORDS.dashboard.test(content)) relevant.push("dashboard");
  if (CATEGORY_INTENT_KEYWORDS.coding.test(content)) relevant.push("coding");

  // If no specific category detected, return null (load all)
  return relevant.length > 0 ? relevant : null;
}

/**
 * Check if a skill should be loaded based on detected categories.
 */
export function shouldLoadSkill(skillId: string, relevantCategories: string[] | null): boolean {
  if (!relevantCategories) return true; // Load all if no filter
  const category = getSkillCategory(skillId);
  if (!category) return true; // Uncategorized skills always load
  return relevantCategories.includes(category);
}

function truncateSkillDescription(description: string): string {
  // Remove verbose filler words
  let cleaned = description
    .replace(/\b(Use (this|for)|You can|This is|This will|Allows you to|Used to)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length <= MAX_SKILL_DESCRIPTION_LENGTH) return cleaned;
  return cleaned.slice(0, MAX_SKILL_DESCRIPTION_LENGTH - 3) + "...";
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
