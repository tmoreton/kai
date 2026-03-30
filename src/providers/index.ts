import OpenAI from "openai";
import chalk from "chalk";
import { getConfig } from "../config.js";

/**
 * OpenRouter-only provider.
 *
 * All models are accessed via OpenRouter's OpenAI-compatible API.
 * Primary: Kimi K2.5, Fallback: Qwen3 235B, Image: Nano Banana (Gemini 2.5 Flash Image)
 */

export interface ProviderDefinition {
  name: string;
  baseURL: string;
  apiKeyEnv: string;
  models: string[];
  defaultModel: string;
  fallbackModel?: string;
  imageModel?: string;
  maxTokens?: number;
  contextWindow?: number;
}

export const OPENROUTER_PROVIDER: ProviderDefinition = {
  name: "openrouter",
  baseURL: "https://openrouter.ai/api/v1",
  apiKeyEnv: "OPENROUTER_API_KEY",
  models: [
    "qwen/qwen3.5-397b-a17b",
    "moonshotai/kimi-k2.5",
    "qwen/qwen3-235b-a22b",
    "google/gemini-2.5-flash-image",
  ],
  defaultModel: "moonshotai/kimi-k2.5",
  fallbackModel: "qwen/qwen3.5-397b-a17b",
  imageModel: "google/gemini-2.5-flash-image",
  maxTokens: 16384,
  contextWindow: 128_000,
};

export interface ResolvedProvider {
  client: OpenAI;
  model: string;
  provider: ProviderDefinition;
}

/**
 * Resolve the OpenRouter provider.
 * Model can be overridden via param, MODEL_ID env, or config.
 */
export function resolveProvider(modelOverride?: string): ResolvedProvider {
  const config = getConfig();
  // settings.json takes priority over env var so /model set and web UI picker work
  const modelId = modelOverride || config.model || process.env.MODEL_ID || OPENROUTER_PROVIDER.defaultModel;
  const apiKey = process.env[OPENROUTER_PROVIDER.apiKeyEnv] || "";

  if (!apiKey) {
    console.error(chalk.red("\n  Error: OPENROUTER_API_KEY is not set."));
    console.error(chalk.dim("  1. Get a key at https://openrouter.ai/settings/keys"));
    console.error(chalk.dim("  2. Add it to your .env file: OPENROUTER_API_KEY=sk-or-v1-..."));
    console.error(chalk.dim("  3. Or copy .env.example to .env and fill in your key\n"));
    process.exit(1);
  }

  return {
    client: new OpenAI({ apiKey, baseURL: OPENROUTER_PROVIDER.baseURL }),
    model: modelId,
    provider: OPENROUTER_PROVIDER,
  };
}

/**
 * Get the fallback model ID.
 */
export function getFallbackModel(): string {
  return OPENROUTER_PROVIDER.fallbackModel!;
}

/**
 * Get the image generation model ID.
 */
export function getImageModel(): string {
  return OPENROUTER_PROVIDER.imageModel!;
}
