import fs from "fs";
import path from "path";
import { getCwd } from "./bash.js";

function resolvePath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(getCwd(), filePath);
}

export async function readFile(args: {
  file_path: string;
  offset?: number;
  limit?: number;
}): Promise<string> {
  const fullPath = resolvePath(args.file_path);

  try {
    const content = fs.readFileSync(fullPath, "utf-8");
    const lines = content.split("\n");
    const start = Math.max(0, (args.offset || 1) - 1);
    const limit = args.limit || 2000;
    const slice = lines.slice(start, start + limit);

    const numbered = slice.map(
      (line, i) => `${start + i + 1}\t${line}`
    );
    return numbered.join("\n");
  } catch (err: any) {
    return `Error reading file: ${err.message}`;
  }
}

export async function writeFile(args: {
  file_path: string;
  content: string;
}): Promise<string> {
  const fullPath = resolvePath(args.file_path);

  try {
    // Create parent directories if needed
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, args.content, "utf-8");
    return `File written successfully: ${fullPath}`;
  } catch (err: any) {
    return `Error writing file: ${err.message}`;
  }
}

export async function editFile(args: {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}): Promise<string> {
  const fullPath = resolvePath(args.file_path);

  try {
    let content = fs.readFileSync(fullPath, "utf-8");

    if (!content.includes(args.old_string)) {
      return `Error: old_string not found in file. Make sure it matches exactly (including whitespace).`;
    }

    if (args.replace_all) {
      content = content.split(args.old_string).join(args.new_string);
    } else {
      const index = content.indexOf(args.old_string);
      content =
        content.substring(0, index) +
        args.new_string +
        content.substring(index + args.old_string.length);
    }

    fs.writeFileSync(fullPath, content, "utf-8");
    return `File edited successfully: ${fullPath}`;
  } catch (err: any) {
    return `Error editing file: ${err.message}`;
  }
}
