import { bashTool, bashBackgroundTool } from "./bash.js";
import { readFile, writeFile, editFile } from "./files.js";
import { globTool, grepTool } from "./search.js";
import { webFetch, webSearch } from "./web.js";
import { createTask, updateTask, listTasks } from "./tasks.js";
import { spawnAgent } from "../subagent.js";
import { checkPermission } from "../permissions.js";
import { updateCoreMemory, readCoreMemory } from "../soul.js";
import { searchRecall } from "../recall.js";
import { archivalInsert, archivalSearch } from "../archival.js";
import {
  createCronJob,
  deleteCronJob,
  listCronJobs,
} from "../cron.js";
import { readImageAsDataUrl, takeScreenshot } from "./vision.js";

// Special return type for vision tools that need to inject images
export type ToolResult =
  | string
  | { type: "image"; dataUrl: string; description: string };

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const permission = await checkPermission(name, args);
  if (permission === "deny") {
    return `Permission denied for ${name}. The user blocked this action.`;
  }

  try {
    switch (name) {
      // File operations
      case "bash":
        return await bashTool(args as { command: string; timeout?: number });
      case "bash_background":
        return await bashBackgroundTool(args as { command: string; wait_seconds?: number });
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

      // Web
      case "web_fetch":
        return await webFetch(args as { url: string; method?: string; headers?: Record<string, string> });
      case "web_search":
        return await webSearch(args as { query: string; count?: number });

      // Tasks
      case "task_create":
        return createTask(args as { subject: string; description: string });
      case "task_update":
        return updateTask(args as { task_id: number; status?: "pending" | "in_progress" | "completed"; subject?: string; description?: string });
      case "task_list":
        return listTasks();

      // Core memory (soul)
      case "core_memory_read":
        return readCoreMemory((args as { block?: "persona" | "human" | "goals" | "scratchpad" }).block);
      case "core_memory_update":
        return updateCoreMemory(
          (args as { block: "persona" | "human" | "goals" | "scratchpad" }).block,
          (args as { operation: "replace" | "append" }).operation,
          String(args.content)
        );

      // Recall memory
      case "recall_search": {
        const results = searchRecall(String(args.query), (args as { limit?: number }).limit);
        if (results.length === 0) return "No matching past conversations found.";
        return results
          .map((r) => `[${r.timestamp}] ${r.role}: ${r.content.substring(0, 300)}`)
          .join("\n\n");
      }

      // Archival memory
      case "archival_insert":
        return archivalInsert(args as { content: string; tags?: string[]; source?: string });
      case "archival_search":
        return archivalSearch(args as { query: string; tags?: string[]; limit?: number });

      // Cron
      case "cron_create":
        return createCronJob({
          name: String(args.name),
          prompt: String(args.prompt),
          intervalMinutes: Number(args.interval_minutes),
          maxRuns: args.max_runs ? Number(args.max_runs) : undefined,
        });
      case "cron_list":
        return listCronJobs();
      case "cron_delete":
        return deleteCronJob(String(args.id));

      // Vision
      case "view_image": {
        const result = readImageAsDataUrl(String(args.file_path));
        if ("error" in result) return result.error;
        return {
          type: "image",
          dataUrl: result.dataUrl,
          description: `Image loaded: ${args.file_path} (${result.sizeKB} KB, ${result.mimeType})`,
        };
      }
      case "take_screenshot": {
        const screenshotPath = await takeScreenshot();
        if (screenshotPath.startsWith("Error:")) return screenshotPath;
        const result = readImageAsDataUrl(screenshotPath);
        if ("error" in result) return result.error;
        return {
          type: "image",
          dataUrl: result.dataUrl,
          description: `Screenshot captured: ${screenshotPath} (${result.sizeKB} KB)`,
        };
      }

      // User interaction
      case "ask_user": {
        const q = String(args.question);
        const opts = args.options as string[] | undefined;
        let display = `\n❓ ${q}`;
        if (opts && opts.length > 0) {
          display += "\n" + opts.map((o, i) => `   ${i + 1}. ${o}`).join("\n");
        }
        return `[QUESTION FOR USER] ${display}`;
      }

      // Agents
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
