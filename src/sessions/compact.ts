/**
 * Session compaction utilities.
 * Manages token limits by summarizing older messages.
 *
 * Token estimation is centralized in context.ts — this module
 * imports from there to avoid duplicate implementations.
 */
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { estimateContextSize } from "../context.js";

export interface CompactionConfig {
  /** Max tokens before triggering compaction */
  threshold: number;
  /** Max tokens to keep after compaction */
  target: number;
  /** Number of recent message pairs to always preserve */
  preserveRecent: number;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  threshold: 120000,
  target: 80000,
  preserveRecent: 6,
};

export interface CompactionResult {
  originalCount: number;
  compactedCount: number;
  removedCount: number;
  originalTokens: number;
  newTokens: number;
  summaryMessage: ChatCompletionMessageParam;
}

/**
 * Summarize older messages into a compact summary.
 * Preserves the most recent N exchanges.
 */
export function compactSession(
  messages: ChatCompletionMessageParam[],
  config: Partial<CompactionConfig> = {}
): CompactionResult {
  const cfg = { ...DEFAULT_COMPACTION_CONFIG, ...config };

  const originalTokens = estimateContextSize(messages);

  // Always keep system message
  const systemMessage = messages.find((m) => m.role === "system");

  // Count complete user/assistant exchanges
  const exchanges: Array<{ user: ChatCompletionMessageParam; assistant?: ChatCompletionMessageParam }> = [];
  let currentUser: ChatCompletionMessageParam | null = null;

  for (let i = systemMessage ? 1 : 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "user") {
      if (currentUser) {
        exchanges.push({ user: currentUser });
      }
      currentUser = msg;
    } else if (msg.role === "assistant" && currentUser) {
      exchanges.push({ user: currentUser, assistant: msg });
      currentUser = null;
    }
  }
  if (currentUser) {
    exchanges.push({ user: currentUser });
  }

  // Preserve recent exchanges
  const preserveCount = cfg.preserveRecent;
  const exchangesToSummarize = exchanges.slice(0, -preserveCount);
  const exchangesToKeep = exchanges.slice(-preserveCount);

  // Build summary of older exchanges
  const summaryParts: string[] = ["[Earlier conversation summary:]"];

  for (const ex of exchangesToSummarize) {
    const userText =
      typeof ex.user.content === "string"
        ? ex.user.content
        : (ex.user.content as any)?.find((p: any) => p.type === "text")?.text || "[content]";

    summaryParts.push(`User asked: ${truncate(userText, 100)}`);

    if (ex.assistant) {
      const assistantText =
        typeof ex.assistant.content === "string"
          ? ex.assistant.content
          : "[tool use or content]";
      summaryParts.push(`Assistant: ${truncate(assistantText, 150)}`);
    }
  }

  const summaryMessage: ChatCompletionMessageParam = {
    role: "user",
    content: summaryParts.join("\n\n"),
  };

  // Build new message list
  const newMessages: ChatCompletionMessageParam[] = [];
  if (systemMessage) newMessages.push(systemMessage);
  newMessages.push(summaryMessage);

  for (const ex of exchangesToKeep) {
    newMessages.push(ex.user);
    if (ex.assistant) newMessages.push(ex.assistant);
  }

  const newTokens = estimateContextSize(newMessages);

  return {
    originalCount: messages.length,
    compactedCount: newMessages.length,
    removedCount: messages.length - newMessages.length,
    originalTokens,
    newTokens,
    summaryMessage,
  };
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

/**
 * Check if session needs compaction.
 * Uses centralized token estimation from context.ts.
 */
export function shouldCompact(
  messages: ChatCompletionMessageParam[],
  threshold?: number
): boolean {
  const tokens = estimateContextSize(messages);
  return tokens > (threshold || DEFAULT_COMPACTION_CONFIG.threshold);
}

/**
 * Get session token stats.
 */
export function getSessionStats(messages: ChatCompletionMessageParam[]): {
  messageCount: number;
  estimatedTokens: number;
  threshold: number;
  needsCompaction: boolean;
} {
  const estimatedTokens = estimateContextSize(messages);
  const threshold = DEFAULT_COMPACTION_CONFIG.threshold;
  return {
    messageCount: messages.length,
    estimatedTokens,
    threshold,
    needsCompaction: estimatedTokens > threshold,
  };
}
