import { z } from "zod";
import { createKitFingerprint } from "../utils/fingerprint.js";
import { extractRequirements, type RequirementExtractionResult } from "../extraction/requirement-extraction.js";
import { crawlCompanyWebsite } from "../retrieval/crawler.js";
import type { CrawlerOptions } from "../retrieval/crawler.js";
import type { ResearchBundle } from "../retrieval/types.js";
import { normalizeUrl } from "../retrieval/url-validator.js";
import { researchInterviewProcess } from "../research/public-interview-service.js";
import type { PublicInterviewResearch, PublicSearchProvider } from "../research/public-interview-types.js";
import { generateCompanyBriefAndRole, type CompanyBrief, type CompanyBriefRoleResult, type RoleMetadata } from "../generation/company-brief-role.js";
import { generateInterviewQuestions, type GeneratedQuestion, type QuestionGenerationOptions } from "../generation/question-generation.js";
import { generateFlashcards, type FlashcardGenerationOptions, type GeneratedFlashcard, type FlashcardTraceability } from "../generation/flashcard-generation.js";
import type { LLMProvider } from "../llm/types.js";
import type { HttpFetcher } from "../retrieval/fetcher.js";

export const interviewKitPipelineInputSchema = z.object({
  jd: z.string().trim().min(1),
  company_url: z.string().trim().url(),
  days: z.number().int().positive(),
  userId: z.string().min(1).optional(),
});

export type InterviewKitPipelineInput = z.infer<typeof interviewKitPipelineInputSchema>;

export type PipelineStage =
  | "VALIDATING_INPUT"
  | "EXTRACTING_REQUIREMENTS"
  | "CRAWLING_COMPANY"
  | "SEARCHING_INTERVIEWS"
  | "GENERATING_COMPANY_BRIEF"
  | "GENERATING_QUESTIONS"
  | "GENERATING_FLASHCARDS"
  | "DRAFT_COMPLETE"
  | "FAILED";

export type PipelineProgressStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type PipelineProgressEvent = {
  stage: PipelineStage;
  status: PipelineProgressStatus;
  message: string;
  timestamp: string;
};

export type PipelineFailure = {
  stage: PipelineStage;
  code: string;
  message: string;
  fatal: boolean;
};

export type IncompleteInterviewKitDraft = {
  source: {
    company: string;
    company_url: string;
    role: string;
    location: string;
    jd_chars: number;
    researched_at: string;
    pages_used: string[];
  };
  company_brief: CompanyBrief;
  role: RoleMetadata;
  questions: GeneratedQuestion[];
  flashcards: GeneratedFlashcard[];
  flashcardTraceability: FlashcardTraceability[];
  schedule?: never;
  coverage?: never;
  complete: false;
};

export type InterviewKitPipelineContext = {
  input: InterviewKitPipelineInput;
  fingerprint: string;
  requirements?: RequirementExtractionResult;
  companyResearch?: ResearchBundle;
  interviewResearch?: PublicInterviewResearch;
  companyBrief?: CompanyBrief;
  role?: RoleMetadata;
  questions?: GeneratedQuestion[];
  flashcards?: GeneratedFlashcard[];
  flashcardTraceability?: FlashcardTraceability[];
  existingKit?: unknown;
  diagnostics: {
    companyResearch?: ResearchBundle["diagnostics"];
    interviewResearch?: PublicInterviewResearch["diagnostics"];
    failures: PipelineFailure[];
  };
  progress: PipelineProgressEvent[];
};

export type InterviewKitPipelineResult =
  | { status: "newly_generated"; context: InterviewKitPipelineContext; draft: IncompleteInterviewKitDraft }
  | { status: "reused_existing"; context: InterviewKitPipelineContext; kit: unknown }
  | { status: "failed"; context: InterviewKitPipelineContext; failure: PipelineFailure };

export type InterviewKitPipelineDependencies = {
  provider: LLMProvider;
  companyFetcher: Pick<HttpFetcher, "fetchText">;
  interviewFetcher: Pick<HttpFetcher, "fetchText">;
  publicSearchProvider: PublicSearchProvider;
  duplicateLookup?: (userId: string, fingerprint: string) => Promise<{ kit?: unknown }>;
  extract?: typeof extractRequirements;
  crawl?: typeof crawlCompanyWebsite;
  searchInterviews?: typeof researchInterviewProcess;
  generateBriefRole?: typeof generateCompanyBriefAndRole;
  generateQuestions?: typeof generateInterviewQuestions;
  generateFlashcardsStage?: typeof generateFlashcards;
  onProgress?: (event: PipelineProgressEvent) => void;
  now?: () => string;
  retrievalEnvironment?: CrawlerOptions["environment"];
};

export async function generateInterviewKit(
  rawInput: InterviewKitPipelineInput,
  dependencies: InterviewKitPipelineDependencies,
): Promise<InterviewKitPipelineResult> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const context: InterviewKitPipelineContext = {
    input: rawInput,
    fingerprint: "",
    diagnostics: { failures: [] },
    progress: [],
  };

  try {
    const input = runInputValidation(rawInput, context, dependencies.onProgress, now, dependencies.retrievalEnvironment);
    context.input = input;
    context.fingerprint = createKitFingerprint(input.jd, input.company_url, input.days);
    if (input.userId && dependencies.duplicateLookup) {
      const duplicate = await dependencies.duplicateLookup(input.userId, context.fingerprint);
      if (duplicate.kit !== undefined) {
        context.existingKit = duplicate.kit;
        emit(context, dependencies.onProgress, now, "DRAFT_COMPLETE", "skipped", "Reused existing kit for this user and input");
        return { status: "reused_existing", context, kit: duplicate.kit };
      }
    }

    emit(context, dependencies.onProgress, now, "EXTRACTING_REQUIREMENTS", "running", "Extracting job requirements");
    context.requirements = await (dependencies.extract ?? extractRequirements)({ jd: input.jd }, { provider: dependencies.provider });
    complete(context, dependencies.onProgress, now, "EXTRACTING_REQUIREMENTS", "Requirements extracted");

    emit(context, dependencies.onProgress, now, "CRAWLING_COMPANY", "running", "Researching the company website");
    context.companyResearch = await (dependencies.crawl ?? crawlCompanyWebsite)(input.company_url, { fetcher: dependencies.companyFetcher, environment: dependencies.retrievalEnvironment });
    context.diagnostics.companyResearch = context.companyResearch.diagnostics;
    complete(context, dependencies.onProgress, now, "CRAWLING_COMPANY", "Company research completed with available diagnostics");

    emit(context, dependencies.onProgress, now, "SEARCHING_INTERVIEWS", "running", "Searching public interview discussion");
    context.interviewResearch = await (dependencies.searchInterviews ?? researchInterviewProcess)({ companyName: companyNameFromUrl(input.company_url), companyUrl: input.company_url }, { provider: dependencies.publicSearchProvider, fetcher: dependencies.interviewFetcher, environment: dependencies.retrievalEnvironment });
    context.diagnostics.interviewResearch = context.interviewResearch.diagnostics;
    complete(context, dependencies.onProgress, now, "SEARCHING_INTERVIEWS", "Public interview research completed with available diagnostics");

    emit(context, dependencies.onProgress, now, "GENERATING_COMPANY_BRIEF", "running", "Generating company brief and role metadata");
    const briefRole = await (dependencies.generateBriefRole ?? generateCompanyBriefAndRole)({ jd: input.jd, requirements: context.requirements.requirements, companyResearch: context.companyResearch, publicInterviewResearch: context.interviewResearch }, { provider: dependencies.provider });
    context.companyBrief = briefRole.company_brief;
    context.role = briefRole.role;
    complete(context, dependencies.onProgress, now, "GENERATING_COMPANY_BRIEF", "Company brief and role metadata generated");

    emit(context, dependencies.onProgress, now, "GENERATING_QUESTIONS", "running", "Generating categorized interview questions");
    context.questions = (await (dependencies.generateQuestions ?? generateInterviewQuestions)({ requirements: context.requirements.requirements, companyBrief: context.companyBrief, role: context.role, companyResearch: context.companyResearch, publicInterviewResearch: context.interviewResearch }, { provider: dependencies.provider })).questions;
    complete(context, dependencies.onProgress, now, "GENERATING_QUESTIONS", "Interview questions generated");

    emit(context, dependencies.onProgress, now, "GENERATING_FLASHCARDS", "running", "Generating interview flashcards");
    const flashcards = await (dependencies.generateFlashcardsStage ?? generateFlashcards)({ questions: context.questions, requirements: context.requirements.requirements, role: { title: context.role.title, seniority: context.role.seniority } }, { provider: dependencies.provider });
    context.flashcards = flashcards.flashcards;
    context.flashcardTraceability = flashcards.traceability;
    complete(context, dependencies.onProgress, now, "GENERATING_FLASHCARDS", "Flashcards generated");

    emit(context, dependencies.onProgress, now, "DRAFT_COMPLETE", "completed", "Draft kit is ready for deterministic schedule and coverage stages");
    return { status: "newly_generated", context, draft: assembleDraft(context, now()) };
  } catch (error) {
    const stage = currentRunningStage(context) ?? "FAILED";
    return fail(context, stage, "PIPELINE_STAGE_FAILED", safeMessage(error), true, dependencies.onProgress, now);
  }
}

function runInputValidation(input: InterviewKitPipelineInput, context: InterviewKitPipelineContext, onProgress: InterviewKitPipelineDependencies["onProgress"], now: () => string, environment: CrawlerOptions["environment"]): InterviewKitPipelineInput {
  emit(context, onProgress, now, "VALIDATING_INPUT", "running", "Validating interview kit input");
  const parsed = interviewKitPipelineInputSchema.parse(input);
  normalizeUrl(parsed.company_url, { environment });
  complete(context, onProgress, now, "VALIDATING_INPUT", "Input validated");
  return parsed;
}

function assembleDraft(context: InterviewKitPipelineContext, researchedAt: string): IncompleteInterviewKitDraft {
  const input = context.input;
  const companyResearch = context.companyResearch;
  const role = context.role;
  if (!context.requirements || !companyResearch || !context.interviewResearch || !context.companyBrief || !role || !context.questions || !context.flashcards || !context.flashcardTraceability) throw new Error("Pipeline context is incomplete");
  return {
    source: { company: companyNameFromUrl(input.company_url), company_url: input.company_url, role: role.title, location: "", jd_chars: input.jd.length, researched_at: researchedAt, pages_used: companyResearch.pages.map((page) => page.finalUrl || page.url) },
    company_brief: context.companyBrief,
    role,
    questions: context.questions,
    flashcards: context.flashcards,
    flashcardTraceability: context.flashcardTraceability,
    complete: false,
  };
}

function emit(context: InterviewKitPipelineContext, onProgress: InterviewKitPipelineDependencies["onProgress"], now: () => string, stage: PipelineStage, status: PipelineProgressStatus, message: string): void {
  const event = { stage, status, message, timestamp: now() };
  context.progress.push(event);
  onProgress?.(event);
}

function complete(context: InterviewKitPipelineContext, onProgress: InterviewKitPipelineDependencies["onProgress"], now: () => string, stage: PipelineStage, message: string): void {
  emit(context, onProgress, now, stage, "completed", message);
}

function fail(context: InterviewKitPipelineContext, stage: PipelineStage, code: string, message: string, fatal: boolean, onProgress: InterviewKitPipelineDependencies["onProgress"], now: () => string): { status: "failed"; context: InterviewKitPipelineContext; failure: PipelineFailure } {
  const failure = { stage, code, message, fatal };
  context.diagnostics.failures.push(failure);
  emit(context, onProgress, now, "FAILED", "failed", message);
  return { status: "failed", context, failure };
}

function currentRunningStage(context: InterviewKitPipelineContext): PipelineStage | undefined {
  return [...context.progress].reverse().find((event) => event.status === "running")?.stage;
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Pipeline stage failed";
}

function companyNameFromUrl(companyUrl: string): string {
  return new URL(companyUrl).hostname.replace(/^www\./, "");
}
