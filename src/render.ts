import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import chalk from "chalk";

const marked = new Marked(
  markedTerminal({
    // Code block styling
    code: chalk.bgGray,
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
