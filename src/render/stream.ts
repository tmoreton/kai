/**
 * Streaming terminal renderer inspired by claw-code.
 * Renders markdown incrementally as tokens arrive, flushing only
 * at safe markdown boundaries to prevent broken rendering.
 */
import chalk from "chalk";
import { highlight } from "cli-highlight";
import { renderMarkdown } from "../render.js";

// Spinner frames from claw-code
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Color theme matching claw-code's aesthetic
export const COLOR_THEME = {
  heading: chalk.cyan,
  emphasis: chalk.magenta,
  strong: chalk.yellow,
  inlineCode: chalk.green,
  link: chalk.blue.underline,
  quote: chalk.gray,
  tableBorder: chalk.cyan.dim,
  codeBlockBorder: chalk.gray,
  spinnerActive: chalk.blue,
  spinnerDone: chalk.green,
  spinnerFailed: chalk.red,
  dim: chalk.dim,
  toolName: chalk.cyan.bold,
  toolRunning: chalk.yellow,
  toolSuccess: chalk.green,
  toolError: chalk.red,
  assistant: chalk.cyan,
} as const;

export interface Spinner {
  label: string;
  frameIndex: number;
  interval: ReturnType<typeof setInterval> | null;
}

export interface ToolCard {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: "pending" | "running" | "success" | "error";
  output?: string;
  elapsedMs?: number;
}

export interface StreamState {
  buffer: string;
  inCodeBlock: boolean;
  codeLanguage: string;
  codeBuffer: string;
  listDepth: number;
  inHeading: boolean;
  headingLevel: number;
  pendingToolCards: Map<string, ToolCard>;
  activeSpinner: Spinner | null;
  lineCount: number;
}

export function createStreamState(): StreamState {
  return {
    buffer: "",
    inCodeBlock: false,
    codeLanguage: "",
    codeBuffer: "",
    listDepth: 0,
    inHeading: false,
    headingLevel: 0,
    pendingToolCards: new Map(),
    activeSpinner: null,
    lineCount: 0,
  };
}

// ─── Safe-boundary markdown streaming (inspired by claw-code) ───────────────

/**
 * Tracks fence state to find safe points to flush buffered markdown.
 * Prevents rendering partial code blocks, bold markers, etc.
 */
function findStreamSafeBoundary(text: string): number | null {
  let fenceOpen = false;
  let lastSafe = -1;

  const lines = text.split("\n");
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Track code fence state
    if (trimmed.startsWith("```")) {
      fenceOpen = !fenceOpen;
    }

    // A line boundary outside a code fence is safe to flush at
    if (!fenceOpen && i < lines.length - 1) {
      lastSafe = offset + line.length + 1; // +1 for the \n
    }

    offset += line.length + 1;
  }

  // If we have a lot of buffered text with no safe boundary,
  // flush at the last paragraph break regardless
  if (lastSafe === -1 && text.length > 500) {
    const doubleNewline = text.lastIndexOf("\n\n");
    if (doubleNewline > 0) return doubleNewline + 2;
  }

  return lastSafe > 0 ? lastSafe : null;
}

/**
 * Markdown stream state that buffers incoming tokens and flushes
 * rendered markdown only at safe boundaries (closed code fences,
 * line breaks outside fences). This prevents flickering/broken
 * rendering of partial markdown elements.
 */
export class MarkdownStreamBuffer {
  private pending = "";
  private flushedContent = "";  // All content flushed so far (raw markdown)
  private lineCount = 0;

  /** Push a new streaming delta. Returns rendered text to write, or null if still buffering. */
  push(delta: string): string | null {
    this.pending += delta;

    const boundary = findStreamSafeBoundary(this.pending);
    if (boundary === null) return null;

    const ready = this.pending.slice(0, boundary);
    this.pending = this.pending.slice(boundary);

    // Render the ready chunk as markdown
    const rendered = renderMarkdown(ready);
    this.flushedContent += ready;

    // Track line count for cursor management
    for (const ch of rendered) {
      if (ch === "\n") this.lineCount++;
    }

    return rendered;
  }

  /** Flush any remaining buffered content (call at end of stream). */
  flush(): string | null {
    if (!this.pending) return null;
    const rendered = renderMarkdown(this.pending);
    this.flushedContent += this.pending;
    this.pending = "";
    for (const ch of rendered) {
      if (ch === "\n") this.lineCount++;
    }
    return rendered;
  }

  /** Get all raw markdown content that has been streamed so far. */
  getAllContent(): string {
    return this.flushedContent + this.pending;
  }

  /** Get the number of rendered lines (for cursor management). */
  getLineCount(): number {
    return this.lineCount;
  }

  /** Check if there's pending unflushed content. */
  hasPending(): boolean {
    return this.pending.length > 0;
  }
}

/**
 * Create a spinner that renders inline without blocking.
 */
export function startSpinner(label: string, onRender: (text: string) => void): Spinner {
  const spinner: Spinner = {
    label,
    frameIndex: 0,
    interval: null,
  };

  // Initial render
  renderSpinner(spinner, onRender);

  // Animate
  spinner.interval = setInterval(() => {
    spinner.frameIndex++;
    renderSpinner(spinner, onRender);
  }, 80);

  return spinner;
}

function renderSpinner(spinner: Spinner, onRender: (text: string) => void): void {
  const frame = SPINNER_FRAMES[spinner.frameIndex % SPINNER_FRAMES.length];
  // Use cursor save/restore to avoid line-clearing flicker
  const text = `\x1b[s\r${COLOR_THEME.spinnerActive(frame)} ${COLOR_THEME.dim(spinner.label)}\x1b[K\x1b[u`;
  onRender(text);
}

export function stopSpinner(
  spinner: Spinner,
  outcome: "success" | "error" | null,
  finalLabel?: string
): void {
  if (spinner.interval) {
    clearInterval(spinner.interval);
    spinner.interval = null;
  }

  const label = finalLabel || spinner.label;
  if (outcome === "success") {
    process.stdout.write(`\r\x1b[K${COLOR_THEME.spinnerDone("✔")} ${COLOR_THEME.dim(label)}\n`);
  } else if (outcome === "error") {
    process.stdout.write(`\r\x1b[K${COLOR_THEME.spinnerFailed("✘")} ${COLOR_THEME.dim(label)}\n`);
  } else {
    process.stdout.write("\r\x1b[K"); // Clear line cleanly with ANSI escape
  }
}

/**
 * Render a tool call as a card (similar to Claude Code).
 */
export function renderToolCard(card: ToolCard, compact = false): string {
  const lines: string[] = [];

  const statusIcon =
    card.status === "pending"
      ? COLOR_THEME.dim("○")
      : card.status === "running"
        ? COLOR_THEME.toolRunning("◐")
        : card.status === "success"
          ? COLOR_THEME.toolSuccess("●")
          : COLOR_THEME.toolError("●");

  const statusColor =
    card.status === "success"
      ? COLOR_THEME.toolSuccess
      : card.status === "error"
        ? COLOR_THEME.toolError
        : COLOR_THEME.toolRunning;

  const toolDisplay = COLOR_THEME.toolName(card.name);

  if (compact) {
    // Single line: ● toolName arg1=value1 arg2=value2
    const argSummary = Object.entries(card.input)
      .slice(0, 2)
      .map(([k, v]) => {
        const val = typeof v === "string" && v.length > 20 ? `${v.slice(0, 20)}...` : String(v);
        return `${k}=${val}`;
      })
      .join(" ");
    const elapsed = card.elapsedMs ? ` ${COLOR_THEME.dim(`(${card.elapsedMs}ms)`)}` : "";
    return `  ${statusIcon} ${toolDisplay}${argSummary ? " " + argSummary : ""}${elapsed}`;
  }

  // Full card view
  lines.push(`  ${statusIcon} ${toolDisplay}`);

  // Input arguments
  for (const [key, value] of Object.entries(card.input)) {
    const valStr = typeof value === "string" ? value : JSON.stringify(value);
    const displayVal = valStr.length > 60 ? valStr.slice(0, 60) + "..." : valStr;
    lines.push(`    ${COLOR_THEME.dim(key + ":")} ${displayVal}`);
  }

  if (card.elapsedMs) {
    lines.push(`    ${COLOR_THEME.dim(`completed in ${card.elapsedMs}ms`)}`);
  }

  return lines.join("\n");
}

/**
 * Update a tool card in-place (for streaming tool status).
 */
export function updateToolCard(state: StreamState, card: ToolCard): void {
  state.pendingToolCards.set(card.id, card);
}

/**
 * Clear the current line (for spinner replacement).
 */
export function clearLine(): void {
  process.stdout.write("\r\x1b[K");
}

/**
 * Move cursor up N lines.
 */
export function moveUp(lines: number): void {
  if (lines > 0) {
    process.stdout.write(`\x1b[${lines}A`);
  }
}

/**
 * Move cursor down N lines.
 */
export function moveDown(lines: number): void {
  if (lines > 0) {
    process.stdout.write(`\x1b[${lines}B`);
  }
}

/**
 * Save cursor position.
 */
export function saveCursor(): void {
  process.stdout.write("\x1b[s");
}

/**
 * Restore cursor position.
 */
export function restoreCursor(): void {
  process.stdout.write("\x1b[u");
}

/**
 * Hide cursor.
 */
export function hideCursor(): void {
  process.stdout.write("\x1b[?25l");
}

/**
 * Show cursor.
 */
export function showCursor(): void {
  process.stdout.write("\x1b[?25h");
}

/**
 * Highlight code with syntax highlighting.
 */
export function highlightCode(code: string, language?: string): string {
  try {
    return highlight(code, {
      language: language || "text",
      ignoreIllegals: true,
    });
  } catch {
    return code;
  }
}

/**
 * Render a code block with borders (claw-code style).
 */
export function renderCodeBlock(code: string, language?: string): string {
  const langLabel = language ? ` ${language}` : "";
  const lines = code.split("\n");
  const border = COLOR_THEME.codeBlockBorder("│");

  let output = COLOR_THEME.codeBlockBorder(`╭─${langLabel}`) + "\n";

  for (const line of lines) {
    const highlighted = highlightCode(line, language);
    output += `${border} ${highlighted}\n`;
  }

  output += COLOR_THEME.codeBlockBorder("╰─");
  return output;
}

/**
 * Format a heading with appropriate styling.
 */
export function renderHeading(text: string, level: number): string {
  const indent = "  ".repeat(level - 1);
  const style = level === 1 ? COLOR_THEME.strong.bold : level === 2 ? COLOR_THEME.heading : COLOR_THEME.dim;
  const prefix = level === 1 ? "# " : level === 2 ? "## " : "### ";
  return `\n${indent}${style(prefix + text)}\n`;
}

/**
 * Render assistant output start marker.
 */
export function renderAssistantMarker(): void {
  process.stdout.write(COLOR_THEME.assistant("⏺ "));
}
