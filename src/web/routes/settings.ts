import { Hono } from "hono";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { readUserConfig, saveUserConfig } from "../../config.js";
import { listMcpServers, initMcpServers } from "../../tools/index.js";
import { getLoadedSkills, getSkill, loadSkill, unloadSkill, reloadAllSkills, skillsDir } from "../../skills/index.js";
import { installSkill, uninstallSkill, updateSkill } from "../../skills/installer.js";

const CLI_SYMLINK_PATH = "/usr/local/bin/kai";

function getCliSourcePath(): string {
  const entryScript = path.resolve(process.argv[1]);
  const distIndex = path.resolve(path.dirname(entryScript), "index.js");
  if (fs.existsSync(distIndex)) return distIndex;
  return entryScript;
}

function getCliStatus(): { installed: boolean; path: string | null; source: string; needsSudo?: boolean } {
  const source = getCliSourcePath();
  const wrapperPath = path.resolve(process.env.HOME || "~", ".kai/bin/kai");
  
  // Check 1: Does the wrapper script exist?
  const hasWrapper = fs.existsSync(wrapperPath);
  
  // Check 2: Does the symlink exist and point to our wrapper?
  let symlinkExists = false;
  let symlinkValid = false;
  let needsSudo = false;
  
  try {
    const stat = fs.lstatSync(CLI_SYMLINK_PATH);
    symlinkExists = true;
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(CLI_SYMLINK_PATH);
      // Check if symlink points to our wrapper or is at least a valid path
      symlinkValid = fs.existsSync(target);
      if (symlinkValid) {
        return { installed: true, path: CLI_SYMLINK_PATH, source: target };
      }
    }
  } catch (err: any) {
    if (err.code === "EACCES" || err.code === "EPERM") {
      needsSudo = true;
    }
    // Symlink doesn't exist or can't be read
  }
  
  // Check 3: Try "which kai" as fallback
  try {
    const which = execSync("which kai", { encoding: "utf-8" }).trim();
    if (which && which !== "/usr/local/bin/kai") {
      // Found kai elsewhere in PATH
      return { installed: true, path: which, source: which };
    }
  } catch {
    // "which kai" failed - command not found
  }
  
  // If we have a wrapper but no valid symlink, CLI is partially installed
  if (hasWrapper && symlinkExists && !symlinkValid) {
    // Broken symlink - needs sudo to fix
    return { installed: false, path: null, source, needsSudo: true };
  }
  
  return { installed: false, path: null, source, needsSudo };
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
        source: s.source,
      })),
    });
  });

  app.patch("/api/settings", async (c) => {
    try {
      const updates = await c.req.json();
      const config = readUserConfig();
      
      // Allow profile updates
      if (updates.profile) {
        config.profile = { ...config.profile, ...updates.profile };
      }
      
      // Other config updates
      if ("autoCompact" in updates) config.autoCompact = updates.autoCompact;
      if ("maxTokens" in updates) config.maxTokens = updates.maxTokens;
      
      saveUserConfig(config);
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

  // --- Environment variable management ---
  app.post("/api/settings/env", async (c) => {
    try {
      const { key, value } = await c.req.json();
      if (!key || value === undefined) {
        return c.json({ error: "key and value are required" }, 400);
      }
      
      // Save to ~/.kai/.env
      const envPath = path.resolve(process.env.HOME || "~", ".kai/.env");
      let envContent = "";
      try {
        if (fs.existsSync(envPath)) {
          envContent = fs.readFileSync(envPath, "utf-8");
        }
      } catch {}
      
      // Update or add the key
      const lines = envContent.split("\n");
      let found = false;
      const newLines = lines.map(line => {
        if (line.startsWith(`${key}=`)) {
          found = true;
          return `${key}=${value}`;
        }
        return line;
      });
      if (!found) {
        newLines.push(`${key}=${value}`);
      }
      
      fs.writeFileSync(envPath, newLines.join("\n"), "utf-8");
      
      // Also update current process env for immediate use
      process.env[key] = value;
      
      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
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

  app.post("/api/settings/skills/:id/update", async (c) => {
    try {
      const skillId = c.req.param("id");
      const result = await updateSkill(skillId);
      if (!result.updated) {
        return c.json({ error: result.message }, 400);
      }
      return c.json({ ok: true, message: result.message });
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
        configSchema: s.configSchema || {},
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

  // Create custom skill with full code
  app.post("/api/settings/skills/custom", async (c) => {
    try {
      const { name, description, code } = await c.req.json();
      if (!name || !name.trim()) return c.json({ error: "name is required" }, 400);
      if (!code) return c.json({ error: "code is required" }, 400);
      
      // Generate ID from name (kebab-case)
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!id) return c.json({ error: "name must contain letters or numbers" }, 400);
      
      const dir = skillsDir();
      const skillPath = path.join(dir, id);
      
      // If skill exists, overwrite (allows updates)
      const exists = fs.existsSync(skillPath);
      if (!exists) {
        fs.mkdirSync(skillPath, { recursive: true });
      }
      
      // Parse code to extract tools
      const manifest = `id: ${id}
name: ${name}
version: ${exists ? await getSkill(id).then(s => s?.manifest.version || "1.0.0") : "1.0.0"}
description: ${description || ""}
author: custom
tools: []
`;
      fs.writeFileSync(path.join(skillPath, "skill.yaml"), manifest, "utf-8");
      fs.writeFileSync(path.join(skillPath, "handler.js"), code, "utf-8");
      
      // Reload if skill was already loaded
      if (exists) {
        await unloadSkill(id);
      }
      await loadSkill(skillPath);
      
      return c.json({ ok: true, id, updated: exists });
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
      const { key, value, reload } = await c.req.json();
      if (!key || typeof value !== "string") {
        return c.json({ error: "key and value are required" }, 400);
      }
      
      // Update env file
      const vars = readEnvFile();
      vars[key] = value;
      writeEnvFile(vars);
      
      // Also update current process env
      process.env[key] = value;
      
      // Optionally reload provider (for API key changes)
      if (reload && (key === "OPENROUTER_API_KEY" || key === "FIREWORKS_API_KEY")) {
        const { reloadProvider } = await import("../../client.js");
        await reloadProvider();
      }
      
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

  // --- Provider Reload (for API key changes) ---
  app.post("/api/settings/reload-provider", async (c) => {
    try {
      // Re-read env file to ensure process.env is up to date
      const vars = readEnvFile();
      for (const [k, v] of Object.entries(vars)) {
        process.env[k] = v;
      }
      
      const { reloadProvider } = await import("../../client.js");
      await reloadProvider();
      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // --- Soul/Memory File Editing ---
  // Single file format: ~/.kai/soul/identity.json (plain text with ## headers)
  const SOUL_DIR = path.resolve(process.env.HOME || "~", ".kai/soul");

  app.get("/api/settings/soul", async (c) => {
    try {
      const { loadSoul } = await import("../../soul.js");
      const soul = loadSoul();
      const soulPath = path.join(SOUL_DIR, "identity.json");
      
      // Build plain text content from soul object
      const parts: string[] = [];
      if (soul.personality?.content) parts.push(`## Personality\n${soul.personality.content}`);
      if (soul.goals?.content) parts.push(`## Goals\n${soul.goals.content}`);
      if (soul.human?.content) parts.push(`## Human\n${soul.human.content}`);
      if (soul.scratchpad?.content) parts.push(`## Scratchpad\n${soul.scratchpad.content}`);
      const content = parts.join("\n\n") || "## Personality\n\n## Goals\n\n## Human\n\n## Scratchpad";
      
      return c.json({ content, path: soulPath });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.put("/api/settings/soul", async (c) => {
    try {
      const { content } = await c.req.json();
      if (content === undefined) return c.json({ error: "content is required" }, 400);
      
      const { saveSoul, loadSoul } = await import("../../soul.js");
      const soul = loadSoul();
      
      // Parse the plain text content and update soul
      const lines = content.split("\n");
      let currentSection = "";
      let currentContent: string[] = [];
      
      for (const line of lines) {
        const headerMatch = line.match(/^##?\s*(\w+)$/);
        if (headerMatch) {
          if (currentSection && currentContent.length > 0) {
            const sectionKey = currentSection.toLowerCase() as keyof typeof soul;
            if (soul[sectionKey]) {
              soul[sectionKey].content = currentContent.join("\n").trim();
            }
          }
          currentSection = headerMatch[1].toLowerCase();
          currentContent = [];
        } else if (currentSection) {
          currentContent.push(line);
        }
      }
      
      // Don't forget the last section
      if (currentSection && currentContent.length > 0) {
        const sectionKey = currentSection.toLowerCase() as keyof typeof soul;
        if (soul[sectionKey]) {
          soul[sectionKey].content = currentContent.join("\n").trim();
        }
      }
      
      saveSoul(soul);
      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Deprecated: Context is now part of soul file
  app.get("/api/settings/context", async (c) => {
    try {
      const { loadSoul } = await import("../../soul.js");
      const soul = loadSoul();
      const soulPath = path.join(SOUL_DIR, "identity.json");
      
      // Return goals+scratchpad as "context" for backwards compatibility
      const contextContent = `## Goals\n${soul.goals.content}\n\n## Scratchpad\n${soul.scratchpad.content}`;
      
      return c.json({ 
        content: contextContent, 
        path: soulPath, 
        hasProjectContext: false, 
        globalPath: soulPath,
        isProject: false 
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.put("/api/settings/context", async (c) => {
    try {
      const { content } = await c.req.json();
      if (content === undefined) return c.json({ error: "content is required" }, 400);
      
      const { saveSoul, loadSoul } = await import("../../soul.js");
      const soul = loadSoul();
      
      // Parse goals/scratchpad from plain text and update
      const lines = content.split("\n");
      let currentSection = "";
      let currentContent: string[] = [];
      
      for (const line of lines) {
        const headerMatch = line.match(/^##?\s*(\w+)$/);
        if (headerMatch) {
          if (currentSection && currentContent.length > 0) {
            const sectionKey = currentSection.toLowerCase();
            if (sectionKey === "goals" || sectionKey === "scratchpad") {
              soul[sectionKey].content = currentContent.join("\n").trim();
            }
          }
          currentSection = headerMatch[1].toLowerCase();
          currentContent = [];
        } else if (currentSection) {
          currentContent.push(line);
        }
      }
      
      if (currentSection) {
        const sectionKey = currentSection.toLowerCase();
        if (sectionKey === "goals" || sectionKey === "scratchpad") {
          soul[sectionKey].content = currentContent.join("\n").trim();
        }
      }
      
      saveSoul(soul);
      return c.json({ ok: true, path: path.join(SOUL_DIR, "identity.json") });
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
      
      // Try to remove existing symlink (might be broken or need sudo) - silently ignore errors
      try { fs.unlinkSync(CLI_SYMLINK_PATH); } catch {}
      try { fs.rmSync(CLI_SYMLINK_PATH, { force: true }); } catch {}
      
      try {
        fs.symlinkSync(wrapperPath, CLI_SYMLINK_PATH);
      } catch (err: any) {
        if (err.code === "EACCES" || err.code === "EPERM") {
          return c.json({ 
            error: "Permission denied. Try running: sudo ln -sf ~/.kai/bin/kai /usr/local/bin/kai", 
            needsSudo: true 
          }, 403);
        }
        throw err;
      }
      
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
      let needsSudo = false;
      
      // Try to remove symlink - may need sudo
      try { 
        fs.unlinkSync(CLI_SYMLINK_PATH); 
      } catch (err: any) {
        if (err.code === "EACCES" || err.code === "EPERM") {
          needsSudo = true;
        }
      }
      
      // Try to remove wrapper script (user-owned, should work)
      const wrapperPath = path.resolve(process.env.HOME || "~", ".kai/bin/kai");
      try { fs.unlinkSync(wrapperPath); } catch {}
      
      // Also try to remove wrapper directory if empty
      try { fs.rmdirSync(path.dirname(wrapperPath)); } catch {}
      
      if (needsSudo) {
        return c.json({ 
          error: "Permission denied. Try running: sudo rm /usr/local/bin/kai", 
          needsSudo: true 
        }, 403);
      }
      
      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // --- Provider reload (after API key change) ---
  app.post("/api/settings/reload-provider", async (c) => {
    try {
      const { reloadProvider } = await import("../../client.js");
      await reloadProvider();
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

  // --- VPN / Tailscale Settings ---
  app.get("/api/settings/vpn", async (c) => {
    try {
      const config = readUserConfig();
      const { getTailscaleStatus } = await import("../../tailscale.js");
      const tsStatus = getTailscaleStatus();
      // Build URL if running
      let tailscaleUrl: string | null = null;
      if (tsStatus.running) {
        tailscaleUrl = tsStatus.dnsName
          ? `https://${tsStatus.dnsName}`
          : tsStatus.tailscaleIp
          ? `https://${tsStatus.tailscaleIp}`
          : null;
      }
      return c.json({
        vpn: config.vpn || { enabled: true, funnel: false },
        tailscale: { ...tsStatus, url: tailscaleUrl },
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.patch("/api/settings/vpn", async (c) => {
    try {
      const { enabled, funnel } = await c.req.json();
      saveUserConfig({
        vpn: {
          enabled: enabled !== undefined ? enabled : true,
          funnel: funnel !== undefined ? funnel : false,
        }
      });
      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });
}
