import type { FetchRecord } from "./types.js";
import { normalizeUrl, type UrlValidationOptions } from "./url-validator.js";

export type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

export type FetcherOptions = {
  timeoutMs?: number;
  maximumResponseBytes?: number;
  maximumRetries?: number;
  backoffBaseMs?: number;
  fetchImplementation?: FetchImplementation;
  sleep?: (milliseconds: number) => Promise<void>;
  userAgent?: string;
  environment?: UrlValidationOptions["environment"];
  allowCrossOriginRedirects?: boolean;
  maximumRedirects?: number;
};

const textContentTypes = ["text/html", "application/xhtml+xml", "text/plain"];
const transientStatuses = new Set([429, 502, 503, 504]);

export class HttpFetcher {
  private readonly options: Required<Omit<FetcherOptions, "fetchImplementation" | "sleep" | "environment">> & {
    fetchImplementation: FetchImplementation;
    sleep: (milliseconds: number) => Promise<void>;
    environment?: UrlValidationOptions["environment"];
  };

  constructor(options: FetcherOptions = {}) {
    this.options = {
      timeoutMs: options.timeoutMs ?? 10_000,
      maximumResponseBytes: options.maximumResponseBytes ?? 1_000_000,
      maximumRetries: options.maximumRetries ?? 2,
      backoffBaseMs: options.backoffBaseMs ?? 100,
      fetchImplementation: options.fetchImplementation ?? fetch,
      sleep: options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
      userAgent: options.userAgent ?? "PrepAssistBot/1.0 (+retrieval)",
      environment: options.environment,
      allowCrossOriginRedirects: options.allowCrossOriginRedirects ?? false,
      maximumRedirects: options.maximumRedirects ?? 5,
    };
  }

  async fetchText(requestedUrl: string): Promise<FetchRecord> {
    const startedAt = Date.now();
    let attempts = 0;
    let currentUrl = requestedUrl;
    let redirectCount = 0;
    const origin = new URL(requestedUrl).origin;

    for (let retry = 0; retry <= this.options.maximumRetries; retry += 1) {
      attempts += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

      try {
        const response = await this.options.fetchImplementation(currentUrl, {
          redirect: "manual",
          signal: controller.signal,
          headers: { "user-agent": this.options.userAgent, accept: "text/html, application/xhtml+xml, text/plain" },
        });
        clearTimeout(timeout);

        if (transientStatuses.has(response.status) && retry < this.options.maximumRetries) {
          await this.options.sleep(this.options.backoffBaseMs * 2 ** retry);
          continue;
        }

        if (isRedirectStatus(response.status)) {
          const location = response.headers.get("location");
          if (!location) {
            return makeFailureRecord(requestedUrl, currentUrl, attempts, startedAt, response, "HTTP_ERROR", "Redirect response did not include a Location header");
          }
          if (redirectCount >= this.options.maximumRedirects) {
            return makeFailureRecord(requestedUrl, currentUrl, attempts, startedAt, response, "REDIRECT_LIMIT", "Maximum redirect count exceeded");
          }

          let redirectTarget: string;
          try {
            redirectTarget = normalizeUrl(location, {
              baseUrl: currentUrl,
              environment: this.options.environment,
            });
          } catch {
            return makeFailureRecord(requestedUrl, currentUrl, attempts, startedAt, response, "REDIRECT_BLOCKED", "Redirect target is not allowed");
          }
          if (!this.options.allowCrossOriginRedirects && new URL(redirectTarget).origin !== origin) {
            return makeFailureRecord(requestedUrl, currentUrl, attempts, startedAt, response, "REDIRECT_BLOCKED", "Cross-origin redirects are not allowed");
          }

          currentUrl = redirectTarget;
          redirectCount += 1;
          retry = -1;
          continue;
        }

        const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
        const baseRecord = {
          requestedUrl,
          finalUrl: currentUrl,
          statusCode: response.status,
          contentType,
          responseBytes: 0,
          elapsedMs: Date.now() - startedAt,
          attempts,
        };

        if (!response.ok) {
          return { ...baseRecord, failure: { code: "HTTP_ERROR", message: `HTTP ${response.status}`, statusCode: response.status } };
        }

        if (!contentType || !textContentTypes.includes(contentType)) {
          return { ...baseRecord, failure: { code: "UNSUPPORTED_CONTENT_TYPE", message: "Response content type is not text-like" } };
        }

        const declaredLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > this.options.maximumResponseBytes) {
          return { ...baseRecord, responseBytes: declaredLength, failure: { code: "RESPONSE_TOO_LARGE", message: "Response exceeds the configured byte limit" } };
        }

        const body = await readResponseBody(response, this.options.maximumResponseBytes, controller);
        if (body === null) {
          return { ...baseRecord, failure: { code: "RESPONSE_TOO_LARGE", message: "Response exceeds the configured byte limit" } };
        }

        return { ...baseRecord, responseBytes: Buffer.byteLength(body), text: body };
      } catch (error) {
        clearTimeout(timeout);
        const timedOut = controller.signal.aborted;
        if (!timedOut && retry < this.options.maximumRetries) {
          await this.options.sleep(this.options.backoffBaseMs * 2 ** retry);
          continue;
        }

        return {
          requestedUrl,
          finalUrl: currentUrl,
          responseBytes: 0,
          elapsedMs: Date.now() - startedAt,
          attempts,
          failure: {
            code: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
            message: timedOut ? "Request timed out" : "Network request failed",
          },
        };
      }
    }

    throw new Error("Fetcher retry loop ended unexpectedly");
  }
}

async function readResponseBody(response: Response, maximumBytes: number, controller: AbortController): Promise<string | null> {
  if (!response.body) {
    const text = await response.text();
    return Buffer.byteLength(text) > maximumBytes ? null : text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      controller.abort();
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  return new TextDecoder().decode(concatChunks(chunks, totalBytes));
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function makeFailureRecord(
  requestedUrl: string,
  finalUrl: string,
  attempts: number,
  startedAt: number,
  response: Response,
  code: "HTTP_ERROR" | "REDIRECT_LIMIT" | "REDIRECT_BLOCKED",
  message: string,
): FetchRecord {
  return {
    requestedUrl,
    finalUrl,
    statusCode: response.status,
    responseBytes: 0,
    elapsedMs: Date.now() - startedAt,
    attempts,
    failure: { code, message, statusCode: response.status },
  };
}

function concatChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
