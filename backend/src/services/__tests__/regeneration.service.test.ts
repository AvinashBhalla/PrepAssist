import { test, expect, describe, vi } from "vitest";
import { regenerationService } from "../regeneration.service.js";
import * as questionGeneration from "../../generation/question-generation.js";
import * as coverage from "../../deterministic/coverage.js";

vi.mock("../../generation/question-generation.js");
vi.mock("../../deterministic/coverage.js");
vi.mock("../../generation/company-brief-role.js", () => ({
  generateCompanyBriefAndRole: vi.fn().mockResolvedValue({
    company_brief: { summary: "New summary", what_they_do: "New what they do", sources: [] }
  })
}));

describe("Regeneration Service", () => {
  const getMockKit = () => ({
    kit: {
      role: { requirements: [{ id: "req1", text: "Req 1", kind: "technical", priority: "must" }] },
      questions: [
        { id: "q2", category: "technical", requirement_ids: ["req1"] },
        { id: "q3", category: "behavioural", requirement_ids: [] },
        { id: "q4", category: "technical", requirement_ids: ["req1"] },
      ],
      company_brief: { summary: "Old", what_they_do: "Old", sources: [] }
    } as any,
    itemStates: {
      questions: {
        "q1": "deleted",   // Was deleted, not in array
        "q2": "edited",    // Should be preserved
        "q3": "generated", // Different category, should be preserved
        "q4": "generated"  // Should be regenerated
      },
      company_brief: {
        summary: "edited",
        what_they_do: "generated"
      }
    } as any
  });

  test("edited question survives category regeneration", async () => {
    const data = getMockKit();
    
    vi.mocked(questionGeneration.generateInterviewQuestions).mockResolvedValue({
      questions: [
        { id: "new1", category: "technical", requirement_ids: ["req1"] }
      ]
    } as any);

    vi.mocked(coverage.checkCoverage).mockReturnValue({ uncovered_requirement_ids: [], covered_requirement_ids: [], coverage_by_requirement: {}, unknown_requirement_ids: [] });

    const result = await regenerationService.regenerateCategory(data, "technical", { provider: {} as any });

    const questionIds = result.kit.questions.map(q => q.id);
    expect(questionIds).toContain("q2"); // preserved
    expect(questionIds).toContain("q3"); // preserved (different category)
    expect(questionIds).toContain("new1"); // newly generated
    expect(questionIds).not.toContain("q4"); // replaced

    expect(result.itemStates.questions["new1"]).toBe("generated");
    expect(result.itemStates.questions["q2"]).toBe("edited");
  });

  test("deleted question does not silently reappear", async () => {
    const data = getMockKit();
    data.itemStates.questions["q1"] = "deleted"; // Was deleted

    vi.mocked(questionGeneration.generateInterviewQuestions).mockResolvedValue({
      questions: [
        { id: "new1", category: "technical", requirement_ids: ["req1"] }
      ]
    } as any);
    vi.mocked(coverage.checkCoverage).mockReturnValue({ uncovered_requirement_ids: [], covered_requirement_ids: [], coverage_by_requirement: {}, unknown_requirement_ids: [] });

    const result = await regenerationService.regenerateCategory(data, "technical", { provider: {} as any });

    const questionIds = result.kit.questions.map(q => q.id);
    expect(questionIds).not.toContain("q1"); // Did not reappear
  });

  test("edited company brief survives regeneration", async () => {
    const data = getMockKit();
    const result = await regenerationService.regenerateCompanyBrief(data, { provider: {} as any, jd: "test", companyResearch: {}, publicInterviewResearch: {} });
    
    expect(result.kit.company_brief.summary).toBe("Old"); // Was edited, so preserved
    expect(result.kit.company_brief.what_they_do).toBe("New what they do"); // Was generated, so replaced
  });
});
