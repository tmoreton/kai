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
