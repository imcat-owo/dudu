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
  // D36: DuckDuckGo anti-scraping often returns HTTP 200 with a
  // captcha/challenge page instead of results. Parsing that page yields
  // zero results, which used to surface as a confident "No results found."
  // Detect the block and throw so the model gets the truth.
  if (/captcha|anomaly-modal|challenge-form|cf-challenge|just a moment/i.test(html)) {
    throw new Error("DuckDuckGo anti-scraping blocked the request (captcha/challenge page)");
  }
  const results: SearchResult[] = [];
  const re =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>.*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gs;
  let m: RegExpExecArray | null = re.exec(html);
  while (m && results.length < 5) {
    const strip = (s: string) => s.replace(/<[^>]+>/g, "").trim();
    results.push({ title: strip(m[2]), url: m[1], snippet: strip(m[3]).slice(0, 300) });
    m = re.exec(html);
  }
  return { results };
}

export interface WebSearchDeps {
  /** Provider order, e.g. ["tavily", "serper", "brave", "duckduckgo"]. */
  providerOrder?: string[];
}

/** What happened with each provider during a search run. D36: the model
 * must know WHICH backend served the results and which ones failed/skipped
 * and why — no more silent fallback. */
export interface ProviderAttempt {
  provider: string;
  status: "ok" | "skipped" | "failed";
  detail?: string;
}

export interface WebSearchRun {
  provider: string;
  response: SearchResponse;
  attempts: ProviderAttempt[];
}

export function createWebSearchTools(deps: WebSearchDeps = {}): LocalTool[] {
  const order = deps.providerOrder ?? ["tavily", "serper", "brave", "duckduckgo"];

  async function run(query: string): Promise<WebSearchRun> {
    const env = await envStore.getValues();
    const attempts: ProviderAttempt[] = [];
    for (const provider of order) {
      try {
        switch (provider) {
          case "tavily":
            // D36: a missing key is a skip, not a silent nothing — record it.
            if (!env.TAVILY_API_KEY) {
              attempts.push({ provider, status: "skipped", detail: "no API key configured" });
              break;
            }
            return {
              provider,
              response: await searchTavily(query, env.TAVILY_API_KEY),
              attempts: [...attempts, { provider, status: "ok" }],
            };
          case "serper":
            if (!env.SERPER_API_KEY) {
              attempts.push({ provider, status: "skipped", detail: "no API key configured" });
              break;
            }
            return {
              provider,
              response: await searchSerper(query, env.SERPER_API_KEY),
              attempts: [...attempts, { provider, status: "ok" }],
            };
          case "brave":
            if (!env.BRAVE_API_KEY) {
              attempts.push({ provider, status: "skipped", detail: "no API key configured" });
              break;
            }
            return {
              provider,
              response: await searchBrave(query, env.BRAVE_API_KEY),
              attempts: [...attempts, { provider, status: "ok" }],
            };
          case "duckduckgo": {
            const ddg = await searchDuckDuckGo(query);
            // D36: an empty DDG scrape is almost never a genuine "no results"
            // — it's anti-scraping returning an unparseable page. Treat it as
            // a provider failure, not as a confident empty answer.
            if (ddg.results.length === 0) {
              attempts.push({
                provider,
                status: "failed",
                detail: "returned no parseable results (likely anti-scraping)",
              });
              break;
            }
            return { provider, response: ddg, attempts: [...attempts, { provider, status: "ok" }] };
          }
          default:
            attempts.push({ provider, status: "skipped", detail: "unknown provider" });
        }
      } catch (e) {
        attempts.push({
          provider,
          status: "failed",
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }
    const summary = attempts
      .map((a) => `${a.provider}: ${a.status}${a.detail ? ` (${a.detail})` : ""}`)
      .join("; ");
    // D37: the old message told the model to send her to "env vars" to set a
    // key — but there was NO settings page for it, so it pointed nowhere.
    // D15 added one: the environment variables section in the connections
    // settings tab. Point there (or offer the ask_env_form card).
    throw new Error(
      `Web search failed (tried: ${order.join(", ")}). ${summary}. ` +
        `To add a search API key, tell her to open the connections settings tab ` +
        `and add it in the environment variables section there — or ask her directly ` +
        `and use the ask_env_form tool to save it for her.`,
    );
  }

  return [
    {
      name: "web_search",
      description:
        "Search the web for current information. Use when she asks about news, prices, docs, or anything you don't know. Returns titles, URLs, and snippets — cite sources with [title](url) in your reply. The first line tells you which search backend served the results and which backends failed or were skipped — never claim you searched a backend that is listed as failed/skipped.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      manualId: "mcp-tools",
      run: async (args, _ctx) => {
        const query = String(args.query ?? "").trim();
        if (!query) throw new Error("web_search: empty query");
        const { provider, response, attempts } = await run(query);
        const { results, answer } = response;
        // D36: provenance header — the model always knows which backend
        // answered and what happened with the others.
        const header = [`via: ${provider}`];
        const others = attempts.filter((a) => a.status !== "ok");
        if (others.length > 0) {
          header.push(
            `other backends: ${others
              .map((a) => `${a.provider} ${a.status}${a.detail ? ` (${a.detail})` : ""}`)
              .join("; ")}`,
          );
        }
        const head = header.join("\n");
        if (results.length === 0) return `${head}\n\nNo results found.`;
        const lines = results.map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`);
        return `${head}\n\n${answer ? `Summary: ${answer}\n\n` : ""}${lines.join("\n\n")}`;
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
