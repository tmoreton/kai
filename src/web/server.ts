import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import net from "net";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Kai modules
import { getModelId, getProviderName, initProvider } from "../client.js";
import { DEFAULT_FIREWORKS_MODEL, DEFAULT_OPENROUTER_MODEL } from "../constants.js";
import { getConfig } from "../config.js";
import { getCwd } from "../tools/bash.js";
import { initMcpServers } from "../tools/index.js";
import { loadAllSkills } from "../skills/index.js";
import { setPermissionMode } from "../permissions.js";
import {
  isDaemonRunning,
  startDaemon,
  stopDaemon,
  writeDaemonPid,
  getDaemonPidPath,
} from "../agents-core/daemon.js";
import { closeDb } from "../agents-core/db.js";

// Route modules
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerChatRoutes } from "./routes/chat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Serve the web app - try dist/public first (for npm install), fallback to packages/web/dist (dev)
const publicDir = fs.existsSync(path.resolve(__dirname, "../public"))
  ? path.resolve(__dirname, "../public")
  : path.resolve(__dirname, "../../packages/web/dist");

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

  // Initialize provider (with fallback check), MCP servers, and skills before any interaction
  await Promise.allSettled([initProvider(), initMcpServers(), loadAllSkills()]);

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
      tailscale: tailscale,
      funnel: funnel,
      // Include key status for onboarding
      hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
      hasFireworksKey: !!process.env.FIREWORKS_API_KEY,
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

  // --- Model info ---
  app.get("/api/model", (c) => {
    const cfg = getConfig();
    const fireworksKey = process.env.FIREWORKS_API_KEY;
    // Default: OpenRouter Kimi K2.5. Fireworks takes precedence if key present.
    const model = cfg.model || (fireworksKey ? DEFAULT_FIREWORKS_MODEL : DEFAULT_OPENROUTER_MODEL);
    const provider = fireworksKey && !cfg.model?.includes("openrouter") ? "fireworks" : "openrouter";
    return c.json({ model, provider });
  });

  // Register route modules
  registerSessionRoutes(app);
  registerAgentRoutes(app);
  registerSettingsRoutes(app);
  registerChatRoutes(app);

  // --- Serve local images ---
  app.get("/api/image", (c) => {
    const filePath = c.req.query("path");
    if (!filePath) return c.text("Missing path", 400);
    const ext = path.extname(filePath).toLowerCase();
    const allowedExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];
    if (!allowedExts.includes(ext)) return c.text("Not an image", 403);
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
    const staticMimeTypes: Record<string, string> = {
      ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
      ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json",
      ".js": "text/javascript", ".css": "text/css",
    };
    app.get("*", (c, next) => {
      const reqPath = new URL(c.req.url).pathname;
      // Strip /Kai/ base path for GitHub Pages compatibility
      const cleanPath = reqPath.replace(/^\/Kai\//, '/');
      const ext = path.extname(cleanPath);
      if (ext && staticMimeTypes[ext]) {
        const filePath = path.join(publicDir, cleanPath);
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

    // SPA fallback
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
