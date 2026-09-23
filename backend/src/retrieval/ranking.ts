import type { ExtractedLink, RankedLink } from "./types.js";

const signals = [
  "careers", "career", "jobs", "job", "hiring", "interview", "engineering", "engineer",
  "about", "company", "culture", "handbook", "working", "work", "teams", "team",
];

export function scoreLink(link: ExtractedLink, pageTitle = ""): number {
  const anchorScore = scoreText(link.anchorText) * 4;
  const pathScore = scoreText(link.path) * 3;
  const titleScore = scoreText(pageTitle) * 2;
  return anchorScore + pathScore + titleScore;
}

export function rankLinks(links: ExtractedLink[], pageTitle = ""): RankedLink[] {
  return links
    .map((link) => ({ ...link, score: scoreLink(link, pageTitle) }))
    .sort((first, second) => second.score - first.score || first.targetUrl.localeCompare(second.targetUrl));
}

export function classifyHiringCandidate(link: RankedLink): "company" | "hiring-candidate" | "unknown" {
  const value = `${link.anchorText} ${link.title ?? ""} ${link.path}`.toLowerCase();
  return /career|job|hiring|interview|recruit|talent|people|working/.test(value)
    ? "hiring-candidate"
    : link.score > 0
      ? "company"
      : "unknown";
}

function scoreText(value: string): number {
  const lowerValue = value.toLowerCase();
  return signals.reduce((score, signal) => score + (lowerValue.includes(signal) ? 1 : 0), 0);
}
