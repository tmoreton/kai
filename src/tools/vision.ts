import fs from "fs";
import path from "path";
import { getCwd } from "./bash.js";

const SUPPORTED_FORMATS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

/**
 * Read an image file and return base64-encoded data URL
 * for inclusion in the chat as a vision message.
 */
export function readImageAsDataUrl(filePath: string): {
  dataUrl: string;
  mimeType: string;
  sizeKB: number;
} | { error: string } {
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(getCwd(), filePath);

  if (!fs.existsSync(resolved)) {
    return { error: `Image not found: ${resolved}` };
  }

  const ext = path.extname(resolved).toLowerCase();
  if (!SUPPORTED_FORMATS.includes(ext)) {
    return { error: `Unsupported image format: ${ext}. Supported: ${SUPPORTED_FORMATS.join(", ")}` };
  }

  const stat = fs.statSync(resolved);
  if (stat.size > MAX_IMAGE_SIZE) {
    return { error: `Image too large: ${Math.round(stat.size / 1024 / 1024)}MB (max 20MB)` };
  }

  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
  };

  const mimeType = mimeMap[ext] || "image/png";
  const buffer = fs.readFileSync(resolved);
  const base64 = buffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  return {
    dataUrl,
    mimeType,
    sizeKB: Math.round(stat.size / 1024),
  };
}

/**
 * Take a screenshot using macOS screencapture (if available)
 */
export async function takeScreenshot(): Promise<string> {
  const { execSync } = await import("child_process");
  const tmpPath = `/tmp/kai-screenshot-${Date.now()}.png`;

  try {
    // macOS only — capture the frontmost window
    execSync(`screencapture -x ${tmpPath}`, { timeout: 10000 });

    if (fs.existsSync(tmpPath)) {
      return tmpPath;
    }
    return "Error: Screenshot failed — no file created.";
  } catch {
    return "Error: screencapture not available (macOS only).";
  }
}

/**
 * Check if a string looks like an image path
 */
export function isImagePath(input: string): boolean {
  const trimmed = input.trim();
  const ext = path.extname(trimmed).toLowerCase();
  return SUPPORTED_FORMATS.includes(ext);
}
