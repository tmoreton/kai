import fs from "fs";
import path from "path";
import { createImageClient, getImageModel } from "../providers/index.js";
import { kaiPath } from "../config.js";
import { expandHome, backoffDelay, sleep } from "../utils.js";

/**
 * Image Generation Tool
 *
 * Uses OpenRouter with Nano Banana (Gemini 2.5 Flash Image).
 * Images are generated via chat completions with modalities: ["image", "text"].
 */

export interface GenerateImageArgs {
  prompt: string;
  reference_image?: string;
  model?: string;
  width?: number;
  height?: number;
  output_dir?: string;
  negative_prompt?: string;
}

export interface GenerateImageResult {
  images: string[];
  prompt: string;
  model: string;
}

export async function generateImage(
  args: GenerateImageArgs
): Promise<GenerateImageResult> {
  const client = createImageClient();
  const model = args.model || getImageModel();

  const fullPrompt = args.negative_prompt
    ? `${args.prompt}\n\nAvoid: ${args.negative_prompt}`
    : args.prompt;

  // Build message content — include reference image if provided
  const userContent: any[] = [];

  if (args.reference_image) {
    const refPath = expandHome(args.reference_image);
    if (fs.existsSync(refPath)) {
      const imgBuffer = fs.readFileSync(refPath);
      const ext = path.extname(refPath).toLowerCase();
      const mime = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }[ext] || "image/jpeg";
      const base64 = imgBuffer.toString("base64");
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${mime};base64,${base64}` },
      });
    }
  }

  userContent.push({ type: "text", text: fullPrompt });

  // Retry up to 3 times with backoff
  let response: any;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        await sleep(backoffDelay(attempt - 1, 5000));
      }
      // Determine aspect ratio from dimensions (default 16:9 for thumbnails)
      let aspectRatio = "16:9";
      if (args.width && args.height) {
        const ratio = args.width / args.height;
        if (Math.abs(ratio - 1) < 0.1) aspectRatio = "1:1";
        else if (Math.abs(ratio - 4/3) < 0.1) aspectRatio = "4:3";
        else if (Math.abs(ratio - 3/4) < 0.1) aspectRatio = "3:4";
        else if (Math.abs(ratio - 9/16) < 0.1) aspectRatio = "9:16";
        else aspectRatio = "16:9";
      }

      response = await client.chat.completions.create({
        model,
        messages: [
          { role: "user", content: userContent.length === 1 ? fullPrompt : userContent },
        ],
        // @ts-ignore — OpenRouter extensions for image generation
        modalities: ["image", "text"],
        max_tokens: 2048,
        image_config: { aspect_ratio: aspectRatio },
      } as any);
      break;
    } catch (err: any) {
      lastError = err;
      if (!err.message?.includes("timeout") && !err.message?.includes("50")) {
        throw err;
      }
    }
  }

  if (!response) throw lastError || new Error("Image gen failed after 3 attempts");

  const results: string[] = [];
  const outDir = args.output_dir
    ? expandHome(args.output_dir)
    : kaiPath("agent-output", "thumbnails");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Extract images from the response
  const message = response.choices?.[0]?.message;
  let idx = 0;

  // OpenRouter returns images in message.images[] array
  if (message?.images && Array.isArray(message.images)) {
    for (const img of message.images) {
      const url = img.image_url?.url || img.url;
      if (url) {
        const base64Match = url.match(/base64,(.+)/);
        if (base64Match) {
          const outPath = path.join(outDir, `${Date.now()}-${idx}.png`);
          fs.writeFileSync(outPath, Buffer.from(base64Match[1], "base64"));
          results.push(outPath);
          idx++;
        }
      }
    }
  }

  // Also check content for inline base64 data URLs or multi-part blocks
  const content = message?.content;
  if (results.length === 0 && typeof content === "string") {
    const dataUrlPattern = /data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/g;
    let match;
    while ((match = dataUrlPattern.exec(content)) !== null) {
      const outPath = path.join(outDir, `${Date.now()}-${idx}.png`);
      fs.writeFileSync(outPath, Buffer.from(match[1], "base64"));
      results.push(outPath);
      idx++;
    }
  } else if (results.length === 0 && Array.isArray(content)) {
    for (const part of content) {
      if (part.type === "image_url" && part.image_url?.url) {
        const base64Match = part.image_url.url.match(/base64,(.+)/);
        if (base64Match) {
          const outPath = path.join(outDir, `${Date.now()}-${idx}.png`);
          fs.writeFileSync(outPath, Buffer.from(base64Match[1], "base64"));
          results.push(outPath);
          idx++;
        }
      }
    }
  }

  return { images: results, prompt: args.prompt, model };
}

/**
 * Tool wrapper — returns string for the executor.
 */
export async function generateImageTool(args: {
  prompt: string;
  reference_image?: string;
  width?: number;
  height?: number;
  output_dir?: string;
}): Promise<string> {
  const result = await generateImage(args);
  return result.images.length > 0
    ? `Generated ${result.images.length} image(s):\n${result.images.join("\n")}`
    : "Image generation returned no images.";
}
