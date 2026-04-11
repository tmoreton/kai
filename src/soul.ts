import fs from "fs";
import path from "path";
import { ensureGlobalDir } from "./project.js";

/**
 * The Soul: Kai's persistent identity and working context.
 *
 * Single file format (~/.kai/soul/identity.json):
 *   ## Personality
 *   Content here...
 *
 *   ## Goals
 *   Content here...
 *
 *   ## Human
 *   Content here...
 *
 *   ## Scratchpad
 *   Content here...
 */

export interface CoreMemoryBlock {
  key: string;
  content: string;
  maxTokens: number;
}

export interface Soul {
  personality: CoreMemoryBlock;
  goals: CoreMemoryBlock;
  human: CoreMemoryBlock;
  scratchpad: CoreMemoryBlock;
}

const DEFAULT_SOUL: Soul = {
  personality: {
    key: "personality",
    content: `I am Kai, an AI coding assistant. I am direct, concise, and focused on getting things done. I write clean code, verify my work, and explain my reasoning briefly. I use tools proactively — I search before guessing, read before editing, and test after changing.`,
    maxTokens: 500,
  },
  goals: {
    key: "goals",
    content: `No active goals set yet.`,
    maxTokens: 500,
  },
  human: {
    key: "human",
    content: `No information about the user yet. I will update this as I learn about them.`,
    maxTokens: 500,
  },
  scratchpad: {
    key: "scratchpad",
    content: `Empty working notes.`,
    maxTokens: 800,
  },
};

// --- File path ---
function soulPath(): string {
  const dir = ensureGlobalDir("soul");
  return path.join(dir, "identity.json");
}

// --- Parse plain text format with ## headers ---
function parseSoulContent(content: string): Soul {
  const sections: Record<string, string> = {
    personality: "",
    goals: "",
    human: "",
    scratchpad: "",
  };

  const lines = content.split("\n");
  let currentSection = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^##?\s*(\w+)$/);
    if (headerMatch) {
      if (currentSection && currentContent.length > 0) {
        sections[currentSection] = currentContent.join("\n").trim();
      }
      currentSection = headerMatch[1].toLowerCase();
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }

  if (currentSection && currentContent.length > 0) {
    sections[currentSection] = currentContent.join("\n").trim();
  }

  return {
    personality: { ...DEFAULT_SOUL.personality, content: sections.personality || DEFAULT_SOUL.personality.content },
    goals: { ...DEFAULT_SOUL.goals, content: sections.goals || DEFAULT_SOUL.goals.content },
    human: { ...DEFAULT_SOUL.human, content: sections.human || DEFAULT_SOUL.human.content },
    scratchpad: { ...DEFAULT_SOUL.scratchpad, content: sections.scratchpad || DEFAULT_SOUL.scratchpad.content },
  };
}

// --- Build plain text format from Soul ---
function buildSoulContent(soul: Soul): string {
  const parts: string[] = [];
  if (soul.personality.content) parts.push(`## Personality\n${soul.personality.content}`);
  if (soul.goals.content) parts.push(`## Goals\n${soul.goals.content}`);
  if (soul.human.content) parts.push(`## Human\n${soul.human.content}`);
  if (soul.scratchpad.content) parts.push(`## Scratchpad\n${soul.scratchpad.content}`);
  return parts.join("\n\n");
}

// --- In-memory cache ---
let _cachedSoul: Soul | null = null;
let _cachedContent: string | null = null;

// --- Load/Save ---
export function loadSoul(): Soul {
  const filePath = soulPath();
  
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      // Check if it's the new plain text format
      if (content.includes("##")) {
        if (_cachedContent === content && _cachedSoul) {
          return _cachedSoul;
        }
        _cachedContent = content;
        _cachedSoul = parseSoulContent(content);
        return _cachedSoul;
      }
      // Old JSON format - try to migrate
      try {
        const data = JSON.parse(content);
        const migrated: Soul = {
          personality: { ...DEFAULT_SOUL.personality, content: data.persona?.content || "" },
          human: { ...DEFAULT_SOUL.human, content: data.human?.content || "" },
          goals: { ...DEFAULT_SOUL.goals, content: data.goals?.content || "" },
          scratchpad: { ...DEFAULT_SOUL.scratchpad, content: data.scratchpad?.content || "" },
        };
        // Save in new format
        saveSoul(migrated);
        return migrated;
      } catch {
        // Invalid JSON, return defaults
        return { ...DEFAULT_SOUL };
      }
    }
  } catch {}

  // File doesn't exist, create with defaults
  const defaults = { ...DEFAULT_SOUL };
  saveSoul(defaults);
  return defaults;
}

export function saveSoul(soul: Soul): void {
  _cachedSoul = soul;
  _cachedContent = buildSoulContent(soul);
  fs.writeFileSync(soulPath(), _cachedContent, "utf-8");
}

// --- Public API ---

export function updateCoreMemory(
  block: keyof Soul,
  operation: "replace" | "append",
  content: string
): string {
  const soul = loadSoul();
  const mem = soul[block];
  
  if (operation === "replace") {
    mem.content = content;
  } else {
    mem.content += "\n" + content;
  }
  
  // Trim if too long (maxTokens * ~4 chars per token)
  const charLimit = mem.maxTokens * 4;
  if (mem.content.length > charLimit) {
    mem.content = mem.content.substring(mem.content.length - charLimit);
  }
  
  saveSoul(soul);
  return `Core memory [${block}] updated.`;
}

export function getCoreMemoryContext(): string {
  const soul = loadSoul();

  return `
<core_memory>
<personality>
${soul.personality.content}
</personality>
<human>
${soul.human.content}
</human>
<goals>
${soul.goals.content}
</goals>
<scratchpad>
${soul.scratchpad.content}
</scratchpad>
</core_memory>`;
}

export function readCoreMemory(block?: keyof Soul): string {
  const soul = loadSoul();
  if (block) {
    return `[${block}]: ${soul[block].content}`;
  }
  return Object.entries(soul)
    .map(([key, val]) => `[${key}]: ${val.content}`)
    .join("\n\n");
}

// For backwards compatibility
export function loadIdentity() {
  const soul = loadSoul();
  return {
    persona: soul.personality,
    human: soul.human,
  };
}

// For backwards compatibility  
export function loadProjectContext() {
  const soul = loadSoul();
  return {
    goals: soul.goals,
    scratchpad: soul.scratchpad,
  };
}
