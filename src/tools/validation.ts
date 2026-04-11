import { z } from "zod";

/**
 * Zod schemas for tool input validation.
 * Each schema matches the corresponding tool definition in definitions.ts.
 */

export const bashSchema = z.object({
  command: z.string().min(1, "command is required"),
  timeout: z.number().min(1).max(600000, "timeout cannot exceed 600000ms (10 minutes)").optional(),
});

export const bashBackgroundSchema = z.object({
  command: z.string().min(1, "command is required"),
  wait_seconds: z.number().min(0).max(30).optional(),
});

export const readFileSchema = z.object({
  file_path: z.string().min(1, "file_path is required"),
  offset: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).optional(),
});

export const writeFileSchema = z.object({
  file_path: z.string().min(1, "file_path is required"),
  content: z.string(),
});

export const editFileSchema = z.object({
  file_path: z.string().min(1, "file_path is required"),
  old_string: z.string(),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
});

// Reject glob patterns that are clearly garbage (single punctuation, JSON fragments)
const saneGlobPattern = z.string().min(1, "pattern is required").refine(
  (p) => /[a-zA-Z0-9*?/]/.test(p),
  "pattern must contain at least one alphanumeric character, wildcard (*/?), or path separator (/)"
);

export const globSchema = z.object({
  pattern: saneGlobPattern,
  path: z.string().optional(),
});

// Reject grep patterns that are just punctuation fragments
const saneGrepPattern = z.string().min(1, "pattern is required").refine(
  (p) => p.length >= 2 || /[a-zA-Z0-9]/.test(p),
  "pattern too short or contains no useful characters"
);

export const grepSchema = z.object({
  pattern: saneGrepPattern,
  path: z.string().optional(),
  include: z.string().optional(),
  context: z.number().int().min(0).optional(),
  ignore_case: z.boolean().optional(),
});

export const webFetchSchema = z.object({
  url: z.string().url(),
  method: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const webSearchSchema = z.object({
  query: z.string().min(1, "query is required"),
  max_results: z.number().int().min(1).max(20).optional(),
});


export const spawnAgentSchema = z.object({
  agent: z.string().min(1, "agent type or persona ID is required"),
  task: z.string().min(1, "task is required"),
});

export const spawnSwarmSchema = z.object({
  tasks: z.array(z.object({
    agent: z.string().min(1, "agent type or persona ID is required"),
    task: z.string().min(1, "task is required"),
  })).max(10, "maximum 10 concurrent agents"),
});

export const generateImageSchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
  reference_image: z.string().optional(),
  width: z.number().int().min(64).max(4096).optional(),
  height: z.number().int().min(64).max(4096).optional(),
  output_dir: z.string().optional(),
});

export const coreMemoryReadSchema = z.object({
  block: z.enum(["personality", "human", "goals", "scratchpad"]).optional(),
});

export const coreMemoryUpdateSchema = z.object({
  block: z.enum(["personality", "human", "goals", "scratchpad"]),
  operation: z.enum(["replace", "append"]),
  content: z.string(),
});

export const recallSearchSchema = z.object({
  query: z.string().min(1, "query is required"),
  limit: z.number().int().min(1).optional(),
});

export const archivalInsertSchema = z.object({
  content: z.string().min(1, "content is required"),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
});

export const archivalSearchSchema = z.object({
  query: z.string().min(1, "query is required"),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().min(1).optional(),
});

// Git tools
export const gitLogSchema = z.object({
  count: z.number().int().min(1).max(50).optional(),
});

export const gitDiffSessionSchema = z.object({
  session_start: z.string().min(1, "session_start is required"),
});

export const gitUndoSchema = z.object({
  count: z.number().int().min(1).max(10).optional(),
  mode: z.enum(["soft", "hard"]).optional(),
});

export const gitStashSchema = z.object({
  message: z.string().optional(),
});

// Agent persona management
export const agentCreateSchema = z.object({
  id: z.string().min(1).max(30).regex(/^[a-z0-9_-]+$/, "lowercase alphanumeric, hyphens, underscores only"),
  name: z.string().min(1, "name is required"),
  role: z.string().min(1, "role is required"),
  personality: z.string().min(1, "personality is required"),
  goals: z.string().min(1, "goals is required"),
  tools: z.array(z.string()).optional(),
  max_turns: z.number().int().min(1).max(50).optional(),
});

export const agentMemoryReadSchema = z.object({
  field: z.enum(["goals", "scratchpad", "personality", "role"]).optional(),
  _agent_id: z.string().optional(),
});

export const agentMemoryUpdateSchema = z.object({
  field: z.enum(["goals", "scratchpad"]),
  operation: z.enum(["replace", "append"]),
  content: z.string().min(1),
  _agent_id: z.string().optional(),
});

/** Map of tool name → Zod schema */
export const toolSchemas: Record<string, z.ZodType> = {
  bash: bashSchema,
  bash_background: bashBackgroundSchema,
  read_file: readFileSchema,
  write_file: writeFileSchema,
  edit_file: editFileSchema,
  glob: globSchema,
  grep: grepSchema,
  web_fetch: webFetchSchema,
  web_search: webSearchSchema,
spawn_agent: spawnAgentSchema,
  spawn_swarm: spawnSwarmSchema,
  generate_image: generateImageSchema,
  core_memory_read: coreMemoryReadSchema,
  core_memory_update: coreMemoryUpdateSchema,
  recall_search: recallSearchSchema,
  git_log: gitLogSchema,
  git_diff_session: gitDiffSessionSchema,
  git_undo: gitUndoSchema,
  git_stash: gitStashSchema,
  archival_insert: archivalInsertSchema,
  archival_search: archivalSearchSchema,
  agent_create: agentCreateSchema,
  agent_list: z.object({}),
  agent_memory_read: agentMemoryReadSchema,
  agent_memory_update: agentMemoryUpdateSchema,
};

/**
 * Validate tool arguments against the schema.
 * Returns validated args on success, or an error string on failure.
 */
export function validateToolArgs(
  toolName: string,
  args: Record<string, unknown>
): { valid: true; args: Record<string, unknown> } | { valid: false; error: string } {
  const schema = toolSchemas[toolName];
  if (!schema) {
    // MCP tools or unknown tools — skip validation
    return { valid: true, args };
  }

  const result = schema.safeParse(args);
  if (result.success) {
    return { valid: true, args: result.data as Record<string, unknown> };
  }

  const errors = result.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
  return { valid: false, error: errors };
}
