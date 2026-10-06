/**
 * Connector adapters. Every connector follows the same capture contract:
 * the full response is persisted as immutable source chunks BEFORE any
 * model reads it, and every call gets an invocation record.
 *
 * Web search (Tavily) is the first adapter. Without TAVILY_API_KEY the
 * connector reports itself unavailable — a visible capability gap, never
 * a silent skip.
 */

export type SearchResultItem = {
  title: string;
  url: string;
  content: string;
  publishedDate?: string | null;
};

export type ConnectorSearchOutcome =
  | { ok: true; items: SearchResultItem[] }
  | { ok: false; status: "unavailable" | "empty" | "error"; error?: string };

export function webSearchAvailable(): boolean {
  return Boolean(process.env["TAVILY_API_KEY"]);
}

export async function webSearch(query: string, maxResults = 6): Promise<ConnectorSearchOutcome> {
  const apiKey = process.env["TAVILY_API_KEY"];
  if (!apiKey) {
    return { ok: false, status: "unavailable", error: "Web search is not configured (no Tavily API key)" };
  }
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        search_depth: "basic",
        include_answer: false,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      return { ok: false, status: "error", error: `Search provider failed [${response.status}]: ${body}` };
    }
    const data = (await response.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string; published_date?: string }>;
    };
    const items = (data.results ?? [])
      .filter((r) => r.url && r.title)
      .map((r) => ({
        title: r.title!,
        url: r.url!,
        content: r.content ?? "",
        publishedDate: r.published_date ?? null,
      }));
    if (items.length === 0) return { ok: false, status: "empty" };
    return { ok: true, items };
  } catch (error) {
    return { ok: false, status: "error", error: error instanceof Error ? error.message : String(error) };
  }
}
