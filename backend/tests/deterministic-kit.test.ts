import { describe, expect, it } from "vitest";
import { checkCoverage } from "../src/deterministic/coverage.js";
import { allocateSchedule, durationForDifficulty, questionPriorityScore } from "../src/deterministic/schedule.js";
import { validateFinalKit } from "../src/deterministic/final-kit-validator.js";
import type { ExtractedRequirement } from "../src/extraction/requirement-extraction.js";
import type { GeneratedQuestion } from "../src/generation/question-generation.js";
import type { GeneratedFlashcard } from "../src/generation/flashcard-generation.js";
import type { AppendixAKit } from "@prep-assist/shared";

const requirements: ExtractedRequirement[] = [
  { id: "r1", text: "React", kind: "technical", priority: "must" },
  { id: "r2", text: "Mentoring", kind: "behavioural", priority: "must" },
  { id: "r3", text: "Payments", kind: "domain", priority: "nice" },
];

const questions: GeneratedQuestion[] = [
  { id: "q1", requirement_ids: ["r1"], category: "technical", prompt: "Explain React", answer_outline: "Rendering", difficulty: 3 },
  { id: "q2", requirement_ids: ["r1", "r2"], category: "behavioural", prompt: "Describe mentoring with React", answer_outline: "Situation action result", difficulty: 1 },
  { id: "q3", requirement_ids: ["r3"], category: "system-design", prompt: "Design payments", answer_outline: "Trade-offs", difficulty: 2 },
];

const flashcards: GeneratedFlashcard[] = [
  { id: "f1", front: "What is React?", back: "Rendering", requirement_ids: ["r1"] },
  { id: "f2", front: "How do you mentor?", back: "Situation action result", requirement_ids: ["r2"] },
];

function validKit(days = 2): AppendixAKit {
  const schedule = allocateSchedule(requirements, questions, days);
  return {
    source: { company: "Example", company_url: "https://example.com", role: "Engineer", location: "Remote", jd_chars: 100, researched_at: "2026-09-23", pages_used: ["https://example.com/about"] },
    company_brief: { summary: "Example builds software.", what_they_do: "Software for teams.", sources: ["https://example.com/about"] },
    role: { title: "Engineer", seniority: "Senior", responsibilities: ["Build software"], requirements },
    questions,
    flashcards,
    schedule,
    coverage: { uncovered_requirement_ids: ["r3"], passes: 1 },
  };
}

describe("deterministic coverage", () => {
  it("covers all must requirements and preserves requirement order", () => {
    const result = checkCoverage(requirements, questions);

    expect(result.uncovered_requirement_ids).toEqual([]);
    expect(result.covered_requirement_ids).toEqual(["r1", "r2", "r3"]);
    expect(Object.keys(result.coverage_by_requirement)).toEqual(["r1", "r2", "r3"]);
  });

  it("reports one and multiple uncovered must requirements", () => {
    expect(checkCoverage(requirements, [questions[0]]).uncovered_requirement_ids).toEqual(["r2"]);
    expect(checkCoverage(requirements, []).uncovered_requirement_ids).toEqual(["r1", "r2"]);
  });

  it("does not fail for an uncovered nice requirement", () => {
    const result = checkCoverage(requirements, [questions[0], questions[1]]);

    expect(result.uncovered_requirement_ids).toEqual([]);
    expect(result.coverage_by_requirement.r3.covered).toBe(false);
  });

  it("supports one question covering multiple requirements", () => {
    const result = checkCoverage(requirements, [questions[1]]);

    expect(result.coverage_by_requirement.r1.question_ids).toEqual(["q2"]);
    expect(result.coverage_by_requirement.r2.question_ids).toEqual(["q2"]);
  });

  it("reports unknown IDs without creating phantom requirements", () => {
    const result = checkCoverage(requirements, [{ id: "q9", requirement_ids: ["unknown"] }]);

    expect(result.unknown_requirement_ids).toEqual(["unknown"]);
    expect(Object.keys(result.coverage_by_requirement)).toEqual(["r1", "r2", "r3"]);
  });

  it("is deterministic and does not mutate inputs", () => {
    const original = structuredClone(questions);
    const first = checkCoverage(requirements, questions);
    const second = checkCoverage(requirements, questions);

    expect(second).toEqual(first);
    expect(questions).toEqual(original);
  });
});

describe("deterministic schedule allocation", () => {
  it("maps difficulty to integer durations", () => {
    expect(durationForDifficulty(1)).toBe(10);
    expect(durationForDifficulty(2)).toBe(15);
    expect(durationForDifficulty(3)).toBe(25);
  });

  it("returns exactly one day with all questions", () => {
    const schedule = allocateSchedule(requirements, questions, 1);

    expect(schedule.days).toHaveLength(1);
    expect(schedule.days[0].question_ids).toEqual(["q2", "q1", "q3"]);
    expect(schedule.days[0].minutes).toBe(50);
  });

  it.each([5, 60])("returns exactly %s days with matching days_available", (days) => {
    const schedule = allocateSchedule(requirements, questions, days);

    expect(schedule.days).toHaveLength(days);
    expect(schedule.days_available).toBe(days);
    expect(schedule.days.map((day) => day.day)).toEqual(Array.from({ length: days }, (_value, index) => index + 1));
  });

  it("rejects zero, negative, fractional, and excessive day counts", () => {
    expect(() => allocateSchedule(requirements, questions, 0)).toThrow();
    expect(() => allocateSchedule(requirements, questions, -1)).toThrow();
    expect(() => allocateSchedule(requirements, questions, 1.5)).toThrow();
    expect(() => allocateSchedule(requirements, questions, 3651)).toThrow();
  });

  it("is deterministic, schedules each existing question once, and leaves valid empty days", () => {
    const first = allocateSchedule(requirements, questions, 5);
    const second = allocateSchedule(requirements, questions, 5);
    const scheduledIds = first.days.flatMap((day) => day.question_ids);

    expect(second).toEqual(first);
    expect(new Set(scheduledIds).size).toBe(questions.length);
    expect(scheduledIds.sort()).toEqual(["q1", "q2", "q3"]);
    expect(first.days.some((day) => day.question_ids.length === 0 && day.minutes === 0)).toBe(true);
  });

  it("prioritizes must coverage, multiple must coverage, difficulty, then question ID", () => {
    const multiMust = { ...questions[1], id: "q0", requirement_ids: ["r1", "r2"] };
    expect(questionPriorityScore(multiMust, requirements)).toBeGreaterThan(questionPriorityScore(questions[0], requirements));
    expect(questionPriorityScore(questions[0], requirements)).toBeGreaterThan(questionPriorityScore(questions[2], requirements));
    const schedule = allocateSchedule(requirements, [questions[2], questions[0], multiMust], 3);
    expect(schedule.days[0].question_ids).toEqual(["q0"]);
  });

  it("produces deterministic focus strings and never invents question IDs", () => {
    const schedule = allocateSchedule(requirements, questions, 2);
    const ids = new Set(questions.map((question) => question.id));

    expect(schedule.days.every((day) => day.question_ids.every((id) => ids.has(id)))).toBe(true);
    expect(schedule.days.every((day) => typeof day.focus === "string")).toBe(true);
  });
});

describe("final Appendix A validation", () => {
  it("accepts a valid complete kit", () => {
    const kit = validKit();
    kit.coverage.uncovered_requirement_ids = [];
    expect(validateFinalKit(kit, 2)).toEqual({ valid: true, kit, errors: [] });
  });

  it("rejects missing or unexpected top-level sections", () => {
    const missing = validKit() as Partial<AppendixAKit>;
    delete missing.coverage;
    expect(validateFinalKit(missing, 2).valid).toBe(false);
    expect(validateFinalKit({ ...validKit(), unexpected: true }, 2).valid).toBe(false);
  });

  it("rejects invalid requirement kind and priority", () => {
    const invalid = validKit() as unknown as Record<string, unknown>;
    const role = invalid.role as { requirements: Array<Record<string, unknown>> };
    role.requirements[0].kind = "other";
    role.requirements[0].priority = "required";
    const result = validateFinalKit(invalid, 2);

    expect(result.valid).toBe(false);
  });

  it("rejects invalid question category and difficulty", () => {
    const invalid = structuredClone(validKit()) as unknown as { questions: Array<Record<string, unknown>> };
    invalid.questions[0].category = "culture";
    invalid.questions[0].difficulty = 4;
    expect(validateFinalKit(invalid, 2).valid).toBe(false);
  });

  it("rejects unknown question, flashcard, and schedule references", () => {
    const invalid = structuredClone(validKit()) as unknown as { questions: Array<{ requirement_ids: string[] }>; flashcards: Array<{ requirement_ids: string[] }>; schedule: { days: Array<{ question_ids: string[] }> } };
    invalid.questions[0].requirement_ids = ["unknown"];
    invalid.flashcards[0].requirement_ids = ["unknown"];
    invalid.schedule.days[0].question_ids = ["unknown"];
    expect(validateFinalKit(invalid, 2).valid).toBe(false);
  });

  it("rejects duplicate IDs and schedule shape/count errors", () => {
    const invalid = structuredClone(validKit()) as unknown as AppendixAKit;
    invalid.role.requirements[1].id = "r1";
    invalid.questions[1].id = "q1";
    invalid.flashcards[1].id = "f1";
    invalid.schedule.days.pop();
    invalid.schedule.days_available = 3;
    expect(validateFinalKit(invalid, 2).valid).toBe(false);
  });

  it("rejects non-integer/negative minutes and invalid coverage passes", () => {
    const invalid = structuredClone(validKit()) as unknown as AppendixAKit;
    invalid.schedule.days[0].minutes = -1.5;
    invalid.coverage.passes = 0;
    expect(validateFinalKit(invalid, 2).valid).toBe(false);
  });

  it("rejects uncovered must requirements and coverage mismatches", () => {
    const invalid = structuredClone(validKit());
    invalid.coverage.uncovered_requirement_ids = ["r1"];
    expect(validateFinalKit(invalid, 2).valid).toBe(false);
    const mismatch = structuredClone(validKit());
    mismatch.coverage.uncovered_requirement_ids = ["r3"];
    expect(validateFinalKit(mismatch, 2).valid).toBe(false);
  });

  it("rejects days_available mismatch and returns structured errors", () => {
    const invalid = structuredClone(validKit());
    invalid.schedule.days_available = 4;
    const result = validateFinalKit(invalid, 2);

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.length).toBeGreaterThan(0);
  });
});