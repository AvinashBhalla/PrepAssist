import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  getJwtSecret,
  sessionLifetimeSeconds,
} from "../config/auth.js";
import type {
  CreateUserInput,
  UserRecord,
  UserRepository,
} from "../repositories/user.repository.js";

export class AuthError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export type SafeUser = Pick<UserRecord, "id" | "email">;

function toSafeUser(user: UserRecord): SafeUser {
  return { id: user.id, email: user.email };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function createSessionToken(userId: string): string {
  return jwt.sign({ sub: userId }, getJwtSecret(), {
    expiresIn: sessionLifetimeSeconds,
  });
}

export function createAuthService(repository: UserRepository) {
  return {
    async register(email: string, password: string) {
      const passwordHash = await bcrypt.hash(password, 12);
      const input: CreateUserInput = {
        email: normalizeEmail(email),
        passwordHash,
      };

      try {
        const user = await repository.create(input);
        return { user: toSafeUser(user), token: createSessionToken(user.id) };
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw new AuthError(
            "EMAIL_ALREADY_REGISTERED",
            409,
            "An account with that email already exists.",
          );
        }
        throw error;
      }
    },

    async login(email: string, password: string) {
      const user = await repository.findByEmail(normalizeEmail(email));
      const passwordMatches = user
        ? await bcrypt.compare(password, user.passwordHash)
        : false;

      if (!user || !passwordMatches) {
        throw new AuthError(
          "AUTHENTICATION_FAILED",
          401,
          "Invalid email or password.",
        );
      }

      return { user: toSafeUser(user), token: createSessionToken(user.id) };
    },

    async getSafeUser(userId: string): Promise<SafeUser> {
      const user = await repository.findById(userId);

      if (!user) {
        throw new AuthError("AUTHENTICATION_FAILED", 401, "Authentication required.");
      }

      return toSafeUser(user);
    },
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

export function verifySessionToken(token: string): string {
  try {
    const payload = jwt.verify(token, getJwtSecret());

    if (typeof payload !== "object" || typeof payload.sub !== "string") {
      throw new Error("Invalid session payload");
    }

    return payload.sub;
  } catch {
    throw new AuthError("AUTHENTICATION_FAILED", 401, "Authentication required.");
  }
}