/**
 * Typed error hierarchy for structured error handling.
 * Replaces string-based errors with discriminated classes that carry context.
 * Inspired by claw-code's typed error enums.
 */

/** Base error for all Kai errors — carries structured context */
export class KaiError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "KaiError";
    this.code = code;
  }
}

/** API/provider errors (stream failures, auth, rate limits) */
export class ApiError extends KaiError {
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly provider?: string;

  constructor(
    message: string,
    opts: { statusCode?: number; retryable?: boolean; provider?: string; cause?: Error } = {}
  ) {
    super("API_ERROR", message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = "ApiError";
    this.statusCode = opts.statusCode;
    this.retryable = opts.retryable ?? false;
    this.provider = opts.provider;
  }

  static fromStatus(status: number, body?: string, provider?: string): ApiError {
    const retryable = [429, 500, 502, 503].includes(status);
    const message = body
      ? `API ${status}: ${body.slice(0, 200)}`
      : `API request failed with status ${status}`;
    return new ApiError(message, { statusCode: status, retryable, provider });
  }

  static streamFailed(reason: string, cause?: Error): ApiError {
    return new ApiError(`Stream failed: ${reason}`, { retryable: false, cause });
  }

  static timeout(timeoutMs: number): ApiError {
    return new ApiError(`Request timed out after ${timeoutMs}ms`, { retryable: true });
  }
}

/** Tool execution errors */
export class ToolError extends KaiError {
  readonly toolName: string;
  readonly args?: Record<string, unknown>;

  constructor(
    toolName: string,
    message: string,
    opts: { args?: Record<string, unknown>; cause?: Error } = {}
  ) {
    super("TOOL_ERROR", message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = "ToolError";
    this.toolName = toolName;
    this.args = opts.args;
  }

  static validationFailed(toolName: string, error: string): ToolError {
    return new ToolError(toolName, `Invalid arguments: ${error}`);
  }

  static executionFailed(toolName: string, reason: string, cause?: Error): ToolError {
    return new ToolError(toolName, `Execution failed: ${reason}`, { cause });
  }

  static truncated(toolName: string, argLength: number): ToolError {
    return new ToolError(toolName, `Tool call truncated at ${argLength} chars — arguments were cut off`);
  }

  static unknown(toolName: string): ToolError {
    return new ToolError(toolName, `Unknown tool: ${toolName}`);
  }
}

/** Permission/authorization errors */
export class PermissionError extends KaiError {
  readonly toolName: string;
  readonly deniedBy: "user" | "hook" | "plan_mode";

  constructor(
    toolName: string,
    deniedBy: "user" | "hook" | "plan_mode",
    message?: string
  ) {
    super(
      "PERMISSION_ERROR",
      message || `Permission denied for ${toolName} (denied by ${deniedBy})`
    );
    this.name = "PermissionError";
    this.toolName = toolName;
    this.deniedBy = deniedBy;
  }
}

/** Session storage/loading errors */
export class SessionError extends KaiError {
  readonly sessionId?: string;

  constructor(message: string, opts: { sessionId?: string; cause?: Error } = {}) {
    super("SESSION_ERROR", message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = "SessionError";
    this.sessionId = opts.sessionId;
  }

  static notFound(sessionId: string): SessionError {
    return new SessionError(`Session not found: ${sessionId}`, { sessionId });
  }

  static corrupt(sessionId: string, cause?: Error): SessionError {
    return new SessionError(`Session data corrupt: ${sessionId}`, { sessionId, cause });
  }

  static saveFailed(sessionId: string, cause?: Error): SessionError {
    return new SessionError(`Failed to save session: ${sessionId}`, { sessionId, cause });
  }
}

/** Chat loop errors (budget exceeded, loop detection, max turns) */
export class ChatError extends KaiError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "ChatError";
  }

  static budgetExceeded(used: number, limit: number): ChatError {
    return new ChatError(
      "BUDGET_EXCEEDED",
      `Token budget exceeded (${used.toLocaleString()} / ${limit.toLocaleString()})`
    );
  }

  static repetitionLoop(count: number): ChatError {
    return new ChatError(
      "REPETITION_LOOP",
      `Detected repetitive tool loop (same actions repeated ${count} times)`
    );
  }

  static maxTurns(turns: number): ChatError {
    return new ChatError(
      "MAX_TURNS",
      `Reached maximum tool call limit (${turns})`
    );
  }

  static consecutiveErrors(count: number): ChatError {
    return new ChatError(
      "CONSECUTIVE_ERRORS",
      `Tool execution hit ${count} consecutive errors`
    );
  }
}

/**
 * Check if an error is a specific Kai error type.
 * Useful for catch blocks that need to handle specific error kinds.
 */
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export function isToolError(err: unknown): err is ToolError {
  return err instanceof ToolError;
}

export function isPermissionError(err: unknown): err is PermissionError {
  return err instanceof PermissionError;
}

export function isRetryable(err: unknown): boolean {
  return err instanceof ApiError && err.retryable;
}

/**
 * Format any error into a user-friendly string.
 * Extracts the most useful information from typed or untyped errors.
 */
export function formatError(err: unknown): string {
  if (err instanceof KaiError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
