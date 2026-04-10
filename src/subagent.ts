import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { chat, createClient } from "./client.js";
import { toolDefinitions } from "./tools/index.js";
import { getCwd } from "./tools/bash.js";
import { buildAgentSystemPrompt } from "./agent-persona.js";
import { getAgent, listAgents } from "./agents-core/db.js";
import { BUILT_IN_AGENT_CONFIGS, AGENT_BLOCKED_TOOLS } from "./constants.js";
import { getScratchpadToolDefs, getActiveScratchpad } from "./swarm.js";
import chalk from "chalk";

export interface SubagentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[]; // Subset of tools to allow
  maxTurns?: number;
  injectScratchpad?: boolean; // Inject swarm scratchpad tools
}

const BUILT_IN_AGENT_NAMES = Object.keys(BUILT_IN_AGENT_CONFIGS) as (keyof typeof BUILT_IN_AGENT_CONFIGS)[];

function getBuiltInAgent(name: string): SubagentConfig | null {
  const config = BUILT_IN_AGENT_CONFIGS[name as keyof typeof BUILT_IN_AGENT_CONFIGS];
  if (!config) return null;
  return {
    name,
    description: config.description,
    systemPrompt: `${config.systemPromptTemplate}\nWorking directory: ${getCwd()}`,
    tools: config.tools ? [...config.tools] : undefined,
    maxTurns: config.maxTurns,
  };
}

/**
 * Extra tools injected into persona-based agents so they can
 * read/update their own memory (goals, scratchpad).
 */
function getAgentMemoryTools(agentId: string): ChatCompletionTool[] {
  return [
    {
      type: "function",
      function: {
        name: "agent_memory_read",
        description: "Read your agent memory (goals, scratchpad, personality, role).",
        parameters: {
          type: "object",
          properties: {
            field: {
              type: "string",
              enum: ["goals", "scratchpad", "personality", "role"],
              description: "Which field to read (omit for all)",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "agent_memory_update",
        description: "Update your agent memory. Use to track progress, update goals, or save notes.",
        parameters: {
          type: "object",
          properties: {
            field: {
              type: "string",
              enum: ["goals", "scratchpad"],
              description: "Which field to update",
            },
            operation: {
              type: "string",
              enum: ["replace", "append"],
              description: 'Replace entire field or append to it',
            },
            content: {
              type: "string",
              description: "The new content",
            },
          },
          required: ["field", "operation", "content"],
        },
      },
    },
  ];
}

export async function runSubagent(
  config: SubagentConfig,
  task: string,
  onToken?: (token: string) => void
): Promise<string> {
  const client = createClient();

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: config.systemPrompt },
    { role: "user", content: task },
  ];

  // Filter tools: enforce allowlist AND block recursive agent spawning
  let filteredTools: ChatCompletionTool[] | undefined;
  if (config.tools && config.tools.length > 0) {
    const allowed = new Set(config.tools);
    filteredTools = (toolDefinitions as ChatCompletionTool[]).filter((t) => {
      const name = (t as any).function?.name;
      return allowed.has(name) && !AGENT_BLOCKED_TOOLS.has(name);
    });
  } else {
    // "All tools" mode (worker) — still block recursive spawning
    filteredTools = (toolDefinitions as ChatCompletionTool[]).filter(
      (t) => !AGENT_BLOCKED_TOOLS.has((t as any).function?.name)
    );
  }

  // Inject scratchpad tools when running inside a swarm
  if (config.injectScratchpad && getActiveScratchpad()) {
    filteredTools = [...filteredTools, ...getScratchpadToolDefs() as ChatCompletionTool[]];
  }

  console.log(
    chalk.dim(`\n  🤖 Subagent "${config.name}" started...`)
  );

  const result = await chat(client, messages, onToken, {
    tools: filteredTools,
    maxTurns: config.maxTurns,
  });

  // Extract the final assistant message
  const lastAssistant = [...result]
    .reverse()
    .find((m) => m.role === "assistant");

  const content =
    typeof lastAssistant?.content === "string"
      ? lastAssistant.content
      : "Subagent completed with no text output.";

  console.log(
    chalk.dim(`  🤖 Subagent "${config.name}" finished.\n`)
  );

  // Add continuation marker to help main session continue
  return `[SUBAGENT COMPLETE]\n\n${content}\n\n[END SUBAGENT OUTPUT - Continue with the original task using this result.]`;
}

/**
 * Run a persona-based agent. These agents have persistent identity,
 * goals, and scratchpad that survive across invocations.
 */
export async function runPersonaAgent(
  agentId: string,
  task: string,
  onToken?: (token: string) => void,
  options?: { injectScratchpad?: boolean }
): Promise<string> {
  const agent = getAgent(agentId);
  if (!agent) {
    const available = listAgents().map((a) => a.id);
    return `Unknown agent: "${agentId}". Available: ${available.join(", ")}. Use agent_create to define a new one.`;
  }

  const config = typeof agent.config === "string" ? JSON.parse(agent.config) : (agent.config ?? {});
  const persona = {
    id: agent.id,
    name: agent.name,
    role: config.role || "AI Assistant",
    personality: config.personality || "",
    goals: config.goals || "",
    scratchpad: config.scratchpad || "",
    tools: config.tools || [],
    maxTurns: config.maxTurns || 25,
    createdAt: agent.created_at,
    updatedAt: agent.updated_at,
  };

  const client = createClient();
  const cwd = getCwd();
  const systemPrompt = buildAgentSystemPrompt(persona, cwd);

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: task },
  ];

  // Build tool set: agent's allowed tools (or all) + agent memory tools
  // Always block recursive agent spawning tools
  const agentMemoryTools = getAgentMemoryTools(agentId);
  let agentTools: ChatCompletionTool[];

  if (persona.tools.length > 0) {
    const allowed = new Set(persona.tools);
    agentTools = [
      ...(toolDefinitions as ChatCompletionTool[]).filter((t) => {
        const name = (t as any).function?.name;
        return allowed.has(name) && !AGENT_BLOCKED_TOOLS.has(name);
      }),
      ...agentMemoryTools,
    ];
  } else {
    agentTools = [
      ...(toolDefinitions as ChatCompletionTool[]).filter(
        (t) => !AGENT_BLOCKED_TOOLS.has((t as any).function?.name)
      ),
      ...agentMemoryTools,
    ];
  }

  // Inject scratchpad tools when running inside a swarm
  if (options?.injectScratchpad && getActiveScratchpad()) {
    agentTools = [...agentTools, ...getScratchpadToolDefs() as ChatCompletionTool[]];
  }

  console.log(
    chalk.dim(`\n  🤖 `) +
    chalk.magenta(persona.name) +
    chalk.dim(` started...`)
  );

  // Intercept agent_memory_* calls during execution by wrapping the chat
  // We do this by adding the memory tools to the tool list and handling
  // them in the executor. For now, we handle them via a pre-execution hook.
  const result = await chat(client, messages, onToken, {
    tools: agentTools,
    maxTurns: persona.maxTurns,
  });

  const lastAssistant = [...result]
    .reverse()
    .find((m) => m.role === "assistant");

  const content =
    typeof lastAssistant?.content === "string"
      ? lastAssistant.content
      : `${persona.name} completed with no text output.`;

  console.log(
    chalk.dim(`  🤖 `) +
    chalk.magenta(persona.name) +
    chalk.dim(` finished.\n`)
  );

  return `[${persona.name.toUpperCase()} COMPLETE]\n\n${content}\n\n[END AGENT OUTPUT]`;
}

export async function spawnAgent(args: {
  agent: string;
  task: string;
}): Promise<string> {
  // First check built-in agents
  const builtin = getBuiltInAgent(args.agent);
  if (builtin) {
    return runSubagent(builtin, args.task);
  }

  // Then check DB agents
  const agent = getAgent(args.agent);
  if (agent) {
    return runPersonaAgent(args.agent, args.task);
  }

  // List available
  const agentNames = listAgents().map((a) => a.id);
  const all = [...new Set([...BUILT_IN_AGENT_NAMES, ...agentNames])];

  return `Unknown agent: "${args.agent}". Available: ${all.join(", ")}`;
}
