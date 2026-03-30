import { bashTool, bashBackgroundTool } from "./bash.js";
import { readFile, writeFile, editFile } from "./files.js";
import { globTool, grepTool } from "./search.js";
import { webFetch, webSearch } from "./web.js";
import { generateImageTool } from "./image.js";
import { createTask, updateTask, listTasks } from "./tasks.js";
import { spawnAgent } from "../subagent.js";
import { checkPermission } from "../permissions.js";
import { runHooks } from "../hooks.js";
import { updateCoreMemory, readCoreMemory } from "../soul.js";
import { searchRecall } from "../recall.js";
import { archivalInsert, archivalSearch } from "../archival.js";
import { tryExecuteMcpTool } from "./mcp.js";

export type ToolResult = string;

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const permission = await checkPermission(name, args);
  if (permission === "deny") {
    return `Permission denied for ${name}. The user blocked this action.`;
  }

  await runHooks("before", name, args);

  let result: string;

  try {
    switch (name) {
      case "bash":
        result = await bashTool(args as { command: string; timeout?: number }); break;
      case "bash_background":
        result = await bashBackgroundTool(args as { command: string; wait_seconds?: number }); break;
      case "read_file":
        result = await readFile(args as { file_path: string; offset?: number; limit?: number }); break;
      case "write_file":
        result = await writeFile(args as { file_path: string; content: string }); break;
      case "edit_file":
        result = await editFile(args as { file_path: string; old_string: string; new_string: string; replace_all?: boolean }); break;
      case "glob":
        result = await globTool(args as { pattern: string; path?: string }); break;
      case "grep":
        result = await grepTool(args as { pattern: string; path?: string; include?: string; context?: number; ignore_case?: boolean }); break;
      case "web_fetch":
        result = await webFetch(args as { url: string; method?: string; headers?: Record<string, string> }); break;
      case "web_search":
        result = await webSearch(args as { query: string; max_results?: number }); break;
      case "task_create":
        result = createTask(args as { subject: string; description: string }); break;
      case "task_update":
        result = updateTask(args as { task_id: number; status?: "pending" | "in_progress" | "completed"; subject?: string; description?: string }); break;
      case "task_list":
        result = listTasks(); break;
      case "core_memory_read":
        result = readCoreMemory((args as { block?: "persona" | "human" | "goals" | "scratchpad" }).block); break;
      case "core_memory_update":
        result = updateCoreMemory(
          (args as { block: "persona" | "human" | "goals" | "scratchpad" }).block,
          (args as { operation: "replace" | "append" }).operation,
          String(args.content)
        ); break;
      case "recall_search": {
        const results = searchRecall(String(args.query), (args as { limit?: number }).limit);
        result = results.length === 0
          ? "No matching past conversations found."
          : results.map((r) => `[${r.timestamp}] ${r.role}: ${r.content.substring(0, 300)}`).join("\n\n");
        break;
      }
      case "archival_insert":
        result = archivalInsert(args as { content: string; tags?: string[]; source?: string }); break;
      case "archival_search":
        result = archivalSearch(args as { query: string; tags?: string[]; limit?: number }); break;
      case "spawn_agent":
        result = await spawnAgent(args as { agent: string; task: string }); break;
      case "generate_image":
        result = await generateImageTool(args as { prompt: string; reference_image?: string; width?: number; height?: number; output_dir?: string }); break;
      default: {
        // Check if it's an MCP tool (mcp__server__tool)
        const mcpResult = await tryExecuteMcpTool(name, args);
        if (mcpResult !== null) {
          result = mcpResult;
        } else {
          result = `Unknown tool: ${name}`;
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result = `Tool "${name}" failed: ${msg}`;
  }

  await runHooks("after", name, args);

  return result;
}
