import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import OpenAI from "openai";

import { getModelId, summarizeArgs, rescueToolCallsFromText } from "../client.js";
import { toolDefinitions, getMcpToolDefinitions } from "../tools/index.js";
import { getSkillToolDefinitions } from "../skills/index.js";
import { executeTool } from "../tools/executor.js";
import { trackUsage, shouldCompact, compactMessages } from "../context.js";
import {
  MAX_TOKENS,
  MAX_TOOL_TURNS,
  STREAM_TIMEOUT_MS,
  TOOL_OUTPUT_CONTEXT_LIMIT,
  RETRY_MAX_ATTEMPTS,
  MAX_CONSECUTIVE_ERRORS,
  RETRYABLE_STATUS_CODES,
} from "../constants.js";
import { backoffDelay, sleep } from "../utils.js";
import { buildSystemPrompt } from "../system-prompt.js";
import { getCwd } from "../tools/bash.js";
import {
  generateSessionId,
  type Session,
} from "../sessions.js";

export function createNewSession(): Session {
  return {
    id: generateSessionId(),
    cwd: getCwd(),
    type: "chat",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [{ role: "system", content: buildSystemPrompt() }],
  };
}

export function buildPersonaContext(persona: {
  name: string;
  role?: string;
  personality?: string;
  goals?: string;
  scratchpad?: string;
}): string {
  return [
    `You are ${persona.name}.`,
    persona.role ? `Role: ${persona.role}` : "",
    persona.personality ? `\nPersonality:\n${persona.personality}` : "",
    persona.goals ? `\nGoals:\n${persona.goals}` : "",
    persona.scratchpad ? `\nWorking Notes (scratchpad):\n${persona.scratchpad}` : "",
    "\nMaintain this persona throughout the conversation. Reference your goals and working notes as appropriate.",
  ].filter(Boolean).join("\n");
}

/**
 * Web-specific chat loop adapted from client.ts chat().
 * Replaces terminal output (spinners, chalk) with SSE events.
 */
export async function chatForWeb(
  client: OpenAI,
  messages: ChatCompletionMessageParam[],
  emit: (event: string, data: any) => Promise<void>,
  signal?: AbortSignal
): Promise<ChatCompletionMessageParam[]> {
  const mcpTools = getMcpToolDefinitions();
  const skillTools = getSkillToolDefinitions();
  const activeTools = [...toolDefinitions, ...mcpTools, ...skillTools] as ChatCompletionTool[];
  const updatedMessages = [...messages];

  // Auto-compact if context is getting large
  if (shouldCompact(updatedMessages)) {
    const compacted = compactMessages(updatedMessages);
    updatedMessages.length = 0;
    updatedMessages.push(...compacted);
    await emit("status", { message: "Context auto-compacted" });
  }

  let turns = 0;
  let consecutiveErrors = 0;

  while (turns < MAX_TOOL_TURNS) {
    turns++;

    if (signal?.aborted) break;

    await emit("thinking", { active: true });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

    // Link external abort signal
    if (signal) {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    let stream: any;
    for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        if (attempt > 0) {
          await emit("thinking", { active: true, message: `Retrying (${attempt + 1}/${RETRY_MAX_ATTEMPTS})...` });
          await sleep(backoffDelay(attempt - 1));
        }
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
        break;
      } catch (err: unknown) {
        const status = (err as any)?.status || (err as any)?.response?.status;
        const isRetryable = status && RETRYABLE_STATUS_CODES.includes(status);
        if (!isRetryable || attempt === RETRY_MAX_ATTEMPTS - 1) {
          clearTimeout(timeout);
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`API request failed: ${msg}`);
        }
      }
    }

    let content = "";
    const toolCallMap = new Map<number, {
      id: string;
      function: { name: string; arguments: string };
    }>();
    let chunkUsage: any = null;

    try {
      for await (const chunk of stream) {
        if (signal?.aborted) break;

        const delta = chunk.choices[0]?.delta;
        if (chunk.usage) chunkUsage = chunk.usage;
        if (!delta) continue;

        let text = delta.content;
        if (text) {
          // Filter out model-specific tool call markup that leaks into content
          text = text.replace(/<\|tool_calls_section_begin\|>/g, "")
            .replace(/<\|tool_calls_section_end\|>/g, "")
            .replace(/<\|tool_call_begin\|>/g, "")
            .replace(/<\|tool_call_end\|>/g, "")
            .replace(/<\|tool_call_argument_begin\|>/g, "")
            .replace(/<\|tool_call_argument_end\|>/g, "");
          if (text) {
            content += text;
            await emit("token", { text });
          }
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = toolCallMap.get(idx);
            if (existing) {
              if (tc.function?.name) existing.function.name += tc.function.name;
              if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
            } else {
              toolCallMap.set(idx, {
                id: tc.id || `call-${idx}-${Date.now()}`,
                function: {
                  name: tc.function?.name || "",
                  arguments: tc.function?.arguments || "",
                },
              });
            }
          }
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    const toolCalls = Array.from(toolCallMap.values());
    if (chunkUsage) trackUsage(chunkUsage);

    // Rescue tool calls leaked as text
    if (toolCalls.length === 0 && (content.includes("<|tool_call_begin|>") || content.includes("<function=") || content.includes("functions."))) {
      const rescued = rescueToolCallsFromText(content);
      if (rescued.length > 0) {
        toolCalls.push(...rescued);
        content = content
          .replace(/<\|tool_calls_section_begin\|>[\s\S]*$/m, "")
          .replace(/<function=[\s\S]*$/m, "")
          .trim();
      }
    }

    await emit("thinking", { active: false });

    // If assistant text ends with a question, stop the tool loop
    const hasQuestion = content.trim() && /\?\s*$/.test(content.trim());
    if (hasQuestion && toolCalls.length > 0) {
      updatedMessages.push({ role: "assistant", content });
      return updatedMessages;
    }

    // Nudge the model when approaching the turn limit
    if (turns === MAX_TOOL_TURNS - 5) {
      updatedMessages.push({
        role: "user",
        content: "[SYSTEM: You are approaching the tool call limit. Wrap up your current task and provide a summary to the user. Do not start new work.]",
      });
    }

    // Text-only response — done
    if (toolCalls.length === 0) {
      updatedMessages.push({ role: "assistant", content });
      return updatedMessages;
    }

    // Tool calls — execute and loop
    const sanitizedToolCalls = toolCalls.map((tc) => {
      let args = tc.function.arguments;
      try {
        const parsed = JSON.parse(args);
        if (typeof parsed !== "object" || parsed === null) args = "{}";
      } catch {
        args = "{}";
      }
      return { ...tc, function: { ...tc.function, arguments: args } };
    });

    const assistantMsg: ChatCompletionMessageParam = {
      role: "assistant",
      content: content || null,
      tool_calls: sanitizedToolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: tc.function,
      })),
    };
    updatedMessages.push(assistantMsg);

    for (const tc of toolCalls) {
      if (signal?.aborted) break;

      const toolName = tc.function.name;
      let args: Record<string, unknown>;
      let parseError = false;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        parseError = true;
        args = {};
      }

      await emit("tool_call", {
        id: tc.id,
        name: toolName,
        args: summarizeArgs(toolName, args),
      });

      // Plan mode check — block write operations before truncation check
      const { isToolAllowedInPlanMode } = await import("../plan-mode.js");
      if (!isToolAllowedInPlanMode(toolName)) {
        const msg = `Blocked: "${toolName}" is not allowed in plan mode. Only read-only tools are available. Present your plan to the user and ask them to approve it before making changes.`;
        updatedMessages.push({ role: "tool", tool_call_id: tc.id, content: msg });
        await emit("tool_result", { id: tc.id, name: toolName, result: msg, error: true });
        continue;
      }

      if (parseError) {
        const errorMsg = `Error: Tool call truncated — arguments were cut off.`;
        updatedMessages.push({ role: "tool", tool_call_id: tc.id, content: errorMsg });
        await emit("tool_result", { id: tc.id, name: toolName, result: errorMsg, error: true });
        consecutiveErrors++;
        continue;
      }

      const resultStr = await executeTool(toolName, args);

      // Capture diff for file operations
      const { getLastDiff } = await import("../tools/files.js");
      const isFileOp = toolName === "write_file" || toolName === "edit_file";
      const diff = isFileOp ? getLastDiff() : "";

      // Truncate for context
      const contextCharLimit = TOOL_OUTPUT_CONTEXT_LIMIT * 4;
      let contextContent = resultStr;
      if (resultStr.length > contextCharLimit) {
        contextContent =
          resultStr.substring(0, contextCharLimit) +
          `\n\n[Output truncated — ${resultStr.length} chars total]`;
      }

      const isError =
        resultStr.startsWith("Error") ||
        resultStr.includes("exit code:") ||
        resultStr.includes("failed:");

      if (isError) {
        consecutiveErrors++;
      } else {
        consecutiveErrors = 0;
      }

      updatedMessages.push({ role: "tool", tool_call_id: tc.id, content: contextContent });

      // Send preview to frontend (include diff if available)
      const preview = resultStr.length > 500 ? resultStr.substring(0, 500) + "..." : resultStr;
      await emit("tool_result", {
        id: tc.id,
        name: toolName,
        result: preview,
        diff: diff || undefined,
        error: isError,
      });

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        updatedMessages.push({
          role: "user",
          content: `[SYSTEM: ${MAX_CONSECUTIVE_ERRORS} consecutive tool errors. Stop retrying.]`,
        });
        break;
      }
    }
  }

  await emit("turn_limit", { turns: MAX_TOOL_TURNS });
  updatedMessages.push({
    role: "assistant",
    content: "[Reached maximum tool call limit. The user can continue if needed.]",
  });
  return updatedMessages;
}
