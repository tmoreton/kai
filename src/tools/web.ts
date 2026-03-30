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
