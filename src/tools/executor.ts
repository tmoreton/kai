import { bashTool } from "./bash.js";
import { readFile, writeFile, editFile } from "./files.js";
import { globTool, grepTool } from "./search.js";
import { webFetch, webSearch } from "./web.js";
import { createTask, updateTask, listTasks } from "./tasks.js";
import {
  saveMemoryTool,
  listMemoriesTool,
  deleteMemoryTool,
} from "./memory-tool.js";
import { spawnAgent } from "../subagent.js";
import { checkPermission } from "../permissions.js";

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const permission = await checkPermission(name, args);
  if (permission === "deny") {
    return `Permission denied for ${name}. The user blocked this action.`;
  }

  try {
    switch (name) {
      case "bash":
        return await bashTool(args as { command: string; timeout?: number });
      case "read_file":
        return await readFile(args as { file_path: string; offset?: number; limit?: number });
      case "write_file":
        return await writeFile(args as { file_path: string; content: string });
      case "edit_file":
        return await editFile(args as { file_path: string; old_string: string; new_string: string; replace_all?: boolean });
      case "glob":
        return await globTool(args as { pattern: string; path?: string });
      case "grep":
        return await grepTool(args as { pattern: string; path?: string; include?: string; context?: number; ignore_case?: boolean });
      case "web_fetch":
        return await webFetch(args as { url: string; method?: string; headers?: Record<string, string> });
      case "web_search":
        return await webSearch(args as { query: string; count?: number });
      case "task_create":
        return createTask(args as { subject: string; description: string });
      case "task_update":
        return updateTask(args as { task_id: number; status?: "pending" | "in_progress" | "completed"; subject?: string; description?: string });
      case "task_list":
        return listTasks();
      case "save_memory":
        return await saveMemoryTool(args as { name: string; type: "user" | "project" | "feedback" | "reference"; description: string; content: string; scope?: "user" | "project" });
      case "list_memories":
        return await listMemoriesTool(args as { scope?: "user" | "project" });
      case "delete_memory":
        return await deleteMemoryTool(args as { name: string; scope?: "user" | "project" });
      case "spawn_agent":
        return await spawnAgent(args as { agent: string; task: string });
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Tool "${name}" failed: ${msg}`;
  }
}
