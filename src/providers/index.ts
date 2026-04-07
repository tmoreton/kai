import OpenAI from "openai";
import chalk from "chalk";
import { getConfig } from "../config.js";
import {
  DEFAULT_FIREWORKS_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_FIREWORKS_BASE_URL,
  DEFAULT_OPENROUTER_BASE_URL,
} from "../constants.js";

/**
 * Provider resolution.
 *
 * Kai uses a primary/fallback provider model:
 * - Primary: OpenRouter with Kimi K2.5 (OPENROUTER_API_KEY required)
 * - Optional: Fireworks with Kimi K2.5 Turbo (FIREWORKS_API_KEY) - takes precedence if set
 *
 * The config `model` field can override the model ID:
 *   "moonshotai/kimi-k2.5"  (OpenRouter default)
 *   "accounts/fireworks/routers/kimi-k2p5-turbo"  (Fireworks)
 */

export interface ResolvedProvider {
  client: OpenAI;
  model: string;
  providerName: string;
}

type ProviderName = "fireworks" | "openrouter";

/**
 * Get OpenRouter API key - required for Kai to function.
 * On first run, this will trigger onboarding.
 */
export function getOpenRouterKey(): string {
  const key = process.env.OPENROUTER_API_KEY || "";
  if (!key) {
    console.error(chalk.red("\n  Error: OPENROUTER_API_KEY is not set."));
    console.error(chalk.dim("  1. Get a free key at https://openrouter.ai/keys"));
    console.error(chalk.dim("  2. Add it to your ~/.kai/.env file:"));
    console.error(chalk.dim("     OPENROUTER_API_KEY=sk-or-...\n"));
    console.error(chalk.dim("  Kai requires OpenRouter to function.\n"));
    process.exit(1);
  }
  return key;
}

/**
 * Get Fireworks API key - optional, but takes precedence if present.
 */
function getFireworksKey(): string | null {
  return process.env.FIREWORKS_API_KEY || null;
}

/**
 * Build an OpenRouter provider using Kimi K2.5.
 */
function buildOpenRouterProvider(model?: string): ResolvedProvider {
  const config = getConfig();
  return {
    client: new OpenAI({
      apiKey: getOpenRouterKey(),
      baseURL: config.openrouterBaseUrl || DEFAULT_OPENROUTER_BASE_URL,
    }),
    model: model || config.model || DEFAULT_OPENROUTER_MODEL,
    providerName: "openrouter",
  };
}

/**
 * Build a Fireworks provider using Kimi K2.5 Turbo.
 */
function buildFireworksProvider(model?: string): ResolvedProvider {
  const config = getConfig();
  const key = getFireworksKey();
  if (!key) {
    throw new Error("FIREWORKS_API_KEY not set");
  }
  return {
    client: new OpenAI({
      apiKey: key,
      baseURL: config.fireworksBaseUrl || DEFAULT_FIREWORKS_BASE_URL,
    }),
    model: model || DEFAULT_FIREWORKS_MODEL,
    providerName: "fireworks",
  };
}

/**
 * Resolve the primary chat provider.
 *
 * Priority:
 * 1. If FIREWORKS_API_KEY is set, use Fireworks as primary (faster, cheaper)
 * 2. Otherwise, use OpenRouter as primary (always works with just OpenRouter key)
 *
 * OpenRouter is always available as fallback if Fireworks is unreachable.
 */
export function resolveProvider(): ResolvedProvider {
  const config = getConfig();

  // If user explicitly set a model in config, respect it
  if (config.model) {
    // Check if it looks like a Fireworks model path
    if (config.model.includes("fireworks") || config.model.includes("accounts/")) {
      const key = getFireworksKey();
      if (key) {
        return buildFireworksProvider(config.model);
      }
      // Fall through to OpenRouter if Fireworks key not available
    }
    // Otherwise treat as OpenRouter model
    return buildOpenRouterProvider(config.model);
  }

  // Default behavior: Fireworks takes precedence if key present
  const fireworksKey = getFireworksKey();
  if (fireworksKey) {
    return buildFireworksProvider();
  }

  // OpenRouter is the default/fallback
  return buildOpenRouterProvider();
}

/**
 * Resolve provider with automatic fallback.
 * If the primary provider is Fireworks, pings it first; on failure falls back
 * to OpenRouter with Kimi K2.5 (requires OPENROUTER_API_KEY).
 */
export async function resolveProviderWithFallback(): Promise<ResolvedProvider> {
  const primary = resolveProvider();

  // Only attempt fallback when the primary is Fireworks
  if (primary.providerName !== "fireworks") return primary;

  try {
    const res = await fetch(`${DEFAULT_FIREWORKS_BASE_URL}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${process.env.FIREWORKS_API_KEY || ""}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) return primary;
  } catch {
    // Network error or timeout — fall through
  }

  // Fireworks is down — fallback to OpenRouter
  console.error(chalk.yellow("  ⚠ Fireworks API is unreachable — falling back to OpenRouter (Kimi K2.5)\n"));
  return buildOpenRouterProvider();
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
