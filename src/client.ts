import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { toolDefinitions } from "./tools/index.js";
import { executeTool } from "./tools/executor.js";
import { trackUsage, shouldCompact, compactMessages } from "./context.js";
import {
  DEFAULT_MODEL,
  MAX_TOKENS,
  MAX_TOOL_TURNS,
  STREAM_TIMEOUT_MS,
  TOOL_OUTPUT_MAX_LINES,
  TOOL_OUTPUT_PREVIEW_LINES,
  TOOL_OUTPUT_MAX_CHARS,
} from "./constants.js";
import chalk from "chalk";

const MODEL = process.env.MODEL_ID || DEFAULT_MODEL;

export function createClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.TOGETHER_API_KEY,
    baseURL: "https://api.together.xyz/v1",
  });
}

export async function chat(
  client: OpenAI,
  messages: ChatCompletionMessageParam[],
  onToken?: (token: string) => void
): Promise<ChatCompletionMessageParam[]> {
  const updatedMessages = [...messages];

  // Auto-compact if context is getting large
  if (shouldCompact(updatedMessages)) {
    const compacted = compactMessages(updatedMessages);
    updatedMessages.length = 0;
    updatedMessages.push(...compacted);
    console.log(chalk.dim("  📦 Context auto-compacted to save tokens.\n"));
  }

  let turns = 0;

  while (turns < MAX_TOOL_TURNS) {
    turns++;

    // Create stream with timeout
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      STREAM_TIMEOUT_MS
    );

    let stream;
    try {
      stream = await client.chat.completions.create(
        {
          model: MODEL,
          messages: updatedMessages,
          tools: toolDefinitions as ChatCompletionTool[],
          tool_choice: "auto",
          stream: true,
          max_tokens: MAX_TOKENS,
        },
        { signal: controller.signal }
      );
    } catch (err: unknown) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`API request failed: ${msg}`);
    }

    let content = "";
    let toolCalls: Array<{
      id: string;
      function: { name: string; arguments: string };
    }> = [];
    let currentToolCall: {
      id: string;
      function: { name: string; arguments: string };
    } | null = null;
    let chunkUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;

    try {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        if (chunk.usage) {
          chunkUsage = chunk.usage;
        }

        if (!delta) continue;

        if (delta.content) {
          content += delta.content;
          onToken?.(delta.content);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.id) {
              if (currentToolCall) {
                toolCalls.push(currentToolCall);
              }
              currentToolCall = {
                id: tc.id,
                function: {
                  name: tc.function?.name || "",
                  arguments: tc.function?.arguments || "",
                },
              };
            } else if (currentToolCall) {
              if (tc.function?.name) {
                currentToolCall.function.name += tc.function.name;
              }
              if (tc.function?.arguments) {
                currentToolCall.function.arguments += tc.function.arguments;
              }
            }
          }
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    if (currentToolCall) {
      toolCalls.push(currentToolCall);
    }

    if (chunkUsage) {
      trackUsage(chunkUsage);
    }

    // Text-only response — done
    if (toolCalls.length === 0) {
      updatedMessages.push({ role: "assistant", content });
      if (content) onToken?.("\n");
      return updatedMessages;
    }

    // Tool calls — execute and loop
    const assistantMsg: ChatCompletionMessageParam = {
      role: "assistant",
      content: content || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: tc.function,
      })),
    };
    updatedMessages.push(assistantMsg);

    if (content) onToken?.("\n");

    for (const tc of toolCalls) {
      const toolName = tc.function.name;
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }

      console.log(
        chalk.dim(`\n  ⚡ ${toolName}(`) +
          chalk.dim(summarizeArgs(toolName, args)) +
          chalk.dim(")")
      );

      const result = await executeTool(toolName, args);
      const resultStr =
        typeof result === "string" ? result : JSON.stringify(result, null, 2);

      const lines = resultStr.split("\n");
      if (lines.length > TOOL_OUTPUT_MAX_LINES) {
        console.log(chalk.gray(`  ↳ ${lines.slice(0, TOOL_OUTPUT_PREVIEW_LINES).join("\n    ")}...`));
        console.log(chalk.gray(`    (${lines.length} lines total)`));
      } else if (resultStr.length > TOOL_OUTPUT_MAX_CHARS) {
        console.log(chalk.gray(`  ↳ ${resultStr.substring(0, TOOL_OUTPUT_MAX_CHARS)}...`));
      } else {
        console.log(chalk.gray(`  ↳ ${resultStr}`));
      }

      updatedMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: resultStr,
      });
    }
  }

  // Hit max turns — return what we have
  console.log(chalk.yellow(`\n  ⚠ Reached max tool turns (${MAX_TOOL_TURNS}). Stopping.\n`));
  updatedMessages.push({
    role: "assistant",
    content: "[Reached maximum tool call limit. Please continue with a follow-up message if needed.]",
  });
  return updatedMessages;
}

function summarizeArgs(
  toolName: string,
  args: Record<string, unknown>
): string {
  switch (toolName) {
    case "bash":
      return String(args.command || "").substring(0, 80);
    case "read_file":
    case "write_file":
    case "edit_file":
      return String(args.file_path || "");
    case "glob":
      return String(args.pattern || "");
    case "grep":
      return `${args.pattern || ""} ${args.path || ""}`;
    case "web_fetch":
      return String(args.url || "").substring(0, 60);
    case "web_search":
      return String(args.query || "");
    case "spawn_agent":
      return `${args.agent}: ${String(args.task || "").substring(0, 50)}`;
    case "task_create":
      return String(args.subject || "");
    case "task_update":
      return `#${args.task_id} → ${args.status || ""}`;
    case "save_memory":
      return String(args.name || "");
    default:
      return JSON.stringify(args).substring(0, 60);
  }
}
