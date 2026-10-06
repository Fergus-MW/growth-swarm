/** Tavily read adapter. Raw responses are returned for capture before model use. */
export type SearchResultItem = {
  title: string;
  url: string;
  content: string;
  publishedDate: string | null;
};

export type ConnectorSearchOutcome =
  | { ok: true; items: SearchResultItem[]; raw: unknown }
  | { ok: false; status: "unavailable" | "empty" | "error"; error?: string; raw?: unknown };

export function webSearchAvailable(): boolean {
  return Boolean(process.env["TAVILY_API_KEY"]);
}

export async function webSearch(query: string, maxResults = 6, signal?: AbortSignal): Promise<ConnectorSearchOutcome> {
  const apiKey = process.env["TAVILY_API_KEY"];
  if (!apiKey) return { ok: false, status: "unavailable", error: "Web search is not configured (no Tavily API key)" };
  let raw: unknown;
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, max_results: Math.max(1, Math.min(20, Math.trunc(maxResults))), search_depth: "basic", include_answer: false }),
    });
    raw = await response.text();
    if (!response.ok) return { ok: false, status: "error", error: `Search provider failed [${response.status}]`, raw };
    raw = JSON.parse(raw as string) as unknown;
    if (!raw || typeof raw !== "object" || !("results" in raw) || !Array.isArray(raw.results)) {
      return { ok: false, status: "error", error: "Search provider returned an invalid result inventory", raw };
    }
    const items = raw.results.map((result: unknown): SearchResultItem => {
      if (!result || typeof result !== "object") throw new Error("Search provider returned an invalid source item");
      const record = result as Record<string, unknown>;
      const date = typeof record["published_date"] === "string" ? Date.parse(record["published_date"]) : NaN;
      return {
        title: typeof record["title"] === "string" && record["title"].trim() ? record["title"] : "Untitled source result",
        url: typeof record["url"] === "string" ? record["url"] : "",
        content: typeof record["content"] === "string" ? record["content"] : JSON.stringify(record),
        publishedDate: Number.isNaN(date) ? null : new Date(date).toISOString(),
      };
    });
    return items.length ? { ok: true, items, raw } : { ok: false, status: "empty", raw };
  } catch (error) {
    return { ok: false, status: "error", error: error instanceof Error ? error.message : String(error), ...(raw === undefined ? {} : { raw }) };
  }
}
