import fs from "fs";
import path from "path";
import type { PermissionRule } from "./permissions.js";

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

export interface KaiConfig {
  model?: string;
  permissions?: PermissionRule[];
  hooks?: Record<string, string>;
  autoCompact?: boolean;
  maxTokens?: number;
  temperature?: number;
  mcp?: McpConfig;
  /** Maximum token budget per session. Warns at 80%, stops at 100%. */
  budgetTokens?: number;
}

const CONFIG_PATHS = [
  // Project-level (highest priority)
  path.resolve(process.cwd(), ".kai/settings.json"),
  path.resolve(process.cwd(), "kai.config.json"),
  // User-level
  path.resolve(
    process.env.HOME || "~",
    ".kai/settings.json"
  ),
];

let cachedConfig: KaiConfig | null = null;

export function loadConfig(): KaiConfig {
  const merged: KaiConfig = {};

  // Load in reverse order so project settings override user settings
  for (const configPath of [...CONFIG_PATHS].reverse()) {
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw);
        Object.assign(merged, parsed);
      }
    } catch {
      // Skip invalid configs
    }
  }

  cachedConfig = merged;
  return merged;
}

export function getConfig(): KaiConfig {
  if (!cachedConfig) return loadConfig();
  return cachedConfig;
}

/** Clear the config cache so the next getConfig() call re-reads from disk. */
export function clearConfigCache(): void {
  cachedConfig = null;
}

/** User-level config path: ~/.kai/settings.json */
const USER_CONFIG_PATH = path.resolve(process.env.HOME || "~", ".kai/settings.json");

/**
 * Read the user-level config file (~/.kai/settings.json).
 * Returns the raw parsed JSON (not merged with project configs).
 */
export function readUserConfig(): KaiConfig {
  try {
    if (fs.existsSync(USER_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf-8"));
    }
  } catch {}
  return {};
}

/**
 * Save settings to the user-level config file (~/.kai/settings.json).
 * Merges the provided partial config with the existing file contents.
 */
export function saveUserConfig(partial: Partial<KaiConfig>): void {
  ensureKaiDir();
  const existing = readUserConfig();
  const merged = { ...existing, ...partial };
  fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(merged, null, 2), "utf-8");
  clearConfigCache();
}

/** Root data directory: ~/.kai */
export const KAI_HOME = path.resolve(process.env.HOME || "~", ".kai");

export function ensureKaiDir(): string {
  if (!fs.existsSync(KAI_HOME)) {
    fs.mkdirSync(KAI_HOME, { recursive: true });
  }
  return KAI_HOME;
}

/** Resolve a sub-directory under ~/.kai, creating it if needed. */
export function kaiPath(...segments: string[]): string {
  const dir = path.join(KAI_HOME, ...segments);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
