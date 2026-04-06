import { Hono } from "hono";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { readUserConfig, saveUserConfig } from "../../config.js";
import { listMcpServers, initMcpServers } from "../../tools/index.js";
import { getLoadedSkills, getSkill, loadSkill, unloadSkill, reloadAllSkills, skillsDir } from "../../skills/index.js";
import { installSkill, uninstallSkill } from "../../skills/installer.js";

const CLI_SYMLINK_PATH = "/usr/local/bin/kai";

function getCliSourcePath(): string {
  const entryScript = path.resolve(process.argv[1]);
  const distIndex = path.resolve(path.dirname(entryScript), "index.js");
  if (fs.existsSync(distIndex)) return distIndex;
  return entryScript;
}

function getCliStatus(): { installed: boolean; path: string | null; source: string } {
  const source = getCliSourcePath();
  try {
    const stat = fs.lstatSync(CLI_SYMLINK_PATH);
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(CLI_SYMLINK_PATH);
      return { installed: true, path: CLI_SYMLINK_PATH, source: target };
    }
    return { installed: true, path: CLI_SYMLINK_PATH, source: CLI_SYMLINK_PATH };
  } catch {
    try {
      const which = execSync("which kai", { encoding: "utf-8" }).trim();
      if (which) return { installed: true, path: which, source: which };
    } catch {}
    return { installed: false, path: null, source };
  }
}

export function registerSettingsRoutes(app: Hono) {
  // --- Settings API ---
  app.get("/api/settings", (c) => {
    const config = readUserConfig();
    const mcpServers = listMcpServers();
    const skills = getLoadedSkills();

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
        tools: s.manifest.tools.map((t: any) => ({ name: t.name, description: t.description })),
        path: s.path,
      })),
    });
  });

  app.patch("/api/settings", async (c) => {
    try {
      const updates = await c.req.json();
      const allowed: Record<string, any> = {};
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
      config.mcp.servers[name] = { command, args: args || [], env: env || {} };
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

  // --- Available Skills from Registry ---
  app.get("/api/settings/skills/available", async (c) => {
    try {
      // Fetch skills list from kai-skills registry
      const response = await fetch("https://raw.githubusercontent.com/tmoreton/kai-skills/main/registry/skills.json");
      if (!response.ok) {
        return c.json({ error: "Failed to fetch skills registry" }, 500);
      }
      const registry = await response.json();
      
      // Get installed skill IDs
      const installedSkills = getLoadedSkills();
      const installedIds = new Set(installedSkills.map(s => s.manifest.id));
      
      // Filter out already installed skills
      const availableSkills = (registry.skills || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        version: s.version || "1.0.0",
        author: s.author || "Kai",
        tags: s.tags || [],
        installed: installedIds.has(s.id),
      }));
      
      return c.json({ skills: availableSkills });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
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
      return c.json({ id: skill.manifest.id, name: skill.manifest.name, manifest, handler, path: skill.path });
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
      const manifest = `id: ${id}\nname: ${name}\nversion: ${version}\ndescription: ${description}\n${author ? `author: ${author}\n` : ""}config_schema: {}\ntools: []\n`;
      const handler = `/**\n * ${name} Skill Handler\n */\n\nexport default {\n  actions: {\n  },\n};\n`;
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

  app.get("/api/settings/soul", (c) => {
    try {
      const soulPath = path.join(SOUL_DIR, "identity.json");
      const content = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, "utf-8") : JSON.stringify({ persona: { content: "" }, human: { content: "" } }, null, 2);
      return c.json({ content, path: soulPath });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.put("/api/settings/soul", async (c) => {
    try {
      const { content } = await c.req.json();
      if (content === undefined) return c.json({ error: "content is required" }, 400);
      JSON.parse(content);
      const soulPath = path.join(SOUL_DIR, "identity.json");
      fs.mkdirSync(SOUL_DIR, { recursive: true });
      fs.writeFileSync(soulPath, content, "utf-8");
      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  app.get("/api/settings/context", async (c) => {
    try {
      const { getProjectId, ensureProjectDir, ensureGlobalDir } = await import("../../project.js");
      const projectId = getProjectId();
      const isGlobal = projectId === "__global__";
      const globalDir = ensureGlobalDir("soul");
      const globalPath = path.join(globalDir, "context.json");
      let hasProjectContext = false;
      let projectPath = "";
      if (!isGlobal) {
        const projectDir = ensureProjectDir("soul", projectId);
        projectPath = path.join(projectDir, "context.json");
        hasProjectContext = fs.existsSync(projectPath);
      }
      const activePath = hasProjectContext ? projectPath : globalPath;
      const content = fs.existsSync(activePath) ? fs.readFileSync(activePath, "utf-8") : "{}";
      return c.json({ content, path: activePath, hasProjectContext, globalPath });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.put("/api/settings/context", async (c) => {
    try {
      const { content, scope } = await c.req.json();
      if (content === undefined) return c.json({ error: "content is required" }, 400);
      JSON.parse(content);
      const { getProjectId, ensureProjectDir, ensureGlobalDir } = await import("../../project.js");
      const projectId = getProjectId();
      const targetDir = scope === "project" && projectId !== "__global__" 
        ? ensureProjectDir("soul", projectId) 
        : ensureGlobalDir("soul");
      const targetPath = path.join(targetDir, "context.json");
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(targetPath, content, "utf-8");
      return c.json({ ok: true, path: targetPath });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  app.delete("/api/settings/context", async (c) => {
    try {
      const { getProjectId, ensureProjectDir } = await import("../../project.js");
      const projectId = getProjectId();
      if (projectId === "__global__") {
        return c.json({ error: "Cannot delete global context" }, 400);
      }
      const projectDir = ensureProjectDir("soul", projectId);
      const projectPath = path.join(projectDir, "context.json");
      if (fs.existsSync(projectPath)) {
        fs.unlinkSync(projectPath);
      }
      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // --- CLI Installation ---
  app.get("/api/settings/cli", (c) => {
    return c.json(getCliStatus());
  });

  app.post("/api/settings/cli/install", async (c) => {
    try {
      const source = getCliSourcePath();
      if (!fs.existsSync(source)) {
        return c.json({ error: `CLI source not found: ${source}` }, 500);
      }
      const wrapper = `#!/bin/sh\nexec "${process.execPath}" "${source}" "$@"\n`;
      const wrapperPath = path.resolve(process.env.HOME || "~", ".kai/bin/kai");
      const wrapperDir = path.dirname(wrapperPath);
      fs.mkdirSync(wrapperDir, { recursive: true });
      fs.writeFileSync(wrapperPath, wrapper, { mode: 0o755 });
      try { fs.unlinkSync(CLI_SYMLINK_PATH); } catch {}
      fs.symlinkSync(wrapperPath, CLI_SYMLINK_PATH);
      return c.json({ ok: true, path: CLI_SYMLINK_PATH });
    } catch (err: any) {
      if (err.code === "EACCES") {
        return c.json({ error: "Permission denied. Try running: sudo ln -sf ~/.kai/bin/kai /usr/local/bin/kai", needsSudo: true }, 403);
      }
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/settings/cli/uninstall", async (c) => {
    try {
      try { fs.unlinkSync(CLI_SYMLINK_PATH); } catch {}
      const wrapperPath = path.resolve(process.env.HOME || "~", ".kai/bin/kai");
      try { fs.unlinkSync(wrapperPath); } catch {}
      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // --- Weather API ---
  app.get("/api/weather", async (c) => {
    try {
      const apiKey = process.env.OPENWEATHER_API_KEY;
      if (!apiKey) {
        return c.json({ temp: 72, condition: "Sunny", icon: "☀️", location: "Local", mock: true, error: "No API key" }, 200);
      }
      const lat = process.env.WEATHER_LAT || "40.7128";
      const lon = process.env.WEATHER_LON || "-74.0060";
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=imperial`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Weather API error: ${response.status}`);
      }
      const data = await response.json();
      const conditionMap: Record<string, string> = {
        "Clear": "☀️", "Clouds": "☁️", "Rain": "🌧️", "Drizzle": "🌦️", "Thunderstorm": "⛈️",
        "Snow": "🌨️", "Mist": "🌫️", "Fog": "🌫️",
      };
      return c.json({
        temp: Math.round(data.main.temp),
        condition: data.weather[0].main,
        description: data.weather[0].description,
        icon: conditionMap[data.weather[0].main] || "🌡️",
        location: data.name,
        mock: false
      });
    } catch (err: any) {
      return c.json({ temp: 72, condition: "Sunny", icon: "☀️", location: "Local", mock: true, error: err.message }, 200);
    }
  });
}
