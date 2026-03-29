import { registerIntegration, type WorkflowContext } from "../workflow.js";

/**
 * Web Integration — fetch URLs, search the web, scrape content.
 * Uses Tavily for search if TAVILY_API_KEY is set.
 */

export function registerWebIntegration(): void {
  registerIntegration({
    name: "web",
    description: "Fetch URLs, search the web, scrape content",
    actions: {
      fetch: async (params) => {
        const response = await fetch(params.url, {
          method: params.method || "GET",
          headers: params.headers || {},
          signal: AbortSignal.timeout(15000),
        });
        const text = await response.text();
        return {
          status: response.status,
          content: text.substring(0, 50000),
          content_type: response.headers.get("content-type"),
        };
      },

      search: async (params, ctx) => {
        const apiKey = ctx.env.TAVILY_API_KEY;
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
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) throw new Error(`Tavily error: ${response.status}`);
        return response.json();
      },
    },
  });
}
