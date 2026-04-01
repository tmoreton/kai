import { bashTool, bashBackgroundTool } from "./bash.js";
import { readFile, writeFile, editFile } from "./files.js";
import { globTool, grepTool } from "./search.js";
import { webFetch, webSearch } from "./web.js";
import { generateImageTool } from "./image.js";
import { createTask, updateTask, listTasks } from "./tasks.js";
import { spawnAgent } from "../subagent.js";
import { runSwarm } from "../swarm.js";
import { loadPersona, updatePersonaField, listPersonas, createPersona } from "../agent-persona.js";
import { checkPermission } from "../permissions.js";
import { runHooks } from "../hooks.js";
import { updateCoreMemory, readCoreMemory } from "../soul.js";
import { searchRecall } from "../recall.js";
import { archivalInsert, archivalSearch } from "../archival.js";
import { tryExecuteMcpTool } from "./mcp.js";
import { validateToolArgs } from "./validation.js";
import { isToolAllowedInPlanMode, isPlanMode } from "../plan-mode.js";
import { gitLogTool, gitDiffSessionTool, gitUndoTool, gitStashTool } from "./git-tools.js";

export type ToolResult = string;

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  // Plan mode check — block write operations
  if (!isToolAllowedInPlanMode(name)) {
    return `Blocked: "${name}" is not allowed in plan mode. Only read-only tools are available. Present your plan to the user and ask them to approve it before making changes. They can type /plan to exit plan mode.`;
  }

  // Validate tool arguments with Zod
  const validation = validateToolArgs(name, args);
  if (!validation.valid) {
    return `Invalid arguments for ${name}: ${validation.error}`;
  }
  args = validation.args;

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
      case "spawn_swarm":
        result = await runSwarm(args.tasks as Array<{ agent: "explorer" | "planner" | "worker"; task: string }>); break;
      // Agent persona memory tools (used by persona-based agents during their chat loop)
      case "agent_memory_read": {
        const field = args.field as string | undefined;
        const agentId = args._agent_id as string; // Injected by the agent's tool definition
        // If no agent_id context, list all personas
        if (!agentId) {
          const personas = listPersonas();
          result = personas.map((p) =>
            `**${p.name}** (${p.id})\n  Role: ${p.role}\n  Goals: ${p.goals.substring(0, 200)}`
          ).join("\n\n");
          break;
        }
        const persona = loadPersona(agentId);
        if (!persona) { result = `Agent "${agentId}" not found.`; break; }
        if (field && field in persona) {
          result = `[${field}]: ${(persona as any)[field]}`;
        } else {
          result = `[goals]: ${persona.goals}\n\n[scratchpad]: ${persona.scratchpad || "(empty)"}\n\n[personality]: ${persona.personality}\n\n[role]: ${persona.role}`;
        }
        break;
      }
      case "agent_memory_update": {
        const agentId = args._agent_id as string;
        if (!agentId) { result = "No agent context — this tool is for persona-based agents."; break; }
        result = updatePersonaField(
          agentId,
          args.field as "goals" | "scratchpad",
          args.operation as "replace" | "append",
          String(args.content)
        );
        break;
      }
      // Agent persona management (used from the main conversation)
      case "agent_create": {
        const p = createPersona(
          String(args.id),
          String(args.name),
          String(args.role),
          String(args.personality),
          String(args.goals),
          args.tools as string[] | undefined,
          args.max_turns as number | undefined
        );
        result = `Created agent persona "${p.name}" (${p.id}).`;
        break;
      }
      case "agent_list": {
        const personas = listPersonas();
        if (personas.length === 0) {
          result = "No agent personas defined. Use agent_create to define one.";
        } else {
          result = personas.map((p) =>
            `• **${p.name}** (${p.id}) — ${p.role}\n  Goals: ${p.goals.substring(0, 150)}`
          ).join("\n\n");
        }
        break;
      }
      case "generate_image":
        result = await generateImageTool(args as { prompt: string; reference_image?: string; width?: number; height?: number; output_dir?: string }); break;
      case "git_log":
        result = await gitLogTool(args as { count?: number }); break;
      case "git_diff_session":
        result = await gitDiffSessionTool(args as { session_start: string }); break;
      case "git_undo":
        result = await gitUndoTool(args as { count?: number; mode?: "soft" | "hard" }); break;
      case "git_stash":
        result = await gitStashTool(args as { message?: string }); break;
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
