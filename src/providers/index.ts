import OpenAI from "openai";
import chalk from "chalk";
import { FIREWORKS_MODEL } from "../constants.js";

/**
 * Two providers:
 *  - Fireworks: Kimi K2.5 Turbo for all chat/completions
 *  - OpenRouter: image generation only (Gemini 2.5 Flash Image)
 */

export interface ResolvedProvider {
  client: OpenAI;
  model: string;
  providerName: string;
}

/**
 * Resolve the Fireworks provider for chat.
 * Single model — no overrides, no selector.
 */
export function resolveProvider(): ResolvedProvider {
  const apiKey = process.env.FIREWORKS_API_KEY || "";

  if (!apiKey) {
    console.error(chalk.red("\n  Error: FIREWORKS_API_KEY is not set."));
    console.error(chalk.dim("  1. Get a key at https://fireworks.ai"));
    console.error(chalk.dim("  2. Add it to your .env file: FIREWORKS_API_KEY=fw_...\n"));
    process.exit(1);
  }

  return {
    client: new OpenAI({
      apiKey,
      baseURL: "https://api.fireworks.ai/inference/v1",
    }),
    model: FIREWORKS_MODEL,
    providerName: "fireworks",
  };
}

/**
 * Get the image generation model ID (via OpenRouter).
 */
export function getImageModel(): string {
  return "google/gemini-2.5-flash-image";
}

/**
 * Create an OpenRouter client for image generation.
 */
export function createImageClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY || "";
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set — needed for image generation.");
  }
  return new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" });
}
