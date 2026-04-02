import OpenAI from "openai";
import chalk from "chalk";
import { getConfig } from "../config.js";
import {
  DEFAULT_FIREWORKS_MODEL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_FIREWORKS_BASE_URL,
  DEFAULT_OPENROUTER_BASE_URL,
} from "../constants.js";

/**
 * Provider resolution.
 *
 * The config `model` field supports:
 *   "fireworks:accounts/fireworks/routers/kimi-k2p5-turbo"
 *   "openrouter:moonshotai/kimi-k2.5"
 *   "accounts/fireworks/routers/kimi-k2p5-turbo"  (no prefix → fireworks)
 */

export interface ResolvedProvider {
  client: OpenAI;
  model: string;
  providerName: string;
}

type ProviderName = "fireworks" | "openrouter";

/**
 * Parse a "provider:model" string. If no prefix, defaults to fireworks.
 */
function parseModelSpec(spec: string): { provider: ProviderName; model: string } {
  const colonIdx = spec.indexOf(":");
  if (colonIdx > 0) {
    const prefix = spec.substring(0, colonIdx).toLowerCase();
    const model = spec.substring(colonIdx + 1);
    if (prefix === "openrouter" || prefix === "fireworks") {
      return { provider: prefix, model };
    }
  }
  // No recognized prefix — default to fireworks
  return { provider: "fireworks", model: spec };
}

function getFireworksKey(): string {
  const key = process.env.FIREWORKS_API_KEY || "";
  if (!key) {
    console.error(chalk.red("\n  Error: FIREWORKS_API_KEY is not set."));
    console.error(chalk.dim("  1. Get a key at https://fireworks.ai"));
    console.error(chalk.dim("  2. Add it to your .env file: FIREWORKS_API_KEY=fw_...\n"));
    process.exit(1);
  }
  return key;
}

function getOpenRouterKey(): string {
  const key = process.env.OPENROUTER_API_KEY || "";
  if (!key) {
    console.error(chalk.red("\n  Error: OPENROUTER_API_KEY is not set."));
    console.error(chalk.dim("  Add it to your .env file: OPENROUTER_API_KEY=sk-or-...\n"));
    process.exit(1);
  }
  return key;
}

/**
 * Resolve the primary chat provider based on config.
 */
export function resolveProvider(): ResolvedProvider {
  const config = getConfig();
  const modelSpec = config.model || `fireworks:${DEFAULT_FIREWORKS_MODEL}`;
  const { provider, model } = parseModelSpec(modelSpec);

  if (provider === "openrouter") {
    return {
      client: new OpenAI({
        apiKey: getOpenRouterKey(),
        baseURL: config.openrouterBaseUrl || DEFAULT_OPENROUTER_BASE_URL,
      }),
      model,
      providerName: "openrouter",
    };
  }

  // Default: fireworks
  return {
    client: new OpenAI({
      apiKey: getFireworksKey(),
      baseURL: config.fireworksBaseUrl || DEFAULT_FIREWORKS_BASE_URL,
    }),
    model,
    providerName: "fireworks",
  };
}

/**
 * Get the image generation model ID (via OpenRouter).
 */
export function getImageModel(): string {
  const config = getConfig();
  return config.imageModel || DEFAULT_IMAGE_MODEL;
}

/**
 * Create an OpenRouter client for image generation.
 */
export function createImageClient(): OpenAI {
  const config = getConfig();
  return new OpenAI({
    apiKey: getOpenRouterKey(),
    baseURL: config.openrouterBaseUrl || DEFAULT_OPENROUTER_BASE_URL,
  });
}

/**
 * Resolve a vision-capable provider for image analysis.
 * Always uses the same provider/model as the main chat (all models are multimodal).
 */
export function resolveVisionProvider(): { client: OpenAI; model: string } {
  const resolved = resolveProvider();
  return { client: resolved.client, model: resolved.model };
}
