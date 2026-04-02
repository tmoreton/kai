import fs from "fs";
import path from "path";
import { getProjectId, ensureProjectDir, ensureGlobalDir } from "./project.js";

/**
 * The Soul: Kai's persistent identity and working context.
 *
 * Split into two parts:
 *   IDENTITY (global) — persona + human — who Kai is and who the user is
 *   CONTEXT (per-project) — goals + scratchpad — current work state
 */

export interface CoreMemoryBlock {
  key: string;
  content: string;
  maxTokens: number;
}

export interface Identity {
  persona: CoreMemoryBlock;
  human: CoreMemoryBlock;
}

export interface ProjectContext {
  goals: CoreMemoryBlock;
  scratchpad: CoreMemoryBlock;
}

export type Soul = Identity & ProjectContext;

const DEFAULT_IDENTITY: Identity = {
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
};

const DEFAULT_CONTEXT: ProjectContext = {
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

// --- File paths ---

function identityPath(): string {
  const dir = ensureGlobalDir("soul");
  return path.join(dir, "identity.json");
}

function projectContextPath(projectId?: string): string {
  const dir = ensureProjectDir("soul", projectId);
  return path.join(dir, "context.json");
}

// --- In-memory caches to avoid repeated blocking file reads ---
let _cachedIdentity: Identity | null = null;
let _cachedProjectCtx: { ctx: ProjectContext; projectId: string | undefined } | null = null;

// --- Load/Save ---

export function loadIdentity(): Identity {
  if (_cachedIdentity) return _cachedIdentity;

  try {
    const p = identityPath();
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, "utf-8"));
      _cachedIdentity = {
        persona: { ...DEFAULT_IDENTITY.persona, ...data.persona },
        human: { ...DEFAULT_IDENTITY.human, ...data.human },
      };
      return _cachedIdentity;
    }
  } catch {}

  _cachedIdentity = { ...DEFAULT_IDENTITY };
  return _cachedIdentity;
}

function saveIdentity(identity: Identity): void {
  _cachedIdentity = identity;
  fs.writeFileSync(identityPath(), JSON.stringify(identity, null, 2), "utf-8");
}

export function loadProjectContext(projectId?: string): ProjectContext {
  if (_cachedProjectCtx && _cachedProjectCtx.projectId === projectId) {
    return _cachedProjectCtx.ctx;
  }

  try {
    const p = projectContextPath(projectId);
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, "utf-8"));
      const ctx = {
        goals: { ...DEFAULT_CONTEXT.goals, ...data.goals },
        scratchpad: { ...DEFAULT_CONTEXT.scratchpad, ...data.scratchpad },
      };
      _cachedProjectCtx = { ctx, projectId };
      return ctx;
    }
  } catch {}

  const ctx = { ...DEFAULT_CONTEXT };
  _cachedProjectCtx = { ctx, projectId };
  return ctx;
}

function saveProjectContext(ctx: ProjectContext, projectId?: string): void {
  _cachedProjectCtx = { ctx, projectId };
  fs.writeFileSync(
    projectContextPath(projectId),
    JSON.stringify(ctx, null, 2),
    "utf-8"
  );
}

// --- Public API ---

export function loadSoul(projectId?: string): Soul {
  const identity = loadIdentity();
  const context = loadProjectContext(projectId);
  return { ...identity, ...context };
}

export function updateCoreMemory(
  block: keyof Soul,
  operation: "replace" | "append",
  content: string,
  projectId?: string
): string {
  // Route to the right storage
  if (block === "persona" || block === "human") {
    const identity = loadIdentity();
    const mem = identity[block];
    if (operation === "replace") {
      mem.content = content;
    } else {
      mem.content += "\n" + content;
    }
    const charLimit = mem.maxTokens * 4;
    if (mem.content.length > charLimit) {
      mem.content = mem.content.substring(mem.content.length - charLimit);
    }
    saveIdentity(identity);
  } else {
    const ctx = loadProjectContext(projectId);
    const mem = ctx[block as "goals" | "scratchpad"];
    if (operation === "replace") {
      mem.content = content;
    } else {
      mem.content += "\n" + content;
    }
    const charLimit = mem.maxTokens * 4;
    if (mem.content.length > charLimit) {
      mem.content = mem.content.substring(mem.content.length - charLimit);
    }
    saveProjectContext(ctx, projectId);
  }

  const scope = (block === "persona" || block === "human") ? "global" : "project";
  return `Core memory [${block}] updated (${scope}).`;
}

export function getCoreMemoryContext(projectId?: string): string {
  const soul = loadSoul(projectId);

  return `
<core_memory>
<persona>
${soul.persona.content}
</persona>
<human>
${soul.human.content}
</human>
<goals scope="project">
${soul.goals.content}
</goals>
<scratchpad scope="project">
${soul.scratchpad.content}
</scratchpad>
</core_memory>`;
}

export function readCoreMemory(block?: keyof Soul): string {
  const soul = loadSoul();
  if (block) {
    const scope = (block === "persona" || block === "human") ? "global" : "project";
    return `[${block}] (${scope}): ${soul[block].content}`;
  }
  return Object.entries(soul)
    .map(([key, val]) => {
      const scope = (key === "persona" || key === "human") ? "global" : "project";
      return `[${key}] (${scope}): ${val.content}`;
    })
    .join("\n\n");
}
