import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { toolDefinitions, getMcpToolDefinitions } from "./tools/index.js";
import { getSkillToolDefinitions } from "./skills/index.js";
import { executeTool } from "./tools/executor.js";
import { shouldCompact, compactMessages, invalidateContextCache, trackToolMetadata } from "./context.js";
import {
  MAX_TOKENS,
  MAX_TOOL_TURNS,
  STREAM_TIMEOUT_MS,
  TOOL_OUTPUT_MAX_LINES,
  TOOL_OUTPUT_PREVIEW_LINES,
  TOOL_OUTPUT_MAX_CHARS,
  TOOL_OUTPUT_CONTEXT_LIMIT,
  MAX_CONSECUTIVE_ERRORS,
  RETRYABLE_STATUS_CODES,
  RETRY_MAX_ATTEMPTS,
} from "./constants.js";
import { backoffDelay, sleep } from "./utils.js";
import { resolveProvider, resolveProviderWithFallback, type ResolvedProvider } from "./providers/index.js";
import { getLastDiff } from "./tools/files.js";
import { renderColorDiff } from "./diff.js";
import { isToolAllowedInPlanMode } from "./plan-mode.js";
import { startSpinner, stopSpinner } from "./render/stream.js";
import { recordError } from "./error-tracker.js";
import chalk from "chalk";

let _resolved: ResolvedProvider | null = null;

// Pre-compiled regex patterns for Kimi K2.5 token cleanup (hot path — called per chunk)
const KIMI_TOKEN_PATTERN = /<\|(?:tool_calls?_(?:section_)?(?:begin|end)|tool_call_argument_(?:begin|end))\|>/g;

// Cached tool definitions — rebuilt only when invalidated
let _cachedToolDefs: ChatCompletionTool[] | null = null;

function getCachedToolDefinitions(): ChatCompletionTool[] {
  if (_cachedToolDefs) return _cachedToolDefs;
  const mcpTools = getMcpToolDefinitions();
  const userSkillTools = getSkillToolDefinitions();
  _cachedToolDefs = [...toolDefinitions, ...mcpTools, ...userSkillTools] as ChatCompletionTool[];
  return _cachedToolDefs;
}

// When true, the spinner and streaming output pause to let the user type.
// Set by the REPL when keypress activity is detected.
let _userTyping = false;
let _userTypingTimer: ReturnType<typeof setTimeout> | null = null;

export function signalUserTyping(): void {
  _userTyping = true;
  if (_userTypingTimer) clearTimeout(_userTypingTimer);
  // Auto-reset after 2s of no typing activity
  _userTypingTimer = setTimeout(() => { _userTyping = false; }, 2000);
}

function getResolved(): ResolvedProvider {
  if (!_resolved) _resolved = resolveProvider();
  return _resolved;
}

/**
 * Initialize the provider with automatic fallback (async).
 * Call once at startup before the first chat request.
 */
export async function initProvider(): Promise<void> {
  _resolved = await resolveProviderWithFallback();
}

export function createClient(): OpenAI {
  return getResolved().client;
}

export function getModelId(): string {
  return getResolved().model;
}

export function getProviderName(): string {
  return getResolved().providerName;
}

export async function chat(
  client: OpenAI,
  messages: ChatCompletionMessageParam[],
  onToken?: (token: string) => void,
  options?: { tools?: ChatCompletionTool[]; maxTurns?: number; signal?: AbortSignal; unleash?: boolean; onUsage?: (input: number, output: number) => void }
): Promise<ChatCompletionMessageParam[]> {
  const activeTools = options?.tools ?? getCachedToolDefinitions();
  const unleash = options?.unleash ?? false;
  const maxTurns = unleash ? Infinity : (options?.maxTurns ?? MAX_TOOL_TURNS);
  const updatedMessages = [...messages];

  if (unleash) {
    console.log(chalk.magenta("  ⚡ Unleash mode: tool turn limits and stopping guards disabled.\n"));
  }

  // Auto-compact if context is getting large
  if (shouldCompact(updatedMessages)) {
    const compacted = compactMessages(updatedMessages);
    updatedMessages.length = 0;
    updatedMessages.push(...compacted);
    invalidateContextCache();
    console.log(chalk.dim("  📦 Context auto-compacted to save tokens.\n"));
  }

  let turns = 0;

  let consecutiveErrors = 0;
  let lastFailedCall = "";
  let consecutiveFutile = 0; // Track consecutive no-result / empty tool calls
  const MAX_FUTILE_TURNS = unleash ? Infinity : 4; // Break after N turns of getting nowhere

  // Repetition loop detection: track recent tool call signatures
  const recentToolSignatures: string[] = [];
  const recentToolNames: string[] = []; // Track just tool names for fuzzy repetition
  const MAX_REPETITION_WINDOW = 8; // Look at last N tool calls
  const REPETITION_THRESHOLD = unleash ? Infinity : 3;  // Break if same signature appears this many times
  const NAME_REPETITION_THRESHOLD = unleash ? Infinity : 4; // Break if same tool names called this many turns

  while (turns < maxTurns) {
    if (options?.signal?.aborted) {
      return updatedMessages;
    }
    turns++;

    // Show thinking indicator using centralized spinner
    let firstToken = false;
    const spinner = startSpinner("thinking...", (text) => {
      if (!firstToken && !_userTyping) process.stderr.write(text);
    });

    // Create stream with timeout — reset per retry attempt
    let controller: AbortController;
    let timeout: ReturnType<typeof setTimeout>;

    // Link user abort signal to spinner cleanup
    if (options?.signal) {
      options.signal.addEventListener("abort", () => {
        stopSpinner(spinner, null);
        process.stderr.write("\x1b[2K\r");
      }, { once: true });
    }

    let stream: any;
    for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
      // Bail immediately if user already aborted
      if (options?.signal?.aborted) {
        stopSpinner(spinner, null);
        process.stderr.write("\x1b[2K\r");
        return updatedMessages;
      }
      controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
      // Link user abort to HTTP request abort
      if (options?.signal) {
        options.signal.addEventListener("abort", () => controller.abort(), { once: true });
      }
      try {
        if (attempt > 0) {
          process.stderr.write(`\x1b[2K\r  Retrying (${attempt + 1}/${RETRY_MAX_ATTEMPTS})...\n`);
          await sleep(backoffDelay(attempt));
        }
        stream = await client.chat.completions.create(
          {
            model: getModelId(),
            messages: updatedMessages,
            tools: activeTools,
            tool_choice: "auto",
            stream: true,
            stream_options: { include_usage: true },
            max_tokens: MAX_TOKENS,
          } as any,
          { signal: controller.signal }
        );
        break;
      } catch (err: unknown) {
        clearTimeout(timeout!);
        const status = (err as any)?.status || (err as any)?.response?.status;
        const isRetryable = status && RETRYABLE_STATUS_CODES.includes(status);
        if (!isRetryable || attempt === RETRY_MAX_ATTEMPTS - 1) {
          stopSpinner(spinner, null);
          process.stderr.write("\x1b[2K\r"); // Clear spinner
          const msg = err instanceof Error ? err.message : String(err);
          recordError({ source: "client", error: err, context: { provider: getProviderName(), status, attempt } });
          throw new Error(`API request failed: ${msg}`);
        }
      }
    }

    let content = "";       // Visible output (streamed to user)
    let reasoning = "";     // Internal thinking (NOT shown to user)
    // Index-based tracking: Fireworks sends tc.id on every delta chunk,
    // so we must use tc.index to accumulate fragments into complete tool calls.
    const toolCallMap = new Map<number, {
      id: string;
      function: { name: string; arguments: string };
    }>();
    try {
      for await (const chunk of stream) {
        if (options?.signal?.aborted) break;

        // Capture real token usage from the final stream chunk
        if (chunk.usage && options?.onUsage) {
          options.onUsage(chunk.usage.prompt_tokens ?? 0, chunk.usage.completion_tokens ?? 0);
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // Reasoning is internal thinking — store separately, never show to user
        const reasoningChunk = (delta as any).reasoning;
        if (reasoningChunk) {
          reasoning += reasoningChunk;
        }

        let text = delta.content;
        if (text) {
          // Filter out Kimi K2.5 internal formatting tokens that leak on truncation
          KIMI_TOKEN_PATTERN.lastIndex = 0;
          text = text.replace(KIMI_TOKEN_PATTERN, "");
          if (!text) continue;

          if (!firstToken) {
            firstToken = true;
            stopSpinner(spinner, null);
            process.stderr.write("\x1b[2K\r"); // Clear spinner line
          }
          content += text;
          try { onToken?.(text); } catch {}
        }

        if (delta.tool_calls) {
          if (!firstToken) {
            firstToken = true;
            stopSpinner(spinner, null);
            process.stderr.write("\x1b[2K\r");
          }
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = toolCallMap.get(idx);
            if (existing) {
              // Append to existing tool call at this index
              if (tc.function?.name) existing.function.name += tc.function.name;
              if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
            } else {
              // First chunk for this index
              toolCallMap.set(idx, {
                id: tc.id || `call-${idx}-${Date.now()}`,
                function: {
                  name: tc.function?.name || "",
                  arguments: tc.function?.arguments || "",
                },
              });
            }
          }
        }
      }
    } catch (streamErr: unknown) {
      // If aborted by user, return what we have so far
      if (options?.signal?.aborted) {
        stopSpinner(spinner, null);
        clearTimeout(timeout!);
        process.stderr.write("\x1b[2K\r");
        if (content.trim()) {
          updatedMessages.push({ role: "assistant", content });
        }
        return updatedMessages;
      }
      // Handle stream errors gracefully instead of crashing
      if (!content && !toolCallMap.size) {
        const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
        throw new Error(`Stream failed: ${msg}`);
      }
      // If we already have partial content/tool calls, continue with what we have
    } finally {
      stopSpinner(spinner, null);
      clearTimeout(timeout!);
      if (!firstToken) {
        process.stderr.write("\x1b[2K\r");
      }
    }

    // Collect accumulated tool calls from the index map
    const toolCalls = Array.from(toolCallMap.values());

    // Rescue leaked tool calls from content OR reasoning text
    const allText = content + "\n" + reasoning;
    if (toolCalls.length === 0 && allText.includes("<|tool_call_begin|>")) {
      const rescued = rescueToolCallsFromText(allText);
      if (rescued.length > 0) {
        toolCalls.push(...rescued);
        content = content
          .replace(/<\|tool_calls_section_begin\|>[\s\S]*$/m, "")
          .trim();
      }
    }

    // If assistant text contains a question directed at the user, stop the tool loop
    // and let the user respond first — even if there are pending tool calls.
    // Detect: ends with "?", or common question phrases like "Would you like", "Should I", etc.
    const trimmed = content.trim();
    const hasQuestion = trimmed && (
      /\?\s*$/.test(trimmed) ||
      /\?\s*```\s*$/.test(trimmed) ||
      /(?:would you like|should i|do you want|shall i|can you|could you|what do you think|which (?:one|option)|let me know|please (?:confirm|choose|specify|clarify))/i.test(trimmed)
    );
    if (hasQuestion && toolCalls.length > 0) {
      updatedMessages.push({ role: "assistant", content });
      onToken?.("\n");
      return updatedMessages;
    }
    // Also stop if text-only response contains a question (no tool calls)
    // This is already handled by the text-only return below, but adding explicit
    // check for question in content even with tool calls where question is mid-text
    if (trimmed && toolCalls.length > 0 && /\?/.test(trimmed)) {
      // Check if the question seems directed at the user (not rhetorical)
      const lines = trimmed.split("\n");
      const lastFewLines = lines.slice(-5).join("\n");
      if (/\?\s*$/.test(lastFewLines)) {
        updatedMessages.push({ role: "assistant", content });
        onToken?.("\n");
        return updatedMessages;
      }
    }

    // Nudge the model when approaching the turn limit — but don't tell it to stop,
    // just inform it so it can prioritize remaining work
    if (!unleash && turns === maxTurns - 3) {
      updatedMessages.push({
        role: "user",
        content: "[SYSTEM: You are approaching the tool call limit. Prioritize finishing your current fix. Do NOT ask the user whether to continue — just finish the work.]",
      });
    }

    // Text-only response — done
    if (toolCalls.length === 0) {
      // If content is empty (model only produced reasoning), use reasoning as fallback
      if (!content.trim() && reasoning.trim()) {
        // Extract just the useful part of reasoning, strip internal thinking
        const useful = reasoning
          .replace(/^.*?(?:Let me|I should|I need|The user|Looking at|Actually)/s, "")
          .trim();
        if (useful.length > 20) {
          content = useful;
          onToken?.(content);
        } else {
          content = "I'm not sure what you meant. Could you clarify?";
          onToken?.(content);
        }
      }
      // Store content for the conversation (reasoning stays hidden)
      updatedMessages.push({ role: "assistant", content });
      onToken?.("\n");
      return updatedMessages;
    }

    // Tool calls — execute and loop
    // Sanitize arguments: Fireworks requires valid JSON object strings
    const sanitizedToolCalls = toolCalls.map((tc) => {
      let args = tc.function.arguments;
      try {
        const parsed = JSON.parse(args);
        // Ensure it serializes back as a proper JSON object
        if (typeof parsed !== "object" || parsed === null) args = "{}";
      } catch {
        args = "{}";
      }
      return { ...tc, function: { ...tc.function, arguments: args } };
    });

    const assistantMsg: ChatCompletionMessageParam = {
      role: "assistant",
      content: content || null,
      tool_calls: sanitizedToolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: tc.function,
      })),
    };
    updatedMessages.push(assistantMsg);

    if (content) onToken?.("\n");

    // Re-check compaction after tool results accumulate
    if (shouldCompact(updatedMessages)) {
      const compacted = compactMessages(updatedMessages);
      updatedMessages.length = 0;
      updatedMessages.push(...compacted);
      invalidateContextCache();
      console.log(chalk.dim("  📦 Context auto-compacted to save tokens.\n"));
    }

    // Classify tools as parallelizable (read-only, no side effects) vs sequential
    const PARALLEL_SAFE_TOOLS = new Set([
      "read_file", "glob", "grep", "web_fetch", "web_search",
      "core_memory_read", "recall_search", "archival_search",
    ]);

    // Parse all tool calls upfront
    const parsed = toolCalls.map((tc) => {
      let args: Record<string, unknown>;
      let parseError = false;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        parseError = true;
        args = {};
      }
      return { tc, toolName: tc.function.name, args, parseError };
    });

    // Determine if we can run tools in parallel:
    // All tools must be parallel-safe AND there must be >1 tool
    const allParallelSafe = parsed.length > 1 && parsed.every(
      (p) => !p.parseError && PARALLEL_SAFE_TOOLS.has(p.toolName)
    );

    if (allParallelSafe) {
      // === PARALLEL EXECUTION for read-only tools ===

      // Deduplicate read_file calls for the same path + offset + limit
      const deduped: typeof parsed = [];
      const readFileMap = new Map<string, number>(); // key -> index in deduped
      const dupMapping = new Map<number, number>(); // original index -> deduped index

      for (let i = 0; i < parsed.length; i++) {
        const p = parsed[i];
        if (p.toolName === "read_file") {
          const key = `${p.args.file_path}:${p.args.offset || 1}:${p.args.limit || 2000}`;
          const existing = readFileMap.get(key);
          if (existing !== undefined) {
            dupMapping.set(i, existing);
            continue;
          }
          readFileMap.set(key, deduped.length);
        }
        dupMapping.set(i, deduped.length);
        deduped.push(p);
      }

      const skipped = parsed.length - deduped.length;
      if (skipped > 0) {
        console.log(chalk.dim(`\n  ⚡ Running ${deduped.length} tools in parallel (${skipped} duplicate read${skipped > 1 ? "s" : ""} collapsed)...`));
      } else {
        console.log(chalk.dim(`\n  ⚡ Running ${deduped.length} tools in parallel...`));
      }

      for (const p of deduped) {
        console.log(
          chalk.dim(`  ⏺ `) +
            chalk.cyan(formatToolLabel(p.toolName)) +
            chalk.dim(`(`) +
            chalk.dim(summarizeArgs(p.toolName, p.args)) +
            chalk.dim(")")
        );
      }

      // Track metadata for compaction before executing
      for (const p of deduped) trackToolMetadata(p.toolName, p.args);

      // Rate-limited parallel execution: max 5 concurrent to avoid hammering APIs/filesystem
      const MAX_PARALLEL = 5;
      const dedupedResults: PromiseSettledResult<string>[] = [];
      for (let batch = 0; batch < deduped.length; batch += MAX_PARALLEL) {
        const slice = deduped.slice(batch, batch + MAX_PARALLEL);
        const batchResults = await Promise.allSettled(
          slice.map((p) => executeTool(p.toolName, p.args))
        );
        dedupedResults.push(...batchResults);
      }

      // Expand results back to match all original parsed entries (including duplicates)
      const results = parsed.map((_, i) => {
        const dedupedIdx = dupMapping.get(i)!;
        return dedupedResults[dedupedIdx];
      });

      for (let i = 0; i < parsed.length; i++) {
        const p = parsed[i];
        const result = results[i];
        const resultStr = result.status === "fulfilled"
          ? result.value
          : `Tool "${p.toolName}" failed: ${(result as PromiseRejectedResult).reason?.message || "Unknown error"}`;

        // Display output with truncation indicator
        const lines = resultStr.split("\n");
        if (p.toolName === "read_file") {
          // Compact display for file reads — just show line count
          console.log(chalk.gray(`    ⎿  ${lines.length} lines`));
        } else if (p.toolName === "grep") {
          // Compact display for grep — show match count
          const matchCount = resultStr === "No matches found." ? 0 : lines.length;
          console.log(chalk.gray(`    ⎿  ${matchCount} match${matchCount !== 1 ? "es" : ""}`));
        } else if (p.toolName === "bash" || p.toolName === "bash_background") {
          // Hide bash output completely — just show completion
          console.log(chalk.gray(`    ⎿  done`));
        } else if (lines.length > TOOL_OUTPUT_MAX_LINES) {
          console.log(chalk.gray(`    ⎿  ${lines.length} lines (showing lines 1-${TOOL_OUTPUT_PREVIEW_LINES} in context)`));
        } else if (resultStr.length > TOOL_OUTPUT_MAX_CHARS) {
          console.log(chalk.gray(`    ⎿  ${formatToolLabel(p.toolName)}: ${resultStr.substring(0, TOOL_OUTPUT_MAX_CHARS)}...`));
          console.log(chalk.gray(`       (${resultStr.length} chars total — truncated)`));
        } else {
          console.log(chalk.gray(`    ⎿  ${formatToolLabel(p.toolName)}: ${resultStr}`));
        }

        // Truncate for context
        const contextCharLimit = TOOL_OUTPUT_CONTEXT_LIMIT * 4;
        let contextContent = resultStr;
        if (resultStr.length > contextCharLimit) {
          contextContent =
            resultStr.substring(0, contextCharLimit) +
            `\n\n[Output truncated — ${resultStr.length} chars total, showing first ${contextCharLimit}.]`;
        }

        // Track errors
        const isError =
          resultStr.startsWith("Error") ||
          resultStr.includes("exit code:") ||
          resultStr.includes("failed:") ||
          resultStr.includes("ENOENT") ||
          resultStr.includes("Permission denied");

        if (isError) {
          consecutiveErrors++;
        } else {
          consecutiveErrors = 0;
        }

        updatedMessages.push({
          role: "tool",
          tool_call_id: p.tc.id,
          content: contextContent,
        });
      }
    } else {
      // === SEQUENTIAL EXECUTION (default for write ops or single tools) ===
      for (const p of parsed) {
        console.log(
          chalk.dim(`\n  ⏺ `) +
            chalk.cyan(formatToolLabel(p.toolName)) +
            chalk.dim(`(`) +
            chalk.dim(summarizeArgs(p.toolName, p.args)) +
            chalk.dim(")")
        );

        // Plan mode check — block write operations before truncation check
        if (!isToolAllowedInPlanMode(p.toolName)) {
          const msg = `Blocked: "${p.toolName}" is not allowed in plan mode. Only read-only tools are available. Present your plan to the user and ask them to approve it before making changes. They can type /plan to exit plan mode.`;
          console.log(chalk.yellow(`    ⎿  Blocked by plan mode`));
          updatedMessages.push({
            role: "tool",
            tool_call_id: p.tc.id,
            content: msg,
          });
          continue;
        }

        // If JSON was truncated/malformed, don't execute — tell model to retry
        if (p.parseError || (p.toolName === "write_file" && !p.args.file_path)) {
          const truncLen = p.tc.function.arguments.length;
          console.log(chalk.yellow(`    ⎿  Tool call truncated (${truncLen} chars) — arguments were cut off`));

          let recovery = "";
          if (p.toolName === "bash") {
            recovery = "For long commands: write the command to a .sh script file first with write_file, then run it with bash('bash script.sh').";
          } else if (p.toolName === "write_file") {
            recovery = "Split the content: write a shorter version first, then use edit_file to add more content in parts.";
          } else {
            recovery = "Simplify the tool call arguments — they are too long and got cut off.";
          }

          updatedMessages.push({
            role: "tool",
            tool_call_id: p.tc.id,
            content: `Error: Tool call truncated at ${truncLen} chars — arguments were cut off. ${recovery}`,
          });
          consecutiveErrors++;
          continue;
        }

        // Show spinner for slow tools (image gen, web fetch, agents, swarms)
        const slowTools = ["generate_image", "web_search", "spawn_agent", "spawn_swarm", "take_screenshot", "analyze_image"];
        const isSlow = slowTools.includes(p.toolName) || p.toolName.startsWith("mcp__");
        const toolSpinner = isSlow
          ? startSpinner("Working...", (text) => { if (!_userTyping) process.stderr.write(text); })
          : null;

        trackToolMetadata(p.toolName, p.args);
        const resultStr: string = await executeTool(p.toolName, p.args);

        if (toolSpinner) {
          stopSpinner(toolSpinner, null);
        }

        // Display tool output — show diff for file operations
        const isFileOp = p.toolName === "write_file" || p.toolName === "edit_file";
        const diff = isFileOp ? getLastDiff() : "";

        if (diff) {
          console.log(chalk.gray(`    ⎿  ${resultStr}`));
          const rendered = renderColorDiff(diff);
          console.log(rendered.split("\n").map((l) => `       ${l}`).join("\n"));
        } else if (p.toolName === "read_file") {
          // Compact display for file reads — just show line count
          const lines = resultStr.split("\n");
          console.log(chalk.gray(`    ⎿  ${lines.length} lines`));
        } else if (p.toolName === "grep") {
          // Compact display for grep — show match count
          const lines = resultStr.split("\n");
          const matchCount = resultStr === "No matches found." ? 0 : lines.length;
          console.log(chalk.gray(`    ⎿  ${matchCount} match${matchCount !== 1 ? "es" : ""}`));
        } else if (p.toolName === "bash" || p.toolName === "bash_background") {
          // Hide bash output completely — just show completion
          console.log(chalk.gray(`    ⎿  done`));
        } else {
          const lines = resultStr.split("\n");
          if (lines.length > TOOL_OUTPUT_MAX_LINES) {
            console.log(chalk.gray(`    ⎿  ${lines.length} lines (showing lines 1-${TOOL_OUTPUT_PREVIEW_LINES} in context)`));
          } else if (resultStr.length > TOOL_OUTPUT_MAX_CHARS) {
            console.log(chalk.gray(`    ⎿  ${resultStr.substring(0, TOOL_OUTPUT_MAX_CHARS)}...`));
            console.log(chalk.gray(`       (${resultStr.length} chars total — truncated)`));
          } else {
            console.log(chalk.gray(`    ⎿  ${resultStr}`));
          }
        }

        // Truncate what goes into context
        const contextCharLimit = TOOL_OUTPUT_CONTEXT_LIMIT * 4;
        let contextContent = resultStr;
        if (resultStr.length > contextCharLimit) {
          contextContent =
            resultStr.substring(0, contextCharLimit) +
            `\n\n[Output truncated — ${resultStr.length} chars total, showing first ${contextCharLimit}. Use read_file with offset/limit for more.]`;
        }

        // Track errors for loop detection
        const isError =
          resultStr.startsWith("Error") ||
          resultStr.includes("exit code:") ||
          resultStr.includes("failed:") ||
          resultStr.includes("ENOENT") ||
          resultStr.includes("Permission denied");

        const callSignature = `${p.toolName}:${JSON.stringify(p.args).substring(0, 100)}`;

        if (isError) {
          consecutiveErrors++;
          recordError({ source: "client", error: new Error(resultStr), context: { toolName: p.toolName, args: p.args } });
          if (callSignature === lastFailedCall) {
            contextContent += "\n\n[SYSTEM: This exact tool call has failed before with the same error. Try a DIFFERENT approach instead of retrying the same command.]";
          }
          lastFailedCall = callSignature;
        } else {
          consecutiveErrors = 0;
          lastFailedCall = "";
        }

        // Check if tool result contains an image (from screenshot/read_file)
        // Instead of inlining base64 (which bloats context), analyze via vision model
        // and return the text description to keep context lean
        const imageToolResult = tryParseImageResult(contextContent);
        if (imageToolResult) {
          const { analyzeImage } = await import("./tools/vision.js");
          const description = await analyzeImage({
            image_path: imageToolResult.path,
            question: "Describe this screenshot in detail. Include any text, UI elements, errors, or notable visual content.",
          });
          updatedMessages.push({
            role: "tool",
            tool_call_id: p.tc.id,
            content: `[Screenshot: ${imageToolResult.path} (${imageToolResult.size_kb} KB)]\n\n${description}`,
          });
        } else {
          updatedMessages.push({
            role: "tool",
            tool_call_id: p.tc.id,
            content: contextContent,
          });
        }

        // Circuit breaker: too many consecutive errors
        if (!unleash && consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.log(chalk.yellow(`\n  ! ${MAX_CONSECUTIVE_ERRORS} consecutive errors. Stopping tool loop.\n`));
          updatedMessages.push({
            role: "user",
            content: `[SYSTEM: Tool execution has hit ${MAX_CONSECUTIVE_ERRORS} consecutive errors. Stop retrying and tell the user what went wrong and what you were trying to do.]`,
          });
          break;
        }
      }
    }

    // Futile turn detection: check if all tool results in this turn were empty/no-match
    const FUTILE_PATTERNS = [
      "No files matched",
      "No matches found",
      "No matching",
      "Invalid arguments for",
      "Error: spawnSync",
      "(no output)",
    ];
    const lastToolResults = updatedMessages
      .slice(-toolCalls.length)
      .filter((m) => m.role === "tool")
      .map((m) => typeof m.content === "string" ? m.content : "");
    const allFutile = lastToolResults.length > 0 && lastToolResults.every(
      (r) => FUTILE_PATTERNS.some((p) => r.includes(p)) || r.trim() === ""
    );
    if (allFutile) {
      consecutiveFutile++;
    } else {
      consecutiveFutile = 0;
    }
    if (consecutiveFutile >= MAX_FUTILE_TURNS) {
      console.log(chalk.yellow(`\n  ! ${consecutiveFutile} consecutive turns with no useful results. Stopping.\n`));
      updatedMessages.push({
        role: "user",
        content: `[SYSTEM: Your last ${consecutiveFutile} tool call turns all returned empty/no-match results. You appear stuck. STOP retrying with the same approach. Try a different search strategy, broaden your patterns, or check if the file/function exists at all. Summarize what you tried and what you'll do differently.]`,
      });
      consecutiveFutile = 0;
      // Let model respond to summarize
    }

    // Repetition loop detection: track tool call signatures for this turn
    const turnSignature = toolCalls
      .map((tc) => `${tc.function.name}:${tc.function.arguments.substring(0, 80)}`)
      .sort()
      .join("|");
    recentToolSignatures.push(turnSignature);
    if (recentToolSignatures.length > MAX_REPETITION_WINDOW) {
      recentToolSignatures.shift();
    }

    // Also track just tool names for fuzzy repetition detection
    const turnToolNames = toolCalls.map((tc) => tc.function.name).sort().join("|");
    recentToolNames.push(turnToolNames);
    if (recentToolNames.length > MAX_REPETITION_WINDOW) {
      recentToolNames.shift();
    }

    // Check if the same signature has appeared too many times recently
    const signatureCounts = new Map<string, number>();
    for (const sig of recentToolSignatures) {
      signatureCounts.set(sig, (signatureCounts.get(sig) || 0) + 1);
    }
    const maxCount = Math.max(...signatureCounts.values());

    // Also check tool-name-only repetition (catches varied garbage args)
    const nameRepCounts = new Map<string, number>();
    for (const names of recentToolNames) {
      nameRepCounts.set(names, (nameRepCounts.get(names) || 0) + 1);
    }
    const maxNameCount = Math.max(...nameRepCounts.values());

    if (maxCount >= REPETITION_THRESHOLD) {
      console.log(chalk.yellow(`\n  ! Detected repetitive tool loop (same actions repeated ${maxCount} times). Stopping.\n`));
      updatedMessages.push({
        role: "user",
        content: `[SYSTEM: You are stuck in a repetitive loop — you have called the same tools ${maxCount} times. STOP retrying the same approach. Summarize what you accomplished and what issues remain, then try a completely different strategy to solve the problem.]`,
      });
      // Let the model respond one more time to summarize, then the text-only path will return
    } else if (maxNameCount >= NAME_REPETITION_THRESHOLD && consecutiveFutile >= 2) {
      console.log(chalk.yellow(`\n  ! Same tools called ${maxNameCount} times with no useful results. Stopping.\n`));
      updatedMessages.push({
        role: "user",
        content: `[SYSTEM: You have called the same types of tools (${turnToolNames}) ${maxNameCount} times without getting useful results. The patterns/arguments you're using appear to be malformed. STOP and try a fundamentally different approach — different tool, different search pattern, or different file path.]`,
      });
    }
  }

  // Hit max turns — tell user clearly and return
  console.log(chalk.yellow(`\n  ⚠ Reached tool turn limit (${maxTurns}). Type "continue" to keep going.\n`));
  updatedMessages.push({
    role: "assistant",
    content: "[Reached maximum tool call limit. The user can continue if needed.]",
  });
  return updatedMessages;
}

function formatToolLabel(toolName: string): string {
  const labels: Record<string, string> = {
    bash: "Bash",
    read_file: "Read",
    write_file: "Write",
    edit_file: "Edit",
    glob: "Glob",
    grep: "Grep",
    web_fetch: "WebFetch",
    spawn_agent: "Agent",
    spawn_swarm: "Swarm",
generate_image: "Image",
    git_log: "GitLog",
    git_diff_session: "GitDiff",
    git_undo: "GitUndo",
    git_stash: "GitStash",
    core_memory_read: "Memory",
    core_memory_update: "Memory",
    recall_search: "Recall",
    archival_insert: "Archive",
    archival_search: "Archive",
    agent_create: "AgentCreate",
    agent_list: "AgentList",
    agent_memory_read: "AgentMemory",
    agent_memory_update: "AgentMemory",
    take_screenshot: "Screenshot",
    analyze_image: "Vision",
  };
  if (toolName.startsWith("mcp__")) {
    const parts = toolName.split("__");
    return `MCP:${parts[1]}/${parts.slice(2).join("__")}`;
  }
  if (toolName.startsWith("skill__")) {
    const parts = toolName.substring(7).split("__");
    return `Skill:${parts.slice(0, -1).join("/")}/${parts[parts.length - 1]}`;
  }
  return labels[toolName] || toolName;
}

export function summarizeArgs(
  toolName: string,
  args: Record<string, unknown>
): string {
  switch (toolName) {
    case "bash":
      return String(args.command || "").substring(0, 120);
    case "read_file":
    case "write_file":
    case "edit_file":
      return String(args.file_path || "");
    case "glob":
      return String(args.pattern || "");
    case "grep":
      return `${args.pattern || ""} ${args.path || ""}`;
    case "web_fetch":
      return String(args.url || "").substring(0, 80);
    case "web_search":
      return String(args.query || "");
    case "generate_image":
      return String(args.prompt || "").substring(0, 80);
    case "take_screenshot":
      return String(args.region || "full");
    case "analyze_image":
      return `${args.image_path} — ${String(args.question || "describe").substring(0, 50)}`;
    case "spawn_agent":
      return `${args.agent}: ${String(args.task || "").substring(0, 50)}`;
    case "spawn_swarm": {
      const tasks = args.tasks as Array<{ agent: string }> | undefined;
      return `${tasks?.length || 0} agents`;
    }
case "git_log":
      return `last ${args.count || 15} commits`;
    case "git_diff_session":
      return "session changes";
    case "git_undo":
      return `${args.count || 1} commit(s) ${args.mode || "soft"}`;
    case "git_stash":
      return String(args.message || "");
    default:
      return JSON.stringify(args).substring(0, 80);
  }
}

/**
 * Rescue tool calls that Kimi K2.5 leaked into content text
 * instead of sending as structured tool_calls.
 *
 * Pattern:
 * <|tool_calls_section_begin|>
 * <|tool_call_begin|> functions.tool_name:N
 * <|tool_call_argument_begin|> {"arg": "value"}
 * <|tool_call_end|>
 * <|tool_calls_section_end|>
 */
/**
 * Rescue tool calls that models leak into content text instead of sending
 * as structured tool_calls. Handles multiple formats:
 *
 * 1. Kimi K2.5: functions.tool_name:N <|tool_call_argument_begin|> {...}
 * 2. Kimi/Qwen: <|tool_call_begin|><|tool_sep|>tool_name\n<|tool_call_argument_begin|>{...}
 * 3. Some models: <function=name><parameter=key>value</function>
 */
export function rescueToolCallsFromText(
  text: string
): Array<{ id: string; function: { name: string; arguments: string } }> {
  const rescued: Array<{ id: string; function: { name: string; arguments: string } }> = [];

  // Pattern 1: functions.TOOL_NAME:N followed by argument JSON
  const pattern1 = /functions\.(\w+):\d+\s*(?:<\|tool_call_argument_begin\|>)?\s*(\{[\s\S]*?\})\s*(?:<\|tool_call_end\|>)?/g;
  let match;
  while ((match = pattern1.exec(text)) !== null) {
    try {
      JSON.parse(match[2]);
      rescued.push({
        id: `rescued-${Date.now()}-${rescued.length}`,
        function: { name: match[1], arguments: match[2] },
      });
    } catch {}
  }

  if (rescued.length > 0) return rescued;

  // Pattern 2: <|tool_call_begin|><|tool_sep|>tool_name\n<|tool_call_argument_begin|>{...}<|tool_call_argument_end|>
  const pattern2 = /<\|tool_call_begin\|>\s*<\|tool_sep\|>\s*(\w+)\s*\n<\|tool_call_argument_begin\|>([\s\S]*?)<\|tool_call_argument_end\|>/g;
  while ((match = pattern2.exec(text)) !== null) {
    try {
      JSON.parse(match[2].trim());
      rescued.push({
        id: `rescued-${Date.now()}-${rescued.length}`,
        function: { name: match[1], arguments: match[2].trim() },
      });
    } catch {}
  }

  if (rescued.length > 0) return rescued;

  // Pattern 3: <function=name><parameter=key>value</function>
  const pattern3 = /<function=(\w+)>\s*<parameter=(\w+)>\s*([\s\S]*?)(?:<\/function>|$)/g;
  const calls: Record<string, Record<string, string>> = {};
  while ((match = pattern3.exec(text)) !== null) {
    const fname = match[1];
    if (!calls[fname]) calls[fname] = {};
    calls[fname][match[2]] = match[3].trim();
  }
  for (const [fname, params] of Object.entries(calls)) {
    rescued.push({
      id: `rescued-${Date.now()}-${rescued.length}`,
      function: { name: fname, arguments: JSON.stringify(params) },
    });
  }

  return rescued;
}

/**
 * Try to parse a tool result as an image result (from screenshot tool).
 * Returns parsed data if it's an image result, null otherwise.
 */
function tryParseImageResult(
  result: string
): { path: string; size_kb: number } | null {
  try {
    const parsed = JSON.parse(result);

    // Case 1: Screenshot / browser screenshot returns JSON with type: "image_result"
    if (parsed?.type === "image_result" && parsed.path) {
      return { path: parsed.path, size_kb: parsed.size_kb || 0 };
    }
  } catch {
    // Not JSON — check other formats
  }

  // Case 2: read_file returns "[IMAGE: path (size KB)]\ndata:..." format
  const imageMatch = result.match(/^\[IMAGE: (.+?) \((\d+) KB\)\]/);
  if (imageMatch) {
    return {
      path: imageMatch[1],
      size_kb: parseInt(imageMatch[2], 10),
    };
  }

  return null;
}
