import fs from "fs";
import path from "path";
import OpenAI from "openai";

/**
 * Image Generation Tool
 * Uses Google Gemini 3 Pro Image via Together.ai.
 * Supports reference images for character consistency.
 */

async function refinePromptForImageGen(userPrompt: string, hasReference: boolean): Promise<string> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) return userPrompt;

  try {
    const client = new OpenAI({ apiKey, baseURL: "https://api.together.xyz/v1" });

    const refContext = hasReference
      ? "A reference photo of the person is being provided. Describe the person's placement and pose in the scene — the model will match their appearance from the reference photo. Say something like 'the person from the reference photo sitting at...' or 'a man resembling the reference photo standing next to...'"
      : "No reference photo provided. Describe any people generically or omit them.";

    const response = await client.chat.completions.create({
      model: process.env.MODEL_ID || "moonshotai/Kimi-K2.5",
      messages: [
        {
          role: "system",
          content: `You are an expert image prompt writer for Google Gemini 3 Pro image generation.
Rewrite the user's description as an optimal image generation prompt.

${refContext}

Rules:
- Describe the VISUAL SCENE in detail (lighting, composition, colors, mood, setting)
- Be specific about what's in the frame and where
- Include: camera angle, lighting style, color palette, artistic style
- Keep it under 150 words
- Return ONLY the prompt text, nothing else`,
        },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 250,
    });

    const refined = response.choices[0]?.message?.content
      || (response.choices[0]?.message as any)?.reasoning
      || "";

    return refined.trim() || userPrompt;
  } catch {
    return userPrompt;
  }
}

export async function generateImage(args: {
  prompt: string;
  output_path?: string;
  reference_image?: string; // Path to a reference photo (e.g., portrait)
}): Promise<string> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    return "Error: TOGETHER_API_KEY not set. Add it to ~/.kai/.env";
  }

  const model = "google/gemini-3-pro-image";

  // Handle reference image — convert to base64 data URL
  let referenceDataUrl: string | undefined;
  if (args.reference_image) {
    const refPath = args.reference_image.replace(/^~/, process.env.HOME || "~");
    if (!fs.existsSync(refPath)) {
      return `Error: Reference image not found: ${refPath}`;
    }
    const ext = path.extname(refPath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".png": "image/png", ".webp": "image/webp",
    };
    const mime = mimeMap[ext] || "image/jpeg";
    const b64 = fs.readFileSync(refPath).toString("base64");
    referenceDataUrl = `data:${mime};base64,${b64}`;
  }

  const hasRef = !!referenceDataUrl;
  const refinedPrompt = await refinePromptForImageGen(args.prompt, hasRef);

  const body: Record<string, unknown> = {
    model,
    prompt: refinedPrompt,
    width: 1264,
    height: 848,
    response_format: "b64_json",
  };

  // Add reference image if provided
  if (referenceDataUrl) {
    body.reference_images = [referenceDataUrl];
  }

  try {
    const response = await fetch("https://api.together.xyz/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const err = await response.text();
      return `Error: Image generation failed (${response.status}): ${err}`;
    }

    const data = (await response.json()) as {
      data: Array<{ url?: string; b64_json?: string }>;
    };

    const img = data.data?.[0];
    if (!img) return "Error: No image returned from API";

    let outPath: string;
    if (args.output_path) {
      outPath = args.output_path.replace(/^~/, process.env.HOME || "~");
      if (outPath.endsWith("/") || (fs.existsSync(outPath) && fs.statSync(outPath).isDirectory())) {
        if (!fs.existsSync(outPath)) fs.mkdirSync(outPath, { recursive: true });
        outPath = path.join(outPath, `kai-${Date.now()}.png`);
      }
    } else {
      const outDir = "/tmp/kai-images";
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      outPath = path.join(outDir, `kai-${Date.now()}.png`);
    }

    const parentDir = path.dirname(outPath);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

    if (img.b64_json) {
      fs.writeFileSync(outPath, Buffer.from(img.b64_json, "base64"));
    } else if (img.url) {
      const imgResponse = await fetch(img.url, { signal: AbortSignal.timeout(30_000) });
      const buffer = Buffer.from(await imgResponse.arrayBuffer());
      fs.writeFileSync(outPath, buffer);
    } else {
      return "Error: API returned no image data";
    }

    const sizeKB = Math.round(fs.statSync(outPath).size / 1024);
    return `Image generated and saved to: ${outPath} (${sizeKB} KB, 1264x848)${hasRef ? "\nReference image used for character consistency" : ""}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error generating image: ${msg}`;
  }
}

/**
 * Composite images together using ImageMagick.
 */
export async function compositeImage(args: {
  background: string;
  overlay: string;
  output_path?: string;
  position?: string;
  overlay_width?: number;
}): Promise<string> {
  const { execSync } = await import("child_process");

  const bg = args.background.replace(/^~/, process.env.HOME || "~");
  const overlay = args.overlay.replace(/^~/, process.env.HOME || "~");

  if (!fs.existsSync(bg)) return `Error: Background image not found: ${bg}`;
  if (!fs.existsSync(overlay)) return `Error: Overlay image not found: ${overlay}`;

  try { execSync("which magick", { stdio: "pipe" }); } catch {
    return "Error: ImageMagick not installed. Run: brew install imagemagick";
  }

  const outDir = "/tmp/kai-images";
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = args.output_path?.replace(/^~/, process.env.HOME || "~")
    || path.join(outDir, `composite-${Date.now()}.jpg`);

  const parentDir = path.dirname(outPath);
  if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

  const position = args.position || "right";
  const overlayPct = args.overlay_width || 40;

  try {
    const bgInfo = execSync(`magick identify -format "%wx%h" "${bg}"`, { encoding: "utf-8" }).trim();
    const [bgW, bgH] = bgInfo.split("x").map(Number);
    const overlayW = Math.round(bgW * (overlayPct / 100));
    const gravity = position === "left" ? "West" : position === "center" ? "Center" : "East";

    execSync(
      `magick "${bg}" \\( "${overlay}" -resize ${overlayW}x${bgH}^ -gravity Center -extent ${overlayW}x${bgH} \\) -gravity ${gravity} -composite "${outPath}"`,
      { timeout: 30000 }
    );

    const sizeKB = Math.round(fs.statSync(outPath).size / 1024);
    return `Composite image saved to: ${outPath} (${sizeKB} KB)`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error compositing images: ${msg}`;
  }
}
