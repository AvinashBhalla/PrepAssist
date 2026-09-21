import { z } from "zod";

export type ApiResponse<T> = {
  ok: boolean;
  service?: string;
  data?: T;
  error?: string;
};

export type User = {
  id: string;
  email: string;
};

export type Kit = {
  id: string;
  title: string;
};

export const requirementKindSchema = z.enum([
  "technical",
  "behavioural",
  "domain",
]);

export const requirementPrioritySchema = z.enum(["must", "nice"]);

export const requirementSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  kind: requirementKindSchema,
  priority: requirementPrioritySchema,
});

export const questionCategorySchema = z.enum([
  "technical",
  "behavioural",
  "system-design",
  "company-fit",
]);

export const questionSchema = z.object({
  id: z.string().min(1),
  requirement_ids: z.array(z.string().min(1)),
  category: questionCategorySchema,
  prompt: z.string(),
  answer_outline: z.string(),
  difficulty: z.number().int().min(1).max(3),
});

export const flashcardSchema = z.object({
  id: z.string().min(1),
  front: z.string(),
  back: z.string(),
  requirement_ids: z.array(z.string().min(1)),
});

export const scheduleDaySchema = z.object({
  day: z.number().int().positive(),
  focus: z.string(),
  question_ids: z.array(z.string().min(1)),
  minutes: z.number().int().nonnegative(),
});

export const scheduleSchema = z.object({
  days_available: z.number().int().nonnegative(),
  days: z.array(scheduleDaySchema),
});

export const coverageSchema = z.object({
  uncovered_requirement_ids: z.array(z.string().min(1)),
  passes: z.number().int().nonnegative(),
});

export const sourceSchema = z.object({
  company: z.string(),
  company_url: z.string(),
  role: z.string(),
  location: z.string(),
  jd_chars: z.number().int().nonnegative(),
  researched_at: z.string(),
  pages_used: z.array(z.string()),
});

export const companyBriefSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
  sources: z.array(z.string()),
});

export const roleSchema = z.object({
  title: z.string(),
  seniority: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(requirementSchema),
});

export const appendixAKitSchema = z
  .object({
    source: sourceSchema,
    company_brief: companyBriefSchema,
    role: roleSchema,
    questions: z.array(questionSchema),
    flashcards: z.array(flashcardSchema),
    schedule: scheduleSchema,
    coverage: coverageSchema,
  })
  .superRefine((kit, context) => {
    const questionIds = new Set(kit.questions.map((question) => question.id));
    const requirementIds = new Set(
      kit.role.requirements.map((requirement) => requirement.id),
    );

    kit.questions.forEach((question, index) => {
      question.requirement_ids.forEach((requirementId) => {
        if (!requirementIds.has(requirementId)) {
          context.addIssue({
            code: "custom",
            path: ["questions", index, "requirement_ids"],
            message: `Unknown requirement id: ${requirementId}`,
          });
        }
      });
    });

    kit.schedule.days.forEach((day, index) => {
      day.question_ids.forEach((questionId) => {
        if (!questionIds.has(questionId)) {
          context.addIssue({
            code: "custom",
            path: ["schedule", "days", index, "question_ids"],
            message: `Unknown question id: ${questionId}`,
          });
        }
      });
    });
  });

export type AppendixAKit = z.infer<typeof appendixAKitSchema>;

export type ItemState = "generated" | "edited" | "pinned" | "deleted";

export type ItemStates = {
  questions: Record<string, ItemState>;
  flashcards: Record<string, ItemState>;
  company_brief: Record<string, ItemState>;
  schedule: Record<string, ItemState>;
};

export const userSchema = z.object({
  id: z.string(),
  email: z.email(),
});

export const kitSchema = z.object({
  id: z.string(),
  title: z.string(),
});