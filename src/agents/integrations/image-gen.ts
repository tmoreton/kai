import fs from "fs";
import path from "path";
import { registerIntegration, type WorkflowContext } from "../workflow.js";

/**
 * Image Generation Integration
 * Uses Together.ai FLUX/Imagen/Seedream models.
 */

export function registerImageGenIntegration(): void {
  registerIntegration({
    name: "image_gen",
    description: "Generate images using Together.ai (FLUX, Imagen, Seedream, etc.)",
    actions: {
      generate: async (params, ctx) => {
        const apiKey = ctx.env.TOGETHER_API_KEY;
        if (!apiKey) throw new Error("TOGETHER_API_KEY not set");

        const model = params.model || "black-forest-labs/FLUX.1-schnell";

        const body: Record<string, any> = {
          model,
          prompt: params.prompt,
          width: params.width || 1280,
          height: params.height || 720,
          n: params.count || 1,
          steps: params.steps || 4,
          response_format: "url",
        };

        if (params.negative_prompt) body.negative_prompt = params.negative_prompt;
        if (params.seed) body.seed = params.seed;

        const response = await fetch("https://api.together.xyz/v1/images/generations", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120000),
        });

        if (!response.ok) {
          const err = await response.text();
          throw new Error(`Image gen failed (${response.status}): ${err}`);
        }

        const data = (await response.json()) as {
          data: Array<{ url?: string; b64_json?: string; index: number }>;
        };

        // Download and save images if output_dir provided
        const results: string[] = [];
        const outDir = params.output_dir?.replace("~", process.env.HOME || "~") || "/tmp/kai-images";
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

        for (let i = 0; i < (data.data?.length || 0); i++) {
          const img = data.data[i];
          if (img.url) {
            // Download the image
            try {
              const imgResponse = await fetch(img.url, { signal: AbortSignal.timeout(30000) });
              const buffer = Buffer.from(await imgResponse.arrayBuffer());
              const outPath = path.join(outDir, `${Date.now()}-${i}.png`);
              fs.writeFileSync(outPath, buffer);
              results.push(outPath);
            } catch {
              results.push(img.url); // Fallback to URL if download fails
            }
          } else if (img.b64_json) {
            const outPath = path.join(outDir, `${Date.now()}-${i}.png`);
            fs.writeFileSync(outPath, Buffer.from(img.b64_json, "base64"));
            results.push(outPath);
          }
        }

        return {
          images: results,
          prompt: params.prompt,
          model,
        };
      },

      batch: async (params, ctx) => {
        const prompts = params.prompts as string[];
        if (!Array.isArray(prompts)) throw new Error("'prompts' must be an array");

        const handler = (await import("../workflow.js")).getIntegration("image_gen");
        if (!handler) throw new Error("image_gen integration not found");

        const results: any[] = [];
        for (const prompt of prompts) {
          const result = await handler.actions.generate({ ...params, prompt }, ctx);
          results.push(result);
        }
        return results;
      },
    },
  });
}
