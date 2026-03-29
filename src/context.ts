import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import chalk from "chalk";
import {
  MAX_CONTEXT_TOKENS,
  COMPACT_THRESHOLD,
  COMPACT_RECENT_MIN,
  COMPACT_RECENT_RATIO,
} from "./constants.js";

// Rough token estimation: ~4 chars per token for English
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function messageTokens(msg: ChatCompletionMessageParam): number {
  let text = "";
  if (typeof msg.content === "string") {
    text = msg.content;
  } else if (Array.isArray(msg.content)) {
    text = msg.content
      .map((c) => ("text" in c ? c.text : ""))
      .join("");
  }

  if ("tool_calls" in msg && Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      if ("function" in tc && tc.function) {
        text += (tc.function.name || "") + (tc.function.arguments || "");
      }
    }
  }

  return estimateTokens(text) + 4; // message overhead
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedContextTokens: number;
  apiCalls: number;
}

const usage: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  estimatedContextTokens: 0,
  apiCalls: 0,
};

export function getUsage(): TokenUsage {
  return { ...usage };
}

export function trackUsage(apiUsage: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}) {
  usage.promptTokens += apiUsage.prompt_tokens || 0;
  usage.completionTokens += apiUsage.completion_tokens || 0;
  usage.totalTokens += apiUsage.total_tokens || 0;
  usage.apiCalls += 1;
}

export function estimateContextSize(
  messages: ChatCompletionMessageParam[]
): number {
  let total = 0;
  for (const msg of messages) {
    total += messageTokens(msg);
  }
  usage.estimatedContextTokens = total;
  return total;
}

export function shouldCompact(
  messages: ChatCompletionMessageParam[]
): boolean {
  const estimated = estimateContextSize(messages);
  return estimated > MAX_CONTEXT_TOKENS * COMPACT_THRESHOLD;
}

export function compactMessages(
  messages: ChatCompletionMessageParam[]
): ChatCompletionMessageParam[] {
  if (messages.length <= 2) return messages;

  const systemMsg = messages[0];
  const recentCount = Math.min(
    COMPACT_RECENT_MIN,
    Math.floor(messages.length * COMPACT_RECENT_RATIO)
  );
  const recentMessages = messages.slice(-recentCount);
  const oldMessages = messages.slice(1, -recentCount);

  // Summarize old messages using array for performance
  const summaryParts: string[] = ["Previous conversation summary:"];
  for (const msg of oldMessages) {
    if (msg.role === "user") {
      const content =
        typeof msg.content === "string"
          ? msg.content.substring(0, 100)
          : "[complex content]";
      summaryParts.push(`- User asked: ${content}`);
    } else if (msg.role === "assistant") {
      if ("tool_calls" in msg && Array.isArray(msg.tool_calls)) {
        const tools = msg.tool_calls
          .map((tc) => ("function" in tc && tc.function ? tc.function.name : "unknown"))
          .join(", ");
        summaryParts.push(`- Assistant used tools: ${tools}`);
      } else {
        const content =
          typeof msg.content === "string"
            ? msg.content.substring(0, 100)
            : "";
        if (content) summaryParts.push(`- Assistant: ${content}`);
      }
    }
  }

  return [
    systemMsg,
    {
      role: "user" as const,
      content: `[Context was compacted to save space. Here's what happened before:]\n${summaryParts.join("\n")}`,
    },
    ...recentMessages,
  ];
}

export function formatCost(): string {
  const u = getUsage();
  // Together.ai pricing for Kimi K2.5 (approximate)
  const inputCost = (u.promptTokens / 1_000_000) * 0.3;
  const outputCost = (u.completionTokens / 1_000_000) * 0.3;
  const totalCost = inputCost + outputCost;

  return [
    chalk.bold("  Token Usage:"),
    chalk.dim(`    Input:      ${u.promptTokens.toLocaleString()} tokens`),
    chalk.dim(`    Output:     ${u.completionTokens.toLocaleString()} tokens`),
    chalk.dim(`    Total:      ${u.totalTokens.toLocaleString()} tokens`),
    chalk.dim(`    API calls:  ${u.apiCalls}`),
    chalk.dim(`    Context:    ~${u.estimatedContextTokens.toLocaleString()} tokens (estimated)`),
    chalk.dim(`    Est. cost:  $${totalCost.toFixed(4)}`),
  ].join("\n");
}
