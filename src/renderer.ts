import chalk from "chalk";
import { highlight } from "cli-highlight";

/**
 * Render a complete markdown response for terminal display.
 * Called after streaming is complete to add syntax highlighting to code blocks.
 */
export function renderMarkdown(text: string): string {
  // Highlight fenced code blocks
  return text.replace(
    /```(\w+)?\n([\s\S]*?)```/g,
    (_match, lang: string | undefined, code: string) => {
      const header = lang ? chalk.dim(`\`\`\`${lang}`) : chalk.dim("```");
      const footer = chalk.dim("```");
      try {
        const highlighted = lang
          ? highlight(code.trimEnd(), { language: lang, ignoreIllegals: true })
          : highlight(code.trimEnd(), { ignoreIllegals: true });
        return `${header}\n${highlighted}\n${footer}`;
      } catch {
        return `${header}\n${code.trimEnd()}\n${footer}`;
      }
    }
  );
}

/**
 * Highlight a single code snippet.
 */
export function highlightCode(code: string, lang?: string): string {
  try {
    return highlight(code, {
      language: lang,
      ignoreIllegals: true,
    });
  } catch {
    return code;
  }
}
