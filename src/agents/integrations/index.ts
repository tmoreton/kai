import { registerDataIntegration } from "./data.js";
import { registerMcpIntegration } from "./mcp.js";
import { registerImageIntegration } from "./image.js";
import { registerSkillIntegration, registerSkillsAsIntegrations } from "./skill.js";

/**
 * Register all built-in integrations for the workflow engine.
 */
export function registerAllIntegrations(): void {
  registerDataIntegration();
  registerMcpIntegration();
  registerImageIntegration();
  registerSkillIntegration();
  // Register all loaded skills as top-level integrations (youtube, web, email, etc.)
  registerSkillsAsIntegrations();
}

export { registerSkillsAsIntegrations } from "./skill.js";
