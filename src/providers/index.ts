import OpenAI from "openai";
import { getConfig, type ProviderConfig } from "../config.js";

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

const OPENROUTER_PROVIDER: ProviderDefinition = {
  name: "openrouter",
  baseURL: "https://openrouter.ai/api/v1",
  apiKeyEnv: "OPENROUTER_API_KEY",
  models: [
    "moonshotai/kimi-k2.5",
    "qwen/qwen3-235b-a22b",
    "google/gemini-2.5-flash-image",
  ],
  defaultModel: "moonshotai/kimi-k2.5",
  fallbackModel: "qwen/qwen3-235b-a22b",
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
  const modelId = modelOverride || process.env.MODEL_ID || config.model || OPENROUTER_PROVIDER.defaultModel;
  const apiKey = process.env[OPENROUTER_PROVIDER.apiKeyEnv] || "";

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

/**
 * Get the list of all known providers and their models.
 */
export function listProviders(): ProviderDefinition[] {
  return [OPENROUTER_PROVIDER];
}

/**
 * Get active provider name for display.
 */
export function getActiveProviderName(): string {
  const resolved = resolveProvider();
  return `${resolved.provider.name}/${resolved.model}`;
}
