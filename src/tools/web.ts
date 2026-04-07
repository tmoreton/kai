import { WEB_CONTENT_LIMIT, FETCH_TIMEOUT_MS } from "../constants.js";
import { tryExecuteSkillTool } from "../skills/executor.js";
import { getConfig } from "../config.js";

/**
 * Web Search Tool
 *
 * Uses web-tools skill (Tavily) for web search.
 * Falls back to hardcoded implementation if skill not installed.
 */
export async function webSearch(args: {
  query: string;
  max_results?: number;
}): Promise<string> {
  // Try skill first
  const skillResult = await tryExecuteSkillTool("skill__web-tools__search", args);
  if (skillResult !== null && !skillResult.includes("not installed")) {
    return skillResult;
  }
  
  // Fallback to hardcoded Tavily
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return "Error: TAVILY_API_KEY not set. Add it to ~/.kai/.env or install web-tools skill";

  const config = getConfig();
  const tavilyUrl = "https://api.tavily.com/search";

  try {
    const response = await fetch(tavilyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: args.query,
        max_results: args.max_results || 5,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return `Tavily search error: HTTP ${response.status}`;
    }

    const data = (await response.json()) as {
      answer?: string;
      results?: Array<{ title: string; url: string; content: string }>;
    };

    let output = "";
    if (data.answer) {
      output += `**Answer:** ${data.answer}\n\n`;
    }
    if (data.results) {
      output += data.results
        .map(
          (r) =>
            `### ${r.title}\n${r.url}\n${r.content?.substring(0, 500) || ""}`
        )
        .join("\n\n");
    }
    return output || "No results found.";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error searching: ${msg}`;
  }
}

export async function webFetch(args: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
}): Promise<string> {
  try {
    const response = await fetch(args.url, {
      method: args.method || "GET",
      headers: args.headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      return `HTTP ${response.status} ${response.statusText}`;
    }

    const text = await response.text();

    if (contentType.includes("text/html")) {
      return htmlToText(text).substring(0, WEB_CONTENT_LIMIT);
    }

    return text.substring(0, WEB_CONTENT_LIMIT);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error fetching ${args.url}: ${msg}`;
  }
}

// Pre-compiled single-pass pattern for HTML stripping + entity decoding
const HTML_STRIP_PATTERN = /<[^>]*>|&amp;|&lt;|&gt;|&quot;|&#x27;|&nbsp;/g;
const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">",
  "&quot;": '"', "&#x27;": "'", "&nbsp;": " ",
};

function stripHtml(html: string): string {
  return html
    .replace(HTML_STRIP_PATTERN, (match) => ENTITY_MAP[match] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "");

  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li>/gi, "- ")
    .replace(/<\/li>/gi, "\n");

  text = stripHtml(text);
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return text;
}
