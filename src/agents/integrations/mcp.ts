/**
 * ⚠️ DEPRECATED: This integration system is deprecated and will be removed in a future version.
 *
 * MIGRATION GUIDE:
 * The new Skill system should be used instead of direct integrations. Skills provide:
 * - Better type safety and validation
 * - More flexible configuration
 * - Easier testing and mocking
 * - Standardized manifest-based approach
 *
 * To migrate from MCP integration to skills:
 * 1. Create a skill manifest in ~/.kai/skills/mcp/skill.yaml
 * 2. Use the MCP tool calls within skill actions
 * 3. Use `type: skill` and `skill: mcp` in workflows instead of `type: integration` and `integration: mcp`
 *
 * Example migration:
 *   OLD:
 *     - type: integration
 *       integration: mcp
 *       action: call
 *       params: { server: "filesystem", tool: "read_file", args: { path: "/tmp/data.json" } }
 *
 *   NEW:
 *     - type: skill
 *       skill: mcp
 *       action: call
 *       params: { server: "filesystem", tool: "read_file", args: { path: "/tmp/data.json" } }
 *
 * For more information, see the skills/ directory for built-in skill examples.
 *
 * @deprecated Use the skill system instead
 */

import { registerIntegration } from "../workflow.js";
import { callMcpTool, listMcpServers } from "../../tools/mcp.js";

/**
 * MCP Integration for Workflow Engine
 *
 * Allows YAML workflows to call MCP server tools:
 *
 *   steps:
 *     - name: read_data
 *       type: integration
 *       integration: mcp
 *       action: call
 *       params:
 *         server: "filesystem"
 *         tool: "read_file"
 *         args:
 *           path: "/tmp/data.json"
 *       output_var: file_content
 *
 *     - name: list_servers
 *       type: integration
 *       integration: mcp
 *       action: list_servers
 *       output_var: servers
 */
export function registerMcpIntegration(): void {
  registerIntegration({
    name: "mcp",
    description: "Call tools on connected MCP servers",
    actions: {
      call: async (params) => {
        const { server, tool, args } = params;
        if (!server || !tool) {
          throw new Error("MCP call requires 'server' and 'tool' params");
        }
        return callMcpTool(server, tool, args || {});
      },

      list_servers: async () => {
        return listMcpServers();
      },
    },
  });
}
