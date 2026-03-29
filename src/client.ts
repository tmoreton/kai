import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { toolDefinitions } from "./tools/index.js";
import { executeTool } from "./tools/executor.js";
import { trackUsage, shouldCompact, compactMessages } from "./context.js";
import chalk from "chalk";

const MODEL = process.env.MODEL_ID || "moonshotai/Kimi-K2.5";

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

  while (true) {
    const stream = await client.chat.completions.create({
      model: MODEL,
      messages: updatedMessages,
      tools: toolDefinitions as ChatCompletionTool[],
      tool_choice: "auto",
      stream: true,
      max_tokens: 8192,
    });

    let content = "";
    let toolCalls: Array<{
      id: string;
      function: { name: string; arguments: string };
    }> = [];
    let currentToolCall: {
      id: string;
      function: { name: string; arguments: string };
    } | null = null;
    let chunkUsage: any = null;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      // Track usage from the final chunk
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

    if (currentToolCall) {
      toolCalls.push(currentToolCall);
    }

    // Track API usage
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
      if (lines.length > 10) {
        console.log(chalk.gray(`  ↳ ${lines.slice(0, 8).join("\n    ")}...`));
        console.log(chalk.gray(`    (${lines.length} lines total)`));
      } else if (resultStr.length > 500) {
        console.log(chalk.gray(`  ↳ ${resultStr.substring(0, 500)}...`));
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
