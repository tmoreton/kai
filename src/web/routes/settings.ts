import { Hono } from "hono";
import fs from "fs";
import path from "path";
import { readUserConfig, saveUserConfig } from "../../config.js";
import { listMcpServers, initMcpServers } from "../../tools/index.js";
import { getLoadedSkills, getSkill, loadSkill, unloadSkill, reloadAllSkills, skillsDir } from "../../skills/index.js";
import { installSkill, uninstallSkill } from "../../skills/installer.js";

export function registerSettingsRoutes(app: Hono) {
  // --- Settings API ---
  app.get("/api/settings", (c) => {
    const config = readUserConfig();
    const mcpServers = listMcpServers();
    const skills = getLoadedSkills();

    // Read env vars from ~/.kai/.env
    const envPath = path.resolve(process.env.HOME || "~", ".kai/.env");
    const envVars: Record<string, string> = {};
    try {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf-8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eq = trimmed.indexOf("=");
          if (eq > 0) {
            const key = trimmed.slice(0, eq).trim();
            const value = trimmed.slice(eq + 1).trim();
            envVars[key] = value;
          }
        }
      }
    } catch {}

    return c.json({
      config,
      env: envVars,
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

  app.patch("/api/settings", async (c) => {
    try {
      const updates = await c.req.json();
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

  // --- MCP server management ---
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
      await initMcpServers();

      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  app.delete("/api/settings/mcp/:name", async (c) => {
    try {
      const serverName = c.req.param("name");
      const config = readUserConfig();

      if (!config.mcp?.servers?.[serverName]) {
        return c.json({ error: `Server "${serverName}" not found` }, 404);
      }

      delete config.mcp.servers[serverName];
      saveUserConfig({ mcp: config.mcp });
      await initMcpServers();

      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  // --- Skills management ---
  app.post("/api/settings/skills/reload", async (c) => {
    try {
      const result = await reloadAllSkills();
      return c.json({ loaded: result.loaded, errors: result.errors });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

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

  app.delete("/api/settings/skills/:id", async (c) => {
    try {
      const skillId = c.req.param("id");
      await uninstallSkill(skillId);
      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  app.get("/api/settings/skills/:id", async (c) => {
    try {
      const skillId = c.req.param("id");
      const skill = getSkill(skillId);
      if (!skill) return c.json({ error: "Skill not found" }, 404);

      const manifestPath = path.join(skill.path, "skill.yaml");
      const handlerPath = path.join(skill.path, "handler.js");

      const manifest = fs.readFileSync(manifestPath, "utf-8");
      const handler = fs.existsSync(handlerPath) ? fs.readFileSync(handlerPath, "utf-8") : "";

      return c.json({
        id: skill.manifest.id,
        name: skill.manifest.name,
        manifest,
        handler,
        path: skill.path,
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.put("/api/settings/skills/:id/manifest", async (c) => {
    try {
      const skillId = c.req.param("id");
      const { manifest } = await c.req.json();
      if (!manifest) return c.json({ error: "manifest is required" }, 400);

      const skill = getSkill(skillId);
      if (!skill) return c.json({ error: "Skill not found" }, 404);

      const manifestPath = path.join(skill.path, "skill.yaml");
      fs.writeFileSync(manifestPath, manifest, "utf-8");

      await unloadSkill(skillId);
      await loadSkill(skill.path);

      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.put("/api/settings/skills/:id/handler", async (c) => {
    try {
      const skillId = c.req.param("id");
      const { handler } = await c.req.json();
      if (handler === undefined) return c.json({ error: "handler is required" }, 400);

      const skill = getSkill(skillId);
      if (!skill) return c.json({ error: "Skill not found" }, 404);

      const handlerPath = path.join(skill.path, "handler.js");
      fs.writeFileSync(handlerPath, handler, "utf-8");

      await unloadSkill(skillId);
      await loadSkill(skill.path);

      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/settings/skills", async (c) => {
    try {
      const body = await c.req.json();
      const { id, name, version = "1.0.0", description = "", author = "" } = body;

      if (!id || !name) return c.json({ error: "id and name are required" }, 400);
      if (!/^[a-z0-9-_]+$/i.test(id)) return c.json({ error: "id must contain only letters, numbers, hyphens, and underscores" }, 400);

      const dir = skillsDir();
      const skillPath = path.join(dir, id);

      if (fs.existsSync(skillPath)) {
        return c.json({ error: `Skill "${id}" already exists` }, 409);
      }

      fs.mkdirSync(skillPath, { recursive: true });

      const manifest = `id: ${id}
name: ${name}
version: ${version}
description: ${description}
${author ? `author: ${author}\n` : ""}config_schema: {}
tools: []
`;

      const handler = `/**
 * ${name} Skill Handler
 */

export default {
  actions: {
  },
};
`;

      fs.writeFileSync(path.join(skillPath, "skill.yaml"), manifest, "utf-8");
      fs.writeFileSync(path.join(skillPath, "handler.js"), handler, "utf-8");

      await loadSkill(skillPath);

      return c.json({ ok: true, id });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // --- Env vars API ---
  const ENV_PATH = path.resolve(process.env.HOME || "~", ".kai/.env");

  function readEnvFile(): Record<string, string> {
    const vars: Record<string, string> = {};
    try {
      if (fs.existsSync(ENV_PATH)) {
        const content = fs.readFileSync(ENV_PATH, "utf-8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eq = trimmed.indexOf("=");
          if (eq > 0) {
            const key = trimmed.slice(0, eq).trim();
            const value = trimmed.slice(eq + 1).trim();
            vars[key] = value;
          }
        }
      }
    } catch {}
    return vars;
  }

  function writeEnvFile(vars: Record<string, string>): void {
    const lines = Object.entries(vars).map(([k, v]) => `${k}=${v}`);
    fs.writeFileSync(ENV_PATH, lines.join("\n") + "\n", "utf-8");
  }

  app.get("/api/settings/env", (c) => {
    return c.json({ env: readEnvFile() });
  });

  app.post("/api/settings/env", async (c) => {
    try {
      const { key, value } = await c.req.json();
      if (!key || typeof value !== "string") {
        return c.json({ error: "key and value are required" }, 400);
      }
      const vars = readEnvFile();
      vars[key] = value;
      writeEnvFile(vars);
      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  app.delete("/api/settings/env/:key", async (c) => {
    try {
      const key = c.req.param("key");
      const vars = readEnvFile();
      delete vars[key];
      writeEnvFile(vars);
      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  // --- Soul/Memory File Editing ---
  const SOUL_DIR = path.resolve(process.env.HOME || "~", ".kai/soul");

  // Get soul identity file content
  app.get("/api/settings/soul", (c) => {
    try {
      const soulPath = path.join(SOUL_DIR, "identity.json");
      const content = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, "utf-8") : JSON.stringify({ persona: { content: "" }, human: { content: "" } }, null, 2);
      return c.json({ content, path: soulPath });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Update soul identity file
  app.put("/api/settings/soul", async (c) => {
    try {
      const { content } = await c.req.json();
      if (content === undefined) return c.json({ error: "content is required" }, 400);
      // Validate JSON
      JSON.parse(content);
      const soulPath = path.join(SOUL_DIR, "identity.json");
      fs.mkdirSync(SOUL_DIR, { recursive: true });
      fs.writeFileSync(soulPath, content, "utf-8");
      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  // Get project context (goals + scratchpad)
  app.get("/api/settings/context", async (c) => {
    try {
      const { getProjectId, ensureProjectDir, ensureGlobalDir } = await import("../../project.js");

      const projectId = getProjectId();
      const isGlobal = projectId === "__global__";

      // Get both paths so frontend can toggle
      const globalDir = ensureGlobalDir("soul");
      const globalPath = path.join(globalDir, "context.json");

      let hasProjectContext = false;
      let projectPath = "";

      if (!isGlobal) {
        const projectDir = ensureProjectDir("soul", projectId);
        projectPath = path.join(projectDir, "context.json");
        hasProjectContext = fs.existsSync(projectPath);
      }

      // Use project context if it exists, otherwise global
      const activePath = hasProjectContext ? projectPath : globalPath;
      const content = fs.existsSync(activePath) ? fs.readFileSync(activePath, "utf-8") : JSON.stringify({ goals: { content: "" }, scratchpad: { content: "" } }, null, 2);

      return c.json({
        content,
        path: activePath,
        globalPath,
        projectPath: projectPath || null,
        isProject: hasProjectContext,
        hasProjectContext
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Update project context
  app.put("/api/settings/context", async (c) => {
    try {
      const { content, scope } = await c.req.json();
      if (content === undefined) return c.json({ error: "content is required" }, 400);
      // Validate JSON
      JSON.parse(content);

      const { getProjectId, ensureProjectDir, ensureGlobalDir } = await import("../../project.js");
      const projectId = getProjectId();
      const isGlobal = projectId === "__global__";

      if (scope === "project" && isGlobal) {
        return c.json({ error: "Cannot use project scope - not in a project context" }, 400);
      }

      let ctxPath: string;
      if (scope === "project") {
        const projectDir = ensureProjectDir("soul", projectId);
        ctxPath = path.join(projectDir, "context.json");
      } else {
        const globalDir = ensureGlobalDir("soul");
        ctxPath = path.join(globalDir, "context.json");
      }

      fs.writeFileSync(ctxPath, content, "utf-8");
      return c.json({ ok: true, path: ctxPath });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });
}
