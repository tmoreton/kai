import fs from "fs";
import path from "path";
import { ensureKaiDir } from "./config.js";

/**
 * The Soul is Kai's persistent identity — core memory blocks that are
 * always loaded into the context window. Unlike regular memory, the soul
 * is the "kernel" that's always resident.
 *
 * Core memory blocks:
 *   - persona: Who Kai is, behavioral directives, personality
 *   - human: What Kai knows about the current user
 *   - goals: Current objectives and priorities
 *   - scratchpad: Working notes the agent updates during tasks
 */

export interface CoreMemoryBlock {
  key: string;
  content: string;
  maxTokens: number; // Soft limit to keep context lean
}

export interface Soul {
  persona: CoreMemoryBlock;
  human: CoreMemoryBlock;
  goals: CoreMemoryBlock;
  scratchpad: CoreMemoryBlock;
}

const DEFAULT_SOUL: Soul = {
  persona: {
    key: "persona",
    content: `I am Kai, an AI coding assistant. I am direct, concise, and focused on getting things done. I write clean code, verify my work, and explain my reasoning briefly. I use tools proactively — I search before guessing, read before editing, and test after changing. I track my work with tasks and remember important context across sessions.`,
    maxTokens: 500,
  },
  human: {
    key: "human",
    content: `No information about the user yet. I will update this as I learn about them.`,
    maxTokens: 500,
  },
  goals: {
    key: "goals",
    content: `No active goals.`,
    maxTokens: 300,
  },
  scratchpad: {
    key: "scratchpad",
    content: `Empty.`,
    maxTokens: 500,
  },
};

function soulFilePath(): string {
  return path.join(ensureKaiDir(), "soul.json");
}

export function loadSoul(): Soul {
  try {
    const filePath = soulFilePath();
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return {
        persona: { ...DEFAULT_SOUL.persona, ...data.persona },
        human: { ...DEFAULT_SOUL.human, ...data.human },
        goals: { ...DEFAULT_SOUL.goals, ...data.goals },
        scratchpad: { ...DEFAULT_SOUL.scratchpad, ...data.scratchpad },
      };
    }
  } catch {
    // Return default on error
  }
  return { ...DEFAULT_SOUL };
}

export function saveSoul(soul: Soul): void {
  fs.writeFileSync(soulFilePath(), JSON.stringify(soul, null, 2), "utf-8");
}

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

  // Trim to soft limit (rough: 4 chars per token)
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
<persona>
${soul.persona.content}
</persona>
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
