/**
 * Central error tracking for self-healing.
 *
 * Captures errors from all layers (REPL, client, tools, daemon, uncaught)
 * with full context, deduplicates via fingerprinting, and persists to SQLite.
 *
 * This module is designed to NEVER throw — a tracker crash must not cascade.
 */

import crypto from "crypto";
import { recordErrorEvent } from "./agents-core/db.js";
import { KaiError } from "./errors.js";

export type ErrorSource = "repl" | "repl-ink" | "client" | "tool" | "daemon" | "uncaught";

export interface RecordErrorOpts {
  source: ErrorSource;
  error: unknown;
  context?: Record<string, unknown>;
}

/**
 * Record an error event. Safe to call from anywhere — never throws.
 * Extracts structured info from Error/KaiError instances, computes a
 * fingerprint for dedup, and upserts to the error_events table.
 */
export function recordError(opts: RecordErrorOpts): void {
  try {
    const { source, error, context } = opts;
    const info = extractErrorInfo(error);

    // Skip self-heal errors to prevent recursive healing
    if (context?.agentId === "agent-kai-self-heal" || context?.agentId === "agent-kai-self-diagnosis") {
      return;
    }

    const fingerprint = computeFingerprint(info.className, info.code, info.message, source);

    recordErrorEvent({
      fingerprint,
      source,
      errorClass: info.className,
      errorCode: info.code,
      message: info.message,
      stack: info.stack,
      context,
    });
  } catch {
    // Intentionally swallowed — tracker must never cause secondary failures
  }
}

// --- Internals ---

interface ErrorInfo {
  className: string;
  code: string | undefined;
  message: string;
  stack: string | undefined;
}

function extractErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof KaiError) {
    return {
      className: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack,
    };
  }
  if (error instanceof Error) {
    return {
      className: error.constructor.name,
      code: undefined,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    className: "Unknown",
    code: undefined,
    message: String(error),
    stack: undefined,
  };
}

/**
 * Normalize a message for fingerprinting by replacing variable parts:
 * - File paths → <path>
 * - Numbers → <N>
 * - UUIDs → <uuid>
 * - Quoted strings → <str>
 */
function normalizeMessage(msg: string): string {
  return msg
    .replace(/\/[\w./-]+/g, "<path>")                          // file paths
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>") // UUIDs
    .replace(/\b\d+\b/g, "<N>")                                // numbers
    .replace(/"[^"]{20,}"/g, "<str>")                          // long quoted strings
    .replace(/'[^']{20,}'/g, "<str>");
}

function computeFingerprint(
  className: string,
  code: string | undefined,
  message: string,
  source: ErrorSource
): string {
  const normalized = normalizeMessage(message);
  const input = `${className}:${code || ""}:${normalized}:${source}`;
  return crypto.createHash("sha256").update(input).digest("hex").substring(0, 16);
}

/**
 * Install process-level uncaught exception/rejection handlers.
 * Call once at startup (REPL or daemon entry point).
 */
export function installGlobalErrorHandlers(): void {
  process.on("uncaughtException", (err) => {
    recordError({ source: "uncaught", error: err });
  });
  process.on("unhandledRejection", (reason) => {
    recordError({ source: "uncaught", error: reason });
  });
}
