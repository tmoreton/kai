import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import chalk from "chalk";

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

  // Include tool call args in estimate
  if ("tool_calls" in msg && msg.tool_calls) {
    for (const tc of msg.tool_calls as any[]) {
      text += (tc.function?.name || "") + (tc.function?.arguments || "");
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

// Context window limit for Kimi K2.5 (128k)
const MAX_CONTEXT_TOKENS = 128000;
const COMPACT_THRESHOLD = 0.85; // Compact at 85% usage

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

  const systemMsg = messages[0]; // Keep system prompt
  const recentCount = Math.min(10, Math.floor(messages.length / 3));
  const recentMessages = messages.slice(-recentCount);
  const oldMessages = messages.slice(1, -recentCount);

  // Summarize old messages
  let summary = "Previous conversation summary:\n";
  for (const msg of oldMessages) {
    if (msg.role === "user") {
      const content =
        typeof msg.content === "string"
          ? msg.content.substring(0, 100)
          : "[complex content]";
      summary += `- User asked: ${content}\n`;
    } else if (msg.role === "assistant") {
      if ("tool_calls" in msg && msg.tool_calls) {
        const tools = (msg.tool_calls as any[]).map((tc) => tc.function?.name || "unknown").join(", ");
        summary += `- Assistant used tools: ${tools}\n`;
      } else {
        const content =
          typeof msg.content === "string"
            ? msg.content?.substring(0, 100)
            : "";
        if (content) summary += `- Assistant: ${content}\n`;
      }
    }
  }

  return [
    systemMsg,
    {
      role: "user" as const,
      content: `[Context was compacted to save space. Here's what happened before:]\n${summary}`,
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
