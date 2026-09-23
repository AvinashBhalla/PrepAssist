import { load } from "cheerio";
import { HttpFetcher } from "../retrieval/fetcher.js";
import { normalizeUrl } from "../retrieval/url-validator.js";
import type {
  PublicSearchOptions,
  PublicSearchProvider,
  PublicSearchResult,
} from "./public-interview-types.js";

export type DuckDuckGoProviderOptions = {
  fetcher?: Pick<HttpFetcher, "fetchText">;
  endpoint?: string;
};

export class DuckDuckGoHtmlProvider implements PublicSearchProvider {
  private readonly fetcher: Pick<HttpFetcher, "fetchText">;
  private readonly endpoint: string;

  constructor(options: DuckDuckGoProviderOptions = {}) {
    this.fetcher = options.fetcher ?? new HttpFetcher({ allowCrossOriginRedirects: true });
    this.endpoint = options.endpoint ?? "https://html.duckduckgo.com/html/";
  }

  async search(query: string, options: PublicSearchOptions = {}): Promise<PublicSearchResult[]> {
    const url = new URL(this.endpoint);
    url.searchParams.set("q", query);
    const result = await this.fetcher.fetchText(url.toString());

    if (result.failure || !result.text) {
      throw new Error(result.failure?.code ?? "SEARCH_PROVIDER_UNAVAILABLE");
    }

    const $ = load(result.text);
    const maximumResults = options.maximumResults ?? 5;
    const normalized: PublicSearchResult[] = [];
    const seen = new Set<string>();

    $(".result").each((_index, element) => {
      if (normalized.length >= maximumResults) return;
      const link = $(element).find("a.result__a").first();
      const rawUrl = link.attr("href");
      if (!rawUrl) return;

      const resolvedUrl = extractResultUrl(rawUrl);
      if (!resolvedUrl) return;
      let normalizedUrl: string;
      try {
        normalizedUrl = normalizeUrl(resolvedUrl);
      } catch {
        return;
      }
      if (seen.has(normalizedUrl)) return;
      seen.add(normalizedUrl);

      normalized.push({
        title: link.text().replace(/\s+/g, " ").trim(),
        url: normalizedUrl,
        snippet: $(element).find(".result__snippet").text().replace(/\s+/g, " ").trim(),
        sourceDomain: new URL(normalizedUrl).hostname,
        query,
        rank: normalized.length + 1,
      });
    });

    return normalized;
  }
}

function extractResultUrl(rawUrl: string): string | undefined {
  const value = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
  try {
    const url = new URL(value);
    const destination = url.searchParams.get("uddg");
    return destination ? decodeURIComponent(destination) : url.toString();
  } catch {
    return undefined;
  }
}
