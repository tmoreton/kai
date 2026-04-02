import { registerDataIntegration } from "./data.js";
import { registerMcpIntegration } from "./mcp.js";
import { registerImageIntegration } from "./image.js";

/**
 * Register all built-in integrations for the workflow engine.
 */
export function registerAllIntegrations(): void {
  registerDataIntegration();
  registerMcpIntegration();
  registerImageIntegration();
}
