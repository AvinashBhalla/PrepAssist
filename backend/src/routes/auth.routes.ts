import { Router } from "express";
import { createAuthController } from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/require-auth.js";
import type { UserRepository } from "../repositories/user.repository.js";

export function createAuthRouter(repository: UserRepository): Router {
  const controller = createAuthController(repository);
  const router = Router();

  router.post("/register", controller.register);
  router.post("/login", controller.login);
  router.post("/logout", controller.logout);
  router.get("/me", requireAuth, controller.me);
  router.get("/protected-test", requireAuth, controller.protectedTest);

  return router;
}