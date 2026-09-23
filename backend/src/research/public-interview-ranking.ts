import type {
  PublicInterviewSourceType,
  PublicSearchResult,
} from "./public-interview-types.js";

const interviewTerms = ["interview", "hiring", "recruit", "technical", "onsite", "screen", "process"];
const reportTerms = ["interview report", "experience", "asked", "questions", "rounds", "offer"];
const discussionDomains = ["reddit.com", "glassdoor.com", "blind.com", "teamblind.com", "news.ycombinator.com"];

export function classifyPublicSource(result: PublicSearchResult): PublicInterviewSourceType {
  const value = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
  if (reportTerms.some((term) => value.includes(term))) return "interview-report";
  if (discussionDomains.some((domain) => result.sourceDomain.endsWith(domain)) || value.includes("discussion")) return "discussion";
  if (value.includes("careers") || value.includes("company") || value.includes("about")) return "company";
  return "unknown";
}

export function rankPublicSearchResult(result: PublicSearchResult, roleTitle?: string): number {
  const title = result.title.toLowerCase();
  const snippet = result.snippet.toLowerCase();
  const combined = `${title} ${snippet}`;
  const sourceType = classifyPublicSource(result);
  const role = roleTitle?.trim().toLowerCase();
  const domainScore = discussionDomains.some((domain) => result.sourceDomain.endsWith(domain)) ? 4 : 0;
  const interviewScore = interviewTerms.reduce((score, term) => score + (combined.includes(term) ? 1 : 0), 0);
  const reportScore = sourceType === "interview-report" ? 6 : sourceType === "discussion" ? 4 : 0;
  const roleScore = role && combined.includes(role) ? 4 : 0;

  return reportScore + domainScore + interviewScore + roleScore + Math.max(0, 5 - result.rank);
}

export function rankPublicSearchResults(results: PublicSearchResult[], roleTitle?: string): PublicSearchResult[] {
  return [...results].sort(
    (first, second) =>
      rankPublicSearchResult(second, roleTitle) - rankPublicSearchResult(first, roleTitle) ||
      first.url.localeCompare(second.url),
  );
}
