import { describe, expect, it, vi } from "vitest";
import { generateCoverageRepairQuestions, mergeCoverageRepairQuestions } from "../src/generation/coverage-repair.js";
import { generateInterviewKit, type InterviewKitPipelineDependencies } from "../src/pipeline/interview-kit-pipeline.js";
import type { LLMProvider, LLMResponse } from "../src/llm/types.js";
import type { ExtractedRequirement } from "../src/extraction/requirement-extraction.js";
import type { CompanyBriefRoleResult } from "../src/generation/company-brief-role.js";
import type { ResearchBundle } from "../src/retrieval/types.js";
import type { PublicInterviewResearch } from "../src/research/public-interview-types.js";
import type { FinalKitValidationResult } from "../src/deterministic/final-kit-validator.js";

const requirements: ExtractedRequirement[] = [
  { id: "r1", text: "React", kind: "technical", priority: "must" },
  { id: "r2", text: "Mentoring", kind: "behavioural", priority: "must" },
  { id: "r3", text: "Payments", kind: "domain", priority: "nice" },
];

const companyResearch: ResearchBundle = {
  companyUrl: "https://example.com",
  pages: [{ url: "https://example.com/about", finalUrl: "https://example.com/about", title: "About", text: "Company evidence", sourceType: "company", depth: 0, score: 0 }],
  diagnostics: { attempted: 1, succeeded: 1, failed: 0, skipped: 0, robotsStatus: "available" }, failures: [],
};
const interviewResearch: PublicInterviewResearch = {
  queries: [], results: [], sources: [], diagnostics: { queriesAttempted: 0, resultsFound: 0, sourcesAttempted: 0, sourcesSucceeded: 0, sourcesFailed: 0 }, failures: [{ code: "NO_PUBLIC_DISCUSSION", message: "None" }],
};
const roleResult: CompanyBriefRoleResult = {
  company_brief: { summary: "Evidence", what_they_do: "Software", sources: ["https://example.com/about"] },
  role: { title: "Engineer", seniority: "Senior", responsibilities: ["Build software"], requirements },
};

function repairProvider(payload: unknown, requests: string[] = []): LLMProvider {
  return { name: "groq", model: "test", generate: async (request): Promise<LLMResponse> => { requests.push(request.operation ?? ""); return { text: JSON.stringify(payload), provider: "groq", model: "test", usage: {} }; } };
}

function repairInput() {
  return { requirements, uncoveredRequirementIds: ["r1", "r2"], role: roleResult.role, companyResearch, interviewResearch };
}

describe("coverage repair", () => {
  it("uses one bounded structured call for multiple gaps", async () => {
    const calls: string[] = [];
    const result = await generateCoverageRepairQuestions(repairInput(), { provider: repairProvider({ questions: [
      { id: "model-1", requirement_ids: ["r1"], category: "technical", prompt: "Explain React", answer_outline: "Concepts", difficulty: 2 },
      { id: "model-2", requirement_ids: ["r2"], category: "behavioural", prompt: "Describe mentoring", answer_outline: "STAR", difficulty: 1 },
    ] }, calls) });

    expect(calls).toEqual(["repair.questions.coverage"]);
    expect(result).toHaveLength(2);
  });

  it("rejects unknown IDs, malformed output, and unrepaired gaps", async () => {
    await expect(generateCoverageRepairQuestions(repairInput(), { provider: repairProvider({ questions: [{ requirement_ids: ["unknown"], category: "technical", prompt: "x", answer_outline: "y", difficulty: 1 }] }) })).rejects.toThrow("invalid requirement ID");
    await expect(generateCoverageRepairQuestions(repairInput(), { provider: repairProvider({ questions: [{ requirement_ids: ["r1"], category: "technical", prompt: "x", answer_outline: "y", difficulty: 1 }] }) })).rejects.toThrow("did not address");
    await expect(generateCoverageRepairQuestions(repairInput(), { provider: repairProvider("bad json") })).rejects.toMatchObject({ code: "LLM_SCHEMA_VALIDATION_FAILED" });
  });

  it("assigns repair IDs after original questions and preserves originals", () => {
    const original = [{ id: "q1", requirement_ids: ["r1"], category: "technical" as const, prompt: "Original", answer_outline: "Outline", difficulty: 1 as const }];
    const merged = mergeCoverageRepairQuestions(original, [{ requirement_ids: ["r2"], category: "behavioural", prompt: "Repair", answer_outline: "STAR", difficulty: 2 }]);

    expect(merged.map((question) => question.id)).toEqual(["q1", "q2"]);
    expect(merged[0]).toEqual(original[0]);
  });
});

describe("final pipeline coverage repair", () => {
  function dependencies(overrides: Partial<InterviewKitPipelineDependencies> = {}): InterviewKitPipelineDependencies {
    const provider = repairProvider({});
    const initialQuestion = { id: "q1", requirement_ids: ["r1"], category: "technical" as const, prompt: "Explain React", answer_outline: "Concepts", difficulty: 2 as const };
    return {
      provider,
      companyFetcher: { fetchText: vi.fn() }, interviewFetcher: { fetchText: vi.fn() }, publicSearchProvider: { search: vi.fn() },
      extract: vi.fn(async () => ({ requirements, traceability: [] })),
      crawl: vi.fn(async () => companyResearch), searchInterviews: vi.fn(async () => interviewResearch),
      generateBriefRole: vi.fn(async () => roleResult),
      generateQuestions: vi.fn(async () => ({ questions: [initialQuestion] })),
      repairQuestions: vi.fn(async () => [{ id: "model-id", requirement_ids: ["r2"], category: "behavioural" as const, prompt: "Describe mentoring", answer_outline: "STAR", difficulty: 1 as const }]),
      generateFlashcardsStage: vi.fn(async ({ questions }) => ({ flashcards: questions.map((question: { id: string; requirement_ids: string[] }) => ({ id: `model-${question.id}`, front: `Front ${question.id}`, back: "Outline", requirement_ids: question.requirement_ids })), traceability: [] })),
      ...overrides,
    };
  }

  it("repairs a must gap, runs two coverage passes, and includes repaired questions in cards/schedule", async () => {
    const deps = dependencies();
    const result = await generateInterviewKit({ jd: "JD", company_url: "https://example.com", days: 2 }, deps);

    expect(result.status).toBe("newly_generated");
    if (result.status === "newly_generated") {
      expect(result.kit.coverage.passes).toBe(2);
      expect(result.kit.questions.map((question) => question.id)).toEqual(["q1", "q2"]);
      expect(result.kit.flashcards).toHaveLength(2);
      expect(result.kit.schedule.days.flatMap((day) => day.question_ids)).toEqual(expect.arrayContaining(["q1", "q2"]));
    }
    expect(deps.repairQuestions).toHaveBeenCalledTimes(1);
    expect(deps.generateFlashcardsStage).toHaveBeenCalledWith(expect.objectContaining({ questions: expect.arrayContaining([expect.objectContaining({ id: "q2" })]) }), expect.anything());
  });

  it("does not repair nice-only gaps and records one pass", async () => {
    const deps = dependencies({
      extract: vi.fn(async () => ({ requirements: requirements.map((requirement) => requirement.id === "r2" ? { ...requirement, priority: "nice" as const } : requirement), traceability: [] })),
    });
    const result = await generateInterviewKit({ jd: "JD", company_url: "https://example.com", days: 2 }, deps);

    expect(result.status).toBe("newly_generated");
    expect(deps.repairQuestions).not.toHaveBeenCalled();
    if (result.status === "newly_generated") expect(result.kit.coverage.passes).toBe(1);
  });

  it("fails with COVERAGE_UNRESOLVED and does not attempt a third repair", async () => {
    const repair = vi.fn(async () => []);
    const result = await generateInterviewKit({ jd: "JD", company_url: "https://example.com", days: 2 }, dependencies({ repairQuestions: repair }));

    expect(result.status).toBe("failed");
    expect(repair).toHaveBeenCalledTimes(1);
    if (result.status === "failed") expect(result.failure.code).toBe("COVERAGE_UNRESOLVED");
  });

  it("does not run flashcards or schedule when final validation fails", async () => {
    const flashcards = vi.fn(async () => ({ flashcards: [], traceability: [] }));
    const result = await generateInterviewKit(
      { jd: "JD", company_url: "https://example.com", days: 2 },
      dependencies({ generateFlashcardsStage: flashcards, finalizeKit: vi.fn((): FinalKitValidationResult => ({ valid: false, errors: [{ code: "TEST_FAILURE", path: "", message: "invalid" }] })) }),
    );

    expect(result.status).toBe("failed");
    expect(flashcards).toHaveBeenCalledTimes(1);
    if (result.status === "failed") expect(result.failure.code).toBe("FINAL_KIT_VALIDATION_FAILED");
  });

  it("emits repair and second-check progress only when a gap exists", async () => {
    const events: string[] = [];
    await generateInterviewKit({ jd: "JD", company_url: "https://example.com", days: 2 }, { ...dependencies(), onProgress: (event) => events.push(event.stage) });

    expect(events).toContain("REPAIRING_COVERAGE");
    expect(events).toContain("CHECKING_COVERAGE_AGAIN");
    expect(events.filter((stage) => stage === "REPAIRING_COVERAGE")).toHaveLength(2);
  });
});