/**
 * Agent Personas — Persistent identity, goals, and memory for named agents.
 *
 * Each agent persona has:
 *   - identity: who this agent is, its role and personality
 *   - goals: what it's trying to achieve (can be updated over time)
 *   - context: shared knowledge about the user/project (inherited from main soul)
 *   - scratchpad: working notes that persist across invocations
 *
 * Storage: ~/.kai/agents/personas/{agent-id}.json
 *
 * This lets us have a "YouTube Agent" with its own goals, personality, and
 * accumulated knowledge separate from a "Personal Agent" — while both share
 * the same underlying user/project context from the main soul.
 */

import fs from "fs";
import path from "path";
import { ensureGlobalDir } from "./project.js";
import { loadIdentity } from "./soul.js";

export interface FileReference {
  /** Original filename */
  name: string;
  /** What this file is for (e.g. "thumbnail reference", "brand guide") */
  label: string;
  /** Stored filename on disk (under ~/.kai/agents/files/{persona-id}/) */
  storedName: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
  addedAt: string;
}

export interface AgentPersona {
  id: string;
  name: string;
  role: string;
  personality: string;
  goals: string;
  scratchpad: string;
  /** Tools this agent is allowed to use. Empty = all tools. */
  tools: string[];
  /** Max turns before the agent must wrap up. */
  maxTurns: number;
  /** Attached reference files (images, docs, etc.) */
  files?: FileReference[];
  createdAt: string;
  updatedAt: string;
}

/**
 * No hardcoded default personas — all personas are user-created via
 * agent_create or by placing JSON files in ~/.kai/agents/personas/.
 * This keeps the source code generic and user-specific config out of the repo.
 */

// --- Storage ---

function personasDir(): string {
  return ensureGlobalDir("agents/personas");
}

function personaPath(agentId: string): string {
  return path.join(personasDir(), `${agentId}.json`);
}

// --- CRUD ---

export function loadPersona(agentId: string): AgentPersona | null {
  const p = personaPath(agentId);
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf-8")) as AgentPersona;
    }
  } catch {}
  return null;
}

export function savePersona(persona: AgentPersona): void {
  persona.updatedAt = new Date().toISOString();
  fs.writeFileSync(personaPath(persona.id), JSON.stringify(persona, null, 2), "utf-8");
}

export function listPersonas(): AgentPersona[] {
  const dir = personasDir();
  const results: AgentPersona[] = [];

  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
        results.push(data as AgentPersona);
      } catch {}
    }
  } catch {}

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export function createPersona(
  id: string,
  name: string,
  role: string,
  personality: string,
  goals: string,
  tools?: string[],
  maxTurns?: number
): AgentPersona {
  const persona: AgentPersona = {
    id,
    name,
    role,
    personality,
    goals,
    scratchpad: "",
    tools: tools || [],
    maxTurns: maxTurns || 25,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  savePersona(persona);
  return persona;
}

export function updatePersonaField(
  agentId: string,
  field: "goals" | "scratchpad" | "personality" | "role",
  operation: "replace" | "append",
  content: string
): string {
  const persona = loadPersona(agentId);
  if (!persona) return `Agent "${agentId}" not found.`;

  if (operation === "replace") {
    persona[field] = content;
  } else {
    persona[field] += "\n" + content;
  }

  // Limit field size (~2000 tokens = ~8000 chars)
  const charLimit = 8000;
  if (persona[field].length > charLimit) {
    persona[field] = persona[field].substring(persona[field].length - charLimit);
  }

  savePersona(persona);
  return `Agent "${agentId}" ${field} updated.`;
}

// --- File References ---

function personaFilesDir(agentId: string): string {
  return ensureGlobalDir(`agents/files/${agentId}`);
}

export function addFileReference(
  agentId: string,
  originalName: string,
  label: string,
  mimeType: string,
  data: Buffer
): FileReference | null {
  const persona = loadPersona(agentId);
  if (!persona) return null;

  const ext = path.extname(originalName) || "";
  const storedName = `${Date.now()}-${originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const dir = personaFilesDir(agentId);
  fs.writeFileSync(path.join(dir, storedName), data);

  const ref: FileReference = {
    name: originalName,
    label: label || originalName,
    storedName,
    mimeType,
    size: data.length,
    addedAt: new Date().toISOString(),
  };

  if (!persona.files) persona.files = [];
  persona.files.push(ref);
  savePersona(persona);
  return ref;
}

export function removeFileReference(agentId: string, storedName: string): boolean {
  const persona = loadPersona(agentId);
  if (!persona || !persona.files) return false;

  const idx = persona.files.findIndex((f) => f.storedName === storedName);
  if (idx === -1) return false;

  // Remove from disk
  const filePath = path.join(personaFilesDir(agentId), storedName);
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}

  persona.files.splice(idx, 1);
  savePersona(persona);
  return true;
}

export function getFilePath(agentId: string, storedName: string): string {
  return path.join(personaFilesDir(agentId), storedName);
}

// --- System Prompt Builder ---

/**
 * Build a full system prompt for a persona-based agent.
 * Inherits the user's identity (human block) from the main soul
 * so the agent knows about the user, but has its own personality and goals.
 */
export function buildAgentSystemPrompt(persona: AgentPersona, cwd: string): string {
  const mainIdentity = loadIdentity();

  let prompt = `You are ${persona.name}, a specialized AI agent.

# Your Identity
${persona.personality}

# Your Role
${persona.role}

# Your Goals
${persona.goals}

# About the User
${mainIdentity.human.content}

# Working Notes
${persona.scratchpad || "No notes yet."}

# Environment
- Working directory: ${cwd}
- Current date: ${new Date().toISOString().split("T")[0]}

# Agent Memory
You have access to your own memory through these tools:
- **agent_memory_read** — Read your goals, scratchpad, or personality
- **agent_memory_update** — Update your goals or scratchpad as you learn and make progress
- **skill__data__read_json** — Read JSON files (including your own persona)
- **skill__data__write_json** — Write JSON files (to update your own configuration)

Update your scratchpad with important findings and progress.
Update your goals when objectives are completed or change.
Your persona file is at: ~/.kai/agents/personas/${persona.id}.json (use your agent ID to access it)

# Guidelines
- You are autonomous. Complete the assigned task fully without asking for permission to continue.
- Never ask "should I continue?", "want me to proceed?", or similar. Just do the work.
- Only ask the user when you face a genuine design decision you can't resolve from context.
- Update your scratchpad with findings so you remember them next time.
- Be concise and direct.
- If you need to remember something for future invocations, write it to your scratchpad.

# Self-Improvement — Evolve Through Conversation
You learn and improve over time by updating your own configuration. Use these capabilities:

**How to update yourself:**
- **agent_memory_update** with block="personality" — Add new knowledge, facts, or context you learn from conversations
- **agent_memory_update** with block="goals" — Update objectives when priorities shift or tasks complete
- **skill__data__read_json** on your persona file (~/.kai/agents/personas/${persona.id}.json) — Read your full configuration
- **skill__data__write_json** to your persona file — Modify and save updated configuration

**When to update yourself:**
- User shares new facts ("We have 2,500 subscribers now") → Update your knowledge
- User changes strategy ("Focus on AI tools instead of React") → Update your goals
- User adds competitors, products, or context → Append to your personality
- You learn what content performs well → Record insights for future use

**Keep a "Key Concepts" section** in your personality that captures:
- Channel/user stats (subscriber count, key metrics)
- Competitors or reference points you're tracking
- Content strategy and what's working
- Audience definition
- Reference materials (attached files, etc.)

Example self-update flow:
1. User says: "Update my subscriber count to 2,500"
2. You do: skill__data__read_json → load your persona
3. You do: Modify personality to add/update the stat
4. You do: skill__data__write_json → save back
5. You say: "Updated. I now know you're at 2,500 subscribers."`;

  // Include file references so the agent knows what's available
  if (persona.files && persona.files.length > 0) {
    const fileList = persona.files.map((f) => {
      const filePath = getFilePath(persona.id, f.storedName);
      return `- **${f.label}** — \`${filePath}\` (${f.mimeType})`;
    }).join("\n");
    prompt += `\n\n# Reference Files\nYou have these reference files attached. Use read_file to access them when relevant.\n${fileList}`;
  }

  return prompt;
}
