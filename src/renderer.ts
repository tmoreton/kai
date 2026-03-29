import chalk from "chalk";
import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { highlight } from "cli-highlight";

const marked = new Marked();
marked.use(
  markedTerminal({
    code: (code: string, lang?: string) => {
      try {
        if (lang) {
          return (
            chalk.dim(`\`\`\`${lang}`) +
            "\n" +
            highlight(code, { language: lang, ignoreIllegals: true }) +
            "\n" +
            chalk.dim("```")
          );
        }
        return (
          chalk.dim("```") +
          "\n" +
          highlight(code, { ignoreIllegals: true }) +
          "\n" +
          chalk.dim("```")
        );
      } catch {
        return chalk.dim("```") + "\n" + code + "\n" + chalk.dim("```");
      }
    },
    blockquote: chalk.gray.italic,
    heading: chalk.bold.cyan,
    strong: chalk.bold,
    em: chalk.italic,
    codespan: chalk.yellow,
    link: (href: string, _title: string, text: string) =>
      chalk.blue.underline(text || href),
    listitem: (text: string) => `  ${chalk.dim("•")} ${text}`,
    table: chalk.reset,
    tablerow: chalk.reset,
    tablecell: (content: string) => `${content}\t`,
  }) as any
);

export function renderMarkdown(text: string): string {
  try {
    const result = marked.parse(text);
    return typeof result === "string" ? result : text;
  } catch {
    return text;
  }
}

export function renderInlineCode(code: string, lang?: string): string {
  try {
    return highlight(code, {
      language: lang,
      ignoreIllegals: true,
    });
  } catch {
    return code;
  }
}
