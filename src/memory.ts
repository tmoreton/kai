import fs from "fs";
import path from "path";
import { ensureKaiDir } from "./config.js";

function memoryDir(): string {
  const dir = path.join(ensureKaiDir(), "memory");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function projectMemoryDir(): string {
  const dir = path.resolve(process.cwd(), ".kai/memory");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export interface MemoryEntry {
  name: string;
  type: "user" | "project" | "feedback" | "reference";
  description: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export function saveMemory(
  entry: Omit<MemoryEntry, "createdAt" | "updatedAt">,
  scope: "user" | "project" = "project"
): string {
  const dir = scope === "user" ? memoryDir() : projectMemoryDir();
  const fileName = entry.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .substring(0, 50);
  const filePath = path.join(dir, `${fileName}.md`);

  const now = new Date().toISOString();
  const existing = loadMemoryFile(filePath);

  const full: MemoryEntry = {
    ...entry,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  const fileContent = `---
name: ${full.name}
type: ${full.type}
description: ${full.description}
createdAt: ${full.createdAt}
updatedAt: ${full.updatedAt}
---

${full.content}
`;

  fs.writeFileSync(filePath, fileContent, "utf-8");

  // Update index
  updateMemoryIndex(scope);

  return filePath;
}

function loadMemoryFile(filePath: string): MemoryEntry | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    const match = raw.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
    if (!match) return null;

    const frontmatter = match[1];
    const content = match[2].trim();

    const get = (key: string) => {
      const m = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
      return m?.[1]?.trim() || "";
    };

    return {
      name: get("name"),
      type: get("type") as MemoryEntry["type"],
      description: get("description"),
      content,
      createdAt: get("createdAt"),
      updatedAt: get("updatedAt"),
    };
  } catch {
    return null;
  }
}

export function loadAllMemories(scope: "user" | "project" = "project"): MemoryEntry[] {
  const dir = scope === "user" ? memoryDir() : projectMemoryDir();

  try {
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
    return files
      .map((f) => loadMemoryFile(path.join(dir, f)))
      .filter(Boolean) as MemoryEntry[];
  } catch {
    return [];
  }
}

export function getMemoryContext(charBudget = 8_000): string {
  const userMemories = loadAllMemories("user");
  const projectMemories = loadAllMemories("project");

  if (userMemories.length === 0 && projectMemories.length === 0) return "";

  const allMemories = [...userMemories, ...projectMemories];
  // Sort by most recently updated first so important ones make the cut
  allMemories.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  let ctx = "\n# Memories from previous sessions\n";
  let usedChars = ctx.length;
  let included = 0;

  for (const m of allMemories) {
    const line = `- **${m.name}** (${m.type}): ${m.content.substring(0, 150)}\n`;
    if (usedChars + line.length > charBudget) {
      ctx += `\n(${allMemories.length - included} more memories available — use list_memories tool to see all)\n`;
      break;
    }
    ctx += line;
    usedChars += line.length;
    included++;
  }

  return ctx;
}

function updateMemoryIndex(scope: "user" | "project"): void {
  const dir = scope === "user" ? memoryDir() : projectMemoryDir();
  const memories = loadAllMemories(scope);
  const indexPath = path.join(dir, "MEMORY.md");

  const lines = memories.map(
    (m) => `- [${m.name}](${m.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.md) — ${m.description}`
  );

  fs.writeFileSync(indexPath, lines.join("\n") + "\n", "utf-8");
}

export function deleteMemory(name: string, scope: "user" | "project" = "project"): boolean {
  const dir = scope === "user" ? memoryDir() : projectMemoryDir();
  const fileName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .substring(0, 50);
  const filePath = path.join(dir, `${fileName}.md`);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    updateMemoryIndex(scope);
    return true;
  }
  return false;
}
