import fs from "fs";
import path from "path";
import type { PermissionRule } from "./permissions.js";

export interface KaiConfig {
  model?: string;
  permissions?: PermissionRule[];
  theme?: string;
  autoCompact?: boolean;
  maxTokens?: number;
  temperature?: number;
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

export function getKaiMdContent(): string {
  const paths = [
    path.resolve(process.env.HOME || "~", ".kai/KAI.md"),
    path.resolve(process.cwd(), "KAI.md"),
    path.resolve(process.cwd(), ".kai/KAI.md"),
  ];

  const sections: string[] = [];

  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, "utf-8").trim();
        if (content) {
          sections.push(`# From ${p}\n${content}`);
        }
      }
    } catch {
      // skip
    }
  }

  return sections.join("\n\n---\n\n");
}

export function ensureKaiDir(): string {
  const dir = path.resolve(process.env.HOME || "~", ".kai");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
