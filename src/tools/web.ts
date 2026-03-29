export async function webFetch(args: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
}): Promise<string> {
  try {
    const response = await fetch(args.url, {
      method: args.method || "GET",
      headers: args.headers,
      signal: AbortSignal.timeout(15000),
    });

    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      return `HTTP ${response.status} ${response.statusText}`;
    }

    const text = await response.text();

    if (contentType.includes("text/html")) {
      return htmlToText(text).substring(0, 50000);
    }

    return text.substring(0, 50000);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error fetching ${args.url}: ${msg}`;
  }
}

export async function webSearch(args: {
  query: string;
  count?: number;
}): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return "Error: TAVILY_API_KEY not set in .env";
  }

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: args.query,
        max_results: args.count || 5,
        include_answer: true,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errText = await response.text();
      return `Tavily API error (${response.status}): ${errText}`;
    }

    const data = (await response.json()) as {
      answer?: string;
      results?: Array<{
        title: string;
        url: string;
        content: string;
        score: number;
      }>;
    };

    const parts: string[] = [];

    // Include Tavily's AI-generated answer if available
    if (data.answer) {
      parts.push(`**Answer:** ${data.answer}\n`);
    }

    // Format search results
    if (data.results && data.results.length > 0) {
      parts.push("**Sources:**\n");
      for (let i = 0; i < data.results.length; i++) {
        const r = data.results[i];
        parts.push(
          `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.content.substring(0, 300)}`
        );
      }
    }

    return parts.length > 0
      ? parts.join("\n\n")
      : "No search results found.";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Search error: ${msg}`;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
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
