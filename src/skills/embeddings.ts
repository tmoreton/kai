/**
 * Vector-based tool selection using OpenRouter embeddings.
 *
 * Pre-computes embeddings for all tools at startup, then uses
 * cosine similarity to match user queries to relevant tools.
 *
 * Hybrid approach:
 * 1. Fast keyword regex filter (existing)
 * 2. Semantic fallback if keywords return < 5 results
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { getConfig } from "../config.js";
import { DEFAULT_OPENROUTER_BASE_URL } from "../constants.js";

// Embedding cache
interface ToolEmbedding {
  name: string;
  description: string;
  embedding: number[];
}

const toolEmbeddings = new Map<string, ToolEmbedding>();
let embeddingModel = "openai/text-embedding-3-small"; // Cheap, good quality

/**
 * Generate embeddings for text using OpenRouter.
 */
export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not set for embeddings");
  }

  const response = await fetch(
    (getConfig().openrouterBaseUrl || DEFAULT_OPENROUTER_BASE_URL) + "/embeddings",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: embeddingModel,
        input: text,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding API error: ${response.status} ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Batch embed multiple texts.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not set for embeddings");
  }

  const response = await fetch(
    (getConfig().openrouterBaseUrl || DEFAULT_OPENROUTER_BASE_URL) + "/embeddings",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: embeddingModel,
        input: texts,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding API error: ${response.status} ${error}`);
  }

  const data = await response.json();
  return data.data.map((d: any) => d.embedding);
}

/**
 * Initialize embeddings for all tools.
 * Call this after skills are loaded.
 */
export async function initToolEmbeddings(tools: ChatCompletionTool[]): Promise<void> {
  if (toolEmbeddings.size > 0) return; // Already initialized

  try {
    // Build list of tool descriptions
    const toolList = tools
      .filter((t): t is ChatCompletionTool & { type: "function" } => t.type === "function")
      .map((t) => ({
        name: t.function.name,
        description: t.function.description || "",
      }))
      .filter((t) => t.description); // Skip tools without descriptions

    if (toolList.length === 0) return;

    // Batch embed all tool descriptions
    const descriptions = toolList.map((t) => t.description);
    const embeddings = await embedBatch(descriptions);

    // Cache embeddings
    toolList.forEach((tool, i) => {
      toolEmbeddings.set(tool.name, {
        name: tool.name,
        description: tool.description,
        embedding: embeddings[i],
      });
    });

    console.log(`  📊 Embedded ${toolEmbeddings.size} tools for semantic search`);
  } catch (err) {
    // Fail silently - keyword search still works
    console.log("  ⚠️  Semantic search unavailable (embeddings failed)");
  }
}

/**
 * Calculate cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Find tools semantically similar to the query.
 * Returns top-K tools sorted by similarity.
 */
export async function findToolsBySemanticSimilarity(
  query: string,
  topK: number = 15,
  minScore: number = 0.65
): Promise<{ tool: string; score: number }[]> {
  if (toolEmbeddings.size === 0) return [];

  try {
    const queryEmbedding = await embedText(query);

    // Score all tools
    const scores: { tool: string; score: number }[] = [];
    for (const [name, data] of toolEmbeddings) {
      const similarity = cosineSimilarity(queryEmbedding, data.embedding);
      if (similarity >= minScore) {
        scores.push({ tool: name, score: similarity });
      }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  } catch {
    return [];
  }
}

/**
 * Get cached embedding for a tool (for debugging).
 */
export function getToolEmbedding(name: string): ToolEmbedding | undefined {
  return toolEmbeddings.get(name);
}

/**
 * Clear embedding cache (useful for testing).
 */
export function clearToolEmbeddings(): void {
  toolEmbeddings.clear();
}
