import chalk from "chalk";

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

    // If HTML, do basic extraction
    if (contentType.includes("text/html")) {
      return htmlToText(text).substring(0, 50000);
    }

    return text.substring(0, 50000);
  } catch (err: any) {
    return `Error fetching ${args.url}: ${err.message}`;
  }
}

export async function webSearch(args: {
  query: string;
  count?: number;
}): Promise<string> {
  // Use DuckDuckGo HTML search as a free fallback
  try {
    const encoded = encodeURIComponent(args.query);
    const url = `https://html.duckduckgo.com/html/?q=${encoded}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(10000),
    });

    const html = await response.text();

    // Extract result links and snippets
    const results: string[] = [];
    const resultRegex =
      /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRegex =
      /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    let match;
    const links: string[] = [];
    const titles: string[] = [];
    const snippets: string[] = [];

    while ((match = resultRegex.exec(html)) !== null) {
      links.push(decodeURIComponent(match[1].replace(/.*uddg=/, "").replace(/&.*/, "")));
      titles.push(stripHtml(match[2]));
    }

    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push(stripHtml(match[1]));
    }

    const count = Math.min(args.count || 5, links.length);
    for (let i = 0; i < count; i++) {
      results.push(
        `${i + 1}. ${titles[i] || "No title"}\n   ${links[i] || ""}\n   ${snippets[i] || ""}`
      );
    }

    return results.length > 0
      ? results.join("\n\n")
      : "No search results found.";
  } catch (err: any) {
    return `Search error: ${err.message}`;
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
  // Remove script/style tags
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "");

  // Convert common elements
  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li>/gi, "- ")
    .replace(/<\/li>/gi, "\n");

  // Strip remaining tags
  text = stripHtml(text);

  // Clean up whitespace
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return text;
}
