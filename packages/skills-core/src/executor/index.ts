import type {
  SkillContext,
  ExecutionResult,
  SkillExecutorConfig,
  LoggerInterface,
  SkillActionResult,
  SkillDependencies,
  LoadedSkill,
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
 * SkillExecutor - executes skill tool calls
 *
 * Framework-agnostic. Handles action execution with proper context and error handling.
 */
export class SkillExecutor {
  private skills = new Map<string, LoadedSkill>();
  private config: Required<SkillExecutorConfig>;
  private logger: LoggerInterface;
  private dependencies: SkillDependencies;

  constructor(
    config: SkillExecutorConfig = {},
    skills: LoadedSkill[] = [],
    dependencies: SkillDependencies = {}
  ) {
    this.config = {
      logger: config.logger ?? silentLogger,
      timeout: config.timeout ?? 30000,
      maxResultLength: config.maxResultLength ?? 100000,
    };
    this.logger = this.config.logger;
    this.dependencies = dependencies;

    // Index skills by ID
    for (const skill of skills) {
      this.skills.set(skill.manifest.id, skill);
    }
  }

  /**
   * Register a skill for execution
   */
  registerSkill(skill: LoadedSkill): void {
    this.skills.set(skill.manifest.id, skill);
  }

  /**
   * Unregister a skill
   */
  unregisterSkill(skillId: string): boolean {
    return this.skills.delete(skillId);
  }

  /**
   * Execute a skill tool by name
   *
   * Tool name format: skill__<skill_id>__<tool_name>
   */
  async execute(toolName: string, args: Record<string, unknown>): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Parse the tool name
    const parsed = this.parseToolName(toolName);
    if (!parsed) {
      return {
        success: false,
        error: `Invalid tool name format: ${toolName}. Expected: skill__<id>__<tool>`,
        duration: Date.now() - startTime,
      };
    }

    const { skillId, toolName: actionName } = parsed;

    // Find the skill
    const skill = this.skills.get(skillId);
    if (!skill) {
      return {
        success: false,
        error: `Skill "${skillId}" is not installed. Use "skill list" to see available skills.`,
        duration: Date.now() - startTime,
      };
    }

    // Find the action
    const actionFn = skill.handler.actions[actionName];
    if (!actionFn) {
      const available = Object.keys(skill.handler.actions).join(", ");
      return {
        success: false,
        error: `Skill "${skillId}" has no action "${actionName}". Available: ${available || "none"}`,
        duration: Date.now() - startTime,
      };
    }

    // Build execution context
    const context: SkillContext = {
      config: skill.config,
      deps: this.dependencies,
      logger: this.logger,
      skillPath: skill.path,
    };

    // Execute with timeout
    try {
      const result = await this.executeWithTimeout(
        () => actionFn(args as Record<string, any>, context),
        this.config.timeout
      );

      // Format result
      const formattedResult = this.formatResult(result);

      // Truncate if too long
      let finalResult = formattedResult;
      if (finalResult.length > this.config.maxResultLength) {
        finalResult = finalResult.substring(0, this.config.maxResultLength) +
          `\n... (truncated, ${finalResult.length - this.config.maxResultLength} more chars)`;
      }

      return {
        success: true,
        result: finalResult,
        duration: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Skill "${skillId}" action "${actionName}" failed: ${msg}`);

      return {
        success: false,
        error: `Skill "${skillId}" action "${actionName}" failed: ${msg}`,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Try to execute a skill tool. Returns null if not a skill tool.
   *
   * This is useful for routing - if it returns null, the caller should
   * handle it (e.g., pass to another system).
   */
  async tryExecute(name: string, args: Record<string, unknown>): Promise<string | null> {
    if (!name.startsWith("skill__")) {
      return null;
    }

    const result = await this.execute(name, args);

    if (!result.success) {
      return `Error: ${result.error}`;
    }

    return result.result || "";
  }

  /**
   * Execute with timeout
   */
  private executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }

  /**
   * Format the action result to a string
   */
  private formatResult(result: SkillActionResult): string {
    if (typeof result === "string") {
      return result;
    }

    if (result && typeof result === "object") {
      // If it has a content field, use that
      if ("content" in result && typeof result.content === "string") {
        return result.content;
      }
      // Otherwise stringify the whole object
      return JSON.stringify(result, null, 2);
    }

    return String(result);
  }

  /**
   * Parse a tool name into skill ID and tool name
   */
  private parseToolName(name: string): { skillId: string; toolName: string } | null {
    const match = name.match(/^skill__([^_]+(?:__[^_]+)*)__(.+)$/);
    if (!match) return null;

    const parts = name.substring(7).split("__");
    if (parts.length < 2) return null;

    const toolName = parts[parts.length - 1];
    const skillId = parts.slice(0, -1).join("__");

    return { skillId, toolName };
  }

  /**
   * Get registered skill IDs
   */
  getRegisteredSkillIds(): string[] {
    return [...this.skills.keys()];
  }

  /**
   * Check if a skill is registered
   */
  hasSkill(skillId: string): boolean {
    return this.skills.has(skillId);
  }

  /**
   * Get a registered skill
   */
  getSkill(skillId: string): LoadedSkill | undefined {
    return this.skills.get(skillId);
  }
}

/**
 * Convenience function to create an executor
 */
export function createExecutor(
  config?: SkillExecutorConfig,
  skills?: LoadedSkill[],
  dependencies?: SkillDependencies
): SkillExecutor {
  return new SkillExecutor(config, skills, dependencies);
}
