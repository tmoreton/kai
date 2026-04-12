/**
 * Skill System Types
 *
 * A skill is a modular, self-contained package of tools that can be
 * dynamically loaded, hot-reloaded, and shared via a community registry.
 */

export interface SkillManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  tools: SkillToolDefinition[];
  config_schema?: Record<string, SkillConfigField>;
}

export interface SkillToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, SkillParamDefinition>;
  required?: string[];
}

export interface SkillParamDefinition {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  required?: boolean;
  enum?: string[];
  default?: any;
}

export interface SkillConfigField {
  type: string;
  required?: boolean;
  env?: string; // environment variable to read from
  default?: any;
}

/**
 * The handler module that each skill exports.
 * Skills export an object with action functions.
 */
export interface SkillHandler {
  install?: (config: Record<string, any>) => Promise<void>;
  uninstall?: () => Promise<void>;
  actions: Record<string, (params: Record<string, any>, config: Record<string, any>) => Promise<string | { content: string }>>;
}

/**
 * A loaded skill instance (manifest + handler + resolved config).
 */
export interface LoadedSkill {
  manifest: SkillManifest;
  handler: SkillHandler;
  config: Record<string, any>;
  path: string;
  loaded_at: number;
  source?: string; // e.g., "kai:skill-id", "github:user/repo", "npm:@scope/name"
}
