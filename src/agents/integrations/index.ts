import { registerDataIntegration } from "./data.js";
import { registerMcpIntegration } from "./mcp.js";
import { registerImageIntegration } from "./image.js";
import { registerIntegration, type WorkflowContext } from "../workflow.js";
import { getSkill } from "../../skills/index.js";

/**
 * Register all built-in integrations for the workflow engine.
 *
 * YouTube and Web have been migrated to the skills system
 * (builtin-youtube and builtin-web). Bridge integrations are registered
 * so existing YAML workflows with `integration: youtube` or `integration: web`
 * continue to work by routing calls through the skill handler.
 */
export function registerAllIntegrations(): void {
  registerDataIntegration();
  registerMcpIntegration();
  registerImageIntegration();

  // Bridge: route `integration: youtube` → skill__youtube__<action>
  registerSkillBridge("youtube", "youtube");

  // Bridge: route `integration: web` → skill__web-tools__<action>
  registerSkillBridge("web", "web-tools");
}

/**
 * Create a workflow integration bridge that delegates to a loaded skill.
 * This preserves backward compatibility for YAML workflows using
 * `integration: <name>` steps after the integration has been migrated
 * to the skills system.
 */
function registerSkillBridge(integrationName: string, skillId: string): void {
  registerIntegration({
    name: integrationName,
    description: `Bridge to ${skillId} skill`,
    actions: new Proxy({} as Record<string, (params: Record<string, any>, ctx: WorkflowContext) => Promise<any>>, {
      get(_target, action: string) {
        return async (params: Record<string, any>, _ctx: WorkflowContext): Promise<any> => {
          const skill = getSkill(skillId);
          if (!skill) {
            throw new Error(
              `Skill "${skillId}" not loaded. The "${integrationName}" integration has been migrated to a skill. ` +
              `Ensure builtin-${integrationName} exists in ~/.kai/skills/`
            );
          }
          const actionFn = skill.handler.actions[action];
          if (!actionFn) {
            throw new Error(
              `Skill "${skillId}" has no action "${action}". Available: ${Object.keys(skill.handler.actions).join(", ")}`
            );
          }
          const result = await actionFn(params);
          // Skills return strings; try to parse as JSON for workflow compat
          try { return JSON.parse(result); } catch { return result; }
        };
      },
    }),
  });
}
