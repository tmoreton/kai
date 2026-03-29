import OpenAI from "openai";
import { getConfig } from "../config.js";

/**
 * Multi-provider support.
 *
 * All providers use the OpenAI-compatible API format.
 * Provider is selected by the `model` field in config or MODEL_ID env var.
 * Custom providers can be configured in settings.json under `providers`.
 */

export interface ProviderDefinition {
  name: string;
  baseURL: string;
  apiKeyEnv: string; // Environment variable for the API key
  models: string[];  // Known model IDs for this provider
  defaultModel: string;
  maxTokens?: number;
  contextWindow?: number;
}

// Built-in providers
const PROVIDERS: ProviderDefinition[] = [
  {
    name: "together",
    baseURL: "https://api.together.xyz/v1",
    apiKeyEnv: "TOGETHER_API_KEY",
    models: [
      "moonshotai/Kimi-K2.5",
      "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "Qwen/Qwen2.5-72B-Instruct-Turbo",
      "deepseek-ai/DeepSeek-R1",
      "deepseek-ai/DeepSeek-V3",
      "google/gemma-2-27b-it",
    ],
    defaultModel: "moonshotai/Kimi-K2.5",
    maxTokens: 16384,
    contextWindow: 128_000,
  },
  {
    name: "anthropic",
    baseURL: "https://api.anthropic.com/v1",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    models: [
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ],
    defaultModel: "claude-sonnet-4-6",
    maxTokens: 16384,
    contextWindow: 200_000,
  },
  {
    name: "openai",
    baseURL: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    models: [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4.1-nano",
      "o3",
      "o4-mini",
    ],
    defaultModel: "gpt-4o",
    maxTokens: 16384,
    contextWindow: 128_000,
  },
  {
    name: "ollama",
    baseURL: "http://localhost:11434/v1",
    apiKeyEnv: "OLLAMA_API_KEY", // Ollama doesn't need a key, but OpenAI SDK requires one
    models: [],  // Ollama models are dynamic
    defaultModel: "llama3.3",
    maxTokens: 8192,
    contextWindow: 128_000,
  },
];

export interface ResolvedProvider {
  client: OpenAI;
  model: string;
  provider: ProviderDefinition;
}

/**
 * Resolve which provider to use based on model name.
 * Checks config, env vars, and falls back to defaults.
 */
export function resolveProvider(modelOverride?: string): ResolvedProvider {
  const config = getConfig();
  const modelId = modelOverride || process.env.MODEL_ID || config.model;

  // If a model was specified, find which provider owns it
  if (modelId) {
    const provider = findProviderForModel(modelId);
    if (provider) {
      const apiKey = process.env[provider.apiKeyEnv] || (provider.name === "ollama" ? "ollama" : "");
      return {
        client: new OpenAI({ apiKey, baseURL: provider.baseURL }),
        model: modelId,
        provider,
      };
    }

    // Check custom providers from config
    const customProviders = (config as any).providers as ProviderDefinition[] | undefined;
    if (customProviders) {
      for (const cp of customProviders) {
        if (cp.models?.includes(modelId) || cp.name === modelId) {
          const apiKey = process.env[cp.apiKeyEnv] || "";
          return {
            client: new OpenAI({ apiKey, baseURL: cp.baseURL }),
            model: modelId,
            provider: cp,
          };
        }
      }
    }

    // Unknown model — try together as a passthrough (they host many models)
    const together = PROVIDERS.find((p) => p.name === "together")!;
    const apiKey = process.env[together.apiKeyEnv] || "";
    return {
      client: new OpenAI({ apiKey, baseURL: together.baseURL }),
      model: modelId,
      provider: together,
    };
  }

  // No model specified — find first provider with an API key set
  for (const provider of PROVIDERS) {
    const apiKey = process.env[provider.apiKeyEnv];
    if (apiKey || provider.name === "ollama") {
      return {
        client: new OpenAI({
          apiKey: apiKey || "ollama",
          baseURL: provider.baseURL,
        }),
        model: provider.defaultModel,
        provider,
      };
    }
  }

  // Fallback to together (will fail at API call time if no key)
  const fallback = PROVIDERS[0];
  return {
    client: new OpenAI({
      apiKey: process.env[fallback.apiKeyEnv] || "",
      baseURL: fallback.baseURL,
    }),
    model: fallback.defaultModel,
    provider: fallback,
  };
}

function findProviderForModel(modelId: string): ProviderDefinition | undefined {
  // Exact match
  for (const provider of PROVIDERS) {
    if (provider.models.includes(modelId)) return provider;
  }

  // Prefix match (e.g., "claude-" → anthropic, "gpt-" → openai)
  const prefixMap: Record<string, string> = {
    "claude-": "anthropic",
    "gpt-": "openai",
    "o3": "openai",
    "o4": "openai",
    "llama": "ollama", // Local llama models
  };

  for (const [prefix, providerName] of Object.entries(prefixMap)) {
    if (modelId.startsWith(prefix)) {
      return PROVIDERS.find((p) => p.name === providerName);
    }
  }

  return undefined;
}

/**
 * Get the list of all known providers and their models.
 */
export function listProviders(): ProviderDefinition[] {
  return PROVIDERS;
}

/**
 * Get active provider name for display.
 */
export function getActiveProviderName(): string {
  const resolved = resolveProvider();
  return `${resolved.provider.name}/${resolved.model}`;
}
