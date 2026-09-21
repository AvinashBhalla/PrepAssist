import type { RequestHandler } from "express";
import { getSessionCookieOptions, sessionCookieName } from "../config/auth.js";
import { AuthError, createAuthService } from "../services/auth.service.js";
import { authCredentialsSchema } from "../validators/auth.validators.js";
import type { UserRepository } from "../repositories/user.repository.js";

export function createAuthController(repository: UserRepository) {
  const authService = createAuthService(repository);

  const register: RequestHandler = async (request, response, next) => {
    const parsed = authCredentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      next(new AuthError("VALIDATION_ERROR", 400, "Email and password are invalid."));
      return;
    }

    try {
      const result = await authService.register(parsed.data.email, parsed.data.password);
      response.cookie(sessionCookieName, result.token, getSessionCookieOptions());
      response.status(201).json({ ok: true, user: result.user });
    } catch (error) {
      next(error);
    }
  };

  const login: RequestHandler = async (request, response, next) => {
    const parsed = authCredentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      next(new AuthError("VALIDATION_ERROR", 400, "Email and password are invalid."));
      return;
    }

    try {
      const result = await authService.login(parsed.data.email, parsed.data.password);
      response.cookie(sessionCookieName, result.token, getSessionCookieOptions());
      response.json({ ok: true, user: result.user });
    } catch (error) {
      next(error);
    }
  };

  const logout: RequestHandler = (_request, response) => {
    response.clearCookie(sessionCookieName, getSessionCookieOptions());
    response.json({ ok: true });
  };

  const me: RequestHandler = async (request, response, next) => {
    try {
      if (!request.userId) {
        throw new AuthError("AUTHENTICATION_FAILED", 401, "Authentication required.");
      }
      const user = await authService.getSafeUser(request.userId);
      response.json({ ok: true, user });
    } catch (error) {
      next(error);
    }
  };

  const protectedTest: RequestHandler = (request, response, next) => {
    if (!request.userId) {
      next(new AuthError("AUTHENTICATION_FAILED", 401, "Authentication required."));
      return;
    }
    response.json({ ok: true, userId: request.userId });
  };

  return { register, login, logout, me, protectedTest };
}