import {
  saveMemory,
  deleteMemory,
  loadAllMemories,
  type MemoryEntry,
} from "../memory.js";

export async function saveMemoryTool(args: {
  name: string;
  type: "user" | "project" | "feedback" | "reference";
  description: string;
  content: string;
  scope?: "user" | "project";
}): Promise<string> {
  const filePath = saveMemory(
    {
      name: args.name,
      type: args.type,
      description: args.description,
      content: args.content,
    },
    args.scope || "project"
  );
  return `Memory saved: "${args.name}" → ${filePath}`;
}

export async function listMemoriesTool(args: {
  scope?: "user" | "project";
}): Promise<string> {
  const memories = loadAllMemories(args.scope || "project");
  if (memories.length === 0) return "No memories found.";

  return memories
    .map(
      (m) =>
        `- **${m.name}** (${m.type}): ${m.description}\n  ${m.content.substring(0, 150)}`
    )
    .join("\n\n");
}

export async function deleteMemoryTool(args: {
  name: string;
  scope?: "user" | "project";
}): Promise<string> {
  const deleted = deleteMemory(args.name, args.scope || "project");
  return deleted
    ? `Memory "${args.name}" deleted.`
    : `Memory "${args.name}" not found.`;
}
