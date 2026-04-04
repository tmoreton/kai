import { getSkill, parseSkillToolName } from "./loader.js";

/**
 * Skill Tool Executor
 *
 * Routes skill__<id>__<tool> calls to the appropriate skill handler.
 */

/**
 * Try to execute a skill tool. Returns null if the tool name doesn't match
 * the skill namespace pattern, or a string result if it does.
 */
export async function tryExecuteSkillTool(
  name: string,
  args: Record<string, unknown>
): Promise<string | null> {
  const parsed = parseSkillToolName(name);
  if (!parsed) return null;

  const { skillId, toolName } = parsed;
  const skill = getSkill(skillId);

  if (!skill) {
    return `Skill "${skillId}" is not installed or loaded. Use "kai skill list" to see available skills.`;
  }

  const actionFn = skill.handler.actions[toolName];
  if (!actionFn) {
    const available = Object.keys(skill.handler.actions).join(", ");
    return `Skill "${skillId}" has no action "${toolName}". Available: ${available || "none (no handler)"}`;
  }

  try {
    const result = await actionFn(args as Record<string, any>);
    // Skill handlers can return strings directly or { content: "..." } objects
    if (typeof result === "string") {
      return result;
    } else if (result && typeof result === "object") {
      return String((result as Record<string, unknown>).content ?? result);
    } else {
      return String(result);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Skill "${skillId}" action "${toolName}" failed: ${msg}`;
  }
}
