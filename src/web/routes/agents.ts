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
  deleteNotification,
  deleteAllNotifications,
} from "../../agents/db.js";
import { runAgent } from "../../agents/daemon.js";
import { resumeRun, findInterruptedRunsForDisplay, getResumeStatus } from "../../agents/resume.js";
import { listPersonas, loadPersona, createPersona, updatePersonaField, addFileReference, removeFileReference, getFilePath } from "../../agent-persona.js";
import { createClient, getModelId } from "../../client.js";
import { buildSystemPrompt } from "../../system-prompt.js";
import {
  generateSessionId,
  saveSession,
  findSessionByPersona,
  type Session,
} from "../../sessions/manager.js";
import { getCwd } from "../../tools/bash.js";
import { ensureKaiDir } from "../../config.js";
import { ensureGlobalDir } from "../../project.js";

function inferAttachmentType(filePath: string): 'image' | 'markdown' | 'file' {
  const ext = path.extname(filePath).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) {
    return 'image';
  }
  if (ext === '.md') {
    return 'markdown';
  }
  return 'file';
}

// Helper to infer step type from step properties
function inferStepType(step: any): string {
  if (step.steps && Array.isArray(step.steps)) return 'parallel';
  if (step.prompt) return 'llm';
  if (step.skill || step.integration) return 'skill';
  if (step.command) return 'shell';
  if (step.params?.title || step.params?.message) return 'notify';
  return 'llm';
}

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
  app.get("/api/agents", async (c) => {
    const agents = listAgents();
    const personas = listPersonas();
    const personaMap = new Map(personas.map((p) => [p.id, p]));

    // Parse workflow files to get steps
    const YAML = await import("yaml");

    return c.json({
      agents: agents.map((a) => {
        const runs = getLatestRuns(a.id, 1);
        const lastRun = runs[0];
        const config = JSON.parse(a.config || "{}");
        const personaId = config.personaId;
        const persona = personaId ? personaMap.get(personaId) : null;
        
        // Parse workflow to get steps
        let steps = undefined;
        if (a.workflow_path && fs.existsSync(a.workflow_path)) {
          try {
            const yamlContent = fs.readFileSync(a.workflow_path, "utf-8");
            const workflow = YAML.parse(yamlContent);
            if (workflow.steps && Array.isArray(workflow.steps)) {
              steps = workflow.steps.map((s: any) => ({
                name: s.name,
                type: s.type || inferStepType(s),
                skill: s.skill,
                action: s.action || s.tool,
                prompt: s.prompt,
                command: s.command,
                condition: s.condition,
                output_var: s.output_var,
                params: s.params,
                max_tokens: s.max_tokens,
                auto_approve: s.auto_approve,
                stream: s.stream,
              }));
            }
          } catch (e) {
            // Silently ignore parse errors, steps will be undefined
          }
        }
        
        return {
          id: a.id,
          name: a.name,
          description: a.description,
          schedule: a.schedule,
          enabled: !!a.enabled,
          personaId: persona?.id || null,
          personaName: persona?.name || null,
          workflow_path: a.workflow_path,
          steps,
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

  // --- Workflow YAML ---
  app.get("/api/agents/:id/workflow", (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    if (!agent.workflow_path || !fs.existsSync(agent.workflow_path)) {
      return c.json({ error: "Workflow file not found" }, 404);
    }
    const yaml = fs.readFileSync(agent.workflow_path, "utf-8");
    return c.json({ yaml, path: agent.workflow_path });
  });

  app.put("/api/agents/:id/workflow", async (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    if (!agent.workflow_path) return c.json({ error: "No workflow path configured" }, 400);

    const body = await c.req.json().catch(() => ({}));
    const { yaml: yamlContent } = body as { yaml?: string };
    if (!yamlContent || typeof yamlContent !== "string") {
      return c.json({ error: "yaml field is required" }, 400);
    }

    // Validate YAML parses correctly
    try {
      const YAML = await import("yaml");
      YAML.parse(yamlContent);
    } catch (e) {
      return c.json({ error: `Invalid YAML: ${e instanceof Error ? e.message : String(e)}` }, 400);
    }

    fs.writeFileSync(agent.workflow_path, yamlContent, "utf-8");
    return c.json({ ok: true });
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

  // --- Resume an interrupted run ---
  app.post("/api/agents/:id/resume/:runId", async (c) => {
    const agentId = c.req.param("id");
    const runId = c.req.param("runId");
    
    const agent = getAgent(agentId);
    if (!agent) return c.json({ error: "Agent not found" }, 404);

    // Check if run can be resumed
    const status = getResumeStatus(runId);
    if (!status.canResume) {
      return c.json({ 
        error: "Run cannot be resumed", 
        reason: status.status 
      }, 400);
    }

    try {
      const result = await resumeRun(runId);
      return c.json({
        success: result.success,
        runId: result.runId,
        results: result.results,
        error: result.error,
      });
    } catch (err) {
      return c.json({ 
        error: err instanceof Error ? err.message : String(err) 
      }, 500);
    }
  });

  // --- List interrupted runs for an agent ---
  app.get("/api/agents/:id/interrupted", (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);

    const interrupted = findInterruptedRunsForDisplay({ agentId: agent.id, limit: 10 });
    
    return c.json({
      interruptedRuns: interrupted.map((r) => ({
        id: r.id,
        agentId: r.agent_id,
        status: r.status,
        currentStep: r.current_step,
        startedAt: r.started_at,
        checkpointStep: r.checkpoint_step,
        canResume: r.checkpoint_step > 0,
      })),
    });
  });

  // --- Get checkpoint status for a run ---
  app.get("/api/agents/:id/runs/:runId/checkpoint", (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    
    const runId = c.req.param("runId");
    const status = getResumeStatus(runId);
    
    return c.json({
      runId,
      canResume: status.canResume,
      status: status.status,
      lastCheckpoint: status.lastCheckpoint ? {
        stepIndex: status.lastCheckpoint.stepIndex,
        createdAt: status.lastCheckpoint.createdAt,
      } : null,
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
    return c.json({
      notifications: notifications.map((n) => {
        // Parse attachments - handle both string[] and object[] formats
        let attachments: Array<{ path: string; type: string; name: string }> | undefined;
        if (n.attachments) {
          try {
            const parsed = JSON.parse(n.attachments);
            if (Array.isArray(parsed)) {
              attachments = parsed.map((att: any) => {
                // If it's already an object with path, use it
                if (typeof att === 'object' && att.path) {
                  return {
                    path: att.path,
                    type: att.type || inferAttachmentType(att.path),
                    name: att.name || att.path.split('/').pop() || 'file',
                  };
                }
                // If it's a string (file path), convert to object
                if (typeof att === 'string') {
                  return {
                    path: att,
                    type: inferAttachmentType(att),
                    name: att.split('/').pop() || 'file',
                  };
                }
                return null;
              }).filter(Boolean) as any[];
            }
          } catch {
            // If parsing fails, ignore attachments
          }
        }
        
        return {
          id: n.id,
          agentId: n.agent_id,
          title: n.title,
          message: n.body || '',
          read: !!n.read,
          createdAt: n.created_at,
          attachments,
        };
      }),
      unread,
    });
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

  app.delete("/api/notifications/:id", (c) => {
    const id = parseInt(c.req.param("id"));
    deleteNotification(id);
    return c.json({ ok: true });
  });

  app.delete("/api/notifications", (c) => {
    deleteAllNotifications();
    return c.json({ ok: true });
  });

  // --- Serve notification attachment files ---
  app.get("/api/attachments", (c) => {
    const filePath = c.req.query("path");
    if (!filePath) return c.json({ error: "Missing path" }, 400);

    // Resolve ~ to home directory
    let resolved = filePath.startsWith("~")
      ? path.join(process.env.HOME || "", filePath.slice(1))
      : filePath;
    
    // Resolve relative paths against cwd
    if (!path.isAbsolute(resolved)) {
      resolved = path.resolve(getCwd(), resolved);
    }

    if (!fs.existsSync(resolved)) return c.json({ error: "File not found" }, 404);

    const ext = path.extname(resolved).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
      ".md": "text/markdown", ".txt": "text/plain", ".json": "application/json",
      ".pdf": "application/pdf",
    };
    const contentType = mimeTypes[ext] || "application/octet-stream";
    const data = fs.readFileSync(resolved);
    return new Response(data, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${path.basename(resolved)}"`,
      },
    });
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
