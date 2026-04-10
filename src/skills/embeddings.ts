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

import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { getConfig } from "../config.js";
import { DEFAULT_OPENROUTER_BASE_URL } from "../constants.js";
import { ensureKaiDir } from "../config.js";
import { RICH_TOOL_DESCRIPTIONS } from "../tools/tool-descriptions.js";
import { getLoadedSkills, skillToolName } from "./loader.js";

// Embedding cache
interface ToolEmbedding {
  name: string;
  description: string;
  embedding: number[];
}

interface EmbeddingCache {
  hash: string;
  model: string;
  embeddings: Record<string, ToolEmbedding>;
  createdAt: string;
}

const toolEmbeddings = new Map<string, ToolEmbedding>();
let embeddingModel = "openai/text-embedding-3-small";

function getCachePath(): string {
  return path.join(ensureKaiDir(), "embeddings-cache.json");
}

function computeToolsHash(tools: ChatCompletionTool[]): string {
  const descriptions = tools
    .filter((t): t is ChatCompletionTool & { type: "function" } => t.type === "function")
    .map((t) => t.function.name + ":" + (RICH_TOOL_DESCRIPTIONS[t.function.name] || t.function.description || ""))
    .sort()
    .join("\n");
  return crypto.createHash("md5").update(descriptions).digest("hex");
}

function loadCachedEmbeddings(tools: ChatCompletionTool[]): boolean {
  try {
    const cachePath = getCachePath();
    if (!fs.existsSync(cachePath)) return false;

    const cache: EmbeddingCache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    const currentHash = computeToolsHash(tools);

    if (cache.hash !== currentHash || cache.model !== embeddingModel) {
      console.log("  🔄 Tool descriptions changed, re-embedding...");
      return false;
    }

    // Load from cache
    for (const [name, data] of Object.entries(cache.embeddings)) {
      toolEmbeddings.set(name, data);
    }

    console.log(`  💾 Loaded ${toolEmbeddings.size} cached embeddings`);
    return true;
  } catch {
    return false;
  }
}

function saveCachedEmbeddings(tools: ChatCompletionTool[]): void {
  try {
    const cache: EmbeddingCache = {
      hash: computeToolsHash(tools),
      model: embeddingModel,
      embeddings: Object.fromEntries(toolEmbeddings),
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(getCachePath(), JSON.stringify(cache), "utf-8");
  } catch {
    // Silent fail - not critical
  }
}

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
 * Build embedding text for a tool.
 * Uses rich descriptions for built-in tools, FULL original descriptions for skills.
 * This is separate from the truncated descriptions sent to the LLM.
 */
function buildEmbeddingText(tool: ChatCompletionTool): string {
  if (tool.type !== "function") return "";
  const fn = tool.function;
  const name = fn.name;
  
  // Use rich description for built-in tools (better semantic matching)
  if (RICH_TOOL_DESCRIPTIONS[name]) {
    return RICH_TOOL_DESCRIPTIONS[name];
  }
  
  // For skills: get the FULL original description from the manifest
  // (not the truncated version sent to LLM)
  const parts = name.split("__");
  if (parts.length >= 3 && parts[0] === "skill") {
    const skillId = parts[1];
    const toolName = parts[2];
    
    // Look up the original skill manifest for full description
    const skill = getLoadedSkills().find(s => s.manifest.id === skillId);
    if (skill) {
      const originalTool = skill.manifest.tools.find(t => t.name === toolName);
      if (originalTool) {
        // Use full original description + domain context for better matching
        // Include skill name and full original description for rich semantic matching
        return `${skill.manifest.name} ${toolName}: ${originalTool.description}`;
      }
    }
    
    // Fallback to truncated description with domain context
    const domain = skillId;
    const action = toolName;
    const desc = fn.description || "";
    return `${domain} ${action}: ${desc}`;
  }
  
  return fn.description || "";
}

/**
 * Initialize embeddings for all tools.
 * Uses disk cache if available and tools haven't changed.
 */
export async function initToolEmbeddings(tools: ChatCompletionTool[]): Promise<void> {
  if (toolEmbeddings.size > 0) return; // Already initialized

  // Try loading from disk cache first
  if (loadCachedEmbeddings(tools)) {
    return;
  }

  try {
    // Build list of tool descriptions with rich text
    const toolList = tools
      .filter((t): t is ChatCompletionTool & { type: "function" } => t.type === "function")
      .map((t) => ({
        name: t.function.name,
        description: buildEmbeddingText(t),
      }))
      .filter((t) => t.description); // Skip tools without descriptions

    if (toolList.length === 0) return;

    // Batch embed all tool descriptions
    const descriptions = toolList.map((t) => t.description);
    const embeddings = await embedBatch(descriptions);

    // Cache in memory
    toolList.forEach((tool, i) => {
      toolEmbeddings.set(tool.name, {
        name: tool.name,
        description: tool.description,
        embedding: embeddings[i],
      });
    });

    // Save to disk cache
    saveCachedEmbeddings(tools);

    console.log(`  📊 Embedded ${toolEmbeddings.size} tools (API call)`);
  } catch (err) {
    console.log("  ⚠️  Semantic search unavailable (embeddings failed)");
  }
}

/**
 * Calculate cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
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
