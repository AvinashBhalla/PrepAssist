import net from "node:net";
import type { RetrievalEnvironment } from "./types.js";

export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlValidationError";
  }
}

export type UrlValidationOptions = {
  environment?: RetrievalEnvironment;
  baseUrl?: string;
};

const privateHostSuffixes = [".local", ".internal", ".localhost"];

export function normalizeUrl(input: string, options: UrlValidationOptions = {}): string {
  let url: URL;

  try {
    url = new URL(input, options.baseUrl);
  } catch {
    throw new UrlValidationError("URL is malformed");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlValidationError("URL protocol must be http or https");
  }

  if (url.username || url.password) {
    throw new UrlValidationError("URLs containing credentials are not allowed");
  }

  if (!url.hostname || isObviouslyInvalidHost(url.hostname)) {
    throw new UrlValidationError("URL host is invalid");
  }

  const environment = options.environment ?? getDefaultEnvironment();
  if (environment === "production" && isPrivateOrLoopbackHost(url.hostname)) {
    throw new UrlValidationError("Private and loopback hosts are not allowed in production");
  }

  url.hash = "";
  return url.toString();
}

export function isSameCompanyOrigin(first: string, second: string): boolean {
  const firstUrl = new URL(first);
  const secondUrl = new URL(second);
  return firstUrl.origin === secondUrl.origin;
}

export function getDefaultEnvironment(): RetrievalEnvironment {
  if (process.env.NODE_ENV === "production") {
    return "production";
  }
  return process.env.RETRIEVAL_ENV === "evaluation" ? "evaluation" : "development";
}

function isObviouslyInvalidHost(hostname: string): boolean {
  return hostname === "." || hostname.includes(" ") || hostname.endsWith(".") && hostname.length < 2;
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const lowerHost = hostname.toLowerCase();
  if (
    lowerHost === "localhost" ||
    privateHostSuffixes.some((suffix) => lowerHost.endsWith(suffix))
  ) {
    return true;
  }

  const ipVersion = net.isIP(lowerHost);
  if (ipVersion === 6) {
    return lowerHost === "::1" || lowerHost.startsWith("fc") || lowerHost.startsWith("fd") || lowerHost.startsWith("fe80:");
  }

  if (ipVersion !== 4) {
    return false;
  }

  const octets = lowerHost.split(".").map(Number);
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 169 && octets[1] === 254)
  );
}
