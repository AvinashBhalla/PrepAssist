import { beforeEach, describe, expect, it } from "vitest";
import { getMongoUri } from "../src/config/database.js";
import { createKitFingerprint } from "../src/utils/fingerprint.js";
import {
  appendixAKitSchema,
  type AppendixAKit,
} from "@prep-assist/shared";

const validKit: AppendixAKit = {
  source: {
    company: "Example Co",
    company_url: "https://example.com",
    role: "Engineer",
    location: "Remote",
    jd_chars: 1200,
    researched_at: "2026-09-21T00:00:00.000Z",
    pages_used: [],
  },
  company_brief: {
    summary: "A company summary.",
    what_they_do: "They build software.",
    sources: [],
  },
  role: {
    title: "Engineer",
    seniority: "Mid-level",
    responsibilities: ["Build software"],
    requirements: [
      { id: "req-1", text: "TypeScript", kind: "technical", priority: "must" },
    ],
  },
  questions: [
    {
      id: "q-1",
      requirement_ids: ["req-1"],
      category: "technical",
      prompt: "Explain TypeScript.",
      answer_outline: "Mention types.",
      difficulty: 2,
    },
  ],
  flashcards: [
    { id: "fc-1", front: "TypeScript", back: "A typed language", requirement_ids: ["req-1"] },
  ],
  schedule: {
    days_available: 1,
    days: [{ day: 1, focus: "TypeScript", question_ids: ["q-1"], minutes: 30 }],
  },
  coverage: { uncovered_requirement_ids: [], passes: 1 },
};

describe("MongoDB configuration", () => {
  beforeEach(() => {
    delete process.env.MONGODB_URI;
  });

  it("fails clearly when MONGODB_URI is missing", () => {
    expect(() => getMongoUri()).toThrow("MONGODB_URI is required");
  });

  it("returns the configured URI without logging it", () => {
    process.env.MONGODB_URI = "mongodb://example.test/prep-assist";
    expect(getMongoUri()).toBe("mongodb://example.test/prep-assist");
  });
});

describe("kit fingerprint", () => {
  it("is deterministic", () => {
    expect(createKitFingerprint("JD", "https://example.com", 5)).toBe(
      createKitFingerprint("JD", "https://example.com", 5),
    );
  });

  it("changes when relevant input changes", () => {
    const fingerprint = createKitFingerprint("JD", "https://example.com", 5);
    expect(createKitFingerprint("different JD", "https://example.com", 5)).not.toBe(fingerprint);
    expect(createKitFingerprint("JD", "https://other.example.com", 5)).not.toBe(fingerprint);
    expect(createKitFingerprint("JD", "https://example.com", 6)).not.toBe(fingerprint);
  });
});

describe("Appendix A validation", () => {
  it("accepts valid data", () => {
    expect(appendixAKitSchema.safeParse(validKit).success).toBe(true);
  });

  it("rejects invalid difficulty, priority, kind, and category", () => {
    const invalidKit = structuredClone(validKit);
    invalidKit.questions[0].difficulty = 4;
    invalidKit.role.requirements[0].priority = "required" as "must";
    invalidKit.role.requirements[0].kind = "soft" as "technical";
    invalidKit.questions[0].category = "culture" as "technical";

    expect(appendixAKitSchema.safeParse(invalidKit).success).toBe(false);
  });

  it("rejects non-integer schedule minutes", () => {
    const invalidKit = structuredClone(validKit);
    invalidKit.schedule.days[0].minutes = 10.5;

    expect(appendixAKitSchema.safeParse(invalidKit).success).toBe(false);
  });

  it("rejects omitted required top-level fields", () => {
    const invalidKit = structuredClone(validKit) as Partial<AppendixAKit>;
    delete invalidKit.coverage;

    expect(appendixAKitSchema.safeParse(invalidKit).success).toBe(false);
  });
});