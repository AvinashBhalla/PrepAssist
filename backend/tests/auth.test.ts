import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { sessionCookieName } from "../src/config/auth.js";
import { createApp } from "../src/app.js";
import type {
  CreateUserInput,
  UserRecord,
  UserRepository,
} from "../src/repositories/user.repository.js";

const jwtSecret = "test-jwt-secret";

function createMemoryRepository() {
  const users = new Map<string, UserRecord>();
  let nextId = 1;

  const repository: UserRepository = {
    async create(input: CreateUserInput) {
      if ([...users.values()].some((user) => user.email === input.email)) {
        throw Object.assign(new Error("duplicate"), { code: 11000 });
      }

      const user: UserRecord = {
        id: `user-${nextId++}`,
        email: input.email,
        passwordHash: input.passwordHash,
      };
      users.set(user.id, user);
      return user;
    },
    async findByEmail(email: string) {
      return [...users.values()].find((user) => user.email === email) ?? null;
    },
    async findById(id: string) {
      return users.get(id) ?? null;
    },
  };

  return { repository, users };
}

function cookieFrom(response: request.Response): string {
  const cookie = response.headers["set-cookie"]?.[0];
  if (!cookie) {
    throw new Error("Expected a session cookie");
  }
  return cookie.split(";", 1)[0];
}

describe("authentication boundary", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = jwtSecret;
    process.env.NODE_ENV = "test";
    process.env.FRONTEND_URL = "http://localhost:3000";
  });

  it("registers a user, hashes the password, and establishes a session", async () => {
    const { repository, users } = createMemoryRepository();
    const response = await request(createApp(repository))
      .post("/api/auth/register")
      .send({ email: "USER@example.com", password: "some-password" });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      ok: true,
      user: { id: "user-1", email: "user@example.com" },
    });
    expect(response.body.user.passwordHash).toBeUndefined();
    const storedUser = users.get("user-1");
    expect(storedUser?.passwordHash).not.toBe("some-password");
    expect(await bcrypt.compare("some-password", storedUser?.passwordHash ?? "")).toBe(true);
    expect(cookieFrom(response)).toContain(`${sessionCookieName}=`);
  });

  it("rejects duplicate email registration with a structured conflict", async () => {
    const { repository } = createMemoryRepository();
    const app = createApp(repository);
    await request(app)
      .post("/api/auth/register")
      .send({ email: "user@example.com", password: "some-password" });

    const response = await request(app)
      .post("/api/auth/register")
      .send({ email: "USER@example.com", password: "some-password" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      ok: false,
      error: {
        code: "EMAIL_ALREADY_REGISTERED",
        message: "An account with that email already exists.",
      },
    });
  });

  it("logs in successfully with normalized email and returns a session", async () => {
    const { repository } = createMemoryRepository();
    const app = createApp(repository);
    await request(app)
      .post("/api/auth/register")
      .send({ email: "user@example.com", password: "some-password" });

    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: " USER@EXAMPLE.COM ", password: "some-password" });

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({ id: "user-1", email: "user@example.com" });
    expect(cookieFrom(response)).toContain(`${sessionCookieName}=`);
  });

  it("returns a generic 401 for invalid login credentials", async () => {
    const { repository } = createMemoryRepository();
    const response = await request(createApp(repository))
      .post("/api/auth/login")
      .send({ email: "unknown@example.com", password: "some-password" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      ok: false,
      error: { code: "AUTHENTICATION_FAILED", message: "Invalid email or password." },
    });
  });

  it("rejects expired and tampered JWT cookies", async () => {
    const { repository } = createMemoryRepository();
    const app = createApp(repository);
    const expiredToken = jwt.sign({ sub: "user-1" }, jwtSecret, { expiresIn: -1 });

    const expiredResponse = await request(app)
      .get("/api/auth/me")
      .set("Cookie", `${sessionCookieName}=${expiredToken}`);
    const tamperedResponse = await request(app)
      .get("/api/auth/me")
      .set("Cookie", `${sessionCookieName}=tampered`);

    expect(expiredResponse.status).toBe(401);
    expect(tamperedResponse.status).toBe(401);
    expect(expiredResponse.body.ok).toBe(false);
  });

  it("returns safe public information from authenticated /me", async () => {
    const { repository } = createMemoryRepository();
    const app = createApp(repository);
    const registerResponse = await request(app)
      .post("/api/auth/register")
      .send({ email: "user@example.com", password: "some-password" });

    const response = await request(app)
      .get("/api/auth/me")
      .set("Cookie", cookieFrom(registerResponse));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      user: { id: "user-1", email: "user@example.com" },
    });
    expect(response.body.user.passwordHash).toBeUndefined();
  });

  it("rejects unauthenticated /me", async () => {
    const { repository } = createMemoryRepository();
    const response = await request(createApp(repository)).get("/api/auth/me");

    expect(response.status).toBe(401);
    expect(response.body.ok).toBe(false);
  });

  it("clears the session cookie on logout even when already logged out", async () => {
    const { repository } = createMemoryRepository();
    const app = createApp(repository);
    const response = await request(app).post("/api/auth/logout");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(response.headers["set-cookie"]?.[0]).toContain(`${sessionCookieName}=;`);
  });

  it("rejects the protected test endpoint without a session", async () => {
    const { repository } = createMemoryRepository();
    const response = await request(createApp(repository)).get("/api/auth/protected-test");

    expect(response.status).toBe(401);
  });

  it("accepts the protected test endpoint with a valid session", async () => {
    const { repository } = createMemoryRepository();
    const app = createApp(repository);
    const registerResponse = await request(app)
      .post("/api/auth/register")
      .send({ email: "user@example.com", password: "some-password" });

    const response = await request(app)
      .get("/api/auth/protected-test")
      .set("Cookie", cookieFrom(registerResponse));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, userId: "user-1" });
  });

  it("rejects malformed credentials with status 400", async () => {
    const { repository } = createMemoryRepository();
    const response = await request(createApp(repository))
      .post("/api/auth/register")
      .send({ email: "not-an-email", password: "short" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});