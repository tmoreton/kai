import { toolDefinitions as rawToolDefinitions } from "./definitions.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
export { executeTool } from "./executor.js";
export {
  initMcpServers,
  getMcpToolDefinitions,
  shutdownMcpServers,
  listMcpServers,
} from "./mcp.js";

// Truncate tool descriptions to save tokens
function truncateToolDefs(tools: ChatCompletionTool[]): ChatCompletionTool[] {
  return tools.map(tool => {
    if (tool.type !== "function") return tool;
    const fn = tool.function;
    // Truncate description to 120 chars max
    const desc = fn.description?.slice(0, 120).replace(/\s+$/g, "") || "";

    // Truncate parameter descriptions
    const params = fn.parameters as { properties?: Record<string, any>; required?: string[] } | undefined;
    if (params?.properties) {
      const newProps: Record<string, any> = {};
      for (const [key, val] of Object.entries(params.properties)) {
        newProps[key] = {
          ...val,
          description: val.description?.slice(0, 60).replace(/\s+$/g, "") || key,
        };
      }
      return {
        type: "function",
        function: {
          ...fn,
          description: desc,
          parameters: {
            type: "object",
            properties: newProps,
            required: params.required,
          },
        },
      };
    }

    return {
      type: "function",
      function: { ...fn, description: desc },
    };
  });
}

// Export truncated tool definitions
export const toolDefinitions = truncateToolDefs(rawToolDefinitions);
