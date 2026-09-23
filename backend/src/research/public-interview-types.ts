export type PublicSearchResult = {
  title: string;
  url: string;
  snippet: string;
  sourceDomain: string;
  query: string;
  rank: number;
};

export type PublicSearchOptions = {
  maximumResults?: number;
};

export interface PublicSearchProvider {
  search(query: string, options?: PublicSearchOptions): Promise<PublicSearchResult[]>;
}

export type PublicInterviewSourceType =
  | "interview-report"
  | "discussion"
  | "company"
  | "unknown";

export type PublicInterviewSource = {
  url: string;
  title: string;
  domain: string;
  sourceType: PublicInterviewSourceType;
  snippet: string;
  text: string;
  retrievedAt: string;
};

export type PublicResearchFailure = {
  code:
    | "SEARCH_PROVIDER_UNAVAILABLE"
    | "SEARCH_TIMEOUT"
    | "SOURCE_UNREACHABLE"
    | "SOURCE_BLOCKED"
    | "SOURCE_INVALID"
    | "NO_PUBLIC_DISCUSSION";
  message: string;
  query?: string;
  url?: string;
};

export type PublicInterviewResearch = {
  queries: string[];
  results: PublicSearchResult[];
  sources: PublicInterviewSource[];
  diagnostics: {
    queriesAttempted: number;
    resultsFound: number;
    sourcesAttempted: number;
    sourcesSucceeded: number;
    sourcesFailed: number;
  };
  failures: PublicResearchFailure[];
};
