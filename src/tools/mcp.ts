import { spawn, type ChildProcess } from "child_process";
import { resolve } from "path";
import { getConfig } from "../config.js";
import chalk from "chalk";

/**
 * MCP (Model Context Protocol) Client
 *
 * Connects to MCP servers via stdio transport, discovers their tools,
 * and makes them callable from the chat loop and workflow engine.
 *
 * Config in ~/.kai/settings.json:
 * {
 *   "mcp": {
 *     "servers": {
 *       "filesystem": {
 *         "command": "npx",
 *         "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
 *         "env": {}
 *       }
 *     }
 *   }
 * }
 */

// --- JSON-RPC types ---

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, any>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

// --- MCP types ---

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, any>;
}

interface McpServer {
  name: string;
  config: McpServerConfig;
  process: ChildProcess | null;
  tools: McpTool[];
  ready: boolean;
  requestId: number;
  pendingRequests: Map<number, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timer: ReturnType<typeof setTimeout>;
  }>;
  buffer: string;
}

// --- Module state ---

const servers = new Map<string, McpServer>();

/**
 * Initialize all MCP servers from config.
 * Call once at startup.
 */
export async function initMcpServers(): Promise<void> {
  const config = getConfig();
  const mcpConfig = config.mcp?.servers;
  if (!mcpConfig || Object.keys(mcpConfig).length === 0) return;

  const startPromises: Promise<void>[] = [];

  for (const [name, serverConfig] of Object.entries(mcpConfig)) {
    startPromises.push(startServer(name, serverConfig));
  }

  await Promise.allSettled(startPromises);
}

async function startServer(name: string, config: McpServerConfig): Promise<void> {
  const server: McpServer = {
    name,
    config,
    process: null,
    tools: [],
    ready: false,
    requestId: 0,
    pendingRequests: new Map(),
    buffer: "",
  };
  servers.set(name, server);

  // Resolve command path for npx/node etc.
  const env = {
    ...process.env,
    ...(config.env || {}),
  };

  const child = spawn(config.command, config.args || [], {
    stdio: ["pipe", "pipe", "pipe"],
    env,
    shell: process.platform === "win32",
  });

  server.process = child;

  child.stdout!.on("data", (data: Buffer) => {
    server.buffer += data.toString();
    processBuffer(server);
  });

  child.stderr!.on("data", (data: Buffer) => {
    // MCP servers may log to stderr — ignore unless debugging
  });

  child.on("error", (err) => {
    console.error(chalk.red(`  MCP server "${name}" error: ${err.message}`));
    server.ready = false;
  });

  child.on("exit", (code) => {
    server.ready = false;
    // Reject any pending requests
    for (const [, pending] of server.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`MCP server "${name}" exited with code ${code}`));
    }
    server.pendingRequests.clear();
  });

  // Initialize the connection
  try {
    await sendRequest(server, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "kai", version: "1.0.0" },
    });

    // Send initialized notification (no id = notification)
    const notification = JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    child.stdin!.write(notification + "\n");

    // Discover tools
    const toolsResult = await sendRequest(server, "tools/list", {});
    server.tools = toolsResult.tools || [];
    server.ready = true;
  } catch (err: any) {
    console.error(chalk.red(`  MCP server "${name}" init failed: ${err.message}`));
    child.kill();
  }
}

function processBuffer(server: McpServer): void {
  // MCP uses newline-delimited JSON-RPC
  const lines = server.buffer.split("\n");
  server.buffer = lines.pop() || ""; // Keep incomplete line in buffer

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const msg = JSON.parse(trimmed) as JsonRpcResponse;
      if (msg.id !== undefined && server.pendingRequests.has(msg.id)) {
        const pending = server.pendingRequests.get(msg.id)!;
        clearTimeout(pending.timer);
        server.pendingRequests.delete(msg.id);

        if (msg.error) {
          pending.reject(new Error(`MCP error: ${msg.error.message}`));
        } else {
          pending.resolve(msg.result);
        }
      }
      // Notifications from server (no id) are ignored for now
    } catch {
      // Not valid JSON — skip
    }
  }
}

function sendRequest(server: McpServer, method: string, params: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!server.process || !server.process.stdin?.writable) {
      return reject(new Error(`MCP server "${server.name}" is not running`));
    }

    const id = ++server.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const timer = setTimeout(() => {
      server.pendingRequests.delete(id);
      reject(new Error(`MCP request to "${server.name}" timed out (30s)`));
    }, 30000);

    server.pendingRequests.set(id, { resolve, reject, timer });
    server.process.stdin!.write(JSON.stringify(request) + "\n");
  });
}

/**
 * Call a tool on an MCP server.
 */
export async function callMcpTool(
  serverName: string,
  toolName: string,
  args: Record<string, any>
): Promise<string> {
  const server = servers.get(serverName);
  if (!server) throw new Error(`MCP server "${serverName}" not found`);
  if (!server.ready) throw new Error(`MCP server "${serverName}" is not ready`);

  const result = await sendRequest(server, "tools/call", {
    name: toolName,
    arguments: args,
  });

  // MCP tool results are { content: [{ type, text }] }
  if (result.content && Array.isArray(result.content)) {
    return result.content
      .map((c: any) => {
        if (c.type === "text") return c.text;
        if (c.type === "image") return `[Image: ${c.mimeType}]`;
        if (c.type === "resource") return `[Resource: ${c.uri}]`;
        return JSON.stringify(c);
      })
      .join("\n");
  }

  return JSON.stringify(result, null, 2);
}

/**
 * Get all MCP tools across all servers, namespaced as "mcp__{server}__{tool}".
 */
export function getMcpToolDefinitions(): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}> {
  const defs: Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, any> };
  }> = [];

  for (const [serverName, server] of servers) {
    if (!server.ready) continue;

    for (const tool of server.tools) {
      defs.push({
        type: "function",
        function: {
          name: mcpToolName(serverName, tool.name),
          description: `[MCP: ${serverName}] ${tool.description || tool.name}`,
          parameters: tool.inputSchema || { type: "object", properties: {} },
        },
      });
    }
  }

  return defs;
}

/**
 * Check if a tool name is an MCP tool and execute it.
 * Returns null if not an MCP tool.
 */
export async function tryExecuteMcpTool(
  name: string,
  args: Record<string, any>
): Promise<string | null> {
  const parsed = parseMcpToolName(name);
  if (!parsed) return null;
  return callMcpTool(parsed.server, parsed.tool, args);
}

/**
 * List active MCP servers and their tools.
 */
export function listMcpServers(): Array<{
  name: string;
  ready: boolean;
  tools: string[];
}> {
  const result: Array<{ name: string; ready: boolean; tools: string[] }> = [];
  for (const [name, server] of servers) {
    result.push({
      name,
      ready: server.ready,
      tools: server.tools.map((t) => t.name),
    });
  }
  return result;
}

/**
 * Shut down all MCP servers gracefully.
 */
export async function shutdownMcpServers(): Promise<void> {
  for (const [, server] of servers) {
    if (server.process && !server.process.killed) {
      server.process.kill("SIGTERM");
    }
  }
  servers.clear();
}

// --- Helpers ---

function mcpToolName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}

function parseMcpToolName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith("mcp__")) return null;
  const parts = name.split("__");
  if (parts.length < 3) return null;
  return { server: parts[1], tool: parts.slice(2).join("__") };
}
