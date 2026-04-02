import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import chalk from "chalk";

/**
 * Syntax highlighting for code blocks using cli-highlight.
 * Falls back to plain bgGray if highlighting fails.
 */
let highlightFn: ((code: string, lang?: string) => string) | null = null;
try {
  const { highlight } = await import("cli-highlight");
  highlightFn = (code: string, lang?: string) => {
    try {
      return highlight(code, {
        language: lang || undefined,
        ignoreIllegals: true,
      });
    } catch {
      return code;
    }
  };
} catch {
  // cli-highlight not available, will fall back
}

function highlightCode(code: string, lang?: string): string {
  if (highlightFn) {
    return highlightFn(code, lang);
  }
  return chalk.bgGray(code);
}

const marked = new Marked(
  markedTerminal({
    // Code block styling — use syntax highlighting
    code: (code: string, lang?: string) => {
      const langLabel = lang ? chalk.dim(` ${lang}`) : "";
      const highlighted = highlightCode(code, lang);
      return `\n${chalk.dim("  ┌──")}${langLabel}\n${highlighted
        .split("\n")
        .map((l: string) => `${chalk.dim("  │")} ${l}`)
        .join("\n")}\n${chalk.dim("  └──")}\n`;
    },
    codespan: chalk.cyan,
    // Headers
    firstHeading: chalk.bold.white,
    heading: chalk.bold.white,
    // Links
    href: chalk.cyan.underline,
    // Emphasis
    strong: chalk.bold,
    em: chalk.italic,
    // Lists
    listitem: chalk.white,
    // Tables
    tableOptions: {
      chars: {
        top: "─",
        "top-mid": "┬",
        "top-left": "┌",
        "top-right": "┐",
        bottom: "─",
        "bottom-mid": "┴",
        "bottom-left": "└",
        "bottom-right": "┘",
        left: "│",
        "left-mid": "├",
        mid: "─",
        "mid-mid": "┼",
        right: "│",
        "right-mid": "┤",
        middle: "│",
      },
    },
    // Indentation
    indent: "  ",
    showSectionPrefix: false,
    reflowText: true,
    width: Math.min(process.stdout.columns || 100, 120),
  }) as Record<string, unknown>
);

/**
 * Render markdown text for the terminal with syntax highlighting,
 * code blocks, headers, bold/italic, etc.
 */
export function renderMarkdown(text: string): string {
  if (!text.trim()) return "";

  try {
    const rendered = marked.parse(text) as string;
    // Trim trailing newlines that marked adds
    return rendered.replace(/\n{3,}/g, "\n\n").trimEnd();
  } catch {
    // Fallback to raw text if rendering fails
    return text;
  }
}
