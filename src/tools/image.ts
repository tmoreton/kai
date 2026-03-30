import fs from "fs";
import path from "path";
import { resolveProvider, getImageModel } from "../providers/index.js";

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
  count?: number;
  steps?: number;
  negative_prompt?: string;
  seed?: number;
}

export interface GenerateImageResult {
  images: string[];
  prompt: string;
  model: string;
}

export async function generateImage(
  args: GenerateImageArgs
): Promise<GenerateImageResult> {
  const { client } = resolveProvider();
  const model = args.model || getImageModel();

  const fullPrompt = args.negative_prompt
    ? `${args.prompt}\n\nAvoid: ${args.negative_prompt}`
    : args.prompt;

  // Retry up to 3 times with backoff
  let response: any;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        const delay = 5000 * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
      response = await client.chat.completions.create({
        model,
        messages: [
          { role: "user", content: fullPrompt },
        ],
        // @ts-ignore — OpenRouter extension for image generation
        modalities: ["image", "text"],
        max_tokens: 2048,
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
  const outDir = (args.output_dir || "~/.kai/agent-output/thumbnails").replace(
    "~",
    process.env.HOME || "~"
  );
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
