import { describe, expect, it, vi } from "vitest";
import { generateInterviewKit, type InterviewKitPipelineDependencies } from "../src/pipeline/interview-kit-pipeline.js";
import type { RequirementExtractionResult } from "../src/extraction/requirement-extraction.js";
import type { CompanyBriefRoleResult } from "../src/generation/company-brief-role.js";
import type { QuestionGenerationResult } from "../src/generation/question-generation.js";
import type { FlashcardGenerationResult } from "../src/generation/flashcard-generation.js";
import type { LLMProvider } from "../src/llm/types.js";
import type { PublicInterviewResearch } from "../src/research/public-interview-types.js";
import type { ResearchBundle } from "../src/retrieval/types.js";
import { createKitFingerprint } from "../src/utils/fingerprint.js";

const requirements: RequirementExtractionResult = {
  requirements: [{ id: "r1", text: "React", kind: "technical", priority: "must" }],
  traceability: [{ requirementId: "r1", evidence: "React required" }],
};

const companyResearch: ResearchBundle = {
  companyUrl: "https://example.com",
  pages: [{ url: "https://example.com/about", finalUrl: "https://example.com/about", title: "About", text: "Company evidence", sourceType: "company", depth: 0, score: 0 }],
  diagnostics: { attempted: 1, succeeded: 1, failed: 0, skipped: 0, robotsStatus: "available" },
  failures: [],
};

const interviewResearch: PublicInterviewResearch = {
  queries: ["example interview process"], results: [], sources: [],
  diagnostics: { queriesAttempted: 1, resultsFound: 0, sourcesAttempted: 0, sourcesSucceeded: 0, sourcesFailed: 0 },
  failures: [{ code: "NO_PUBLIC_DISCUSSION", message: "No public interview discussion results were found." }],
};

const companyRole: CompanyBriefRoleResult = {
  company_brief: { summary: "Evidence summary", what_they_do: "Build software", sources: ["https://example.com/about"] },
  role: { title: "Frontend Engineer", seniority: "unspecified", responsibilities: ["Build interfaces"], requirements: requirements.requirements },
};

const questions: QuestionGenerationResult = {
  questions: [{ id: "q1", requirement_ids: ["r1"], category: "technical", prompt: "Explain React", answer_outline: "Discuss rendering", difficulty: 2 }],
};

const flashcards: FlashcardGenerationResult = {
  flashcards: [{ id: "f1", front: "What is React?", back: "Rendering concepts", requirement_ids: ["r1"] }],
  traceability: [{ flashcardId: "f1", questionId: "q1" }],
};

function baseDependencies(order: string[], overrides: Partial<InterviewKitPipelineDependencies> = {}): InterviewKitPipelineDependencies {
  const provider = { name: "groq", model: "test", generate: vi.fn() } as unknown as LLMProvider;
  return {
    provider,
    companyFetcher: { fetchText: vi.fn() },
    interviewFetcher: { fetchText: vi.fn() },
    publicSearchProvider: { search: vi.fn() },
    now: () => "2026-09-23T00:00:00.000Z",
    extract: vi.fn(async () => { order.push("extract"); return requirements; }),
    crawl: vi.fn(async () => { order.push("crawl"); return companyResearch; }),
    searchInterviews: vi.fn(async () => { order.push("search"); return interviewResearch; }),
    generateBriefRole: vi.fn(async () => { order.push("brief"); return companyRole; }),
    generateQuestions: vi.fn(async () => { order.push("questions"); return questions; }),
    generateFlashcardsStage: vi.fn(async () => { order.push("flashcards"); return flashcards; }),
    ...overrides,
  };
}

describe("interview kit pipeline orchestration", () => {
  it("runs the complete pipeline in the required order", async () => {
    const order: string[] = [];
    const result = await generateInterviewKit({ jd: "Frontend Engineer", company_url: "https://example.com", days: 5 }, baseDependencies(order));

    expect(result.status).toBe("newly_generated");
    expect(order).toEqual(["extract", "crawl", "search", "brief", "questions", "flashcards"]);
  });

  it("passes JD to extraction and research before brief/question generation", async () => {
    const extractionInput = vi.fn(async () => requirements);
    const briefInput = vi.fn(async () => companyRole);
    const questionInput = vi.fn(async () => questions);
    const result = await generateInterviewKit(
      { jd: "React required", company_url: "https://example.com", days: 3 },
      baseDependencies([], {
        extract: extractionInput,
        generateBriefRole: briefInput,
        generateQuestions: questionInput,
      }),
    );

    expect(result.status).toBe("newly_generated");
    expect(extractionInput).toHaveBeenCalledWith({ jd: "React required" }, expect.anything());
    expect(briefInput).toHaveBeenCalledWith(expect.objectContaining({ jd: "React required", companyResearch, publicInterviewResearch: interviewResearch }), expect.anything());
    expect(questionInput).toHaveBeenCalledWith(expect.objectContaining({ companyResearch, publicInterviewResearch: interviewResearch, requirements: requirements.requirements }), expect.anything());
  });

  it("passes requirements unchanged through role, question, and flashcard stages", async () => {
    const roleInput = vi.fn(async () => companyRole);
    const questionInput = vi.fn(async () => questions);
    const flashcardInput = vi.fn(async () => flashcards);
    await generateInterviewKit({ jd: "JD", company_url: "https://example.com", days: 2 }, baseDependencies([], { generateBriefRole: roleInput, generateQuestions: questionInput, generateFlashcardsStage: flashcardInput }));

    const roleCall = roleInput.mock.calls[0] as unknown as [{ requirements: RequirementExtractionResult["requirements"] }];
    const questionCall = questionInput.mock.calls[0] as unknown as [{ requirements: RequirementExtractionResult["requirements"] }];
    const flashcardCall = flashcardInput.mock.calls[0] as unknown as [{ requirements: RequirementExtractionResult["requirements"] }];
    expect(roleCall[0].requirements).toBe(requirements.requirements);
    expect(questionCall[0].requirements).toBe(requirements.requirements);
    expect(flashcardCall[0].requirements).toBe(requirements.requirements);
  });

  it("preserves stable requirement, question, and flashcard IDs", async () => {
    const result = await generateInterviewKit({ jd: "JD", company_url: "https://example.com", days: 2 }, baseDependencies([]));

    if (result.status !== "newly_generated") throw new Error("Expected draft");
    expect(result.context.requirements?.requirements[0].id).toBe("r1");
    expect(result.context.questions?.[0].id).toBe("q1");
    expect(result.context.flashcards?.[0].id).toBe("f1");
  });

  it("returns an incomplete draft without schedule or coverage", async () => {
    const result = await generateInterviewKit({ jd: "JD", company_url: "https://example.com", days: 2 }, baseDependencies([]));

    expect(result.status).toBe("newly_generated");
    if (result.status === "newly_generated") {
      expect(result.draft.complete).toBe(false);
      expect(result.draft.schedule).toBeUndefined();
      expect(result.draft.coverage).toBeUndefined();
    }
  });

  it("keeps public research absence and partial company failures non-fatal", async () => {
    const partialCompany = { ...companyResearch, diagnostics: { ...companyResearch.diagnostics, failed: 1 }, failures: [{ url: "https://example.com/jobs", code: "HTTP_ERROR", message: "HTTP 404" }] };
    const missingPublic: PublicInterviewResearch = { ...interviewResearch, diagnostics: { ...interviewResearch.diagnostics }, failures: [{ code: "NO_PUBLIC_DISCUSSION", message: "None found" }] };
    const result = await generateInterviewKit(
      { jd: "JD", company_url: "https://example.com", days: 2 },
      baseDependencies([], { crawl: vi.fn(async () => partialCompany), searchInterviews: vi.fn(async () => missingPublic) }),
    );

    expect(result.status).toBe("newly_generated");
    if (result.status === "newly_generated") {
      expect(result.context.diagnostics.companyResearch?.failed).toBe(1);
      expect(result.context.diagnostics.interviewResearch?.resultsFound).toBe(0);
    }
  });

  it("fails fatally when requirement extraction fails", async () => {
    const result = await generateInterviewKit(
      { jd: "JD", company_url: "https://example.com", days: 2 },
      baseDependencies([], { extract: vi.fn(async () => { throw new Error("invalid extraction output"); }) }),
    );

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.failure.stage).toBe("EXTRACTING_REQUIREMENTS");
  });

  it("returns structured failure when question generation fails", async () => {
    const result = await generateInterviewKit(
      { jd: "JD", company_url: "https://example.com", days: 2 },
      baseDependencies([], { generateQuestions: vi.fn(async () => { throw new Error("question failure"); }) }),
    );

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.failure).toMatchObject({ stage: "GENERATING_QUESTIONS", fatal: true });
  });

  it("calls duplicate lookup with userId and deterministic fingerprint", async () => {
    const lookup = vi.fn(async () => ({}));
    const result = await generateInterviewKit(
      { jd: " JD ", company_url: "HTTPS://EXAMPLE.COM", days: 2, userId: "user-1" },
      baseDependencies([], { duplicateLookup: lookup }),
    );

    expect(result.status).toBe("newly_generated");
    expect(lookup).toHaveBeenCalledWith("user-1", expect.any(String));
    expect(result.context.fingerprint).toBeTruthy();
  });

  it("reuses an existing kit for the same user before extraction", async () => {
    const order: string[] = [];
    const existingKit = { id: "kit-1", status: "ready" };
    const result = await generateInterviewKit(
      { jd: "JD", company_url: "https://example.com", days: 2, userId: "user-1" },
      baseDependencies(order, { duplicateLookup: vi.fn(async () => ({ kit: existingKit })) }),
    );

    expect(result.status).toBe("reused_existing");
    expect(order).toEqual([]);
    if (result.status === "reused_existing") expect(result.kit).toBe(existingKit);
  });

  it("uses different fingerprints for changed days, JD, and company URL", () => {
    const base = createKitFingerprint("JD", "https://example.com", 2);
    expect(createKitFingerprint("JD", "https://example.com", 3)).not.toBe(base);
    expect(createKitFingerprint("Different JD", "https://example.com", 2)).not.toBe(base);
    expect(createKitFingerprint("JD", "https://other.example", 2)).not.toBe(base);
  });

  it("cannot reuse another user's kit because lookup is user-scoped", async () => {
    const lookup = vi.fn(async (userId: string) => userId === "owner-2" ? { kit: { id: "owner-2-kit" } } : {});
    const result = await generateInterviewKit(
      { jd: "JD", company_url: "https://example.com", days: 2, userId: "owner-1" },
      baseDependencies([], { duplicateLookup: lookup }),
    );

    expect(result.status).toBe("newly_generated");
    expect(lookup).toHaveBeenCalledWith("owner-1", expect.any(String));
  });

  it("emits progress stages in order and never includes secrets", async () => {
    const events: string[] = [];
    const progress = vi.fn((event) => events.push(`${event.stage}:${event.status}`));
    const result = await generateInterviewKit({ jd: "JD", company_url: "https://example.com", days: 2 }, { ...baseDependencies([]), onProgress: progress });

    expect(result.status).toBe("newly_generated");
    expect(events).toEqual([
      "VALIDATING_INPUT:running", "VALIDATING_INPUT:completed",
      "EXTRACTING_REQUIREMENTS:running", "EXTRACTING_REQUIREMENTS:completed",
      "CRAWLING_COMPANY:running", "CRAWLING_COMPANY:completed",
      "SEARCHING_INTERVIEWS:running", "SEARCHING_INTERVIEWS:completed",
      "GENERATING_COMPANY_BRIEF:running", "GENERATING_COMPANY_BRIEF:completed",
      "GENERATING_QUESTIONS:running", "GENERATING_QUESTIONS:completed",
      "GENERATING_FLASHCARDS:running", "GENERATING_FLASHCARDS:completed",
      "DRAFT_COMPLETE:completed",
    ]);
    expect(JSON.stringify(progress.mock.calls)).not.toContain("password");
    expect(JSON.stringify(progress.mock.calls)).not.toContain("api_key");
  });

  it("does not perform retries or unexpected provider calls in orchestration", async () => {
    const provider = { name: "groq", model: "test", generate: vi.fn() } as unknown as LLMProvider;
    const dependencies = baseDependencies([], { provider });
    const result = await generateInterviewKit({ jd: "JD", company_url: "https://example.com", days: 2 }, dependencies);

    expect(result.status).toBe("newly_generated");
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("rejects invalid input as a structured failed result", async () => {
    const result = await generateInterviewKit({ jd: "", company_url: "not-url", days: 0 } as never, baseDependencies([]));

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.failure.stage).toBe("VALIDATING_INPUT");
  });
});