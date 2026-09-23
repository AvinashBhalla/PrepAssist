import { Router } from "express";
import { kitController } from "../controllers/kit.controller.js";
import { requireAuth } from "../middleware/require-auth.js";

export function createKitRouter() {
  const router = Router();

  router.use(requireAuth);

  router.post("/", kitController.createKit);
  router.get("/", kitController.listKits);
  router.get("/:id", kitController.getKit);
  router.patch("/:id", kitController.updateKitStatus);

  router.post("/:id/questions", kitController.addQuestion);
  router.patch("/:id/questions/reorder", kitController.reorderQuestions);
  router.patch("/:id/questions/:questionId", kitController.editQuestion);
  router.delete("/:id/questions/:questionId", kitController.deleteQuestion);

  router.post("/:id/flashcards", kitController.addFlashcard);
  router.patch("/:id/flashcards/:flashcardId", kitController.editFlashcard);
  router.delete("/:id/flashcards/:flashcardId", kitController.deleteFlashcard);

  router.post("/:id/regenerate", kitController.regenerate);

  return router;
}
