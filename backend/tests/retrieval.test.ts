import { describe, expect, it, vi } from "vitest";
import { HttpFetcher } from "../src/retrieval/fetcher.js";
import { extractLinks } from "../src/retrieval/links.js";
import { rankLinks } from "../src/retrieval/ranking.js";
import { crawlCompanyWebsite } from "../src/retrieval/crawler.js";
import { normalizeUrl, UrlValidationError } from "../src/retrieval/url-validator.js";

function response(body: string, options: { status?: number; contentType?: string; location?: string; contentLength?: string } = {}): Response {
  const headers: Record<string, string> = {
    "content-type": options.contentType ?? "text/html",
  };
  if (options.location) headers.location = options.location;
  if (options.contentLength) headers["content-length"] = options.contentLength;
  return new Response(body, {
    status: options.status ?? 200,
    headers,
  });
}

function fetcherFor(handler: (url: string, count: number) => Response | Promise<Response>) {
  let count = 0;
  return new HttpFetcher({
    fetchImplementation: async (url) => handler(url, ++count),
    sleep: async () => undefined,
  });
}

describe("URL validation and links", () => {
  it("resolves relative links and removes fragments", () => {
    const links = extractLinks(
      '<a href="/about#team">About</a><a href="../jobs/apply?source=nav">Jobs</a>',
      "https://example.com/docs/start",
    );

    expect(links.map((link) => link.targetUrl)).toEqual([
      "https://example.com/about",
      "https://example.com/jobs/apply?source=nav",
    ]);
  });

  it("ignores external, javascript, mailto, tel, and asset links", () => {
    const links = extractLinks(
      '<a href="https://other.example/x">External</a><a href="javascript:void(0)">JS</a><a href="mailto:a@example.com">Mail</a><a href="tel:123">Phone</a><a href="/file.pdf">PDF</a>',
      "https://example.com",
    );

    expect(links).toEqual([]);
  });

  it("ranks useful links deterministically and prioritizes careers/hiring", () => {
    const links = extractLinks(
      '<a href="/about">About</a><a href="/careers/engineering">Engineering careers</a><a href="/random">Random</a>',
      "https://example.com",
    );
    const first = rankLinks(links, "Example company");
    const second = rankLinks(links, "Example company");

    expect(first).toEqual(second);
    expect(first[0].targetUrl).toBe("https://example.com/careers/engineering");
    expect(first[0].score).toBeGreaterThan(first[1].score);
  });

  it("allows localhost in evaluation/development but rejects it in production", () => {
    expect(normalizeUrl("http://localhost:3000", { environment: "evaluation" })).toBe("http://localhost:3000/");
    expect(normalizeUrl("http://127.0.0.1:3000", { environment: "development" })).toBe("http://127.0.0.1:3000/");
    expect(() => normalizeUrl("http://localhost:3000", { environment: "production" })).toThrow(UrlValidationError);
    expect(() => normalizeUrl("http://192.168.1.5", { environment: "production" })).toThrow(UrlValidationError);
  });
});

describe("HTTP fetcher", () => {
  it("follows an allowed same-origin redirect and resolves relative Location", async () => {
    const requested: string[] = [];
    const fetcher = fetcherFor((url) => {
      requested.push(url);
      return url.endsWith("/start")
        ? response("redirect", { status: 302, location: "/final" })
        : response("ok");
    });

    const result = await fetcher.fetchText("https://example.com/start");

    expect(requested).toEqual(["https://example.com/start", "https://example.com/final"]);
    expect(result.finalUrl).toBe("https://example.com/final");
    expect(result.text).toBe("ok");
  });

  it("blocks a redirect to a disallowed production destination", async () => {
    const fetcher = new HttpFetcher({
      environment: "production",
      fetchImplementation: async () => response("redirect", { status: 301, location: "http://127.0.0.1:8080/private" }),
    });

    const result = await fetcher.fetchText("https://example.com/start");

    expect(result.failure?.code).toBe("REDIRECT_BLOCKED");
  });

  it("blocks cross-origin redirects by default", async () => {
    const fetcher = fetcherFor(() => response("redirect", { status: 302, location: "https://other.example/final" }));

    const result = await fetcher.fetchText("https://example.com/start");

    expect(result.failure?.code).toBe("REDIRECT_BLOCKED");
  });

  it("returns REDIRECT_LIMIT for a redirect loop", async () => {
    const fetcher = fetcherFor((url) => response("redirect", { status: 307, location: `${new URL(url).pathname}` }));

    const result = await fetcher.fetchText("https://example.com/loop");

    expect(result.failure?.code).toBe("REDIRECT_LIMIT");
  });

  it("returns REDIRECT_LIMIT when the maximum redirect count is exceeded", async () => {
    const fetcher = new HttpFetcher({
      maximumRedirects: 1,
      fetchImplementation: async (url) => response("redirect", { status: 302, location: `${new URL(url).pathname}/next` }),
    });

    const result = await fetcher.fetchText("https://example.com/start");

    expect(result.failure?.code).toBe("REDIRECT_LIMIT");
  });

  it("returns a normal response under the configured limit", async () => {
    const fetcher = new HttpFetcher({
      maximumResponseBytes: 5,
      fetchImplementation: async () => response("12345"),
    });

    const result = await fetcher.fetchText("https://example.com/ok");

    expect(result.text).toBe("12345");
    expect(result.responseBytes).toBe(5);
  });

  it("skips unsupported content types", async () => {
    const fetcher = fetcherFor(() => response("binary", { contentType: "application/pdf" }));
    const result = await fetcher.fetchText("https://example.com/file.pdf");

    expect(result.failure?.code).toBe("UNSUPPORTED_CONTENT_TYPE");
  });

  it("enforces the response-size limit", async () => {
    const fetcher = new HttpFetcher({
      maximumResponseBytes: 3,
      fetchImplementation: async () => response("1234"),
    });
    const result = await fetcher.fetchText("https://example.com/large");

    expect(result.failure?.code).toBe("RESPONSE_TOO_LARGE");
  });

  it("enforces the limit without Content-Length while reading chunks", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("123"));
        controller.enqueue(new TextEncoder().encode("456"));
        controller.close();
      },
    });
    const fetcher = new HttpFetcher({
      maximumResponseBytes: 5,
      fetchImplementation: async () => new Response(stream, { headers: { "content-type": "text/html" } }),
    });

    const result = await fetcher.fetchText("https://example.com/chunked");

    expect(result.failure?.code).toBe("RESPONSE_TOO_LARGE");
    expect(result.text).toBeUndefined();
  });

  it("does not trust a misleading small Content-Length", async () => {
    const fetcher = new HttpFetcher({
      maximumResponseBytes: 5,
      fetchImplementation: async () => response("123456", { contentLength: "1" }),
    });

    const result = await fetcher.fetchText("https://example.com/misleading-length");

    expect(result.failure?.code).toBe("RESPONSE_TOO_LARGE");
  });

  it("returns a structured timeout failure", async () => {
    const fetcher = new HttpFetcher({
      timeoutMs: 1,
      maximumRetries: 0,
      fetchImplementation: (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    });
    const result = await fetcher.fetchText("https://example.com/slow");

    expect(result.failure?.code).toBe("TIMEOUT");
  });

  it("retries transient HTTP failures with backoff", async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(response("busy", { status: 503 }))
      .mockResolvedValueOnce(response("ok"));
    const fetcher = new HttpFetcher({
      maximumRetries: 1,
      fetchImplementation,
      sleep: async () => undefined,
    });
    const result = await fetcher.fetchText("https://example.com/retry");

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("ok");
    expect(result.attempts).toBe(2);
  });
});

describe("bounded crawler", () => {
  function crawlerFetcher() {
    const requested: string[] = [];
    const fetcher = fetcherFor((url) => {
      requested.push(url);
      if (url.endsWith("/robots.txt")) return response("User-agent: *\nDisallow: /private", { contentType: "text/plain" });
      if (url.endsWith("/")) return response('<title>Example</title><a href="/about">About</a><a href="/private">Private</a><a href="https://other.example/x">External</a>');
      if (url.endsWith("/about")) return response("<main><h1>About</h1><p>Company information</p></main>");
      return response("<main>Other page</main>");
    });
    return { fetcher, requested };
  }

  it("skips robots-disallowed URLs and ignores external domains", async () => {
    const { fetcher, requested } = crawlerFetcher();
    const bundle = await crawlCompanyWebsite("https://example.com", { fetcher });

    expect(bundle.diagnostics.robotsStatus).toBe("available");
    expect(bundle.pages.map((page) => page.url)).toEqual(["https://example.com/", "https://example.com/about"]);
    expect(bundle.failures.some((failure) => failure.code === "ROBOTS_DISALLOWED")).toBe(true);
    expect(requested).not.toContain("https://other.example/x");
  });

  it("respects maximum page count", async () => {
    const fetcher = fetcherFor((url) => {
      if (url.endsWith("/robots.txt")) return response("User-agent: *\nAllow: /", { contentType: "text/plain" });
      return response('<a href="/one">One</a><a href="/two">Two</a><a href="/three">Three</a>');
    });
    const bundle = await crawlCompanyWebsite("https://example.com", { fetcher, limits: { maximumPages: 2 } });

    expect(bundle.diagnostics.attempted).toBe(2);
    expect(bundle.pages).toHaveLength(2);
  });

  it("respects maximum depth", async () => {
    const fetcher = fetcherFor((url) => {
      if (url.endsWith("/robots.txt")) return response("User-agent: *\nAllow: /", { contentType: "text/plain" });
      if (url.endsWith("/")) return response('<a href="/one">One</a>');
      return response('<a href="/two">Two</a>');
    });
    const bundle = await crawlCompanyWebsite("https://example.com", { fetcher, limits: { maximumDepth: 1 } });

    expect(bundle.pages.map((page) => page.depth)).toEqual([0, 1]);
  });

  it("fetches duplicate normalized URLs only once", async () => {
    const requested: string[] = [];
    const fetcher = fetcherFor((url) => {
      requested.push(url);
      if (url.endsWith("/robots.txt")) return response("User-agent: *\nAllow: /", { contentType: "text/plain" });
      if (url.endsWith("/")) return response('<a href="/about#one">About</a><a href="/about#two">About again</a>');
      return response("<main>About</main>");
    });
    const bundle = await crawlCompanyWebsite("https://example.com", { fetcher });

    expect(bundle.pages.filter((page) => page.url.endsWith("/about")).length).toBe(1);
    expect(requested.filter((url) => url.endsWith("/about")).length).toBe(1);
  });

  it("returns a structured top-level failure when the homepage is unreachable", async () => {
    const fetcher = fetcherFor((url) => {
      if (url.endsWith("/robots.txt")) return response("User-agent: *\nAllow: /", { contentType: "text/plain" });
      return response("missing", { status: 404 });
    });
    const bundle = await crawlCompanyWebsite("https://example.com", { fetcher });

    expect(bundle.topLevelFailure?.code).toBe("HTTP_ERROR");
    expect(bundle.diagnostics.failed).toBe(1);
  });
});