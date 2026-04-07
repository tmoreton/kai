import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  MAX_CONTEXT_TOKENS,
  COMPACT_THRESHOLD,
  COMPACT_RECENT_MIN,
  COMPACT_RECENT_RATIO,
} from "./constants.js";
import { getConfig } from "./config.js";
import { getCachedFileIndex } from "./tools/file-cache.js";

// Marker used to detect previously compacted summaries
const COMPACT_SUMMARY_PREFIX = "# Compacted conversation history";
const COMPACT_CONTINUATION = `Continue working on the task without asking the user any further questions unless you are genuinely blocked. Pick up where you left off.`;

/**
 * Get the configured context window size.
 * Uses MAX_CONTEXT_TOKENS from constants.
 */
export function getContextWindowSize(): number {
  return MAX_CONTEXT_TOKENS;
}

/**
 * Incremental metadata tracker — populated during chat to avoid
 * expensive rescanning during compaction.
 */
export interface ConversationMetadata {
  filesRead: Set<string>;
  filesModified: Set<string>;
  toolsUsed: Set<string>;
}

const _metadata: ConversationMetadata = {
  filesRead: new Set(),
  filesModified: new Set(),
  toolsUsed: new Set(),
};

/** Track a tool call's metadata incrementally (call from client.ts) */
export function trackToolMetadata(toolName: string, args: Record<string, unknown>): void {
  _metadata.toolsUsed.add(toolName);
  const filePath = args.file_path as string | undefined;
  if (filePath) {
    if (toolName === "read_file") {
      _metadata.filesRead.add(filePath);
    } else {
      _metadata.filesModified.add(filePath);
    }
  }
}

/** Get the incrementally-tracked metadata */
function getTrackedMetadata(): ConversationMetadata {
  return _metadata;
}

/** Reset tracked metadata (call after compaction) */
function resetTrackedMetadata(): void {
  _metadata.filesRead.clear();
  _metadata.filesModified.clear();
  _metadata.toolsUsed.clear();
}

// Rough token estimation: ~4 chars per token for English
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function messageTokens(msg: ChatCompletionMessageParam): number {
  // Track length directly — avoid string concatenation (O(n²) → O(n))
  let textLength = 0;
  let imageCount = 0;
  if (typeof msg.content === "string") {
    textLength = msg.content.length;
  } else if (Array.isArray(msg.content)) {
    for (const c of msg.content) {
      if ("text" in c) textLength += c.text.length;
      else if ("image_url" in c) imageCount++;
    }
  }

  if ("tool_calls" in msg && Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      if ("function" in tc && tc.function) {
        textLength += (tc.function.name?.length || 0) + (tc.function.arguments?.length || 0);
      }
    }
  }

  // Images typically use ~1000 tokens each (varies by resolution)
  return Math.ceil(textLength / 4) + (imageCount * 1000) + 4; // message overhead
}

// Memoized context size: avoid O(n) rescan when message count hasn't changed
let _cachedContextSize = 0;
let _cachedMessageCount = -1;

export function estimateContextSize(
  messages: ChatCompletionMessageParam[]
): number {
  // Fast path: if message count hasn't changed, return cached value
  if (messages.length === _cachedMessageCount && _cachedContextSize > 0) {
    return _cachedContextSize;
  }

  let total = 0;
  for (const msg of messages) {
    total += messageTokens(msg);
  }
  // Add ~5000 for tool definitions (always sent)
  total += 5000;

  _cachedContextSize = total;
  _cachedMessageCount = messages.length;
  return total;
}

/** Invalidate context size cache (call after compaction or message mutation) */
export function invalidateContextCache(): void {
  _cachedMessageCount = -1;
  _cachedContextSize = 0;
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
  const config = getConfig();
  const configuredRecent = (config as any).compactRecentMessages as number | undefined;
  const recentCount = configuredRecent
    ? Math.max(COMPACT_RECENT_MIN, configuredRecent)
    : Math.max(COMPACT_RECENT_MIN, Math.floor(messages.length * COMPACT_RECENT_RATIO));
  const recentMessages = messages.slice(-recentCount);

  // Detect existing compacted summary (incremental compaction)
  let previousSummary = "";
  let compactStartIndex = 1;
  if (
    messages.length > 2 &&
    messages[1].role === "user" &&
    typeof messages[1].content === "string" &&
    messages[1].content.startsWith(COMPACT_SUMMARY_PREFIX)
  ) {
    previousSummary = messages[1].content;
    // Skip past the existing summary + ack message
    compactStartIndex = messages[2]?.role === "assistant" ? 3 : 2;
  }

  const oldMessages = messages.slice(compactStartIndex, -recentCount);
  if (oldMessages.length === 0 && !previousSummary) return messages;

  // Use pre-tracked metadata from chat loop (avoids rescanning tool calls)
  const tracked = getTrackedMetadata();
  const filesModified = new Set(tracked.filesModified);
  const filesRead = new Set(tracked.filesRead);
  const toolsUsed = new Set(tracked.toolsUsed);

  // Only scan old messages for user summaries, decisions, and pending work
  // (lightweight — skips expensive JSON.parse on tool call arguments)
  const summaryParts: string[] = [];
  const keyDecisions: string[] = [];
  const pendingWork: string[] = [];

  for (const msg of oldMessages) {
    const textContent = typeof msg.content === "string" ? msg.content : "";

    if (msg.role === "user" && textContent) {
      if (textContent.startsWith("[SYSTEM:") || textContent.startsWith("[AUTO-ROUTE:")) continue;
      const truncated = textContent.length > 160
        ? textContent.substring(0, 160) + "..."
        : textContent;
      summaryParts.push(`User: ${truncated}`);
    } else if (msg.role === "assistant") {
      if (!("tool_calls" in msg) && textContent.length > 50) {
        keyDecisions.push(textContent.substring(0, 120) + "...");
      }

      // Detect pending work items
      if (textContent) {
        const pendingPatterns = /(?:todo|next|pending|follow.?up|remaining|still need|haven't yet|will need to)[:.\s]+(.{10,100})/gi;
        let pendingMatch;
        while ((pendingMatch = pendingPatterns.exec(textContent)) !== null) {
          pendingWork.push(pendingMatch[1].trim());
        }
      }
    }
  }

  // Reset tracked metadata after consuming it
  resetTrackedMetadata();

  // Also include files still in the read cache
  const cachedFiles = getCachedFileIndex();
  for (const f of cachedFiles) {
    filesRead.add(f.path);
  }

  // Build the new summary
  let summary = COMPACT_SUMMARY_PREFIX + "\n\n";

  // Merge with previous summary if this is an incremental compaction
  if (previousSummary) {
    // Extract the previous context section
    const prevBody = previousSummary.replace(COMPACT_SUMMARY_PREFIX, "").trim();
    summary += "## Previously compacted context:\n";
    // Keep it concise — extract key sections from previous summary
    const prevLines = prevBody.split("\n");
    const condensed = prevLines
      .filter((l) => l.startsWith("##") || l.startsWith("- ") || l.startsWith("User:"))
      .slice(0, 20)
      .join("\n");
    summary += condensed + "\n\n";
    summary += "## Newly compacted context:\n";
  } else {
    summary += "## What happened:\n";
  }

  summary += summaryParts.slice(0, 15).join("\n") + "\n\n";

  if (toolsUsed.size > 0) {
    summary += `## Tools used: ${[...toolsUsed].join(", ")}\n`;
  }
  if (filesModified.size > 0) {
    summary += `## Files modified: ${[...filesModified].join(", ")}\n`;
  }
  if (filesRead.size > 0) {
    summary += `## Files already read (cached — no need to re-read unless modified):\n`;
    const cacheIndex = new Map(cachedFiles.map((f) => [f.path, f.lines]));
    for (const f of filesRead) {
      const lines = cacheIndex.get(f);
      summary += `- ${f}${lines ? ` (${lines} lines)` : ""}\n`;
    }
  }
  if (keyDecisions.length > 0) {
    summary += "\n## Key decisions:\n";
    summary += keyDecisions.slice(0, 5).map((d) => `- ${d}`).join("\n") + "\n";
  }
  if (pendingWork.length > 0) {
    summary += "\n## Pending work items:\n";
    summary += [...new Set(pendingWork)].slice(0, 5).map((w) => `- ${w}`).join("\n") + "\n";
  }

  return [
    systemMsg,
    {
      role: "user" as const,
      content: summary,
    },
    {
      role: "assistant" as const,
      content: `I've reviewed the compacted conversation history. ${COMPACT_CONTINUATION}`,
    },
    ...recentMessages,
  ];
}

