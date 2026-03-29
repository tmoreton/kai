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
import chalk from "chalk";

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  // Check permissions before executing
  const permission = await checkPermission(name, args);
  if (permission === "deny") {
    return `Permission denied for ${name}. The user blocked this action.`;
  }

  switch (name) {
    case "bash":
      return bashTool(args as any);
    case "read_file":
      return readFile(args as any);
    case "write_file":
      return writeFile(args as any);
    case "edit_file":
      return editFile(args as any);
    case "glob":
      return globTool(args as any);
    case "grep":
      return grepTool(args as any);
    case "web_fetch":
      return webFetch(args as any);
    case "web_search":
      return webSearch(args as any);
    case "task_create":
      return createTask(args as any);
    case "task_update":
      return updateTask(args as any);
    case "task_list":
      return listTasks();
    case "save_memory":
      return saveMemoryTool(args as any);
    case "list_memories":
      return listMemoriesTool(args as any);
    case "delete_memory":
      return deleteMemoryTool(args as any);
    case "spawn_agent":
      return spawnAgent(args as any);
    default:
      return `Unknown tool: ${name}`;
  }
}
