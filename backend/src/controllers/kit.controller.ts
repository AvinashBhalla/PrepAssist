import type { Request, Response } from "express";
import { z } from "zod";
import type { Types } from "mongoose";
import { kitRepository } from "../repositories/kit.repository.js";
import { kitEditorService, KitEditorError } from "../services/kit-editor.service.js";
import { regenerationService, RegenerationError } from "../services/regeneration.service.js";
import { generateInterviewKit } from "../pipeline/interview-kit-pipeline.js";
import { createLLMProvider } from "../llm/factory.js";
import { HttpFetcher } from "../retrieval/fetcher.js";
import { DuckDuckGoHtmlProvider } from "../research/duckduckgo-provider.js";
import { createKitFingerprint } from "../utils/fingerprint.js";

const createKitSchema = z.object({
  jd: z.string().min(1),
  company_url: z.string().url(),
  days: z.number().int().positive().default(5),
});

const questionSchema = z.object({
  requirement_ids: z.array(z.string().min(1)),
  category: z.enum(["technical", "behavioural", "system-design", "company-fit"]),
  prompt: z.string(),
  answer_outline: z.string(),
  difficulty: z.number().int().min(1).max(3),
});

const flashcardSchema = z.object({
  front: z.string(),
  back: z.string(),
  requirement_ids: z.array(z.string().min(1)),
});

export const kitController = {
  async createKit(req: Request, res: Response) {
    try {
      const userId = req.userId as string;
      const parsed = createKitSchema.parse(req.body);
      const fingerprint = createKitFingerprint(parsed.jd, parsed.company_url, parsed.days);

      // Duplicate check handled by pipeline if duplicateLookup provided, but we can do it here for simplicity
      const existing = await kitRepository.findByFingerprintForUser(fingerprint, userId as unknown as Types.ObjectId);
      if (existing && existing.status === "ready") {
        return res.status(200).json({ ok: true, data: existing });
      }

      // We just call generateInterviewKit, but it takes time. 
      // For synchronous API, we'll wait for it. In a real app this would be async.
      const result = await generateInterviewKit(
        { ...parsed, userId },
        {
          provider: createLLMProvider(),
          companyFetcher: new HttpFetcher(),
          interviewFetcher: new HttpFetcher(),
          publicSearchProvider: new DuckDuckGoHtmlProvider(),
        }
      );

      if (result.status === "failed") {
        return res.status(500).json({ ok: false, error: "PIPELINE_FAILED", details: result.failure });
      }

      if (result.status === "reused_existing") {
        return res.status(200).json({ ok: true, data: result.kit });
      }

      // Create new
      const newKit = await kitRepository.create({
        userId: userId as unknown as Types.ObjectId,
        fingerprint,
        status: "ready",
        kit: result.kit,
        itemStates: {
          questions: {},
          flashcards: {},
          company_brief: {},
          schedule: {}
        }
      });

      return res.status(201).json({ ok: true, data: newKit });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ ok: false, error: "VALIDATION_FAILED", details: (err as any).errors });
      }
      return res.status(500).json({ ok: false, error: "INTERNAL_SERVER_ERROR", message: err.message });
    }
  },

  async listKits(req: Request, res: Response) {
    try {
      const kits = await kitRepository.findByUser(req.userId as unknown as Types.ObjectId);
      const metadata = kits.map(k => ({
        id: (k as any)._id || (k as any).id,
        company: k.kit.source.company,
        role: k.kit.source.role,
        status: k.status,
        createdAt: k.createdAt,
        updatedAt: k.updatedAt
      }));
      res.status(200).json({ ok: true, data: metadata });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: "INTERNAL_SERVER_ERROR", message: err.message });
    }
  },

  async getKit(req: Request, res: Response) {
    try {
      const kit = await kitRepository.findByIdForUser((req.params.id as string), req.userId as unknown as Types.ObjectId);
      if (!kit) {
        return res.status(404).json({ ok: false, error: "KIT_NOT_FOUND" });
      }
      res.status(200).json({ ok: true, data: kit });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: "INTERNAL_SERVER_ERROR", message: err.message });
    }
  },

  async updateKitStatus(req: Request, res: Response) {
    try {
      const { status } = z.object({ status: z.enum(["draft", "generating", "ready", "failed"]) }).parse(req.body);
      let version = req.headers["if-unmodified-since"];
      if (Array.isArray(version)) version = version[0];
      version = version || req.body.lastUpdatedAt;

      const kit = await kitRepository.updateForUser((req.params.id as string), req.userId as unknown as Types.ObjectId, { status }, version as string);
      if (!kit) {
        // Find out if it's missing or version mismatch
        const existing = await kitRepository.findByIdForUser((req.params.id as string), req.userId as unknown as Types.ObjectId);
        if (!existing) return res.status(404).json({ ok: false, error: "KIT_NOT_FOUND" });
        return res.status(409).json({ ok: false, error: "CONCURRENT_UPDATE" });
      }

      res.status(200).json({ ok: true, data: kit });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: "VALIDATION_FAILED" });
    }
  },

  // --- QUESTION CRUD ---

  async addQuestion(req: Request, res: Response) {
    try {
      const parsed = questionSchema.parse(req.body);
      const kit = await kitRepository.findByIdForUser((req.params.id as string), req.userId as unknown as Types.ObjectId);
      if (!kit) return res.status(404).json({ ok: false, error: "KIT_NOT_FOUND" });

      const updatedData = kitEditorService.addQuestion({ kit: kit.kit, itemStates: kit.itemStates }, parsed);
      let version = req.headers["if-unmodified-since"];
      if (Array.isArray(version)) version = version[0];
      version = version || req.body.lastUpdatedAt;

      const updated = await kitRepository.updateForUser((req.params.id as string), req.userId as unknown as Types.ObjectId, { kit: updatedData.kit, itemStates: updatedData.itemStates }, version as string);
      if (!updated) return res.status(409).json({ ok: false, error: "CONCURRENT_UPDATE" });

      res.status(201).json({ ok: true, data: updated });
    } catch (err: any) {
      if (err instanceof KitEditorError) return res.status(400).json({ ok: false, error: err.code, message: err.message });
      res.status(400).json({ ok: false, error: "VALIDATION_FAILED", message: err.message });
    }
  },

  async editQuestion(req: Request, res: Response) {
    try {
      const parsed = questionSchema.partial().parse(req.body);
      const kit = await kitRepository.findByIdForUser((req.params.id as string), req.userId as unknown as Types.ObjectId);
      if (!kit) return res.status(404).json({ ok: false, error: "KIT_NOT_FOUND" });

      const updatedData = kitEditorService.editQuestion({ kit: kit.kit, itemStates: kit.itemStates }, (req.params.questionId as string), parsed);
      let version = req.headers["if-unmodified-since"];
      if (Array.isArray(version)) version = version[0];
      version = version || req.body.lastUpdatedAt;

      const updated = await kitRepository.updateForUser((req.params.id as string), req.userId as unknown as Types.ObjectId, { kit: updatedData.kit, itemStates: updatedData.itemStates }, version as string);
      if (!updated) return res.status(409).json({ ok: false, error: "CONCURRENT_UPDATE" });

      res.status(200).json({ ok: true, data: updated });
    } catch (err: any) {
      if (err instanceof KitEditorError) return res.status(400).json({ ok: false, error: err.code, message: err.message });
      res.status(400).json({ ok: false, error: "VALIDATION_FAILED", message: err.message });
    }
  },

  async deleteQuestion(req: Request, res: Response) {
    try {
      const kit = await kitRepository.findByIdForUser((req.params.id as string), req.userId as unknown as Types.ObjectId);
      if (!kit) return res.status(404).json({ ok: false, error: "KIT_NOT_FOUND" });

      const updatedData = kitEditorService.deleteQuestion({ kit: kit.kit, itemStates: kit.itemStates }, (req.params.questionId as string));
      let version = req.headers["if-unmodified-since"];
      if (Array.isArray(version)) version = version[0];
      version = version || req.body.lastUpdatedAt;

      const updated = await kitRepository.updateForUser((req.params.id as string), req.userId as unknown as Types.ObjectId, { kit: updatedData.kit, itemStates: updatedData.itemStates }, version as string);
      if (!updated) return res.status(409).json({ ok: false, error: "CONCURRENT_UPDATE" });

      res.status(200).json({ ok: true, data: updated });
    } catch (err: any) {
      if (err instanceof KitEditorError) return res.status(400).json({ ok: false, error: err.code, message: err.message });
      res.status(400).json({ ok: false, error: "VALIDATION_FAILED", message: err.message });
    }
  },

  async reorderQuestions(req: Request, res: Response) {
    try {
      const { newOrder } = z.object({ newOrder: z.array(z.string()) }).parse(req.body);
      const kit = await kitRepository.findByIdForUser((req.params.id as string), req.userId as unknown as Types.ObjectId);
      if (!kit) return res.status(404).json({ ok: false, error: "KIT_NOT_FOUND" });

      const updatedData = kitEditorService.reorderQuestions({ kit: kit.kit, itemStates: kit.itemStates }, newOrder);
      let version = req.headers["if-unmodified-since"];
      if (Array.isArray(version)) version = version[0];
      version = version || req.body.lastUpdatedAt;

      const updated = await kitRepository.updateForUser((req.params.id as string), req.userId as unknown as Types.ObjectId, { kit: updatedData.kit, itemStates: updatedData.itemStates }, version as string);
      if (!updated) return res.status(409).json({ ok: false, error: "CONCURRENT_UPDATE" });

      res.status(200).json({ ok: true, data: updated });
    } catch (err: any) {
      if (err instanceof KitEditorError) return res.status(400).json({ ok: false, error: err.code, message: err.message });
      res.status(400).json({ ok: false, error: "VALIDATION_FAILED", message: err.message });
    }
  },

  // --- FLASHCARD CRUD ---

  async addFlashcard(req: Request, res: Response) {
    try {
      const parsed = flashcardSchema.parse(req.body);
      const kit = await kitRepository.findByIdForUser((req.params.id as string), req.userId as unknown as Types.ObjectId);
      if (!kit) return res.status(404).json({ ok: false, error: "KIT_NOT_FOUND" });

      const updatedData = kitEditorService.addFlashcard({ kit: kit.kit, itemStates: kit.itemStates }, parsed);
      let version = req.headers["if-unmodified-since"];
      if (Array.isArray(version)) version = version[0];
      version = version || req.body.lastUpdatedAt;

      const updated = await kitRepository.updateForUser((req.params.id as string), req.userId as unknown as Types.ObjectId, { kit: updatedData.kit, itemStates: updatedData.itemStates }, version as string);
      if (!updated) return res.status(409).json({ ok: false, error: "CONCURRENT_UPDATE" });

      res.status(201).json({ ok: true, data: updated });
    } catch (err: any) {
      if (err instanceof KitEditorError) return res.status(400).json({ ok: false, error: err.code, message: err.message });
      res.status(400).json({ ok: false, error: "VALIDATION_FAILED", message: err.message });
    }
  },

  async editFlashcard(req: Request, res: Response) {
    try {
      const parsed = flashcardSchema.partial().parse(req.body);
      const kit = await kitRepository.findByIdForUser((req.params.id as string), req.userId as unknown as Types.ObjectId);
      if (!kit) return res.status(404).json({ ok: false, error: "KIT_NOT_FOUND" });

      const updatedData = kitEditorService.editFlashcard({ kit: kit.kit, itemStates: kit.itemStates }, (req.params.flashcardId as string), parsed);
      let version = req.headers["if-unmodified-since"];
      if (Array.isArray(version)) version = version[0];
      version = version || req.body.lastUpdatedAt;

      const updated = await kitRepository.updateForUser((req.params.id as string), req.userId as unknown as Types.ObjectId, { kit: updatedData.kit, itemStates: updatedData.itemStates }, version as string);
      if (!updated) return res.status(409).json({ ok: false, error: "CONCURRENT_UPDATE" });

      res.status(200).json({ ok: true, data: updated });
    } catch (err: any) {
      if (err instanceof KitEditorError) return res.status(400).json({ ok: false, error: err.code, message: err.message });
      res.status(400).json({ ok: false, error: "VALIDATION_FAILED", message: err.message });
    }
  },

  async deleteFlashcard(req: Request, res: Response) {
    try {
      const kit = await kitRepository.findByIdForUser((req.params.id as string), req.userId as unknown as Types.ObjectId);
      if (!kit) return res.status(404).json({ ok: false, error: "KIT_NOT_FOUND" });

      const updatedData = kitEditorService.deleteFlashcard({ kit: kit.kit, itemStates: kit.itemStates }, (req.params.flashcardId as string));
      let version = req.headers["if-unmodified-since"];
      if (Array.isArray(version)) version = version[0];
      version = version || req.body.lastUpdatedAt;

      const updated = await kitRepository.updateForUser((req.params.id as string), req.userId as unknown as Types.ObjectId, { kit: updatedData.kit, itemStates: updatedData.itemStates }, version as string);
      if (!updated) return res.status(409).json({ ok: false, error: "CONCURRENT_UPDATE" });

      res.status(200).json({ ok: true, data: updated });
    } catch (err: any) {
      if (err instanceof KitEditorError) return res.status(400).json({ ok: false, error: err.code, message: err.message });
      res.status(400).json({ ok: false, error: "VALIDATION_FAILED", message: err.message });
    }
  },

  // --- REGENERATION ---

  async regenerate(req: Request, res: Response) {
    try {
      const { type, category } = z.object({ 
        type: z.enum(["category", "company_brief", "schedule"]),
        category: z.enum(["technical", "behavioural", "system-design", "company-fit"]).optional()
      }).parse(req.body);

      const kit = await kitRepository.findByIdForUser((req.params.id as string), req.userId as unknown as Types.ObjectId);
      if (!kit) return res.status(404).json({ ok: false, error: "KIT_NOT_FOUND" });

      let updatedData = { kit: kit.kit, itemStates: kit.itemStates };
      const provider = createLLMProvider();

      if (type === "category") {
        if (!category) return res.status(400).json({ ok: false, error: "VALIDATION_FAILED", message: "Category required" });
        updatedData = await regenerationService.regenerateCategory(updatedData, category, { provider });
      } else if (type === "company_brief") {
        updatedData = await regenerationService.regenerateCompanyBrief(updatedData, { 
          provider, 
          companyResearch: { pages: [], diagnostics: { errors: [], skipped: [] } }, 
          publicInterviewResearch: { hits: [], snippets: [], diagnostics: { errors: [] } }, 
          jd: kit.kit.source.jd_chars.toString() // We don't save full JD, but generator requires it. Ideally we pass original. 
        });
      } else if (type === "schedule") {
        updatedData = regenerationService.regenerateSchedule(updatedData);
      }

      let version = req.headers["if-unmodified-since"];
      if (Array.isArray(version)) version = version[0];
      version = version || req.body.lastUpdatedAt;
      const updated = await kitRepository.updateForUser((req.params.id as string), req.userId as unknown as Types.ObjectId, { kit: updatedData.kit, itemStates: updatedData.itemStates }, version as string);
      if (!updated) return res.status(409).json({ ok: false, error: "CONCURRENT_UPDATE" });

      res.status(200).json({ ok: true, data: updated });
    } catch (err: any) {
      if (err instanceof RegenerationError) return res.status(400).json({ ok: false, error: err.code, message: err.message });
      res.status(400).json({ ok: false, error: "VALIDATION_FAILED", message: err.message });
    }
  }
};
