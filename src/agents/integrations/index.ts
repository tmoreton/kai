/**
 * @deprecated DEPRECATED - Use the skill system instead
 * 
 * This entire module is deprecated. The skill system in ~/.kai/skills/ 
 * and src/skills/ provides superior functionality.
 * 
 * Migration:
 * - Old: registerAllIntegrations()
 * - New: loadAllSkills() from src/skills/loader.js
 */

// Re-export for backward compatibility (all no-ops now)
export { registerSkillIntegration, registerSkillsAsIntegrations } from "./skill.js";

/**
 * @deprecated Use loadAllSkills() from src/skills/loader.js instead
 */
export function registerAllIntegrations(): void {
  console.warn("[DEPRECATED] registerAllIntegrations() is deprecated. Use loadAllSkills() instead.");
}
