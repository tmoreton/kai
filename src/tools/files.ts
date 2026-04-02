import fs from "fs";
import path from "path";
import { getCwd } from "./bash.js";
import { generateDiff } from "../diff.js";
import { resolveFilePath } from "../utils.js";
import { getCachedRead, setCachedRead, invalidateCache } from "./file-cache.js";

const resolvePath = resolveFilePath;

/** Extensions with dedicated parsers — handled before the binary check */
const PARSEABLE_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".xls", ".csv"]);

/** Image extensions — returned as base64 for vision models */
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);

const BINARY_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".ico", ".svg",
  ".mp4", ".mov", ".avi", ".mkv", ".mp3", ".wav", ".flac",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".doc",
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
  const offset = args.offset || 1;
  const limit = args.limit || 2000;

  // Check cache first — returns hit if file hasn't changed and same offset/limit
  const cached = getCachedRead(fullPath, offset, limit);
  if (cached !== null) {
    return cached;
  }

  try {
    const ext = path.extname(fullPath).toLowerCase();
    const stat = fs.statSync(fullPath);
    const sizeKB = Math.round(stat.size / 1024);

    // --- Parseable document formats ---
    if (PARSEABLE_EXTENSIONS.has(ext)) {
      return await parseDocument(fullPath, ext, sizeKB);
    }

    // --- Images: return description + base64 for vision ---
    if (IMAGE_EXTENSIONS.has(ext)) {
      const buf = fs.readFileSync(fullPath);
      const base64 = buf.toString("base64");
      const mime = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : ext === ".webp" ? "image/webp" : "image/jpeg";
      return `[IMAGE: ${fullPath} (${sizeKB} KB)]\ndata:${mime};base64,${base64}`;
    }

    // --- Other binary files ---
    if (BINARY_EXTENSIONS.has(ext)) {
      return `Binary file: ${fullPath} (${sizeKB} KB, ${ext}). Cannot read binary files as text.`;
    }

    // Quick binary content check — look for null bytes in first 512 bytes
    const buf = fs.readFileSync(fullPath);
    const checkLen = Math.min(buf.length, 512);
    for (let i = 0; i < checkLen; i++) {
      if (buf[i] === 0) {
        return `Binary file detected: ${fullPath} (${sizeKB} KB). Cannot read binary files as text.`;
      }
    }

    const content = buf.toString("utf-8");
    const lines = content.split("\n");
    const start = Math.max(0, offset - 1);
    const slice = lines.slice(start, start + limit);

    const numbered = slice.map(
      (line, i) => `${start + i + 1}\t${line}`
    );
    const result = numbered.join("\n");

    // Cache the result for future reads
    setCachedRead(fullPath, offset, limit, result);

    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error reading file: ${msg}`;
  }
}

/**
 * Parse structured document formats into text.
 */
async function parseDocument(filePath: string, ext: string, sizeKB: number): Promise<string> {
  const MAX_CHARS = 100_000; // ~25k tokens limit for extracted text
  let text = "";

  try {
    switch (ext) {
      case ".pdf": {
        const { execSync } = await import("child_process");
        try {
          // pdftotext (from poppler) is fast and reliable
          const pdfText = execSync(`pdftotext "${filePath}" -`, {
            maxBuffer: 10 * 1024 * 1024,
            timeout: 30_000,
          }).toString("utf-8");
          const pageCount = (pdfText.match(/\f/g) || []).length + 1;
          text = `[PDF: ${filePath} — ~${pageCount} pages, ${sizeKB} KB]\n\n${pdfText}`;
        } catch {
          return `Error: Could not parse PDF. Install poppler for PDF support: brew install poppler`;
        }
        break;
      }
      case ".docx": {
        // @ts-ignore — optional dependency
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ path: filePath });
        text = `[DOCX: ${filePath} — ${sizeKB} KB]\n\n${result.value}`;
        break;
      }
      case ".xlsx":
      case ".xls": {
        // @ts-ignore — optional dependency
        const XLSX = await import("xlsx");
        const workbook = XLSX.readFile(filePath);
        const sheets: string[] = [];
        for (const name of workbook.SheetNames) {
          const sheet = workbook.Sheets[name];
          const csv = XLSX.utils.sheet_to_csv(sheet);
          sheets.push(`## Sheet: ${name}\n${csv}`);
        }
        text = `[${ext.toUpperCase().slice(1)}: ${filePath} — ${workbook.SheetNames.length} sheets, ${sizeKB} KB]\n\n${sheets.join("\n\n")}`;
        break;
      }
      case ".csv": {
        const content = fs.readFileSync(filePath, "utf-8");
        text = `[CSV: ${filePath} — ${sizeKB} KB]\n\n${content}`;
        break;
      }
      default:
        return `Unsupported document format: ${ext}`;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error parsing ${ext} file: ${msg}`;
  }

  if (text.length > MAX_CHARS) {
    text = text.substring(0, MAX_CHARS) + `\n\n[Truncated — ${text.length} chars total]`;
  }
  return text;
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
    invalidateCache(fullPath);

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
    invalidateCache(fullPath);

    // Generate diff for display
    const relativePath = path.relative(getCwd(), fullPath) || fullPath;
    _lastDiff = generateDiff(relativePath, oldContent, newContent);

    return `File edited successfully: ${fullPath}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error editing file: ${msg}`;
  }
}
