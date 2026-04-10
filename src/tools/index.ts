import { toolDefinitions as rawToolDefinitions } from "./definitions.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
export { executeTool } from "./executor.js";
export {
  initMcpServers,
  getMcpToolDefinitions,
  shutdownMcpServers,
  listMcpServers,
} from "./mcp.js";

// Truncate tool descriptions aggressively to save tokens
// Each token costs money — be ruthless here
function truncateToolDefs(tools: ChatCompletionTool[]): ChatCompletionTool[] {
  return tools.map(tool => {
    if (tool.type !== "function") return tool;
    const fn = tool.function;
    // Truncate description to 80 chars max (was 120)
    const desc = fn.description?.slice(0, 80).replace(/\s+$/g, "") || "";

    // Truncate parameter descriptions to 40 chars max (was 60)
    // Parameter names + types are self-documenting
    const params = fn.parameters as { properties?: Record<string, any>; required?: string[] } | undefined;
    if (params?.properties) {
      const newProps: Record<string, any> = {};
      for (const [key, val] of Object.entries(params.properties)) {
        const paramDesc = val.description?.slice(0, 40).replace(/\s+$/g, "") || key;
        newProps[key] = {
          ...val,
          description: paramDesc,
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
