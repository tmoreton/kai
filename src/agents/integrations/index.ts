import { registerYouTubeIntegration } from "./youtube.js";
import { registerImageGenIntegration } from "./image-gen.js";
import { registerWebIntegration } from "./web.js";
import { registerDataIntegration } from "./data.js";
import { registerMcpIntegration } from "./mcp.js";

/**
 * Register all built-in integrations.
 * Call this once at startup.
 */
export function registerAllIntegrations(): void {
  registerYouTubeIntegration();
  registerImageGenIntegration();
  registerWebIntegration();
  registerDataIntegration();
  registerMcpIntegration();
}
