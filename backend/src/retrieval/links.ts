import { load } from "cheerio";
import { normalizeUrl } from "./url-validator.js";
import type { ExtractedLink } from "./types.js";

const ignoredExtensions = /\.(?:pdf|zip|tar|gz|png|jpe?g|gif|svg|webp|ico|mp4|mp3|woff2?|ttf|css|js)(?:$|\?)/i;

export function extractLinks(html: string, sourceUrl: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();
  const $ = load(html);

  $("a[href]").each((_index, anchor) => {
    const rawHref = $(anchor).attr("href") ?? "";
    if (/^(?:javascript:|mailto:|tel:|#)/i.test(rawHref)) return;

    let targetUrl: string;
    try {
      targetUrl = normalizeUrl(rawHref, { baseUrl: sourceUrl });
      if (!sameOrigin(targetUrl, sourceUrl) || ignoredExtensions.test(new URL(targetUrl).pathname)) return;
    } catch {
      return;
    }

    if (seen.has(targetUrl)) return;
    seen.add(targetUrl);
    const anchorText = $(anchor).text().replace(/\s+/g, " ").trim();
    const title = $(anchor).attr("title")?.trim() || undefined;
    links.push({ sourceUrl, targetUrl, anchorText, title, path: new URL(targetUrl).pathname });
  });

  return links;
}

function sameOrigin(first: string, second: string): boolean {
  return new URL(first).origin === new URL(second).origin;
}
