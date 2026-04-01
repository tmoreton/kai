import { Hono } from "hono";
import fs from "fs";
import path from "path";
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
} from "../../agents/db.js";
import { runAgent } from "../../agents/daemon.js";
import { listPersonas, loadPersona, createPersona, updatePersonaField, addFileReference, removeFileReference, getFilePath } from "../../agent-persona.js";
import { createClient, getModelId } from "../../client.js";
import { buildSystemPrompt } from "../../system-prompt.js";
import {
  generateSessionId,
  saveSession,
  findSessionByPersona,
  type Session,
} from "../../sessions.js";
import { getCwd } from "../../tools/bash.js";
import { ensureKaiDir } from "../../config.js";
import { ensureGlobalDir } from "../../project.js";

function createNewSession(): Session {
  return {
    id: generateSessionId(),
    cwd: getCwd(),
    type: "chat",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [{ role: "system", content: buildSystemPrompt() }],
  };
}

function buildPersonaContext(persona: { name: string; role?: string; personality?: string; goals?: string; scratchpad?: string }): string {
  return [
    `You are ${persona.name}.`,
    persona.role ? `Role: ${persona.role}` : "",
    persona.personality ? `\nPersonality:\n${persona.personality}` : "",
    persona.goals ? `\nGoals:\n${persona.goals}` : "",
    persona.scratchpad ? `\nWorking Notes (scratchpad):\n${persona.scratchpad}` : "",
    "\nMaintain this persona throughout the conversation. Reference your goals and working notes as appropriate.",
  ].filter(Boolean).join("\n");
}

export function registerAgentRoutes(app: Hono) {
  // --- Agents ---
  app.get("/api/agents", (c) => {
    const agents = listAgents();
    const personas = listPersonas();
    const personaMap = new Map(personas.map((p) => [p.id, p]));

    return c.json({
      agents: agents.map((a) => {
        const runs = getLatestRuns(a.id, 1);
        const lastRun = runs[0];
        const config = JSON.parse(a.config || "{}");
        const personaId = config.personaId;
        const persona = personaId ? personaMap.get(personaId) : null;
        return {
          id: a.id,
          name: a.name,
          description: a.description,
          schedule: a.schedule,
          enabled: !!a.enabled,
          personaId: persona?.id || null,
          personaName: persona?.name || null,
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
        scratchpad: p.scratchpad,
        tools: p.tools,
        maxTurns: p.maxTurns,
        files: p.files || [],
      })),
    });
  });

  // Persona CRUD endpoints
  app.post("/api/personas", async (c) => {
    const body = await c.req.json();
    const { id, name, role, personality, goals, scratchpad, tools, maxTurns } = body;
    if (!id || !name || !role || !personality || !goals) {
      return c.json({ error: "Missing required fields" }, 400);
    }
    const persona = createPersona(id, name, role, personality, goals, tools, maxTurns);
    if (scratchpad) {
      updatePersonaField(id, "scratchpad", "replace", scratchpad);
    }
    return c.json({ id: persona.id, name: persona.name });
  });

  app.patch("/api/personas/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const { field, content, operation = "replace" } = body;
    if (!field || !content) {
      return c.json({ error: "Missing field or content" }, 400);
    }
    const result = updatePersonaField(id, field, operation, content);
    return c.json({ result });
  });

  app.delete("/api/personas/:id", (c) => {
    const id = c.req.param("id");
    const dir = ensureGlobalDir("agents/personas");
    const p = path.join(dir, `${id}.json`);
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        return c.json({ deleted: true });
      }
      return c.json({ error: "Persona not found" }, 404);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // --- Persona File References ---
  app.post("/api/personas/:id/files", async (c) => {
    const id = c.req.param("id");
    const persona = loadPersona(id);
    if (!persona) return c.json({ error: "Persona not found" }, 404);

    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    const label = (formData.get("label") as string) || "";
    if (!file) return c.json({ error: "No file provided" }, 400);

    const buffer = Buffer.from(await file.arrayBuffer());
    const ref = addFileReference(id, file.name, label || file.name, file.type || "application/octet-stream", buffer);
    if (!ref) return c.json({ error: "Failed to save file" }, 500);

    return c.json(ref);
  });

  app.delete("/api/personas/:id/files/:storedName", (c) => {
    const id = c.req.param("id");
    const storedName = c.req.param("storedName");
    const removed = removeFileReference(id, storedName);
    if (!removed) return c.json({ error: "File not found" }, 404);
    return c.json({ deleted: true });
  });

  app.get("/api/personas/:id/files/:storedName", (c) => {
    const id = c.req.param("id");
    const storedName = c.req.param("storedName");
    const filePath = getFilePath(id, storedName);
    if (!fs.existsSync(filePath)) return c.json({ error: "File not found" }, 404);

    const persona = loadPersona(id);
    const ref = persona?.files?.find((f) => f.storedName === storedName);
    const mimeType = ref?.mimeType || "application/octet-stream";

    const data = fs.readFileSync(filePath);
    return new Response(data, { headers: { "Content-Type": mimeType } });
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

  app.post("/api/agents", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { name, description, schedule, prompt, personaId } = body as {
      name?: string;
      description?: string;
      schedule?: string;
      prompt?: string;
      personaId?: string;
    };

    if (!name || !name.trim()) {
      return c.json({ error: "Name is required" }, 400);
    }
    if (!prompt || !prompt.trim()) {
      return c.json({ error: "Prompt is required" }, 400);
    }

    const id = `agent-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")}`;

    const existing = getAgent(id);
    if (existing) {
      return c.json({ error: `Agent "${id}" already exists` }, 409);
    }

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

    const workflowsDir = path.join(ensureKaiDir(), "workflows");
    if (!fs.existsSync(workflowsDir)) fs.mkdirSync(workflowsDir, { recursive: true });
    const workflowPath = path.join(workflowsDir, `${id}.yaml`);
    fs.writeFileSync(workflowPath, yaml);

    saveAgent({
      id,
      name: name.trim(),
      description: (description || "").trim(),
      workflow_path: workflowPath,
      schedule: cleanSchedule,
      enabled: 1,
      config: JSON.stringify({ personaId: personaId || null }),
    });

    return c.json({ id, name: name.trim(), description: (description || "").trim(), schedule: cleanSchedule, enabled: true });
  });

  app.delete("/api/agents/:id", (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    deleteAgent(agent.id);
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

  // --- Agent recap ---
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

  // --- Persona Chat: Get or create persistent session ---
  app.post("/api/personas/:id/chat", async (c) => {
    const personaId = c.req.param("id");
    const persona = loadPersona(personaId);
    if (!persona) return c.json({ error: "Persona not found" }, 404);

    let session = findSessionByPersona(personaId);

    if (session) {
      const personaContext = buildPersonaContext(persona);
      const baseSystemPrompt = buildSystemPrompt();
      session.messages[0] = {
        role: "system",
        content: `${baseSystemPrompt}\n\n---\n\n${personaContext}`
      };
      saveSession(session);
      return c.json({ id: session.id, name: session.name, persona: persona.name, existing: true });
    }

    session = createNewSession();
    session.name = `Chat with ${persona.name}`;
    session.type = "agent";
    session.personaId = personaId;

    const personaContext = buildPersonaContext(persona);
    const baseSystemPrompt = buildSystemPrompt();
    session.messages[0] = {
      role: "system",
      content: `${baseSystemPrompt}\n\n---\n\n${personaContext}`
    };

    session.messages.push({
      role: "assistant",
      content: `Hi, I'm ${persona.name}. ${persona.role ? `I ${persona.role.toLowerCase().replace(/^i /, "").replace(/\.$/, "")}.` : "How can I help you today?"}`
    });

    saveSession(session);
    return c.json({ id: session.id, name: session.name, persona: persona.name, existing: false });
  });

  // --- New Persona Chat: Force create fresh session ---
  app.post("/api/personas/:id/chat/new", async (c) => {
    const personaId = c.req.param("id");
    const persona = loadPersona(personaId);
    if (!persona) return c.json({ error: "Persona not found" }, 404);

    const session = createNewSession();
    session.name = `Chat with ${persona.name}`;
    session.type = "agent";
    session.personaId = personaId;

    const personaContext = buildPersonaContext(persona);
    const baseSystemPrompt = buildSystemPrompt();
    session.messages[0] = {
      role: "system",
      content: `${baseSystemPrompt}\n\n---\n\n${personaContext}`
    };

    session.messages.push({
      role: "assistant",
      content: `Hi, I'm ${persona.name}. ${persona.role ? `I ${persona.role.toLowerCase().replace(/^i /, "").replace(/\.$/, "")}.` : "How can I help you today?"}`
    });

    saveSession(session);
    return c.json({ id: session.id, name: session.name, persona: persona.name, existing: false });
  });

  // --- Agent Detail Chat (simple request/response) ---
  app.post("/api/agent-chat", async (c) => {
    const body = await c.req.json();
    const { agentId, message } = body as { agentId: string; message: string };
    if (!agentId || !message) return c.json({ error: "Missing agentId or message" }, 400);

    const agent = getAgent(agentId);
    const config = agent ? JSON.parse(agent.config || "{}") : {};
    const personaId = config.personaId || agentId;
    const persona = loadPersona(personaId);

    let systemPrompt: string;
    if (persona) {
      const { buildAgentSystemPrompt } = await import("../../agent-persona.js");
      const { getCwd } = await import("../../tools/bash.js");
      systemPrompt = buildAgentSystemPrompt(persona, getCwd());
    } else if (agent) {
      systemPrompt = `You are ${agent.name}. ${agent.description || ""}\nAnswer questions about your workflows, past runs, and status.`;
    } else {
      return c.json({ error: "Agent not found" }, 404);
    }

    try {
      const client = createClient();
      const response = await client.chat.completions.create({
        model: getModelId(),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        max_tokens: 4096,
      });

      const text = response.choices[0]?.message?.content
        || (response.choices[0]?.message as any)?.reasoning || "";
      return c.json({ response: text });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });
}
