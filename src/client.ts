import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { toolDefinitions, getMcpToolDefinitions } from "./tools/index.js";
import { executeTool } from "./tools/executor.js";
import { trackUsage, shouldCompact, compactMessages } from "./context.js";
import {
  MAX_TOKENS,
  MAX_TOOL_TURNS,
  STREAM_TIMEOUT_MS,
  TOOL_OUTPUT_MAX_LINES,
  TOOL_OUTPUT_PREVIEW_LINES,
  TOOL_OUTPUT_MAX_CHARS,
  TOOL_OUTPUT_CONTEXT_LIMIT,
} from "./constants.js";
import { resolveProvider, type ResolvedProvider } from "./providers/index.js";
import { renderMarkdown } from "./render.js";
import chalk from "chalk";

let _resolved: ResolvedProvider | null = null;

function getResolved(): ResolvedProvider {
  if (!_resolved) _resolved = resolveProvider();
  return _resolved;
}

export function createClient(): OpenAI {
  return getResolved().client;
}

export function getModelId(): string {
  return getResolved().model;
}

export function getProviderName(): string {
  return getResolved().provider.name;
}

export async function chat(
  client: OpenAI,
  messages: ChatCompletionMessageParam[],
  onToken?: (token: string) => void,
  options?: { tools?: ChatCompletionTool[] }
): Promise<ChatCompletionMessageParam[]> {
  // Merge built-in tools with any MCP server tools
  const mcpTools = getMcpToolDefinitions();
  const allTools = [...toolDefinitions, ...mcpTools] as ChatCompletionTool[];
  const activeTools = options?.tools ?? allTools;
  const updatedMessages = [...messages];

  // Auto-compact if context is getting large
  if (shouldCompact(updatedMessages)) {
    const compacted = compactMessages(updatedMessages);
    updatedMessages.length = 0;
    updatedMessages.push(...compacted);
    console.log(chalk.dim("  📦 Context auto-compacted to save tokens.\n"));
  }

  let turns = 0;

  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 3;
  let lastFailedCall = "";

  while (turns < MAX_TOOL_TURNS) {
    turns++;

    // Show thinking indicator
    const thinkingFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let frameIndex = 0;
    let firstToken = false;
    const spinnerText = "  thinking...";
    const spinner = setInterval(() => {
      if (!firstToken) {
        const frame = thinkingFrames[frameIndex++ % thinkingFrames.length];
        process.stderr.write(`\x1b[2K\r  ${chalk.cyan(frame)} ${chalk.dim("thinking...")}`);
      }
    }, 80);

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
          model: getModelId(),
          messages: updatedMessages,
          tools: activeTools,
          tool_choice: "auto",
          stream: true,
          max_tokens: MAX_TOKENS,
        },
        { signal: controller.signal }
      );
    } catch (err: unknown) {
      clearInterval(spinner);
      clearTimeout(timeout);
      process.stderr.write("\x1b[2K\r"); // Clear spinner
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`API request failed: ${msg}`);
    }

    let content = "";       // Visible output (streamed to user)
    let reasoning = "";     // Internal thinking (NOT shown to user)
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

        // Reasoning is internal thinking — store separately, never show to user
        const reasoningChunk = (delta as any).reasoning;
        if (reasoningChunk) {
          reasoning += reasoningChunk;
        }

        let text = delta.content;
        if (text) {
          // Filter out Kimi K2.5 internal formatting tokens that leak on truncation
          text = text.replace(/<\|tool_calls_section_begin\|>/g, "")
            .replace(/<\|tool_calls_section_end\|>/g, "")
            .replace(/<\|tool_call_begin\|>/g, "")
            .replace(/<\|tool_call_end\|>/g, "")
            .replace(/<\|tool_call_argument_begin\|>/g, "")
            .replace(/<\|tool_call_argument_end\|>/g, "");
          if (!text) continue;

          if (!firstToken) {
            firstToken = true;
            clearInterval(spinner);
            process.stderr.write("\x1b[2K\r"); // Clear spinner line
          }
          content += text;
          onToken?.(text);
        }

        if (delta.tool_calls) {
          if (!firstToken) {
            firstToken = true;
            clearInterval(spinner);
            process.stderr.write("\x1b[2K\r");
          }
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
      clearInterval(spinner);
      clearTimeout(timeout);
      if (!firstToken) {
        process.stderr.write("\x1b[2K\r");
      }
    }

    if (currentToolCall) {
      toolCalls.push(currentToolCall);
    }

    if (chunkUsage) {
      trackUsage(chunkUsage);
    }

    // Rescue leaked tool calls from content OR reasoning text
    const allText = content + "\n" + reasoning;
    if (toolCalls.length === 0 && allText.includes("<|tool_call_begin|>")) {
      const rescued = rescueToolCallsFromText(allText);
      if (rescued.length > 0) {
        toolCalls.push(...rescued);
        content = content
          .replace(/<\|tool_calls_section_begin\|>[\s\S]*$/m, "")
          .trim();
      }
    }

    // Text-only response — done
    if (toolCalls.length === 0) {
      // If content is empty (model only produced reasoning), use reasoning as fallback
      if (!content.trim() && reasoning.trim()) {
        // Extract just the useful part of reasoning, strip internal thinking
        const useful = reasoning
          .replace(/^.*?(?:Let me|I should|I need|The user|Looking at|Actually)/s, "")
          .trim();
        if (useful.length > 20) {
          content = useful;
          onToken?.(content);
        } else {
          content = "I'm not sure what you meant. Could you clarify?";
          onToken?.(content);
        }
      }
      // Store content for the conversation (reasoning stays hidden)
      updatedMessages.push({ role: "assistant", content });
      onToken?.("\n");
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
      let parseError = false;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        parseError = true;
        args = {};
      }

      console.log(
        chalk.dim(`\n  ⏺ `) +
          chalk.cyan(formatToolLabel(toolName)) +
          chalk.dim(`(`) +
          chalk.dim(summarizeArgs(toolName, args)) +
          chalk.dim(")")
      );

      // If JSON was truncated/malformed, don't execute — tell model to retry
      if (parseError || (toolName === "write_file" && !args.file_path)) {
        const truncLen = tc.function.arguments.length;
        console.log(chalk.yellow(`    ⎿  Tool call truncated (${truncLen} chars) — arguments were cut off`));

        let recovery = "";
        if (toolName === "bash") {
          recovery = "For long commands: write the command to a .sh script file first with write_file, then run it with bash('bash script.sh').";
        } else if (toolName === "write_file") {
          recovery = "Split the content: write a shorter version first, then use edit_file to add more content in parts.";
        } else {
          recovery = "Simplify the tool call arguments — they are too long and got cut off.";
        }

        updatedMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Error: Tool call truncated at ${truncLen} chars — arguments were cut off. ${recovery}`,
        });
        consecutiveErrors++;
        continue;
      }

      const resultStr: string = await executeTool(toolName, args);

      // Display truncated output to user
      const lines = resultStr.split("\n");
      if (lines.length > TOOL_OUTPUT_MAX_LINES) {
        console.log(chalk.gray(`    ⎿  ${lines.slice(0, TOOL_OUTPUT_PREVIEW_LINES).join("\n       ")}...`));
        console.log(chalk.gray(`       (${lines.length} lines total)`));
      } else if (resultStr.length > TOOL_OUTPUT_MAX_CHARS) {
        console.log(chalk.gray(`    ⎿  ${resultStr.substring(0, TOOL_OUTPUT_MAX_CHARS)}...`));
      } else {
        console.log(chalk.gray(`    ⎿  ${resultStr}`));
      }

      // Truncate what goes into context
      const contextCharLimit = TOOL_OUTPUT_CONTEXT_LIMIT * 4;
      let contextContent = resultStr;
      if (resultStr.length > contextCharLimit) {
        contextContent =
          resultStr.substring(0, contextCharLimit) +
          `\n\n[Output truncated — ${resultStr.length} chars total, showing first ${contextCharLimit}. Use read_file with offset/limit for more.]`;
      }

      // Track errors for loop detection
      const isError =
        resultStr.startsWith("Error") ||
        resultStr.includes("exit code:") ||
        resultStr.includes("failed:") ||
        resultStr.includes("ENOENT") ||
        resultStr.includes("Permission denied");

      const callSignature = `${toolName}:${JSON.stringify(args).substring(0, 100)}`;

      if (isError) {
        consecutiveErrors++;
        if (callSignature === lastFailedCall) {
          // Same call failed twice — inject guidance
          contextContent += "\n\n[SYSTEM: This exact tool call has failed before with the same error. Try a DIFFERENT approach instead of retrying the same command.]";
        }
        lastFailedCall = callSignature;
      } else {
        consecutiveErrors = 0;
        lastFailedCall = "";
      }

      updatedMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: contextContent,
      });

      // Circuit breaker: too many consecutive errors
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.log(chalk.yellow(`\n  ! ${MAX_CONSECUTIVE_ERRORS} consecutive errors. Stopping tool loop.\n`));
        updatedMessages.push({
          role: "user",
          content: `[SYSTEM: Tool execution has hit ${MAX_CONSECUTIVE_ERRORS} consecutive errors. Stop retrying and tell the user what went wrong and what you were trying to do.]`,
        });
        // Let the model respond with an explanation
        break;
      }
    }
  }

  // Hit max turns — return what we have
  console.log(chalk.yellow(`\n  ! Reached max tool turns (${MAX_TOOL_TURNS}). Stopping.\n`));
  updatedMessages.push({
    role: "assistant",
    content: "[Reached maximum tool call limit. Please continue with a follow-up message if needed.]",
  });
  return updatedMessages;
}

function formatToolLabel(toolName: string): string {
  const labels: Record<string, string> = {
    bash: "Bash",
    read_file: "Read",
    write_file: "Write",
    edit_file: "Edit",
    glob: "Glob",
    grep: "Grep",
    web_fetch: "WebFetch",
    web_search: "WebSearch",
    generate_image: "ImageGen",
    spawn_agent: "Agent",
    task_create: "Task",
    task_update: "Task",
  };
  if (toolName.startsWith("mcp__")) {
    const parts = toolName.split("__");
    return `MCP:${parts[1]}/${parts.slice(2).join("__")}`;
  }
  return labels[toolName] || toolName;
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
    case "generate_image":
      return String(args.prompt || "").substring(0, 60);
    case "spawn_agent":
      return `${args.agent}: ${String(args.task || "").substring(0, 50)}`;
    case "task_create":
      return String(args.subject || "");
    case "task_update":
      return `#${args.task_id} → ${args.status || ""}`;
    default:
      return JSON.stringify(args).substring(0, 60);
  }
}

/**
 * Rescue tool calls that Kimi K2.5 leaked into content text
 * instead of sending as structured tool_calls.
 *
 * Pattern:
 * <|tool_calls_section_begin|>
 * <|tool_call_begin|> functions.tool_name:N
 * <|tool_call_argument_begin|> {"arg": "value"}
 * <|tool_call_end|>
 * <|tool_calls_section_end|>
 */
function rescueToolCallsFromText(
  text: string
): Array<{ id: string; function: { name: string; arguments: string } }> {
  const rescued: Array<{ id: string; function: { name: string; arguments: string } }> = [];

  // Match: functions.TOOL_NAME:N followed by argument JSON
  const callPattern = /functions\.(\w+):\d+\s*(?:<\|tool_call_argument_begin\|>)?\s*(\{[\s\S]*?\})\s*(?:<\|tool_call_end\|>)?/g;
  let match;

  while ((match = callPattern.exec(text)) !== null) {
    const toolName = match[1];
    const argsStr = match[2];

    // Validate the JSON parses
    try {
      JSON.parse(argsStr);
      rescued.push({
        id: `rescued-${Date.now()}-${rescued.length}`,
        function: {
          name: toolName,
          arguments: argsStr,
        },
      });
    } catch {
      // JSON was truncated — skip
    }
  }

  return rescued;
}
