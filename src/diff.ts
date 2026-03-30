import { createTwoFilesPatch } from "diff";
import chalk from "chalk";

/**
 * Generate a unified diff between old and new file content.
 * Returns empty string if no changes.
 */
export function generateDiff(
  filePath: string,
  oldContent: string,
  newContent: string
): string {
  if (oldContent === newContent) return "";

  const patch = createTwoFilesPatch(
    filePath,
    filePath,
    oldContent,
    newContent,
    "",
    "",
    { context: 3 }
  );

  // Remove the first two lines (Index: ... and ===) that createTwoFilesPatch adds
  const lines = patch.split("\n");
  const start = lines.findIndex((l) => l.startsWith("---"));
  return start >= 0 ? lines.slice(start).join("\n") : patch;
}

/**
 * Render a unified diff with terminal colors.
 * Cap output at maxLines to avoid flooding the terminal.
 */
export function renderColorDiff(diff: string, maxLines = 60): string {
  if (!diff) return "";

  const lines = diff.split("\n");
  const output: string[] = [];
  let shown = 0;
  let totalAdded = 0;
  let totalRemoved = 0;

  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      output.push(chalk.bold(line));
    } else if (line.startsWith("@@")) {
      output.push(chalk.cyan(line));
    } else if (line.startsWith("+")) {
      totalAdded++;
      if (shown < maxLines) {
        output.push(chalk.green(line));
        shown++;
      }
    } else if (line.startsWith("-")) {
      totalRemoved++;
      if (shown < maxLines) {
        output.push(chalk.red(line));
        shown++;
      }
    } else {
      if (shown < maxLines) {
        output.push(chalk.dim(line));
        shown++;
      }
    }
  }

  if (shown < totalAdded + totalRemoved) {
    const remaining = totalAdded + totalRemoved - shown;
    output.push(chalk.dim(`  ... ${remaining} more lines`));
  }

  const summary = chalk.dim(
    `  ${chalk.green(`+${totalAdded}`)} ${chalk.red(`-${totalRemoved}`)}`
  );
  output.push(summary);

  return output.join("\n");
}
