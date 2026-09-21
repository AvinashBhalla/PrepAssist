import type { CookieOptions } from "express";

export const sessionCookieName = "prep_assist_session";
export const sessionLifetimeSeconds = 60 * 60;

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();

  if (!secret) {
    throw new Error("JWT_SECRET is required for authentication");
  }

  return secret;
}

export function getSessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: sessionLifetimeSeconds * 1000,
    path: "/",
  };
}