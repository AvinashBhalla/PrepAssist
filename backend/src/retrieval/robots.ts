import { normalizeUrl } from "./url-validator.js";
import type { HttpFetcher } from "./fetcher.js";

type RobotsRule = { path: string; allow: boolean };

export type RobotsStatus = "available" | "unavailable" | "blocked";

export type RobotsPolicy = {
  status: RobotsStatus;
  isAllowed: (url: string) => boolean;
};

export async function loadRobotsPolicy(
  origin: string,
  fetcher: Pick<HttpFetcher, "fetchText">,
): Promise<RobotsPolicy> {
  const robotsUrl = new URL("/robots.txt", origin).toString();
  const result = await fetcher.fetchText(robotsUrl);

  if (result.failure || !result.text) {
    return { status: "unavailable", isAllowed: () => true };
  }

  const rules = parseRobotsRules(result.text);
  return {
    status: "available",
    isAllowed(url: string) {
      const normalized = normalizeUrl(url);
      const path = new URL(normalized).pathname + new URL(normalized).search;
      const matchingRules = rules.filter((rule) => path.startsWith(rule.path));
      if (matchingRules.length === 0) return true;
      const bestRule = matchingRules.sort((first, second) => second.path.length - first.path.length)[0];
      return bestRule.allow;
    },
  };
}

function parseRobotsRules(content: string): RobotsRule[] {
  const rules: RobotsRule[] = [];
  let appliesToWildcard = false;
  let sawUserAgent = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0].trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const directive = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (directive === "user-agent") {
      sawUserAgent = true;
      appliesToWildcard = value === "*";
      continue;
    }
    if (!sawUserAgent || !appliesToWildcard) continue;
    if (directive === "disallow" && value) rules.push({ path: value, allow: false });
    if (directive === "allow" && value) rules.push({ path: value, allow: true });
  }

  return rules;
}
