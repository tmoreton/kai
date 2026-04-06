/**
 * Skill System Types
 *
 * Core type definitions for the Kai Skills framework.
 * Framework-agnostic - can be used by any tool or adapter.
 */

/**
 * Skill manifest - the skill.yaml structure
 */
export interface SkillManifest {
  /** Unique identifier for the skill (kebab-case recommended) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Semantic version */
  version: string;
  /** Short description of what the skill does */
  description?: string;
  /** Author name or organization */
  author?: string;
  /** Homepage URL */
  homepage?: string;
  /** Repository URL */
  repository?: string;
  /** License identifier */
  license?: string;
  /** Keywords for discovery */
  keywords?: string[];
  /** Tool definitions */
  tools: SkillToolDefinition[];
  /** Configuration schema */
  config_schema?: Record<string, SkillConfigField>;
  /** NPM dependencies this skill needs */
  dependencies?: Record<string, string>;
  /** Minimum required core version */
  minCoreVersion?: string;
  /** Category for organization */
  category?: string;
}

/**
 * Tool definition within a skill
 */
export interface SkillToolDefinition {
  /** Tool name (unique within the skill) */
  name: string;
  /** Description shown to AI models */
  description: string;
  /** Parameter definitions */
  parameters: Record<string, SkillParamDefinition>;
  /** Required parameter names */
  required?: string[];
}

/**
 * Parameter definition for a tool
 */
export interface SkillParamDefinition {
  /** Parameter type */
  type: "string" | "number" | "boolean" | "object" | "array";
  /** Description shown to AI models */
  description?: string;
  /** Whether this parameter is required */
  required?: boolean;
  /** Enum values for string params */
  enum?: string[];
  /** Default value */
  default?: any;
  /** For arrays: item schema */
  items?: SkillParamDefinition;
  /** For objects: property schemas */
  properties?: Record<string, SkillParamDefinition>;
}

/**
 * Configuration field schema
 */
export interface SkillConfigField {
  /** Field type */
  type: string;
  /** Whether required */
  required?: boolean;
  /** Environment variable to read from */
  env?: string;
  /** Default value */
  default?: any;
  /** Description for users */
  description?: string;
}

/**
 * Dependencies that can be injected into skills
 */
export interface SkillDependencies {
  [key: string]: any;
}

/**
 * Execution context passed to skill actions
 */
export interface SkillContext {
  /** Resolved configuration */
  config: Record<string, any>;
  /** Injected dependencies */
  deps: SkillDependencies;
  /** Logger interface */
  logger: LoggerInterface;
  /** Skill directory path */
  skillPath: string;
}

/**
 * Logger interface - pluggable logging
 */
export interface LoggerInterface {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

/**
 * Skill handler - the module exported by each skill
 */
export interface SkillHandler {
  /** Install hook - runs when skill is first loaded */
  install?: (config: Record<string, any>, deps: SkillDependencies) => Promise<void>;
  /** Uninstall hook - runs when skill is unloaded */
  uninstall?: (config: Record<string, any>, deps: SkillDependencies) => Promise<void>;
  /** Post-install hook - runs after skill is installed to disk */
  postInstall?: () => Promise<void>;
  /** Actions map - tool name -> handler function */
  actions: Record<string, SkillAction>;
}

/**
 * Skill action function signature
 */
export type SkillAction = (
  params: Record<string, any>,
  context: SkillContext
) => Promise<SkillActionResult>;

/**
 * Skill action result - can be string or structured object
 */
export type SkillActionResult = string | { content: string; [key: string]: any };

/**
 * A loaded skill instance
 */
export interface LoadedSkill {
  manifest: SkillManifest;
  handler: SkillHandler;
  config: Record<string, any>;
  path: string;
  loaded_at: number;
}

/**
 * Tool definition in various formats
 */
export type ToolFormat = "openai" | "anthropic" | "mcp" | "generic";

/**
 * Generic tool definition
 */
export interface GenericToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
}

/**
 * Skill loader configuration
 */
export interface SkillLoaderConfig {
  /** Directory to load skills from */
  skillsDir: string;
  /** Directory containing built-in skills to bootstrap (optional) */
  builtinsDir?: string;
  /** Whether to auto-bootstrap built-in skills */
  enableBootstrap?: boolean;
  /** Logger interface (default: silent) */
  logger?: LoggerInterface;
  /** Dependencies to inject into skills */
  dependencies?: SkillDependencies;
  /** Callback when skill is loaded */
  onSkillLoaded?: (skill: LoadedSkill) => void;
  /** Callback when skill fails to load */
  onSkillError?: (name: string, error: Error) => void;
  /** Custom tool format generator */
  toolFormatter?: (skills: LoadedSkill[], format: ToolFormat) => GenericToolDefinition[];
}

/**
 * Skill executor configuration
 */
export interface SkillExecutorConfig {
  /** Logger interface */
  logger?: LoggerInterface;
  /** Timeout for action execution (ms) */
  timeout?: number;
  /** Max result length */
  maxResultLength?: number;
}

/**
 * Execution result
 */
export interface ExecutionResult {
  success: boolean;
  result?: string;
  error?: string;
  duration: number;
}

/**
 * Skill registry entry for discovery
 */
export interface SkillRegistryEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  package?: string;
  homepage?: string;
  keywords?: string[];
  verified?: boolean;
  installCount?: number;
  rating?: number;
}

/**
 * Parsed package source
 */
export interface ParsedSource {
  type: "npm" | "github" | "git" | "local";
  source: string;
  name: string;
  version?: string;
  owner?: string;
  repo?: string;
  path?: string;
}
