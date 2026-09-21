import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";

describe("GET /api/health", () => {
  it("returns the service health payload", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, service: "PrepAssist" });
  });
});