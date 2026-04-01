import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import chalk from "chalk";
import {
  MAX_CONTEXT_TOKENS,
  COMPACT_THRESHOLD,
  COMPACT_RECENT_MIN,
  COMPACT_RECENT_RATIO,
} from "./constants.js";
import { getConfig } from "./config.js";

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

export type BudgetStatus = "ok" | "warning" | "exceeded";

/**
 * Check if the session has exceeded its token budget.
 * Returns "ok", "warning" (>80%), or "exceeded" (>100%).
 */
export function checkBudget(): { status: BudgetStatus; used: number; limit: number } {
  const config = getConfig();
  const limit = config.budgetTokens || 0;
  if (!limit) return { status: "ok", used: usage.totalTokens, limit: 0 };

  const used = usage.totalTokens;
  if (used >= limit) return { status: "exceeded", used, limit };
  if (used >= limit * 0.8) return { status: "warning", used, limit };
  return { status: "ok", used, limit };
}

export function estimateContextSize(
  messages: ChatCompletionMessageParam[]
): number {
  let total = 0;
  for (const msg of messages) {
    total += messageTokens(msg);
  }
  // Add ~5000 for tool definitions (always sent)
  total += 5000;
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
  if (messages.length <= 3) return messages;

  const systemMsg = messages[0];
  const recentCount = Math.max(
    COMPACT_RECENT_MIN,
    Math.floor(messages.length * COMPACT_RECENT_RATIO)
  );
  const recentMessages = messages.slice(-recentCount);
  const oldMessages = messages.slice(1, -recentCount);

  // Build a smarter summary that preserves key info
  const summaryParts: string[] = [];
  let filesModified = new Set<string>();
  let toolsUsed = new Set<string>();
  let keyDecisions: string[] = [];

  for (const msg of oldMessages) {
    if (msg.role === "user" && typeof msg.content === "string") {
      // Keep user requests (they define intent)
      const truncated = msg.content.length > 150
        ? msg.content.substring(0, 150) + "..."
        : msg.content;
      summaryParts.push(`User: ${truncated}`);
    } else if (msg.role === "assistant") {
      if ("tool_calls" in msg && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if ("function" in tc && tc.function) {
            toolsUsed.add(tc.function.name);
            // Track files modified
            try {
              const args = JSON.parse(tc.function.arguments);
              if (args.file_path) filesModified.add(args.file_path);
            } catch {}
          }
        }
      } else if (typeof msg.content === "string" && msg.content.length > 0) {
        // Keep assistant conclusions (first 100 chars)
        if (msg.content.length > 50) {
          keyDecisions.push(msg.content.substring(0, 100) + "...");
        }
      }
    }
    // Skip tool role messages entirely — they're the bulk of the bloat
  }

  let summary = "# Compacted conversation history\n\n";
  summary += "## What happened:\n";
  summary += summaryParts.slice(0, 15).join("\n") + "\n\n";

  if (toolsUsed.size > 0) {
    summary += `## Tools used: ${[...toolsUsed].join(", ")}\n`;
  }
  if (filesModified.size > 0) {
    summary += `## Files modified: ${[...filesModified].join(", ")}\n`;
  }
  if (keyDecisions.length > 0) {
    summary += "\n## Key decisions:\n";
    summary += keyDecisions.slice(0, 5).map((d) => `- ${d}`).join("\n") + "\n";
  }

  return [
    systemMsg,
    {
      role: "user" as const,
      content: summary,
    },
    {
      role: "assistant" as const,
      content: "I've reviewed the conversation history above. I'm ready to continue. What would you like to do next?",
    },
    ...recentMessages,
  ];
}

export function formatCost(): string {
  const u = getUsage();

  return [
    chalk.bold("  Token Usage:"),
    chalk.dim(`    Input:      ${u.promptTokens.toLocaleString()} tokens`),
    chalk.dim(`    Output:     ${u.completionTokens.toLocaleString()} tokens`),
    chalk.dim(`    Total:      ${u.totalTokens.toLocaleString()} tokens`),
    chalk.dim(`    API calls:  ${u.apiCalls}`),
    chalk.dim(`    Context:    ~${u.estimatedContextTokens.toLocaleString()} / ${MAX_CONTEXT_TOKENS.toLocaleString()} tokens`),
  ].join("\n");
}

export function formatContextBreakdown(
  messages: ChatCompletionMessageParam[]
): string {
  let systemTokens = 0;
  let userTokens = 0;
  let assistantTokens = 0;
  let toolTokens = 0;
  const toolDefinitionTokens = 5000; // Estimated constant

  for (const msg of messages) {
    const tokens = messageTokens(msg);
    switch (msg.role) {
      case "system":
        systemTokens += tokens;
        break;
      case "user":
        userTokens += tokens;
        break;
      case "assistant":
        assistantTokens += tokens;
        break;
      case "tool":
        toolTokens += tokens;
        break;
    }
  }

  const total = systemTokens + userTokens + assistantTokens + toolTokens + toolDefinitionTokens;
  const pct = (n: number) => ((n / total) * 100).toFixed(0);
  const bar = (n: number) => {
    const filled = Math.round((n / total) * 30);
    return "█".repeat(filled) + "░".repeat(30 - filled);
  };

  return [
    chalk.bold("\n  Context Breakdown:"),
    chalk.dim(`    System prompt: ${systemTokens.toLocaleString()} tokens (${pct(systemTokens)}%) ${bar(systemTokens)}`),
    chalk.dim(`    Tool defs:     ${toolDefinitionTokens.toLocaleString()} tokens (${pct(toolDefinitionTokens)}%) ${bar(toolDefinitionTokens)}`),
    chalk.dim(`    User msgs:     ${userTokens.toLocaleString()} tokens (${pct(userTokens)}%) ${bar(userTokens)}`),
    chalk.dim(`    Assistant:     ${assistantTokens.toLocaleString()} tokens (${pct(assistantTokens)}%) ${bar(assistantTokens)}`),
    chalk.dim(`    Tool outputs:  ${toolTokens.toLocaleString()} tokens (${pct(toolTokens)}%) ${bar(toolTokens)}`),
    chalk.dim(`    ─────────────`),
    chalk.dim(`    Total:         ~${total.toLocaleString()} / ${MAX_CONTEXT_TOKENS.toLocaleString()} tokens (${pct(total)}%)`),
    "",
  ].join("\n");
}
