import fs from "fs";
import path from "path";
import { expandHome, resolveFilePath } from "../utils.js";
import { resolveVisionProvider } from "../providers/index.js";

/**
 * Vision Analysis Tool
 *
 * Sends an image to a vision-capable model for analysis.
 * Uses OpenRouter with a vision model (falls back if Fireworks doesn't support vision).
 */

const IMAGE_EXTS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

export async function analyzeImage(args: {
  image_path: string;
  question?: string;
}): Promise<string> {
  const imgPath = resolveFilePath(expandHome(args.image_path));

  if (!fs.existsSync(imgPath)) {
    return `Image not found: ${imgPath}. Check the path is correct — file names with spaces or special characters must be exact.`;
  }

  const ext = path.extname(imgPath).toLowerCase();
  const mime = IMAGE_EXTS[ext];
  if (!mime) {
    return `Unsupported image format: ${ext}. Supported: ${Object.keys(IMAGE_EXTS).join(", ")}`;
  }

  const stat = fs.statSync(imgPath);
  if (stat.size > 20 * 1024 * 1024) {
    return "Image too large (max 20MB).";
  }

  const base64 = fs.readFileSync(imgPath).toString("base64");
  const dataUrl = `data:${mime};base64,${base64}`;
  const question = args.question || "Describe this image in detail.";

  const { client, model } = resolveVisionProvider();

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: question },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 4096,
    });

    const content = response.choices[0]?.message?.content || "";
    return content || "Vision model returned no response.";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Vision analysis failed: ${msg}`;
  }
}
