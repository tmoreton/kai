import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
import { cors } from "hono/cors";
import net from "net";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import OpenAI from "openai";

// Kai modules
import { createClient, getModelId, getProviderName, summarizeArgs } from "../client.js";
import { resolveProvider } from "../providers/index.js";
import { ensureKaiDir } from "../config.js";
import { buildSystemPrompt } from "../system-prompt.js";
import { getCwd } from "../tools/bash.js";
import { toolDefinitions } from "../tools/index.js";
import { executeTool } from "../tools/executor.js";
import { setPermissionMode } from "../permissions.js";
import { trackUsage, shouldCompact, compactMessages, getUsage } from "../context.js";
import {
  MAX_TOKENS,
  MAX_TOOL_TURNS,
  STREAM_TIMEOUT_MS,
  TOOL_OUTPUT_CONTEXT_LIMIT,
} from "../constants.js";
import {
  generateSessionId,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  type Session,
} from "../sessions.js";
import {
  listAgents,
  getAgent,
  getLatestRuns,
  getSteps,
  getAgentLogs,
  saveAgent,
  deleteAgent,
} from "../agents/db.js";
import {
  runAgent,
  isDaemonRunning,
  startDaemon,
  stopDaemon,
  writeDaemonPid,
  getDaemonPidPath,
} from "../agents/daemon.js";
import { closeDb } from "../agents/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "public");

// Active abort controllers for cancellation
const activeStreams = new Map<string, AbortController>();

// Track whether we started the daemon in-process
let daemonStartedInProcess = false;

export interface ServerOptions {
  port: number;
  agents?: boolean;  // Start agent daemon in-process (default: true)
  ui?: boolean;      // Serve web UI (default: true)
}

export async function startServer(options: ServerOptions): Promise<void> {
  const { port, agents = true, ui = true } = options;

  // Check port availability before doing anything else
  const portFree = await checkPort(port);
  if (!portFree) {
    console.error(`\n  Error: Port ${port} is already in use.`);
    console.error(`  Try: kai server --port ${port + 1}\n`);
    process.exit(1);
  }

  // Auto-approve tools in web mode (no readline available)
  setPermissionMode("auto");

  // Start agent daemon in-process if requested
  if (agents) {
    if (isDaemonRunning()) {
      console.log("  Agent daemon already running (external process)");
    } else {
      writeDaemonPid();
      daemonStartedInProcess = true;
      startDaemon();
    }
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n  Shutting down...");
    if (daemonStartedInProcess) {
      stopDaemon();
      try { fs.unlinkSync(getDaemonPidPath()); } catch {}
    }
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const app = new Hono();
  app.use("/api/*", cors());

  // --- Status ---
  app.get("/api/status", (c) => {
    return c.json({
      provider: getProviderName(),
      model: getModelId(),
      cwd: getCwd(),
      daemon: daemonStartedInProcess || isDaemonRunning(),
      daemonInProcess: daemonStartedInProcess,
      agents: agents,
      ui: ui,
      usage: getUsage(),
    });
  });

  // --- Models (fetch from OpenRouter) ---
  let cachedModels: any[] | null = null;
  let modelsCacheTime = 0;
  const MODELS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  app.get("/api/models", async (c) => {
    const now = Date.now();
    if (cachedModels && now - modelsCacheTime < MODELS_CACHE_TTL) {
      return c.json(cachedModels);
    }
    try {
      const apiKey = process.env.OPENROUTER_API_KEY || "";
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await res.json() as { data?: any[] };
      const models = (data.data || [])
        .filter((m: any) => m.id && m.name)
        .map((m: any) => ({
          id: m.id,
          name: m.name,
          contextLength: m.context_length,
          pricing: m.pricing,
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));
      cachedModels = models;
      modelsCacheTime = now;
      return c.json(models);
    } catch (err) {
      // Fallback to configured models
      const provider = resolveProvider().provider;
      return c.json(provider.models.map((id: string) => ({ id, name: id })));
    }
  });

  // --- Sessions ---
  app.get("/api/sessions", (c) => {
    const sessions = listSessions(30);
    return c.json(
      sessions.map((s) => {
        // Extract first real user message as preview/label
        const firstUserMsg = s.messages.find((m) => {
          if (m.role !== "user") return false;
          const text = typeof m.content === "string" ? m.content
            : Array.isArray(m.content) ? m.content.map((p: any) => p.type === "text" ? p.text : "").join("") : "";
          // Skip compacted history summaries
          return text.length > 0 && !text.startsWith("# Compacted conversation");
        });
        let preview: string | null = null;
        if (firstUserMsg) {
          const text = typeof firstUserMsg.content === "string" ? firstUserMsg.content
            : Array.isArray(firstUserMsg.content) ? (firstUserMsg.content as any[]).map((p: any) => p.type === "text" ? p.text : "").join("") : "";
          preview = text.substring(0, 80);
        }
        return {
          id: s.id,
          name: s.name,
          preview,
          cwd: s.cwd,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          messageCount: s.messages.filter((m) => m.role === "user").length,
        };
      })
    );
  });

  app.get("/api/sessions/:id", (c) => {
    const session = loadSession(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    // Return messages without system prompt (large)
    const messages = session.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role,
        content:
          typeof m.content === "string"
            ? m.content
            : Array.isArray(m.content)
              ? m.content.map((p: any) => (p.type === "text" ? p.text : "[image]")).join("")
              : null,
        tool_calls:
          "tool_calls" in m
            ? (m as any).tool_calls?.map((tc: any) => ({
                id: tc.id,
                name: tc.function?.name,
                arguments: tc.function?.arguments,
              }))
            : undefined,
        tool_call_id: "tool_call_id" in m ? (m as any).tool_call_id : undefined,
      }));
    return c.json({ ...session, messages });
  });

  app.post("/api/sessions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const session: Session = {
      id: generateSessionId(),
      name: body.name,
      cwd: getCwd(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [{ role: "system", content: buildSystemPrompt() }],
    };
    saveSession(session);
    return c.json({ id: session.id, name: session.name });
  });

  // --- Agents ---
  app.get("/api/agents", (c) => {
    const agents = listAgents();
    return c.json(
      agents.map((a) => {
        const runs = getLatestRuns(a.id, 1);
        const lastRun = runs[0];
        return {
          id: a.id,
          name: a.name,
          description: a.description,
          schedule: a.schedule,
          enabled: !!a.enabled,
          lastRun: lastRun
            ? {
                id: lastRun.id,
                status: lastRun.status,
                startedAt: lastRun.started_at,
                completedAt: lastRun.completed_at,
                error: lastRun.error,
              }
            : null,
        };
      })
    );
  });

  app.get("/api/agents/:id", (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    const runs = getLatestRuns(agent.id, 10);
    return c.json({
      ...agent,
      config: JSON.parse(agent.config || "{}"),
      runs: runs.map((r) => ({
        id: r.id,
        status: r.status,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        error: r.error,
        trigger: r.trigger,
      })),
    });
  });

  app.get("/api/agents/:id/output", (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    const runs = getLatestRuns(agent.id, 1);
    if (runs.length === 0) return c.json({ error: "No runs" }, 404);
    const steps = getSteps(runs[0].id);
    return c.json({
      run: runs[0],
      steps: steps.map((s) => ({
        name: s.step_name,
        status: s.status,
        output: s.output?.substring(0, 5000),
        error: s.error,
        tokensUsed: s.tokens_used,
      })),
    });
  });

  app.post("/api/agents/:id/run", async (c) => {
    const agentId = c.req.param("id");
    const result = await runAgent(agentId);
    return c.json(result);
  });

  // --- Edit agent (toggle, rename, description, schedule) ---
  app.patch("/api/agents/:id", async (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.enabled === "boolean") agent.enabled = body.enabled ? 1 : 0;
    if (typeof body.name === "string" && body.name.trim()) agent.name = body.name.trim();
    if (typeof body.description === "string") agent.description = body.description.trim();
    if (typeof body.schedule === "string") agent.schedule = body.schedule.trim();
    saveAgent(agent);
    return c.json({ id: agent.id, name: agent.name, description: agent.description, schedule: agent.schedule, enabled: !!agent.enabled });
  });

  // --- Delete agent ---
  app.delete("/api/agents/:id", (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    deleteAgent(agent.id);
    return c.json({ deleted: true });
  });

  // --- Delete session ---
  app.delete("/api/sessions/:id", (c) => {
    const deleted = deleteSession(c.req.param("id"));
    if (!deleted) return c.json({ error: "Session not found" }, 404);
    return c.json({ deleted: true });
  });

  // --- Get steps for a specific run ---
  app.get("/api/agents/:id/runs/:runId", (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    const steps = getSteps(c.req.param("runId"));
    return c.json({
      steps: steps.map((s) => ({
        name: s.step_name,
        index: s.step_index,
        status: s.status,
        output: s.output,
        error: s.error,
        tokensUsed: s.tokens_used,
        startedAt: s.started_at,
        completedAt: s.completed_at,
      })),
    });
  });

  // --- Agent logs ---
  app.get("/api/agents/:id/logs", (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    const limit = parseInt(c.req.query("limit") || "50");
    const logs = getAgentLogs(agent.id, limit);
    return c.json(logs);
  });

  // --- Agent recap (LLM-generated summary) ---
  app.get("/api/agents/:id/recap", async (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    const runs = getLatestRuns(agent.id, 1);
    if (runs.length === 0) return c.json({ error: "No runs" }, 404);
    const steps = getSteps(runs[0].id);
    const completedSteps = steps.filter((s) => s.status === "completed" && s.output);
    if (completedSteps.length === 0) return c.json({ recap: null });

    const keyOutputs = completedSteps.map((s) =>
      `## ${s.step_name}\n${(s.output || "").substring(0, 3000)}`
    );

    try {
      const recapClient = createClient();
      const response = await recapClient.chat.completions.create({
        model: getModelId(),
        messages: [
          {
            role: "system",
            content: "You are summarizing the results of an AI agent workflow run. Be concise, highlight the most actionable insights, and format with clear headers. Keep it under 300 words. Use markdown formatting.",
          },
          {
            role: "user",
            content: `Summarize the key results from this "${agent.name}" agent run:\n\n${keyOutputs.join("\n\n---\n\n")}`,
          },
        ],
        max_tokens: 2048,
      });

      const content = response.choices[0]?.message?.content
        || (response.choices[0]?.message as any)?.reasoning || "";
      return c.json({ recap: content, run: runs[0] });
    } catch {
      return c.json({ recap: null, run: runs[0] });
    }
  });

  // --- Chat (SSE streaming) ---
  app.post("/api/chat", async (c) => {
    const body = await c.req.json();
    const { sessionId, message, model, attachments } = body as {
      sessionId?: string;
      message: string;
      model?: string;
      attachments?: Array<{ type: "image" | "file"; name: string; mimeType: string; data: string }>;
    };

    // Load or create session
    let session: Session;
    if (sessionId) {
      const loaded = loadSession(sessionId);
      if (loaded) {
        session = loaded;
        // Refresh system prompt
        if (session.messages[0]?.role === "system") {
          session.messages[0] = { role: "system", content: buildSystemPrompt() };
        }
      } else {
        session = createNewSession();
      }
    } else {
      session = createNewSession();
    }

    // Build user message content (multipart if attachments present)
    if (attachments && attachments.length > 0) {
      const parts: any[] = [];
      const savedPaths: string[] = [];
      for (const att of attachments) {
        if (att.type === "image") {
          // Save to disk so tools (e.g. generate_image) can reference the file
          const uploadsDir = path.join(ensureKaiDir(), "uploads");
          if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
          const ext = att.name.match(/\.\w+$/)?.[0] || ".png";
          const savedPath = path.join(uploadsDir, `${Date.now()}-${att.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`)
          fs.writeFileSync(savedPath, Buffer.from(att.data, "base64"));
          savedPaths.push(savedPath);

          parts.push({
            type: "image_url",
            image_url: { url: `data:${att.mimeType};base64,${att.data}` },
          });
        } else {
          // Non-image files: include as text content
          parts.push({
            type: "text",
            text: `[File: ${att.name}]\n${Buffer.from(att.data, "base64").toString("utf-8")}`,
          });
        }
      }
      // Include saved file paths so the LLM can pass them to tools like generate_image(reference_image)
      let text = message;
      if (savedPaths.length > 0) {
        text += `\n\n[Attached images saved to: ${savedPaths.join(", ")}]`;
      }
      parts.push({ type: "text", text });
      session.messages.push({ role: "user", content: parts });
    } else {
      session.messages.push({ role: "user", content: message });
    }

    // Set up abort controller
    const abortController = new AbortController();
    activeStreams.set(session.id, abortController);

    return streamSSE(c, async (stream) => {
      try {
        // Send session ID first
        await stream.writeSSE({ event: "session", data: JSON.stringify({ id: session.id }) });

        const client = createClient();
        const updatedMessages = await chatForWeb(
          client,
          session.messages,
          async (event: string, data: any) => {
            await stream.writeSSE({ event, data: JSON.stringify(data) });
          },
          abortController.signal,
          model
        );

        // Update session
        session.messages = updatedMessages;
        saveSession(session);

        // Count tools used for recap
        const toolCallMsgs = updatedMessages.filter(
          (m) => m.role === "assistant" && "tool_calls" in m && (m as any).tool_calls?.length > 0
        );
        const totalToolCalls = toolCallMsgs.reduce(
          (sum, m) => sum + ((m as any).tool_calls?.length || 0), 0
        );
        const toolNames = new Set<string>();
        for (const m of toolCallMsgs) {
          for (const tc of (m as any).tool_calls || []) {
            toolNames.add(tc.function?.name || tc.name || "unknown");
          }
        }

        // Find the last assistant text message as the final answer
        const lastAssistant = [...updatedMessages]
          .reverse()
          .find((m) => m.role === "assistant" && typeof m.content === "string" && m.content && m.content.length > 0);

        await stream.writeSSE({
          event: "recap",
          data: JSON.stringify({
            toolsUsed: totalToolCalls,
            toolNames: [...toolNames],
            turns: updatedMessages.filter((m) => m.role === "assistant").length,
          }),
        });

        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({ sessionId: session.id }),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ message: msg }),
        });
      } finally {
        activeStreams.delete(session.id);
      }
    });
  });

  app.post("/api/chat/stop", async (c) => {
    const { sessionId } = (await c.req.json()) as { sessionId: string };
    const controller = activeStreams.get(sessionId);
    if (controller) {
      controller.abort();
      activeStreams.delete(sessionId);
      return c.json({ stopped: true });
    }
    return c.json({ stopped: false });
  });

  // --- Serve local images (for generated images, thumbnails, etc.) ---
  app.get("/api/image", (c) => {
    const filePath = c.req.query("path");
    if (!filePath) return c.text("Missing path", 400);
    // Security: only allow image files
    const ext = path.extname(filePath).toLowerCase();
    const allowedExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];
    if (!allowedExts.includes(ext)) return c.text("Not an image", 403);
    if (!fs.existsSync(filePath)) return c.text("Not found", 404);
    const mimeTypes: Record<string, string> = {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
    };
    const data = fs.readFileSync(filePath);
    return new Response(data, {
      headers: { "Content-Type": mimeTypes[ext] || "application/octet-stream", "Cache-Control": "public, max-age=3600" },
    });
  });

  // --- Static files ---
  if (ui) {
    app.get("*", (c) => {
      const htmlPath = path.join(publicDir, "index.html");
      if (fs.existsSync(htmlPath)) {
        const html = fs.readFileSync(htmlPath, "utf-8");
        return c.html(html);
      }
      return c.text("Kai — index.html not found", 404);
    });
  }

  const features = [
    ui && "web UI",
    agents && "agent daemon",
    "API",
  ].filter(Boolean).join(" + ");

  console.log(`\n  Kai Server starting (${features})\n`);

  serve({ fetch: app.fetch, port }, (info) => {
    if (ui) console.log(`  UI:          http://localhost:${info.port}`);
    console.log(`  API:         http://localhost:${info.port}/api`);
    console.log(`  Provider:    ${getProviderName()} / ${getModelId()}`);
    console.log(`  Working dir: ${getCwd()}`);
    if (agents) console.log(`  Agents:      ${daemonStartedInProcess ? "daemon started in-process" : "external daemon running"}`);
    console.log(`  Permissions: auto\n`);
  });
}

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

// --- Helpers ---

function createNewSession(): Session {
  return {
    id: generateSessionId(),
    cwd: getCwd(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [{ role: "system", content: buildSystemPrompt() }],
  };
}

/**
 * Web-specific chat loop adapted from client.ts chat().
 * Replaces terminal output (spinners, chalk) with SSE events.
 */
async function chatForWeb(
  client: OpenAI,
  messages: ChatCompletionMessageParam[],
  emit: (event: string, data: any) => Promise<void>,
  signal?: AbortSignal,
  modelOverride?: string
): Promise<ChatCompletionMessageParam[]> {
  const activeTools = toolDefinitions as ChatCompletionTool[];
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
  const MAX_CONSECUTIVE_ERRORS = 3;

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
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = Math.min(3000 * Math.pow(2, attempt - 1), 15000);
          await emit("thinking", { active: true, message: `Retrying (${attempt + 1}/${maxRetries})...` });
          await new Promise((r) => setTimeout(r, delay));
        }
        stream = await client.chat.completions.create(
          {
            model: modelOverride || getModelId(),
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
        const isRetryable = status && [500, 502, 503, 429].includes(status);
        if (!isRetryable || attempt === maxRetries - 1) {
          clearTimeout(timeout);
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`API request failed: ${msg}`);
        }
      }
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
            if (tc.id) {
              if (currentToolCall) toolCalls.push(currentToolCall);
              currentToolCall = {
                id: tc.id,
                function: {
                  name: tc.function?.name || "",
                  arguments: tc.function?.arguments || "",
                },
              };
            } else if (currentToolCall) {
              if (tc.function?.name) currentToolCall.function.name += tc.function.name;
              if (tc.function?.arguments) currentToolCall.function.arguments += tc.function.arguments;
            }
          }
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    if (currentToolCall) toolCalls.push(currentToolCall);
    if (chunkUsage) trackUsage(chunkUsage);

    // Rescue tool calls leaked as text (Kimi, Qwen <|tool_call_begin|> format)
    if (toolCalls.length === 0 && content.includes("<|tool_call_begin|>")) {
      const pattern = /<\|tool_call_begin\|>\s*<\|tool_sep\|>\s*(\w+)\s*\n<\|tool_call_argument_begin\|>([\s\S]*?)<\|tool_call_argument_end\|>/g;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        toolCalls.push({
          id: `rescued-${Date.now()}-${toolCalls.length}`,
          function: { name: match[1], arguments: match[2].trim() },
        });
      }
      if (toolCalls.length > 0) {
        content = content.replace(/<\|tool_calls_section_begin\|>[\s\S]*$/m, "").trim();
      }
    }

    // Rescue <function=name> format (some models)
    if (toolCalls.length === 0 && content.includes("<function=")) {
      const pattern = /<function=(\w+)>\s*<parameter=(\w+)>\s*([\s\S]*?)(?:<\/function>|$)/g;
      let match;
      const calls: Record<string, Record<string, string>> = {};
      while ((match = pattern.exec(content)) !== null) {
        const fname = match[1];
        if (!calls[fname]) calls[fname] = {};
        calls[fname][match[2]] = match[3].trim();
      }
      for (const [fname, params] of Object.entries(calls)) {
        toolCalls.push({
          id: `rescued-${Date.now()}-${toolCalls.length}`,
          function: { name: fname, arguments: JSON.stringify(params) },
        });
      }
      if (toolCalls.length > 0) {
        content = content.replace(/<function=[\s\S]*$/m, "").trim();
      }
    }

    await emit("thinking", { active: false });

    // Text-only response — done
    if (toolCalls.length === 0) {
      updatedMessages.push({ role: "assistant", content });
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

  updatedMessages.push({
    role: "assistant",
    content: "[Reached maximum tool call limit.]",
  });
  return updatedMessages;
}

