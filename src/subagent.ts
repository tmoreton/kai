import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { chat, createClient } from "./client.js";
import { toolDefinitions } from "./tools/index.js";
import { getCwd } from "./tools/bash.js";
import chalk from "chalk";

export interface SubagentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[]; // Subset of tools to allow
  maxTurns?: number;
}

const BUILT_IN_AGENTS: SubagentConfig[] = [
  {
    name: "explorer",
    description:
      "Fast read-only agent for exploring codebases. Use for finding files, searching code, answering questions about structure.",
    systemPrompt: `You are an exploration agent. Your job is to quickly find information in the codebase.
You have read-only access — use glob, grep, and read_file to find what's needed.
Be concise. Return only the relevant findings.
Working directory: ${getCwd()}`,
    tools: ["read_file", "glob", "grep"],
    maxTurns: 10,
  },
  {
    name: "planner",
    description:
      "Planning agent that researches and designs implementation strategies before writing code.",
    systemPrompt: `You are a planning agent. Research the codebase and create a step-by-step implementation plan.
Use read-only tools to understand the code. Do NOT make changes.
Return a clear, actionable plan with file paths and specific changes needed.
Working directory: ${getCwd()}`,
    tools: ["read_file", "glob", "grep", "bash"],
    maxTurns: 15,
  },
  {
    name: "worker",
    description:
      "General-purpose agent that can read, write, and execute code for complex multi-step tasks.",
    systemPrompt: `You are a worker agent. Complete the assigned task autonomously.
You have full access to the filesystem and shell.
Work step by step: understand → implement → verify.
Working directory: ${getCwd()}`,
    maxTurns: 25,
  },
];

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

  // Filter tools if the subagent config specifies a subset
  let filteredTools: ChatCompletionTool[] | undefined;
  if (config.tools && config.tools.length > 0) {
    const allowed = new Set(config.tools);
    filteredTools = (toolDefinitions as ChatCompletionTool[]).filter(
      (t) => allowed.has((t as any).function?.name)
    );
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

export async function spawnAgent(args: {
  agent: string;
  task: string;
}): Promise<string> {
  const config = BUILT_IN_AGENTS.find(
    (a) => a.name === args.agent
  );

  if (!config) {
    return `Unknown agent: "${args.agent}". Available: ${BUILT_IN_AGENTS.map((a) => a.name).join(", ")}`;
  }

  return runSubagent(config, args.task);
}
