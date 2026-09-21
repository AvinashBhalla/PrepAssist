import type { RequestHandler } from "express";
import { sessionCookieName } from "../config/auth.js";
import { AuthError, verifySessionToken } from "../services/auth.service.js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export const requireAuth: RequestHandler = (request, _response, next) => {
  const token = request.cookies?.[sessionCookieName];

  if (!token) {
    next(new AuthError("AUTHENTICATION_FAILED", 401, "Authentication required."));
    return;
  }

  try {
    request.userId = verifySessionToken(token);
    next();
  } catch (error) {
    next(error);
  }
};