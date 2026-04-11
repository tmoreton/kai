// ============================================
// Agent Chat Streaming - Matches main chat functionality
// ============================================

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import fs from "fs";
import path from "path";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import OpenAI from "openai";
import { createClient, getModelId, summarizeArgs, rescueToolCallsFromText } from "../../client.js";
import { buildSystemPrompt } from "../../system-prompt.js";
import { getCwd } from "../../tools/bash.js";
import { toolDefinitions, getMcpToolDefinitions } from "../../tools/index.js";
import { getSkillToolDefinitions } from "../../skills/index.js";
import { executeTool } from "../../tools/executor.js";
import { shouldCompact, compactMessages } from "../../context.js";
import { ensureKaiDir } from "../../config.js";
import {
  MAX_TOKENS,
  MAX_TOOL_TURNS,
  STREAM_TIMEOUT_MS,
  TOOL_OUTPUT_CONTEXT_LIMIT,
  RETRY_MAX_ATTEMPTS,
  MAX_CONSECUTIVE_ERRORS,
  RETRYABLE_STATUS_CODES,
} from "../../constants.js";
import { backoffDelay, sleep } from "../../utils.js";
import {
  generateSessionId,
  saveSession,
  loadSession,
  type Session,
} from "../../sessions/manager.js";
import { getAgent } from "../../agents-core/db.js";

// Active abort controllers for cancellation
const activeStreams = new Map<string, AbortController>();

function createNewSession(): Session {
  return {
    id: generateSessionId(),
    cwd: getCwd(),
    type: "chat",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [{ role: "system", content: "" }], // Will be set based on agent
  };
}

async function buildAgentSystemPrompt(agentId: string): Promise<string> {
  const agent = getAgent(agentId);
  if (!agent) {
    throw new Error(`Agent ${agentId} not found`);
  }

  const agentConfig = typeof agent.config === 'string' ? JSON.parse(agent.config || "{}") : (agent.config || {});

  // Get available skills for this agent
  const availableSkills = getLoadedSkills() as Array<{manifest: {name: string; description?: string; tools: Array<{name: string; description: string}>}}>;
  const skillDescriptions = availableSkills.map((s) => {
    const tools = s.manifest.tools.map((t) => `- ${t.name}: ${t.description}`).join('\n  ');
    return `- ${s.manifest.name}: ${s.manifest.description || 'No description'}\n  Tools:\n  ${tools}`;
  }).join('\n\n');

  // Build system prompt from config or fallback to simple prompt
  let systemPrompt: string;
  if (agentConfig.personality || agentConfig.goals) {
    systemPrompt = `You are ${agent.name}.

# Your Identity
${agentConfig.personality || "An AI agent helping with tasks."}

# Your Goals
${agentConfig.goals || "Help the user achieve their objectives."}

# Working Notes
${agentConfig.scratchpad || "No notes yet."}

# Current Status
- Enabled: ${agent.enabled ? "Yes" : "No"}
- Schedule: ${agent.schedule || "Not scheduled"}

# Available Skills & Tools
You have access to these skills and can use their tools when needed:

${skillDescriptions || "No skills available."}

You are autonomous. Complete tasks fully without asking for permission. Be concise and direct. Update your working notes with important findings. USE your available skills when appropriate - don't ask the user to do things you can do yourself.`;
  } else {
    // Fallback for agents without personality/goals
    systemPrompt = `You are ${agent.name}. ${agent.description || ""}

You help the user understand your workflow, check your run history, and manage your settings.
Be concise and helpful. If you don't know something, say so.

# Available Skills & Tools
You have access to these skills and can use their tools when needed:

${skillDescriptions || "No skills available."}

Current status: ${agent.enabled ? "Enabled" : "Disabled"}`;
  }

  // Combine with base system prompt for tool capabilities
  const basePrompt = buildSystemPrompt();
  return `${basePrompt}\n\n${systemPrompt}`;
}

export function registerAgentChatRoutes(app: Hono) {
  // --- Agent Streaming Chat (matches /api/chat) ---
  app.post("/api/agents/:id/stream-chat", async (c) => {
    const agentId = c.req.param("id");
    const body = await c.req.json();
    const { sessionId, message, attachments } = body as {
      sessionId?: string;
      message: string;
      attachments?: Array<{ type: "image" | "file"; name: string; mimeType: string; data: string }>;
    };

    const agent = getAgent(agentId);
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404);
    }

    // Load or create session
    let session: Session;
    if (sessionId) {
      const loaded = loadSession(sessionId);
      if (loaded) {
        session = loaded;
        // Refresh system prompt with latest agent config
        session.messages[0] = { 
          role: "system", 
          content: await buildAgentSystemPrompt(agentId)
        };
      } else {
        session = createNewSession();
        session.messages[0] = { 
          role: "system", 
          content: await buildAgentSystemPrompt(agentId)
        };
      }
    } else {
      session = createNewSession();
      session.messages[0] = { 
        role: "system", 
        content: await buildAgentSystemPrompt(agentId)
      };
    }

    // Build user message content (multipart if attachments present)
    if (attachments && attachments.length > 0) {
      const parts: any[] = [];
      const savedPaths: string[] = [];
      const uploadErrors: string[] = [];

      for (const att of attachments) {
        if (att.type === "image") {
          try {
            if (!att.data || att.data.length === 0) {
              uploadErrors.push(`Empty image data for ${att.name}`);
              continue;
            }

            const uploadsDir = path.join(ensureKaiDir(), "uploads");
            if (!fs.existsSync(uploadsDir)) {
              fs.mkdirSync(uploadsDir, { recursive: true });
            }

            const safeName = att.name.replace(/[^a-zA-Z0-9._-]/g, "_");
            const timestamp = Date.now();
            const ext = att.name.match(/\.\w+$/)?.[0] || ".png";
            const filename = `${timestamp}-${safeName}`;
            const savedPath = path.join(uploadsDir, filename);

            const buffer = Buffer.from(att.data, "base64");
            fs.writeFileSync(savedPath, buffer);
            savedPaths.push(savedPath);

            parts.push({
              type: "image_url",
              image_url: { url: `data:${att.mimeType};base64,${att.data}` },
            });
          } catch (err: unknown) {
            uploadErrors.push(`Failed to process ${att.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else {
          // For non-image files, include as text reference
          parts.push({
            type: "text",
            text: `[Attached file: ${att.name}]`,
          });
        }
      }

      // Add text content first if message exists
      if (message) {
        parts.unshift({ type: "text", text: message });
      }

      // Add any upload errors
      if (uploadErrors.length > 0) {
        parts.push({
          type: "text",
          text: `\n\n⚠️ Upload errors: ${uploadErrors.join(", ")}`,
        });
      }

      session.messages.push({ role: "user", content: parts });
    } else {
      session.messages.push({ role: "user", content: message });
    }

    // Store abort controller
    const abortController = new AbortController();
    activeStreams.set(session.id, abortController);

    return streamSSE(c, async (stream) => {
      const client = createClient();

      try {
        await stream.writeSSE({
          event: "session",
          data: JSON.stringify({ sessionId: session.id }),
        });

        const updatedMessages = await chatForAgentWeb(
          client,
          agentId,
          session.messages,
          async (event: string, data: any) => {
            await stream.writeSSE({ event, data: JSON.stringify(data) });
          },
          abortController.signal
        );

        session.messages = updatedMessages;
        saveSession(session);

        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({ sessionId: session.id }),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : '';
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({
            message: msg,
            details: stack,
            type: 'chat_error'
          }),
        });
      } finally {
        activeStreams.delete(session.id);
      }
    });
  });

  // --- Stop Agent Chat Streaming ---
  app.post("/api/agents/:id/chat/stop", async (c) => {
    const { sessionId } = (await c.req.json()) as { sessionId: string };
    const controller = activeStreams.get(sessionId);
    if (controller) {
      controller.abort();
      activeStreams.delete(sessionId);
      return c.json({ stopped: true });
    }
    return c.json({ stopped: false });
  });
}

/**
 * Agent-specific chat loop adapted from chat.ts chatForWeb.
 * Replaces terminal output with SSE events.
 */
async function chatForAgentWeb(
  client: OpenAI,
  agentId: string,
  messages: ChatCompletionMessageParam[],
  emit: (event: string, data: any) => Promise<void>,
  signal?: AbortSignal
): Promise<ChatCompletionMessageParam[]> {
  const mcpTools = getMcpToolDefinitions();
  const skillTools = getSkillToolDefinitions();
  const activeTools = [...toolDefinitions, ...mcpTools, ...skillTools] as ChatCompletionTool[];
  const updatedMessages = [...messages];

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
          throw err;
        }
      }
    }

    clearTimeout(timeout);

    let assistantText = "";
    let toolCalls: any[] = [];

    try {
      for await (const chunk of stream) {
        if (signal?.aborted) break;

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // Handle content
        if (delta.content) {
          assistantText += delta.content;
          await emit("token", { text: delta.content });
        }

        // Handle tool calls
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const index = tc.index || 0;
            if (!toolCalls[index]) {
              toolCalls[index] = {
                id: tc.id || `call_${Date.now()}_${index}`,
                type: "function",
                function: { name: "", arguments: "" },
              };
            }
            if (tc.function?.name) {
              toolCalls[index].function.name = tc.function.name;
            }
            if (tc.function?.arguments) {
              toolCalls[index].function.arguments += tc.function.arguments;
            }
          }
        }
      }
    } catch (err: unknown) {
      if ((err as any)?.name === "AbortError") {
        throw new Error("Request aborted");
      }
      throw err;
    }

    await emit("thinking", { active: false });

    // Build assistant message
    const assistantMessage: ChatCompletionMessageParam = {
      role: "assistant",
      content: assistantText || null,
    };
    if (toolCalls.length > 0) {
      (assistantMessage as any).tool_calls = toolCalls;
    }
    updatedMessages.push(assistantMessage);

    // Execute tools if present
    if (toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        const func = toolCall.function;
        if (!func?.name) continue;

        let args: any;
        try {
          args = JSON.parse(func.arguments || "{}");
        } catch {
          args = {};
        }

        const toolName = func.name;
        const toolId = toolCall.id || `call_${Date.now()}`;
        const summary = summarizeArgs(toolName, args);

        await emit("tool_call", {
          id: toolId,
          name: toolName,
          args: summary,
        });

        let result: string;
        try {
          result = await executeTool(toolName, args);
          consecutiveErrors = 0;
        } catch (err: any) {
          result = `Error: ${err?.message || String(err)}`;
          consecutiveErrors++;

          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            await emit("status", { message: "Too many tool errors, stopping" });
            break;
          }
        }

        // Limit result length
        if (result.length > TOOL_OUTPUT_CONTEXT_LIMIT) {
          result = result.slice(0, TOOL_OUTPUT_CONTEXT_LIMIT) + 
            `\n\n[...truncated from ${result.length} chars]`;
        }

        // Try to parse as diff for UI
        let diff: string | undefined;
        try {
          const parsed = JSON.parse(result);
          if (parsed?.diff) {
            diff = parsed.diff;
          }
        } catch {
          // Not JSON or no diff
        }

        await emit("tool_result", {
          id: toolId,
          result: result.slice(0, 500),
          fullResult: result,
          diff,
          error: result.startsWith("Error:"),
        });

        updatedMessages.push({
          role: "tool",
          tool_call_id: toolId,
          content: result,
        });
      }

      // Continue loop for next LLM call
      continue;
    }

    // No tool calls - we're done
    break;
  }

  return updatedMessages;
}

// Import getLoadedSkills
function getLoadedSkills() {
  const { getLoadedSkills: getSkills } = require("../../skills/loader.js");
  return getSkills();
}
