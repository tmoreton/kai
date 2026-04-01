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
import { createClient, getModelId, getProviderName, summarizeArgs, rescueToolCallsFromText } from "../client.js";
import { FIREWORKS_MODEL, FIREWORKS_MODEL_LABEL } from "../constants.js";
import { ensureKaiDir, readUserConfig, saveUserConfig, clearConfigCache } from "../config.js";
import { buildSystemPrompt } from "../system-prompt.js";
import { getCwd } from "../tools/bash.js";
import { toolDefinitions, getMcpToolDefinitions, initMcpServers, listMcpServers } from "../tools/index.js";
import { getLoadedSkills, getSkillToolDefinitions, reloadAllSkills } from "../skills/index.js";
import { installSkill, uninstallSkill } from "../skills/installer.js";
import { executeTool } from "../tools/executor.js";
import { setPermissionMode } from "../permissions.js";
import { trackUsage, shouldCompact, compactMessages, getUsage } from "../context.js";
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
  listNotifications,
  unreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
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
import { listPersonas, loadPersona } from "../agent-persona.js";

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
  tailscale?: boolean; // Expose via Tailscale serve (default: false)
  funnel?: boolean;    // Expose via Tailscale Funnel to internet (default: false)
}

export async function startServer(options: ServerOptions): Promise<void> {
  const { port, agents = true, ui = true, tailscale = false, funnel = false } = options;

  // Check port availability before doing anything else
  const portFree = await checkPort(port);
  if (!portFree) {
    console.error(`\n  Error: Port ${port} is already in use.`);
    console.error(`  Try: kai server --port ${port + 1}\n`);
    process.exit(1);
  }

  // Auto-approve tools in web mode (no readline available)
  setPermissionMode("auto");

  // Initialize MCP servers before any interaction
  await initMcpServers();

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
  const shutdown = async () => {
    console.log("\n  Shutting down...");
    if (tailscale) {
      try {
        const { stopTailscaleServe } = await import("../tailscale.js");
        stopTailscaleServe(funnel);
        console.log("  Tailscale serve stopped");
      } catch {}
    }
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
      tailscale: tailscale,
      funnel: funnel,
    });
  });

  // --- Tailscale status ---
  app.get("/api/tailscale", async (c) => {
    try {
      const { getTailscaleStatus } = await import("../tailscale.js");
      return c.json({ ...getTailscaleStatus(), enabled: tailscale, funnel });
    } catch {
      return c.json({ installed: false, running: false, enabled: false, funnel: false });
    }
  });

  // --- Model info (single model, no selector) ---
  app.get("/api/model", (c) => {
    return c.json({ model: FIREWORKS_MODEL, label: FIREWORKS_MODEL_LABEL, provider: "fireworks" });
  });

  // --- Sessions ---
  app.get("/api/sessions", (c) => {
    const sessions = listSessions(30, true);
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

  // --- Projects (sessions grouped by cwd) ---
  app.get("/api/projects", (c) => {
    const sessions = listSessions(100, true);
    const projectMap = new Map<string, {
      cwd: string;
      name: string;
      sessionCount: number;
      lastActive: string;
      sessions: Array<{ id: string; name?: string; preview: string | null; updatedAt: string; messageCount: number }>;
    }>();

    for (const s of sessions) {
      const cwd = s.cwd || "unknown";
      if (!projectMap.has(cwd)) {
        // Derive project name from last path segment
        const name = cwd.split("/").filter(Boolean).pop() || cwd;
        projectMap.set(cwd, { cwd, name, sessionCount: 0, lastActive: s.updatedAt, sessions: [] });
      }
      const proj = projectMap.get(cwd)!;
      const userMsgCount = s.messages.filter((m) => m.role === "user").length;
      if (userMsgCount === 0) continue; // skip empty sessions

      // Extract preview from first user message
      const firstUserMsg = s.messages.find((m) => {
        if (m.role !== "user") return false;
        const text = typeof m.content === "string" ? m.content
          : Array.isArray(m.content) ? m.content.map((p: any) => p.type === "text" ? p.text : "").join("") : "";
        return text.length > 0 && !text.startsWith("# Compacted conversation");
      });
      let preview: string | null = null;
      if (firstUserMsg) {
        const text = typeof firstUserMsg.content === "string" ? firstUserMsg.content
          : Array.isArray(firstUserMsg.content) ? (firstUserMsg.content as any[]).map((p: any) => p.type === "text" ? p.text : "").join("") : "";
        preview = text.substring(0, 80);
      }

      proj.sessionCount++;
      if (s.updatedAt > proj.lastActive) proj.lastActive = s.updatedAt;
      proj.sessions.push({
        id: s.id,
        name: s.name,
        preview,
        updatedAt: s.updatedAt,
        messageCount: userMsgCount,
      });
    }

    // Sort projects by last activity, sessions within each by updatedAt desc
    const projects = [...projectMap.values()]
      .filter((p) => p.sessionCount > 0)
      .sort((a, b) => b.lastActive.localeCompare(a.lastActive));
    for (const p of projects) {
      p.sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    return c.json(projects);
  });

  // --- Create project (register a new codebase by path) ---
  app.post("/api/projects", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { path: projectPath } = body as { path?: string };

    if (!projectPath || !projectPath.trim()) {
      return c.json({ error: "Path is required" }, 400);
    }

    const resolvedPath = path.resolve(projectPath.trim());

    if (!fs.existsSync(resolvedPath)) {
      // Create the directory if it doesn't exist
      try {
        fs.mkdirSync(resolvedPath, { recursive: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return c.json({ error: `Could not create directory: ${msg}` }, 400);
      }
    } else {
      try {
        const stat = fs.statSync(resolvedPath);
        if (!stat.isDirectory()) {
          return c.json({ error: "Path exists but is not a directory" }, 400);
        }
      } catch {
        return c.json({ error: "Cannot access path" }, 400);
      }
    }

    const projectName = resolvedPath.split("/").filter(Boolean).pop() || resolvedPath;

    // Create a session scoped to this cwd to register the project
    const session: Session = {
      id: generateSessionId(),
      name: `New chat in ${projectName}`,
      cwd: resolvedPath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [{ role: "system", content: buildSystemPrompt() }],
    };
    saveSession(session);

    return c.json({ id: session.id, name: projectName, cwd: resolvedPath });
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
    const personas = listPersonas();
    const personaMap = new Map(personas.map((p) => [p.id, p]));

    return c.json({
      agents: agents.map((a) => {
        const runs = getLatestRuns(a.id, 1);
        const lastRun = runs[0];
        const persona = personaMap.get(a.id);
        return {
          id: a.id,
          name: a.name,
          description: a.description,
          schedule: a.schedule,
          enabled: !!a.enabled,
          persona: persona ? { name: persona.name, role: persona.role, personality: persona.personality } : null,
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
      }),
      personas: personas.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        personality: p.personality,
        goals: p.goals,
      })),
    });
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
        recap: r.recap,
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

  // --- Create agent (from web UI) ---
  app.post("/api/agents", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { name, description, schedule, prompt } = body as {
      name?: string;
      description?: string;
      schedule?: string;
      prompt?: string;
    };

    if (!name || !name.trim()) {
      return c.json({ error: "Name is required" }, 400);
    }
    if (!prompt || !prompt.trim()) {
      return c.json({ error: "Prompt is required" }, 400);
    }

    const id = `agent-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")}`;

    // Check if agent already exists
    const existing = getAgent(id);
    if (existing) {
      return c.json({ error: `Agent "${id}" already exists` }, 409);
    }

    // Generate workflow YAML
    const cleanName = name.trim().replace(/"/g, '\\"');
    const cleanDesc = (description || "").trim().replace(/"/g, '\\"');
    const cleanSchedule = (schedule || "").trim();
    const indentedPrompt = prompt.trim().split("\n").map(line => `      ${line}`).join("\n");

    const yaml = [
      `name: "${cleanName}"`,
      `description: "${cleanDesc}"`,
      cleanSchedule ? `schedule: "${cleanSchedule}"` : "",
      `steps:`,
      `  - name: main`,
      `    type: llm`,
      `    prompt: |`,
      indentedPrompt,
    ].filter(Boolean).join("\n") + "\n";

    // Write workflow file
    const workflowsDir = path.join(ensureKaiDir(), "workflows");
    if (!fs.existsSync(workflowsDir)) fs.mkdirSync(workflowsDir, { recursive: true });
    const workflowPath = path.join(workflowsDir, `${id}.yaml`);
    fs.writeFileSync(workflowPath, yaml);

    // Save to DB
    saveAgent({
      id,
      name: name.trim(),
      description: (description || "").trim(),
      workflow_path: workflowPath,
      schedule: cleanSchedule,
      enabled: 1,
      config: "{}",
    });

    return c.json({ id, name: name.trim(), description: (description || "").trim(), schedule: cleanSchedule, enabled: true });
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

  // --- Agent recap (cached from run completion) ---
  app.get("/api/agents/:id/recap", async (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    const runs = getLatestRuns(agent.id, 1);
    if (runs.length === 0) return c.json({ error: "No runs" }, 404);
    return c.json({ recap: runs[0].recap || null, run: runs[0] });
  });

  // --- Notifications ---
  app.get("/api/notifications", (c) => {
    const limit = parseInt(c.req.query("limit") || "30");
    const notifications = listNotifications(limit);
    const unread = unreadNotificationCount();
    return c.json({ notifications, unread });
  });

  app.patch("/api/notifications/:id/read", (c) => {
    const id = parseInt(c.req.param("id"));
    markNotificationRead(id);
    return c.json({ ok: true });
  });

  app.post("/api/notifications/read-all", (c) => {
    markAllNotificationsRead();
    return c.json({ ok: true });
  });

  // --- Chat (SSE streaming) ---
  app.post("/api/chat", async (c) => {
    const body = await c.req.json();
    const { sessionId, message, attachments } = body as {
      sessionId?: string;
      message: string;
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
          abortController.signal
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

  // --- Settings API ---

  // Get all settings + MCP server status + installed skills
  app.get("/api/settings", (c) => {
    const config = readUserConfig();
    const mcpServers = listMcpServers();
    const skills = getLoadedSkills();

    return c.json({
      config,
      mcp: {
        servers: mcpServers.map((s) => ({
          name: s.name,
          ready: s.ready,
          tools: s.tools,
          config: config.mcp?.servers?.[s.name] || {},
        })),
      },
      skills: skills.map((s) => ({
        id: s.manifest.id,
        name: s.manifest.name,
        version: s.manifest.version,
        description: s.manifest.description || "",
        author: s.manifest.author || "",
        tools: s.manifest.tools.map((t) => ({ name: t.name, description: t.description })),
        path: s.path,
      })),
    });
  });

  // Update general settings
  app.patch("/api/settings", async (c) => {
    try {
      const updates = await c.req.json();
      // Only allow safe fields to be updated
      const allowed: Record<string, any> = {};
      if ("budgetTokens" in updates) allowed.budgetTokens = updates.budgetTokens;
      if ("autoCompact" in updates) allowed.autoCompact = updates.autoCompact;
      if ("maxTokens" in updates) allowed.maxTokens = updates.maxTokens;

      saveUserConfig(allowed);
      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  // Add MCP server
  app.post("/api/settings/mcp", async (c) => {
    try {
      const { name, command, args, env } = await c.req.json();
      if (!name || !command) return c.json({ error: "name and command are required" }, 400);

      const config = readUserConfig();
      if (!config.mcp) config.mcp = { servers: {} };
      if (!config.mcp.servers) config.mcp.servers = {};

      config.mcp.servers[name] = {
        command,
        args: args || [],
        env: env || {},
      };

      saveUserConfig({ mcp: config.mcp });

      // Re-initialize MCP servers to pick up the new one
      await initMcpServers();

      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  // Remove MCP server
  app.delete("/api/settings/mcp/:name", async (c) => {
    try {
      const serverName = c.req.param("name");
      const config = readUserConfig();

      if (!config.mcp?.servers?.[serverName]) {
        return c.json({ error: `Server "${serverName}" not found` }, 404);
      }

      delete config.mcp.servers[serverName];
      saveUserConfig({ mcp: config.mcp });

      // Re-initialize MCP servers
      await initMcpServers();

      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  // Reload all skills
  app.post("/api/settings/skills/reload", async (c) => {
    try {
      const result = await reloadAllSkills();
      return c.json({ loaded: result.loaded, errors: result.errors });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Install a skill from GitHub URL or local path
  app.post("/api/settings/skills/install", async (c) => {
    try {
      const { source } = await c.req.json();
      if (!source) return c.json({ error: "source is required" }, 400);
      const id = await installSkill(source);
      return c.json({ ok: true, id });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  // Uninstall a skill
  app.delete("/api/settings/skills/:id", async (c) => {
    try {
      const skillId = c.req.param("id");
      await uninstallSkill(skillId);
      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  // --- Serve local images (for generated images, thumbnails, etc.) ---
  app.get("/api/image", (c) => {
    const filePath = c.req.query("path");
    if (!filePath) return c.text("Missing path", 400);
    // Security: only allow image files
    const ext = path.extname(filePath).toLowerCase();
    const allowedExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];
    if (!allowedExts.includes(ext)) return c.text("Not an image", 403);
    // Security: resolve to absolute and block path traversal
    const resolved = path.resolve(filePath);
    const kaiDir = path.resolve(process.env.HOME || "", ".kai");
    if (!resolved.startsWith(kaiDir) && !resolved.startsWith("/tmp")) {
      return c.text("Forbidden: path outside allowed directories", 403);
    }
    if (!fs.existsSync(resolved)) return c.text("Not found", 404);
    const mimeTypes: Record<string, string> = {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
    };
    const data = fs.readFileSync(resolved);
    return new Response(data, {
      headers: { "Content-Type": mimeTypes[ext] || "application/octet-stream", "Cache-Control": "public, max-age=3600" },
    });
  });

  // --- Static files ---
  if (ui) {
    // Serve static assets from public dir (icons, manifest, etc.)
    const staticMimeTypes: Record<string, string> = {
      ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
      ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json",
      ".js": "text/javascript", ".css": "text/css",
    };
    app.get("*", (c, next) => {
      const reqPath = new URL(c.req.url).pathname;
      const ext = path.extname(reqPath);
      if (ext && staticMimeTypes[ext]) {
        const filePath = path.join(publicDir, reqPath);
        const resolved = path.resolve(filePath);
        if (resolved.startsWith(path.resolve(publicDir)) && fs.existsSync(resolved)) {
          const data = fs.readFileSync(resolved);
          return new Response(data, {
            headers: { "Content-Type": staticMimeTypes[ext], "Cache-Control": "public, max-age=3600" },
          });
        }
      }
      return next();
    });

    // SPA fallback — serve index.html for all other routes
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

  serve({ fetch: app.fetch, port }, async (info) => {
    if (ui) console.log(`  UI:          http://localhost:${info.port}`);
    console.log(`  API:         http://localhost:${info.port}/api`);
    console.log(`  Working dir: ${getCwd()}`);
    if (agents) console.log(`  Agents:      ${daemonStartedInProcess ? "daemon started in-process" : "external daemon running"}`);
    console.log(`  Permissions: auto`);

    // Start Tailscale serve/funnel if requested
    if (tailscale) {
      try {
        const { startTailscaleServe } = await import("../tailscale.js");
        const tsUrl = await startTailscaleServe({ port: info.port, funnel });
        const mode = funnel ? "Funnel (public)" : "Serve (tailnet only)";
        console.log(`  Tailscale:   ${tsUrl}  (${mode})`);
      } catch (err: any) {
        console.error(`  Tailscale:   ${err.message}`);
      }
    }

    console.log("");
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
    // Index-based tracking: Fireworks sends tc.id on every delta chunk,
    // so we must use tc.index to accumulate fragments into complete tool calls.
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

    // Rescue tool calls leaked as text (handles Kimi, Qwen, and <function=> formats)
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

    // If assistant text ends with a question, stop the tool loop and
    // let the user respond — even if there are pending tool calls
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
    // Sanitize arguments: Fireworks requires valid JSON object strings
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

