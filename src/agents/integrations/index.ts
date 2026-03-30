import { registerDataIntegration } from "./data.js";
import { registerMcpIntegration } from "./mcp.js";
import { registerYouTubeIntegration } from "./youtube.js";
import { registerImageIntegration } from "./image.js";
import { registerWebIntegration } from "./web.js";

/**
 * Register all built-in integrations for the workflow engine.
 */
export function registerAllIntegrations(): void {
  registerDataIntegration();
  registerMcpIntegration();
  registerYouTubeIntegration();
  registerImageIntegration();
  registerWebIntegration();
}
