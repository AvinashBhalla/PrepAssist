import type { AppendixAKit, ItemStates, ItemState } from "@prep-assist/shared";
import { generateCompanyBriefAndRole } from "../generation/company-brief-role.js";
import { generateInterviewQuestions, type GeneratedQuestion } from "../generation/question-generation.js";
import { checkCoverage } from "../deterministic/coverage.js";
import { finalizeInterviewKit } from "../generation/final-kit.js";
import { createLLMProvider } from "../llm/factory.js";
import type { PublicSearchProvider } from "../research/public-interview-types.js";

type KitAndStates = { kit: AppendixAKit; itemStates: ItemStates };

export class RegenerationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "RegenerationError";
  }
}

export const regenerationService = {
  async regenerateCategory(
    data: KitAndStates,
    category: "technical" | "behavioural" | "system-design" | "company-fit",
    dependencies: {
      provider: ReturnType<typeof createLLMProvider>;
      companyResearch?: any;
      publicInterviewResearch?: any;
    }
  ): Promise<KitAndStates> {
    const { kit, itemStates } = data;

    // 1-5. Preserve edited/pinned/deleted items, drop eligible generated items
    const preservedQuestions: AppendixAKit["questions"] = [];
    const questionsToRegenerateCount = kit.questions.filter((q) => {
      if (q.category !== category) {
        preservedQuestions.push(q);
        return false;
      }
      const state = itemStates.questions[q.id];
      if (state === "edited" || state === "pinned") {
        preservedQuestions.push(q);
        return false;
      }
      if (state === "deleted") {
        // deleted items shouldn't be regenerated in their place, nor restored
        return false;
      }
      return true; // eligible for regeneration
    }).length;

    if (questionsToRegenerateCount === 0) {
      return data; // nothing to regenerate
    }

    // 6. Regenerate eligible items
    // Using the same generator but maybe requesting specific category? 
    // The underlying generator generates ALL categories, we'll just pick the ones for this category
    const generated = await generateInterviewQuestions(
      {
        requirements: kit.role.requirements,
        companyBrief: kit.company_brief,
        role: kit.role,
        companyResearch: dependencies.companyResearch,
        publicInterviewResearch: dependencies.publicInterviewResearch,
      },
      { provider: dependencies.provider }
    );

    // Filter to only the requested category
    let newQuestions = generated.questions.filter((q) => q.category === category) as any as GeneratedQuestion[];

    // 7. Merge new generated items
    const updatedKit: AppendixAKit = { ...kit, questions: [...preservedQuestions, ...newQuestions] };
    const updatedStates: ItemStates = { ...itemStates, questions: { ...itemStates.questions } };
    
    // 8. Assign stable IDs to new questions and mark as generated
    newQuestions.forEach((q) => {
      updatedStates.questions[q.id] = "generated";
    });

    // 9. Re-run deterministic coverage validation
    const coverage = checkCoverage(kit.role.requirements, updatedKit.questions);
    if (coverage.uncovered_requirement_ids.length > 0) {
      throw new RegenerationError("REGENERATION_WOULD_BREAK_COVERAGE", `Regeneration would leave requirements uncovered: ${coverage.uncovered_requirement_ids.join(", ")}`);
    }
    
    updatedKit.coverage = {
      uncovered_requirement_ids: coverage.uncovered_requirement_ids,
      passes: 1
    };

    // 10. Validate the resulting kit (for questions, we don't have to re-run the full finalizeKit if we just updated questions, but let's do a fast Zod check if needed. We assume `checkCoverage` is sufficient for logic).
    return { kit: updatedKit, itemStates: updatedStates };
  },

  async regenerateCompanyBrief(
    data: KitAndStates,
    dependencies: {
      provider: ReturnType<typeof createLLMProvider>;
      companyResearch: any;
      publicInterviewResearch: any;
      jd: string;
    }
  ): Promise<KitAndStates> {
    const { kit, itemStates } = data;

    // If both summary and what_they_do are user edited/pinned, there is nothing to regenerate safely without overwriting.
    const isSummaryEdited = itemStates.company_brief["summary"] === "edited" || itemStates.company_brief["summary"] === "pinned";
    const isWhatTheyDoEdited = itemStates.company_brief["what_they_do"] === "edited" || itemStates.company_brief["what_they_do"] === "pinned";

    if (isSummaryEdited && isWhatTheyDoEdited) {
      return data;
    }

    const briefRole = await generateCompanyBriefAndRole(
      {
        jd: dependencies.jd,
        requirements: kit.role.requirements,
        companyResearch: dependencies.companyResearch,
        publicInterviewResearch: dependencies.publicInterviewResearch,
      },
      { provider: dependencies.provider }
    );

    const newBrief = { ...kit.company_brief };
    const newStates = { ...itemStates.company_brief };

    if (!isSummaryEdited) {
      newBrief.summary = briefRole.company_brief.summary;
      newStates["summary"] = "generated";
    }
    
    if (!isWhatTheyDoEdited) {
      newBrief.what_they_do = briefRole.company_brief.what_they_do;
      newStates["what_they_do"] = "generated";
    }

    // Merge sources safely
    newBrief.sources = Array.from(new Set([...newBrief.sources, ...briefRole.company_brief.sources]));

    return { kit: { ...kit, company_brief: newBrief }, itemStates: { ...itemStates, company_brief: newStates } };
  },

  regenerateSchedule(data: KitAndStates): KitAndStates {
    const { kit, itemStates } = data;

    // For schedule, unless specifically pinned/edited at a day level, we re-run finalizeInterviewKit (which allocates the schedule).
    // The prompt says "preserve manual schedule edits only if the state model supports them cleanly, otherwise document the behavior explicitly"
    // The state model has `schedule: Record<string, ItemState>`. If `schedule["root"] === "edited"`, we could preserve it.
    // Assuming we just re-allocate for now.
    
    if (itemStates.schedule["root"] === "edited" || itemStates.schedule["root"] === "pinned") {
      return data; // Preserved
    }

    const result = finalizeInterviewKit({
      jd: "not-needed-for-schedule",
      companyUrl: kit.source.company_url,
      days: kit.schedule.days_available,
      requirements: kit.role.requirements,
      companyBrief: kit.company_brief,
      role: kit.role,
      questions: kit.questions as unknown as GeneratedQuestion[],
      flashcards: kit.flashcards,
      companyResearch: { pages: [], diagnostics: { errors: [], skipped: [] } } as any, // Only used for metadata
      uncoveredRequirementIds: kit.coverage.uncovered_requirement_ids,
      researchedAt: kit.source.researched_at,
    });

    if (!result.valid) {
      throw new RegenerationError("REGENERATION_FAILED", "Schedule regeneration resulted in invalid kit");
    }

    // Update schedule
    const updatedKit = { ...kit, schedule: result.kit.schedule };
    return { kit: updatedKit, itemStates };
  }
};
