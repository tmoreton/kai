import fs from "fs";
import path from "path";
import YAML from "yaml";
import { z } from "zod";
import type {
  SkillManifest,
  SkillHandler,
  LoadedSkill,
  SkillLoaderConfig,
  GenericToolDefinition,
  LoggerInterface,
  SkillDependencies,
} from "../types/index.js";

/**
 * Default silent logger
 */
const silentLogger: LoggerInterface = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Manifest validation schema
 */
const ManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().default("1.0.0"),
  description: z.string().optional(),
  author: z.string().optional(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      parameters: z.record(z.any()).default({}),
      required: z.array(z.string()).optional(),
    })
  ).default([]),
  config_schema: z.record(z.any()).optional(),
  dependencies: z.record(z.string()).optional(),
  minCoreVersion: z.string().optional(),
  category: z.string().optional(),
});

/**
 * SkillLoader - discovers, loads, validates, and hot-reloads skills
 *
 * Configurable and framework-agnostic. Can be used by any tool.
 */
export class SkillLoader {
  private skills = new Map<string, LoadedSkill>();
  private config: Required<SkillLoaderConfig>;
  private logger: LoggerInterface;

  constructor(config: SkillLoaderConfig) {
    this.config = {
      skillsDir: config.skillsDir,
      builtinsDir: config.builtinsDir,
      enableBootstrap: config.enableBootstrap ?? false,
      logger: config.logger ?? silentLogger,
      dependencies: config.dependencies ?? {},
      onSkillLoaded: config.onSkillLoaded,
      onSkillError: config.onSkillError,
      toolFormatter: config.toolFormatter ?? this.defaultToolFormatter,
    };
    this.logger = this.config.logger;
  }

  /**
   * Load all skills from the configured skills directory
   */
  async loadAll(): Promise<LoadedSkill[]> {
    // Bootstrap built-ins if enabled
    if (this.config.enableBootstrap && this.config.builtinsDir) {
      this.bootstrapBuiltins();
    }

    if (!fs.existsSync(this.config.skillsDir)) {
      this.logger.debug(`Skills directory does not exist: ${this.config.skillsDir}`);
      return [];
    }

    const entries = fs.readdirSync(this.config.skillsDir, { withFileTypes: true });
    const loaded: LoadedSkill[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = path.join(this.config.skillsDir, entry.name);
      try {
        const skill = await this.load(skillPath);
        loaded.push(skill);
        this.config.onSkillLoaded?.(skill);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Failed to load skill "${entry.name}": ${msg}`);
        this.config.onSkillError?.(entry.name, err instanceof Error ? err : new Error(msg));
      }
    }

    return loaded;
  }

  /**
   * Load a single skill from a directory
   */
  async load(skillPath: string): Promise<LoadedSkill> {
    const manifestPath = path.join(skillPath, "skill.yaml");
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`No skill.yaml found in ${skillPath}`);
    }

    // Parse and validate manifest
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const parsed = YAML.parse(raw);
    const validation = ManifestSchema.safeParse(parsed);

    if (!validation.success) {
      throw new Error(`Invalid skill.yaml: ${validation.error.message}`);
    }

    const manifest = validation.data as SkillManifest;

    // Load handler module
    const handlerPath = path.join(skillPath, "handler.js");
    let handler: SkillHandler;

    if (fs.existsSync(handlerPath)) {
      // Use dynamic import with cache-busting for hot reload
      const moduleUrl = `file://${handlerPath}?t=${Date.now()}`;
      const mod = await import(moduleUrl);
      handler = mod.default || mod;

      if (!handler.actions || typeof handler.actions !== "object") {
        throw new Error(`Skill "${manifest.id}" handler must export an 'actions' object`);
      }
    } else {
      // No handler file - manifest-only skill (useful for MCP bridge)
      handler = { actions: {} };
    }

    // Resolve config from environment variables and schema defaults
    const config = this.resolveConfig(manifest);

    // Run install hook if present
    if (handler.install) {
      try {
        await handler.install(config, this.config.dependencies);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Install hook failed for "${manifest.id}": ${msg}`);
      }
    }

    const loaded: LoadedSkill = {
      manifest,
      handler,
      config,
      path: skillPath,
      loaded_at: Date.now(),
    };

    this.skills.set(manifest.id, loaded);
    this.logger.info(`Loaded skill: ${manifest.name}@${manifest.version}`);

    return loaded;
  }

  /**
   * Unload a skill by ID
   */
  async unload(id: string): Promise<boolean> {
    const skill = this.skills.get(id);
    if (!skill) return false;

    if (skill.handler.uninstall) {
      try {
        await skill.handler.uninstall(skill.config, this.config.dependencies);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Uninstall hook failed for "${id}": ${msg}`);
      }
    }

    this.skills.delete(id);
    this.logger.info(`Unloaded skill: ${id}`);
    return true;
  }

  /**
   * Reload all skills (hot reload)
   */
  async reloadAll(): Promise<{ loaded: number; errors: string[] }> {
    const errors: string[] = [];

    // Unload all current skills
    for (const [id] of this.skills) {
      await this.unload(id);
    }

    // Reload from disk
    const dir = this.config.skillsDir;
    if (!fs.existsSync(dir)) return { loaded: 0, errors };

    let loaded = 0;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        await this.load(path.join(dir, entry.name));
        loaded++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${entry.name}: ${msg}`);
      }
    }

    return { loaded, errors };
  }

  /**
   * Get all loaded skills
   */
  getLoadedSkills(): LoadedSkill[] {
    return [...this.skills.values()];
  }

  /**
   * Get a specific loaded skill by ID
   */
  getSkill(id: string): LoadedSkill | undefined {
    return this.skills.get(id);
  }

  /**
   * Get skill IDs
   */
  getSkillIds(): string[] {
    return [...this.skills.keys()];
  }

  /**
   * Check if a skill is loaded
   */
  hasSkill(id: string): boolean {
    return this.skills.has(id);
  }

  /**
   * Get tool definitions in various formats
   */
  getToolDefinitions(format: string = "generic"): GenericToolDefinition[] {
    const skills = this.getLoadedSkills();
    return this.config.toolFormatter(skills, format as any);
  }

  /**
   * Get the skills directory path
   */
  getSkillsDir(): string {
    return this.config.skillsDir;
  }

  /**
   * Resolve configuration from environment variables and defaults
   */
  private resolveConfig(manifest: SkillManifest): Record<string, any> {
    const config: Record<string, any> = {};

    if (manifest.config_schema) {
      for (const [key, field] of Object.entries(manifest.config_schema)) {
        // Priority: field.env → bare env key → default
        const value = (field.env && process.env[field.env]) ?? process.env[key] ?? field.default;

        if (value !== undefined) {
          config[key] = value;
        } else if (field.required) {
          this.logger.warn(`Skill "${manifest.id}": missing required config "${key}"`);
        }
      }
    }

    return config;
  }

  /**
   * Bootstrap built-in skills to the skills directory
   */
  private bootstrapBuiltins(): void {
    if (!this.config.builtinsDir || !fs.existsSync(this.config.builtinsDir)) {
      return;
    }

    const entries = fs.readdirSync(this.config.builtinsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const sourcePath = path.join(this.config.builtinsDir!, entry.name);
      const manifestPath = path.join(sourcePath, "skill.yaml");

      if (!fs.existsSync(manifestPath)) continue;

      // Use builtin- prefix to avoid conflicts
      const targetName = `builtin-${entry.name}`;
      const targetPath = path.join(this.config.skillsDir, targetName);

      // Skip if already exists
      if (fs.existsSync(targetPath)) continue;

      try {
        fs.cpSync(sourcePath, targetPath, { recursive: true });
        this.logger.debug(`Bootstrapped built-in skill: ${entry.name}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Failed to bootstrap "${entry.name}": ${msg}`);
      }
    }
  }

  /**
   * Default tool formatter - converts skills to generic tool definitions
   */
  private defaultToolFormatter(skills: LoadedSkill[], _format: string): GenericToolDefinition[] {
    const defs: GenericToolDefinition[] = [];

    for (const skill of skills) {
      for (const tool of skill.manifest.tools) {
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
            name: this.skillToolName(skill.manifest.id, tool.name),
            description: `[${skill.manifest.name}] ${tool.description}`,
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
   * Build a namespaced tool name
   */
  skillToolName(skillId: string, toolName: string): string {
    return `skill__${skillId}__${toolName}`;
  }

  /**
   * Parse a namespaced tool name
   */
  parseSkillToolName(name: string): { skillId: string; toolName: string } | null {
    const match = name.match(/^skill__([^_]+(?:__[^_]+)*)__(.+)$/);
    if (!match) return null;

    const parts = name.substring(7).split("__");
    if (parts.length < 2) return null;

    const toolName = parts[parts.length - 1];
    const skillId = parts.slice(0, -1).join("__");

    return { skillId, toolName };
  }
}

/**
 * Convenience function to create a loader with config
 */
export function createLoader(config: SkillLoaderConfig): SkillLoader {
  return new SkillLoader(config);
}

/**
 * Helper to build namespaced tool names
 */
export function skillToolName(skillId: string, toolName: string): string {
  return `skill__${skillId}__${toolName}`;
}

/**
 * Helper to parse namespaced tool names
 */
export function parseSkillToolName(name: string): { skillId: string; toolName: string } | null {
  const match = name.match(/^skill__([^_]+(?:__[^_]+)*)__(.+)$/);
  if (!match) return null;

  const parts = name.substring(7).split("__");
  if (parts.length < 2) return null;

  const toolName = parts[parts.length - 1];
  const skillId = parts.slice(0, -1).join("__");

  return { skillId, toolName };
}
