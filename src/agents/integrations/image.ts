/**
 * ⚠️ DEPRECATED: This integration system is deprecated and will be removed in a future version.
 *
 * MIGRATION GUIDE:
 * The new Skill system should be used instead of direct integrations. Skills provide:
 * - Better type safety and validation
 * - More flexible configuration
 * - Easier testing and mocking
 * - Standardized manifest-based approach
 *
 * To migrate from image_gen integration to skills:
 * 1. Use the built-in image generation via direct tool imports (import { generateImage } from "../tools/image.js")
 * 2. Or create a skill that wraps the image generation functionality
 * 3. Use `type: skill` and `skill: your-skill` in workflows instead of `type: integration` and `integration: image_gen`
 *
 * For more information, see the skills/ directory for built-in skill examples.
 *
 * @deprecated Use the skill system instead
 */

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
          negative_prompt: params.negative_prompt,
        });
      },
    },
  });
}
