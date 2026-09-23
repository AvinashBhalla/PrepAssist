import { describe, expect, it, vi } from "vitest";
import { DuckDuckGoHtmlProvider } from "../src/research/duckduckgo-provider.js";
import { buildInterviewQueries } from "../src/research/public-interview-queries.js";
import { classifyPublicSource, rankPublicSearchResults } from "../src/research/public-interview-ranking.js";
import { researchInterviewProcess } from "../src/research/public-interview-service.js";
import type { FetchRecord } from "../src/retrieval/types.js";
import type { PublicSearchProvider, PublicSearchResult } from "../src/research/public-interview-types.js";

function searchResult(overrides: Partial<PublicSearchResult> = {}): PublicSearchResult {
  return {
    title: "Example interview report",
    url: "https://example.com/report",
    snippet: "Interview questions and rounds reported by a candidate.",
    sourceDomain: "example.com",
    query: "Example interview process",
    rank: 1,
    ...overrides,
  };
}

function successfulPage(url: string, text = "<main><h1>Interview report</h1><p>Candidate discussion</p></main>"): FetchRecord {
  return {
    requestedUrl: url,
    finalUrl: url,
    statusCode: 200,
    contentType: "text/html",
    responseBytes: text.length,
    elapsedMs: 1,
    attempts: 1,
    text,
  };
}

describe("public interview query and result foundations", () => {
  it("builds bounded deterministic queries with a role-specific query", () => {
    const queries = buildInterviewQueries({ companyName: "Example Co", roleTitle: "Senior Engineer" });

    expect(queries).toHaveLength(7);
    expect(queries).toContain("Example Co Senior Engineer interview");
    expect(new Set(queries).size).toBe(queries.length);
  });

  it("does not duplicate queries when company input has repeated whitespace", () => {
    const queries = buildInterviewQueries({ companyName: " Example   Co ", roleTitle: "Engineer" });

    expect(new Set(queries).size).toBe(queries.length);
    expect(queries[0]).toBe("Example Co interview process");
  });

  it("normalizes DuckDuckGo HTML results", async () => {
    const provider = new DuckDuckGoHtmlProvider({
      fetcher: {
        fetchText: vi.fn(async () => successfulPage(
          "https://html.duckduckgo.com/html/?q=Example",
          '<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Freport%23round">Example report</a><a class="result__snippet">Candidate interview discussion</a></div>',
        )),
      },
    });

    const results = await provider.search("Example", { maximumResults: 3 });

    expect(results).toEqual([{
      title: "Example report",
      url: "https://example.com/report",
      snippet: "Candidate interview discussion",
      sourceDomain: "example.com",
      query: "Example",
      rank: 1,
    }]);
  });

  it("ranks interview reports and role matches above generic pages", () => {
    const generic = searchResult({ title: "Example company", snippet: "About the company", url: "https://example.com/about", rank: 1 });
    const report = searchResult({ title: "Senior Engineer interview report", snippet: "Questions and rounds", url: "https://reddit.com/r/jobs/report", sourceDomain: "reddit.com", rank: 4 });

    expect(rankPublicSearchResults([generic, report], "Senior Engineer")[0]).toEqual(report);
    expect(classifyPublicSource(report)).toBe("interview-report");
    expect(classifyPublicSource(searchResult({ sourceDomain: "reddit.com", title: "Discussion", snippet: "Discussion" }))).toBe("discussion");
  });
});

describe("public interview research service", () => {
  it("limits queries and fetched results, and fetches duplicate URLs once", async () => {
    const results = [
      searchResult({ url: "https://example.com/report", rank: 1 }),
      searchResult({ url: "https://example.com/report#duplicate", rank: 2 }),
      searchResult({ url: "https://example.com/second", rank: 3 }),
    ];
    const provider: PublicSearchProvider = { search: vi.fn(async () => results) };
    const fetchText = vi.fn(async (url: string) => successfulPage(url));

    const research = await researchInterviewProcess(
      { companyName: "Example", companyUrl: "https://example.com", roleTitle: "Engineer" },
      { provider, fetcher: { fetchText }, maximumQueries: 2, maximumResultsPerQuery: 2, maximumSources: 1 },
    );

    expect(provider.search).toHaveBeenCalledTimes(2);
    expect(research.queries).toHaveLength(2);
    expect(research.results).toHaveLength(1);
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it("returns no-results diagnostics without fabricating sources", async () => {
    const provider: PublicSearchProvider = { search: vi.fn(async () => []) };

    const research = await researchInterviewProcess(
      { companyName: "Quiet Co", companyUrl: "https://quiet.example" },
      { provider, fetcher: { fetchText: vi.fn() } },
    );

    expect(research.sources).toEqual([]);
    expect(research.diagnostics.resultsFound).toBe(0);
    expect(research.failures.some((failure) => failure.code === "NO_PUBLIC_DISCUSSION")).toBe(true);
  });

  it("continues when one source fetch fails", async () => {
    const provider: PublicSearchProvider = {
      search: vi.fn(async () => [
        searchResult({ url: "https://example.com/broken", rank: 1 }),
        searchResult({ url: "https://example.com/working", rank: 2 }),
      ]),
    };
    const fetchText = vi.fn(async (url: string): Promise<FetchRecord> => {
      if (url.endsWith("broken")) {
        return { requestedUrl: url, finalUrl: url, responseBytes: 0, elapsedMs: 1, attempts: 1, failure: { code: "HTTP_ERROR", message: "HTTP 503", statusCode: 503 } };
      }
      return successfulPage(url);
    });

    const research = await researchInterviewProcess(
      { companyName: "Example", companyUrl: "https://example.com" },
      { provider, fetcher: { fetchText } },
    );

    expect(research.sources).toHaveLength(1);
    expect(research.diagnostics.sourcesFailed).toBe(1);
    expect(research.failures[0].code).toBe("SOURCE_UNREACHABLE");
  });

  it("records provider failures and does not abort later queries", async () => {
    let call = 0;
    const provider: PublicSearchProvider = {
      search: vi.fn(async () => {
        call += 1;
        if (call === 1) throw new Error("provider unavailable");
        return [searchResult()];
      }),
    };

    const research = await researchInterviewProcess(
      { companyName: "Example", companyUrl: "https://example.com" },
      { provider, fetcher: { fetchText: async (url) => successfulPage(url) }, maximumQueries: 2 },
    );

    expect(provider.search).toHaveBeenCalledTimes(2);
    expect(research.sources).toHaveLength(1);
    expect(research.failures.some((failure) => failure.code === "SEARCH_PROVIDER_UNAVAILABLE")).toBe(true);
  });

  it("returns a structured invalid-company-url result", async () => {
    const provider: PublicSearchProvider = { search: vi.fn() };

    const research = await researchInterviewProcess(
      { companyName: "Example", companyUrl: "file:///secret" },
      { provider, fetcher: { fetchText: vi.fn() } },
    );

    expect(research.failures[0].code).toBe("SOURCE_INVALID");
    expect(provider.search).not.toHaveBeenCalled();
  });
});