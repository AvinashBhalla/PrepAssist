import { load } from "cheerio";
import type { CleanPage } from "./types.js";
import { normalizeUrl } from "./url-validator.js";

export function cleanHtml(html: string, baseUrl?: string): CleanPage {
  const $ = load(html);
  $("script, style, noscript, template, svg, [hidden], [aria-hidden='true'], nav, footer").remove();
  const root = $("main, article").first().length > 0 ? $("main, article").first() : $("body");
  const headings = root.find("h1, h2, h3").map((_index, element) => normalizeWhitespace($(element).text())).get().filter(Boolean);
  const title = normalizeWhitespace($("title").first().text());
  const text = normalizeWhitespace(root.text());
  const canonical = $("link[rel='canonical']").attr("href");
  let canonicalUrl: string | undefined;
  if (canonical) {
    try {
      canonicalUrl = normalizeUrl(canonical, { baseUrl });
    } catch {
      canonicalUrl = undefined;
    }
  }

  return {
    title,
    headings,
    text,
    ...(canonicalUrl ? { canonicalUrl } : {}),
  };
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
