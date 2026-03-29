import fs from "fs";
import path from "path";
import { getCwd } from "./bash.js";

function resolvePath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(getCwd(), filePath);
}

const BINARY_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".ico", ".svg",
  ".mp4", ".mov", ".avi", ".mkv", ".mp3", ".wav", ".flac",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".so", ".dylib", ".dll", ".exe", ".bin",
  ".sqlite", ".db", ".db-wal", ".db-shm",
]);

export async function readFile(args: {
  file_path: string;
  offset?: number;
  limit?: number;
}): Promise<string> {
  const fullPath = resolvePath(args.file_path);

  try {
    // Detect binary files by extension
    const ext = path.extname(fullPath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      const stat = fs.statSync(fullPath);
      const sizeKB = Math.round(stat.size / 1024);
      if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(ext)) {
        return `Binary image file: ${fullPath} (${sizeKB} KB). Use the view_image tool to see this image, not read_file.`;
      }
      return `Binary file: ${fullPath} (${sizeKB} KB, ${ext}). Cannot read binary files as text.`;
    }

    // Quick binary content check — look for null bytes in first 512 bytes
    const buf = fs.readFileSync(fullPath);
    const checkLen = Math.min(buf.length, 512);
    for (let i = 0; i < checkLen; i++) {
      if (buf[i] === 0) {
        const sizeKB = Math.round(buf.length / 1024);
        return `Binary file detected: ${fullPath} (${sizeKB} KB). Cannot read binary files as text.`;
      }
    }

    const content = buf.toString("utf-8");
    const lines = content.split("\n");
    const start = Math.max(0, (args.offset || 1) - 1);
    const limit = args.limit || 2000;
    const slice = lines.slice(start, start + limit);

    const numbered = slice.map(
      (line, i) => `${start + i + 1}\t${line}`
    );
    return numbered.join("\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error reading file: ${msg}`;
  }
}

export async function writeFile(args: {
  file_path: string;
  content: string;
}): Promise<string> {
  if (!args.file_path) {
    return "Error: file_path is required for write_file.";
  }
  if (args.content === undefined || args.content === null) {
    return "Error: content is required for write_file.";
  }
  const fullPath = resolvePath(args.file_path);

  try {
    // Create parent directories if needed
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, args.content, "utf-8");
    return `File written successfully: ${fullPath}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error writing file: ${msg}`;
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error editing file: ${msg}`;
  }
}
