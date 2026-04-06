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
  // In Tauri app: the dist/index.js is inside the app bundle's Resources
  // In dev/npm: it's the global npm package location
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
    // A real file exists at the path (e.g. npm global install)
    return { installed: true, path: CLI_SYMLINK_PATH, source: CLI_SYMLINK_PATH };
  } catch {
    // Also check if `kai` is available on PATH via another method
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

    // Check which required env vars are missing for each skill
    const skillsWithConfig = skills.map((s) => {
      const missingConfig: string[] = [];
      
      if (s.manifest.config_schema) {
        for (const [key, field] of Object.entries(s.manifest.config_schema)) {
          if (field.required) {
            const envKey = field.env || key;
            const hasValue = (field.env && envVars[field.env]) || envVars[key] || field.default !== undefined;
            if (!hasValue) {
              missingConfig.push(envKey);
            }
          }
        }
      }
      
      return {
        id: s.manifest.id,
        name: s.manifest.name,
        version: s.manifest.version,
        description: s.manifest.description || "",
        author: s.manifest.author || "",
        tools: s.manifest.tools.map((t: any) => ({ name: t.name, description: t.description })),
        path: s.path,
        missingConfig: missingConfig.length > 0 ? missingConfig : undefined,
      };
    });

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
      skills: skillsWithConfig,
    });
  });