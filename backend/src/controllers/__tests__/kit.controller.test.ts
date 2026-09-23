import { test, expect, describe, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../app.js";
import { kitRepository } from "../../repositories/kit.repository.js";
import { Types } from "mongoose";
import * as authService from "../../services/auth.service.js";

vi.mock("../../repositories/kit.repository.js");
vi.mock("../../pipeline/interview-kit-pipeline.js", () => ({
  generateInterviewKit: vi.fn().mockResolvedValue({
    status: "newly_generated",
    kit: {
      source: { company: "Test", role: "Dev", jd_chars: 100, researched_at: new Date().toISOString(), company_url: "https://test.com", location: "", pages_used: [] },
      company_brief: { summary: "Test", what_they_do: "Test", sources: [] },
      role: { title: "Dev", seniority: "Mid", responsibilities: [], requirements: [] },
      questions: [],
      flashcards: [],
      schedule: { days_available: 5, days: [] },
      coverage: { uncovered_requirement_ids: [], passes: 1 }
    }
  })
}));
vi.mock("../../services/auth.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/auth.service.js")>();
  return {
    ...actual,
    verifySessionToken: vi.fn(),
  };
});
vi.mock("../../llm/factory.js", () => ({
  createLLMProvider: vi.fn().mockReturnValue({}),
}));

const mockUserId = new Types.ObjectId().toHexString();
const mockToken = "mock_token";

describe("Kit Controller API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authService.verifySessionToken).mockReturnValue(mockUserId);
  });

  test("unauthenticated create rejected", async () => {
    const res = await request(app)
      .post("/api/kits")
      .send({ jd: "test", company_url: "https://test.com", days: 5 });
      
    expect(res.status).toBe(401);
  });

  test("create kit authenticated", async () => {
    vi.mocked(kitRepository.findByFingerprintForUser).mockResolvedValue(null);
    vi.mocked(kitRepository.create).mockResolvedValue({ _id: "123", kit: {} } as any);

    const res = await request(app)
      .post("/api/kits")
      .set("Cookie", [`prep_assist_session=${mockToken}`])
      .send({ jd: "test", company_url: "https://test.com", days: 5 });

    if (res.status === 500) console.error("create kit 500 error text:", res.text);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });

  test("list only user's own kits", async () => {
    vi.mocked(kitRepository.findByUser).mockResolvedValue([{ _id: "123", kit: { source: { company: "Test" } } }] as any);

    const res = await request(app)
      .get("/api/kits")
      .set("Cookie", [`prep_assist_session=${mockToken}`]);

    if (res.status === 500) console.error("list kit 500 error text:", res.text);
    expect(res.status).toBe(200);
    expect(kitRepository.findByUser).toHaveBeenCalledWith(mockUserId);
  });
});
