import { Hono } from "hono";
import fs from "fs";
import path from "path";
import { buildSystemPrompt } from "../../system-prompt.js";
import { getCwd } from "../../tools/bash.js";
import {
  generateSessionId,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  type Session,
} from "../../sessions/manager.js";

export function registerSessionRoutes(app: Hono) {
  app.get("/api/sessions", (c) => {
    const type = c.req.query("type") as "chat" | "code" | "agent" | undefined;
    let sessions = listSessions(100, true);

    if (type) {
      sessions = sessions.filter((s) => {
        const sessionType = s.type || "chat";
        return sessionType === type;
      });
    }

    return c.json(
      sessions.map((s) => {
        // Load full session for preview extraction
        const full = loadSession(s.id);
        const msgs = full?.messages || [];
        const firstUserMsg = msgs.find((m: any) => {
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
        return {
          id: s.id,
          name: s.name,
          type: s.type || "chat",
          preview,
          cwd: full?.cwd || "",
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          messageCount: Math.floor(s.messageCount / 2),
        };
      })
    );
  });

  app.get("/api/sessions/:id", (c) => {
    const session = loadSession(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);
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
      type: body.type || "chat",
      cwd: getCwd(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [{ role: "system", content: buildSystemPrompt() }],
    };
    saveSession(session);
    return c.json({ id: session.id, name: session.name, type: session.type });
  });

  app.delete("/api/sessions/:id", (c) => {
    const deleted = deleteSession(c.req.param("id"));
    if (!deleted) return c.json({ error: "Session not found" }, 404);
    return c.json({ deleted: true });
  });

  // --- Projects (code sessions grouped by cwd) ---
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
      const sessionType = s.type || "code";
      if (sessionType !== "code") continue;

      // Load full session for cwd and message details
      const full = loadSession(s.id);
      if (!full) continue;

      const cwd = full.cwd || "unknown";
      if (!projectMap.has(cwd)) {
        const name = cwd.split("/").filter(Boolean).pop() || cwd;
        projectMap.set(cwd, { cwd, name, sessionCount: 0, lastActive: s.updatedAt, sessions: [] });
      }
      const proj = projectMap.get(cwd)!;
      const userMsgCount = full.messages.filter((m: any) => m.role === "user").length;
      if (userMsgCount === 0) continue;

      const firstUserMsg = full.messages.find((m: any) => {
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

    const projects = [...projectMap.values()]
      .filter((p) => p.sessionCount > 0)
      .sort((a, b) => b.lastActive.localeCompare(a.lastActive));
    for (const p of projects) {
      p.sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    return c.json(projects);
  });

  app.post("/api/projects", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { path: projectPath } = body as { path?: string };

    if (!projectPath || !projectPath.trim()) {
      return c.json({ error: "Path is required" }, 400);
    }

    const resolvedPath = path.resolve(projectPath.trim());

    if (!fs.existsSync(resolvedPath)) {
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

    const session: Session = {
      id: generateSessionId(),
      name: `New chat in ${projectName}`,
      cwd: resolvedPath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      type: "code",
      messages: [{ role: "system", content: buildSystemPrompt() }],
    };
    saveSession(session);

    return c.json({ id: session.id, name: projectName, cwd: resolvedPath });
  });
}
