import { registerDataIntegration } from "./data.js";
import { registerMcpIntegration } from "./mcp.js";
import { loadCustomIntegrations } from "./custom.js";

/**
 * Register all integrations.
 *
 * Built-in: data (cross-agent communication), mcp (MCP server bridge)
 * Custom: loaded from ~/.kai/integrations/*.js at runtime
 */
export async function registerAllIntegrations(): Promise<void> {
  registerDataIntegration();
  registerMcpIntegration();
  await loadCustomIntegrations();
}
