import { registerIntegration } from "../workflow.js";
import { WEB_CONTENT_LIMIT, FETCH_TIMEOUT_MS } from "../../constants.js";

/**
 * Web Integration (built-in)
 *
 * Fetch URLs and search the web via Tavily for workflow steps.
 */
export function registerWebIntegration(): void {
  registerIntegration({
    name: "web",
    description: "Fetch URLs and search the web",
    actions: {
      fetch: async (params) => {
        const response = await fetch(params.url, {
          method: params.method || "GET",
          headers: params.headers || {},
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        const text = await response.text();
        if (!response.ok) {
          return {
            status: response.status,
            error: `HTTP ${response.status}: ${text.substring(0, 500)}`,
            content: text.substring(0, WEB_CONTENT_LIMIT),
            content_type: response.headers.get("content-type"),
          };
        }
        return {
          status: response.status,
          content: text.substring(0, WEB_CONTENT_LIMIT),
          content_type: response.headers.get("content-type"),
        };
      },

      search: async (params, ctx) => {
        const apiKey =
          ctx.env.TAVILY_API_KEY || process.env.TAVILY_API_KEY;
        if (!apiKey) throw new Error("TAVILY_API_KEY not set");

        const response = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            query: params.query,
            max_results: params.max_results || 5,
            include_answer: true,
          }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!response.ok)
          throw new Error(`Tavily error: ${response.status}`);
        return response.json();
      },
    },
  });
}
