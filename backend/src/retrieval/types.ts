export type RetrievalEnvironment = "development" | "evaluation" | "production";

export type FetchErrorCode =
  | "INVALID_URL"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "RESPONSE_TOO_LARGE"
  | "REDIRECT_LIMIT"
  | "REDIRECT_BLOCKED";

export type FetchFailure = {
  code: FetchErrorCode;
  message: string;
  statusCode?: number;
};

export type FetchRecord = {
  requestedUrl: string;
  finalUrl: string;
  statusCode?: number;
  contentType?: string;
  responseBytes: number;
  elapsedMs: number;
  attempts: number;
  text?: string;
  failure?: FetchFailure;
};

export type CleanPage = {
  title: string;
  headings: string[];
  text: string;
  canonicalUrl?: string;
};

export type ExtractedLink = {
  sourceUrl: string;
  targetUrl: string;
  anchorText: string;
  title?: string;
  path: string;
};

export type RankedLink = ExtractedLink & {
  score: number;
};

export type ResearchPage = {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  sourceType: "company" | "hiring-candidate" | "unknown";
  depth: number;
  score: number;
};

export type RetrievalFailure = {
  url: string;
  code: string;
  message: string;
  statusCode?: number;
  depth?: number;
};

export type ResearchBundle = {
  companyUrl: string;
  pages: ResearchPage[];
  diagnostics: {
    attempted: number;
    succeeded: number;
    failed: number;
    skipped: number;
    robotsStatus: "available" | "unavailable" | "blocked" | "not-checked";
  };
  failures: RetrievalFailure[];
  topLevelFailure?: RetrievalFailure;
};
