import { cleanHtml } from "../retrieval/html-cleaner.js";
import type { HttpFetcher } from "../retrieval/fetcher.js";
import { normalizeUrl } from "../retrieval/url-validator.js";
import type { RetrievalEnvironment } from "../retrieval/types.js";
import { buildInterviewQueries, type InterviewQueryInput } from "./public-interview-queries.js";
import { classifyPublicSource, rankPublicSearchResults } from "./public-interview-ranking.js";
import type {
  PublicInterviewResearch,
  PublicResearchFailure,
  PublicSearchProvider,
  PublicSearchResult,
} from "./public-interview-types.js";

export type PublicInterviewResearchOptions = {
  provider: PublicSearchProvider;
  fetcher: Pick<HttpFetcher, "fetchText">;
  environment?: RetrievalEnvironment;
  maximumQueries?: number;
  maximumResultsPerQuery?: number;
  maximumSources?: number;
  concurrency?: number;
};

const defaultOptions = {
  maximumQueries: 7,
  maximumResultsPerQuery: 5,
  maximumSources: 8,
  concurrency: 2,
};

export async function researchInterviewProcess(
  input: InterviewQueryInput & { companyUrl: string },
  options: PublicInterviewResearchOptions,
): Promise<PublicInterviewResearch> {
  const limits = { ...defaultOptions, ...options };
  const queries = buildInterviewQueries(input).slice(0, limits.maximumQueries);
  const resultMap = new Map<string, PublicSearchResult>();
  const failures: PublicResearchFailure[] = [];

  try {
    normalizeUrl(input.companyUrl, { environment: options.environment });
  } catch {
    return {
      queries: [],
      results: [],
      sources: [],
      diagnostics: { queriesAttempted: 0, resultsFound: 0, sourcesAttempted: 0, sourcesSucceeded: 0, sourcesFailed: 0 },
      failures: [{ code: "SOURCE_INVALID", message: "Company URL is invalid.", url: input.companyUrl }],
    };
  }

  for (const query of queries) {
    try {
      const results = await options.provider.search(query, { maximumResults: limits.maximumResultsPerQuery });
      for (const result of results) {
        let normalizedUrl: string;
        try {
          normalizedUrl = normalizeUrl(result.url, { environment: options.environment });
        } catch {
          continue;
        }
        if (!resultMap.has(normalizedUrl)) {
          resultMap.set(normalizedUrl, { ...result, url: normalizedUrl });
        }
      }
    } catch (error) {
      failures.push({
        code: error instanceof Error && error.message === "TIMEOUT" ? "SEARCH_TIMEOUT" : "SEARCH_PROVIDER_UNAVAILABLE",
        message: "Public search provider failed for this query.",
        query,
      });
    }
  }

  const results = rankPublicSearchResults([...resultMap.values()], input.roleTitle).slice(0, limits.maximumSources);
  const sources: PublicInterviewResearch["sources"] = [];
  const sourceFailures: PublicResearchFailure[] = [];

  for (let index = 0; index < results.length; index += limits.concurrency) {
    const batch = results.slice(index, index + limits.concurrency);
    const fetched = await Promise.all(batch.map(async (result) => {
      try {
        const page = await options.fetcher.fetchText(result.url);
        if (page.failure || page.text === undefined) {
          return { result, failure: toSourceFailure(result, page.failure?.code) };
        }
        return { result, page };
      } catch {
        return { result, failure: toSourceFailure(result, "NETWORK_ERROR") };
      }
    }));

    for (const item of fetched) {
      if ("failure" in item && item.failure) {
        sourceFailures.push(item.failure);
        continue;
      }
      if (!("page" in item) || !item.page.text) continue;
      const cleaned = cleanHtml(item.page.text, item.page.finalUrl);
      sources.push({
        url: item.page.finalUrl,
        title: item.result.title || cleaned.title,
        domain: new URL(item.page.finalUrl).hostname,
        sourceType: classifyPublicSource(item.result),
        snippet: item.result.snippet,
        text: cleaned.text,
        retrievedAt: new Date().toISOString(),
      });
    }
  }

  failures.push(...sourceFailures);
  if (results.length === 0) {
    failures.push({ code: "NO_PUBLIC_DISCUSSION", message: "No public interview discussion results were found." });
  }

  return {
    queries,
    results,
    sources,
    diagnostics: {
      queriesAttempted: queries.length,
      resultsFound: results.length,
      sourcesAttempted: results.length,
      sourcesSucceeded: sources.length,
      sourcesFailed: sourceFailures.length,
    },
    failures,
  };
}

function toSourceFailure(result: PublicSearchResult, code?: string): PublicResearchFailure {
  return {
    code: code === "REDIRECT_BLOCKED" || code === "REDIRECT_LIMIT" ? "SOURCE_BLOCKED" : "SOURCE_UNREACHABLE",
    message: "Public source could not be retrieved.",
    url: result.url,
  };
}
