import { cleanHtml } from "./html-cleaner.js";
import { extractLinks } from "./links.js";
import { classifyHiringCandidate, rankLinks } from "./ranking.js";
import { loadRobotsPolicy, type RobotsPolicy } from "./robots.js";
import { normalizeUrl, type UrlValidationOptions } from "./url-validator.js";
import type { HttpFetcher } from "./fetcher.js";
import type { ResearchBundle, RetrievalFailure, RankedLink } from "./types.js";

export type CrawlerLimits = {
  maximumPages: number;
  maximumDepth: number;
  concurrency: number;
};

export type CrawlerOptions = {
  fetcher: Pick<HttpFetcher, "fetchText">;
  environment?: UrlValidationOptions["environment"];
  limits?: Partial<CrawlerLimits>;
};

const defaultLimits: CrawlerLimits = {
  maximumPages: 12,
  maximumDepth: 2,
  concurrency: 2,
};

type QueueItem = { link: RankedLink; depth: number };

export async function crawlCompanyWebsite(companyUrl: string, options: CrawlerOptions): Promise<ResearchBundle> {
  let normalizedCompanyUrl: string;
  try {
    normalizedCompanyUrl = normalizeUrl(companyUrl, { environment: options.environment });
  } catch (error) {
    const failure = makeFailure(companyUrl, "INVALID_URL", error instanceof Error ? error.message : "URL is invalid");
    return emptyBundle(companyUrl, failure);
  }

  const limits = { ...defaultLimits, ...options.limits };
  const bundle: ResearchBundle = {
    companyUrl: normalizedCompanyUrl,
    pages: [],
    diagnostics: { attempted: 0, succeeded: 0, failed: 0, skipped: 0, robotsStatus: "not-checked" },
    failures: [],
  };
  const robots = await loadRobotsPolicy(new URL(normalizedCompanyUrl).origin, options.fetcher);
  bundle.diagnostics.robotsStatus = robots.status;
  const queue: QueueItem[] = [{ link: { sourceUrl: normalizedCompanyUrl, targetUrl: normalizedCompanyUrl, anchorText: "", path: new URL(normalizedCompanyUrl).pathname, score: 0 }, depth: 0 }];
  const queued = new Set([normalizedCompanyUrl]);

  while (queue.length > 0 && bundle.diagnostics.attempted < limits.maximumPages) {
    queue.sort((first, second) => second.link.score - first.link.score || first.link.targetUrl.localeCompare(second.link.targetUrl));
    const batch: QueueItem[] = [];
    while (batch.length < limits.concurrency && queue.length > 0 && bundle.diagnostics.attempted + batch.length < limits.maximumPages) {
      const item = queue.shift();
      if (!item) break;
      if (!robots.isAllowed(item.link.targetUrl)) {
        bundle.diagnostics.skipped += 1;
        bundle.failures.push(makeFailure(item.link.targetUrl, "ROBOTS_DISALLOWED", "URL is disallowed by robots.txt", undefined, item.depth));
        continue;
      }
      batch.push(item);
    }

    if (batch.length === 0) continue;
    bundle.diagnostics.attempted += batch.length;
    const results = await Promise.all(batch.map(async (item) => ({ item, result: await options.fetcher.fetchText(item.link.targetUrl) })));

    for (const { item, result } of results) {
      if (result.failure || result.text === undefined) {
        const isSkipped = result.failure?.code === "UNSUPPORTED_CONTENT_TYPE";
        if (isSkipped) {
          bundle.diagnostics.skipped += 1;
        } else {
          bundle.diagnostics.failed += 1;
        }
        const failure = makeFailure(item.link.targetUrl, result.failure?.code ?? "FETCH_FAILED", result.failure?.message ?? "Page fetch failed", result.statusCode, item.depth);
        bundle.failures.push(failure);
        if (item.depth === 0) bundle.topLevelFailure = failure;
        continue;
      }

      let finalUrl: string;
      try {
        finalUrl = normalizeUrl(result.finalUrl, { environment: options.environment });
        if (new URL(finalUrl).origin !== new URL(normalizedCompanyUrl).origin) {
          throw new Error("Redirected URL is outside the company origin");
        }
      } catch (error) {
        bundle.diagnostics.failed += 1;
        const failure = makeFailure(item.link.targetUrl, "EXTERNAL_REDIRECT", error instanceof Error ? error.message : "Redirected URL is not allowed", undefined, item.depth);
        bundle.failures.push(failure);
        if (item.depth === 0) bundle.topLevelFailure = failure;
        continue;
      }

      bundle.diagnostics.succeeded += 1;
      const cleaned = cleanHtml(result.text, finalUrl);
      const page = {
        url: item.link.targetUrl,
        finalUrl,
        title: cleaned.title,
        text: cleaned.text,
        sourceType: item.depth === 0 ? "company" : classifyHiringCandidate(item.link),
        depth: item.depth,
        score: item.link.score,
      } as const;
      bundle.pages.push(page);

      if (item.depth >= limits.maximumDepth) continue;
      const links = rankLinks(extractLinks(result.text, finalUrl), cleaned.title);
      for (const link of links) {
        if (queued.has(link.targetUrl)) continue;
        queued.add(link.targetUrl);
        queue.push({ link, depth: item.depth + 1 });
      }
    }
  }

  return bundle;
}

function emptyBundle(companyUrl: string, failure: RetrievalFailure): ResearchBundle {
  return {
    companyUrl,
    pages: [],
    diagnostics: { attempted: 0, succeeded: 0, failed: 1, skipped: 0, robotsStatus: "not-checked" },
    failures: [failure],
    topLevelFailure: failure,
  };
}

function makeFailure(url: string, code: string, message: string, statusCode?: number, depth?: number): RetrievalFailure {
  return { url, code, message, ...(statusCode === undefined ? {} : { statusCode }), ...(depth === undefined ? {} : { depth }) };
}
