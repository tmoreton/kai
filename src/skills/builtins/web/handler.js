/**
 * Web Tools Skill Handler
 *
 * Ported from src/agents/integrations/web.ts
 */

const FETCH_TIMEOUT_MS = 15000;
const WEB_CONTENT_LIMIT = 50000;

let _config = {};

export default {
  install: async (config) => { _config = config; },

  actions: {
    fetch: async (params) => {
      const response = await fetch(params.url, {
        method: params.method || "GET",
        headers: params.headers || {},
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const text = await response.text();
      if (!response.ok) {
        return JSON.stringify({
          status: response.status,
          error: `HTTP ${response.status}: ${text.substring(0, 500)}`,
          content: text.substring(0, WEB_CONTENT_LIMIT),
          content_type: response.headers.get("content-type"),
        });
      }
      return JSON.stringify({
        status: response.status,
        content: text.substring(0, WEB_CONTENT_LIMIT),
        content_type: response.headers.get("content-type"),
      });
    },

    search: async (params) => {
      const apiKey = _config.tavily_api_key || process.env.TAVILY_API_KEY;
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

      if (!response.ok) throw new Error(`Tavily error: ${response.status}`);
      const data = await response.json();
      return JSON.stringify(data, null, 2);
    },
  },
};
