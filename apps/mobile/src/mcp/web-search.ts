/**
 * Web search tool — PURE module (no React Native imports).
 *
 * D5: One question, one search, answers with [cite] sources. Faster than
 * "let me go flip through the browser", and every claim carries its source.
 *
 * Providers (API key via env vars, see D10):
 * - Tavily (TAVILY_API_KEY): best for AI, returns answer + sources.
 * - Serper (SERPER_API_KEY): Google results as JSON.
 * - Brave (BRAVE_API_KEY): independent index.
 * - DuckDuckGo: no key, HTML scrape fallback (best-effort).
 *
 * The provider order and keys are configured in settings; the tool tries
 * them in order until one works.
 */

import type { LocalTool } from "../api-groups/local-tools";
import { envStore } from "./env";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchResult[];
  answer?: string;
}

async function searchTavily(query: string, apiKey: string): Promise<SearchResponse> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: 5,
      include_answer: true,
    }),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data = (await res.json()) as {
    answer?: string;
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return {
    answer: data.answer,
    results: (data.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: (r.content ?? "").slice(0, 300),
    })),
  };
}

async function searchSerper(query: string, apiKey: string): Promise<SearchResponse> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({ q: query, num: 5 }),
  });
  if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
  const data = (await res.json()) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
  };
  return {
    results: (data.organic ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.link ?? "",
      snippet: r.snippet ?? "",
    })),
  };
}

async function searchBrave(query: string, apiKey: string): Promise<SearchResponse> {
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
    { headers: { "X-Subscription-Token": apiKey, Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const data = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  return {
    results: (data.web?.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.description ?? "",
    })),
  };
}

async function searchDuckDuckGo(query: string): Promise<SearchResponse> {
  // Best-effort, no key. Uses the HTML endpoint.
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" },
  });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const html = await res.text();
  const results: SearchResult[] = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>.*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gs;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && results.length < 5) {
    const strip = (s: string) => s.replace(/<[^>]+>/g, "").trim();
    results.push({ title: strip(m[2]), url: m[1], snippet: strip(m[3]).slice(0, 300) });
  }
  return { results };
}

export interface WebSearchDeps {
  /** Provider order, e.g. ["tavily", "serper", "brave", "duckduckgo"]. */
  providerOrder?: string[];
}

export function createWebSearchTools(deps: WebSearchDeps = {}): LocalTool[] {
  const order = deps.providerOrder ?? ["tavily", "serper", "brave", "duckduckgo"];

  async function run(query: string): Promise<SearchResponse> {
    const env = await envStore.getValues();
    const errors: string[] = [];
    for (const provider of order) {
      try {
        switch (provider) {
          case "tavily":
            if (env["TAVILY_API_KEY"]) return await searchTavily(query, env["TAVILY_API_KEY"]);
            break;
          case "serper":
            if (env["SERPER_API_KEY"]) return await searchSerper(query, env["SERPER_API_KEY"]);
            break;
          case "brave":
            if (env["BRAVE_API_KEY"]) return await searchBrave(query, env["BRAVE_API_KEY"]);
            break;
          case "duckduckgo":
            return await searchDuckDuckGo(query);
        }
      } catch (e) {
        errors.push(`${provider}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    throw new Error(
      `Web search failed (tried: ${order.join(", ")}). ` +
        `Set a search API key in env vars (TAVILY_API_KEY / SERPER_API_KEY / BRAVE_API_KEY). ` +
        errors.join("; "),
    );
  }

  return [
    {
      name: "web_search",
      description:
        "Search the web for current information. Use when she asks about news, prices, docs, or anything you don't know. Returns titles, URLs, and snippets — cite sources with [title](url) in your reply.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      run: async (args, _ctx) => {
        const query = String(args["query"] ?? "").trim();
        if (!query) throw new Error("web_search: empty query");
        const { results, answer } = await run(query);
        if (results.length === 0) return "No results found.";
        const lines = results.map(
          (r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`,
        );
        return (answer ? `Summary: ${answer}\n\n` : "") + lines.join("\n\n");
      },
    },
  ];
}

/** For tests: run a single provider directly. */
export const __searchProviders = {
  searchTavily,
  searchSerper,
  searchBrave,
  searchDuckDuckGo,
};
