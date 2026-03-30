import { registerIntegration } from "../workflow.js";
import { generateImage } from "../../tools/image.js";

/**
 * Image Generation Integration (built-in)
 *
 * Wraps tools/image.ts for use in workflow steps.
 */
export function registerImageIntegration(): void {
  registerIntegration({
    name: "image_gen",
    description: "Generate images using OpenRouter (Nano Banana)",
    actions: {
      generate: async (params) => {
        return generateImage({
          prompt: params.prompt,
          reference_image: params.reference_image,
          model: params.model,
          width: params.width,
          height: params.height,
          output_dir: params.output_dir,
          count: params.count,
          steps: params.steps,
          negative_prompt: params.negative_prompt,
          seed: params.seed,
        });
      },
    },
  });
}
