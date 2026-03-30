import fs from "fs";
import path from "path";
import { getCwd } from "./bash.js";
import { generateDiff } from "../diff.js";
import { resolveFilePath } from "../utils.js";

const resolvePath = resolveFilePath;

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
        return `Binary image file: ${fullPath} (${sizeKB} KB). Cannot read binary image files as text.`;
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

// Store the last diff for display by the client
let _lastDiff = "";
export function getLastDiff(): string {
  const d = _lastDiff;
  _lastDiff = "";
  return d;
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
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Capture old content for diff
    const oldContent = fs.existsSync(fullPath)
      ? fs.readFileSync(fullPath, "utf-8")
      : "";

    fs.writeFileSync(fullPath, args.content, "utf-8");

    // Generate diff for display
    const relativePath = path.relative(getCwd(), fullPath) || fullPath;
    _lastDiff = generateDiff(relativePath, oldContent, args.content);

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
    const oldContent = fs.readFileSync(fullPath, "utf-8");

    if (!oldContent.includes(args.old_string)) {
      return `Error: old_string not found in file. Make sure it matches exactly (including whitespace).`;
    }

    let newContent: string;
    if (args.replace_all) {
      newContent = oldContent.split(args.old_string).join(args.new_string);
    } else {
      const index = oldContent.indexOf(args.old_string);
      newContent =
        oldContent.substring(0, index) +
        args.new_string +
        oldContent.substring(index + args.old_string.length);
    }

    fs.writeFileSync(fullPath, newContent, "utf-8");

    // Generate diff for display
    const relativePath = path.relative(getCwd(), fullPath) || fullPath;
    _lastDiff = generateDiff(relativePath, oldContent, newContent);

    return `File edited successfully: ${fullPath}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error editing file: ${msg}`;
  }
}
