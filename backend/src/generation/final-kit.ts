import type { AppendixAKit } from "@prep-assist/shared";
import type { ExtractedRequirement } from "../extraction/requirement-extraction.js";
import type { CompanyBrief, RoleMetadata } from "./company-brief-role.js";
import type { GeneratedQuestion } from "./question-generation.js";
import type { GeneratedFlashcard } from "./flashcard-generation.js";
import type { ResearchBundle } from "../retrieval/types.js";
import { allocateSchedule } from "../deterministic/schedule.js";
import { validateFinalKit, type FinalKitValidationResult } from "../deterministic/final-kit-validator.js";

export type FinalizeInterviewKitInput = {
  jd: string;
  companyUrl: string;
  days: number;
  requirements: ExtractedRequirement[];
  companyBrief: CompanyBrief;
  role: RoleMetadata;
  questions: GeneratedQuestion[];
  flashcards: GeneratedFlashcard[];
  companyResearch: ResearchBundle;
  uncoveredRequirementIds: string[];
  coveragePasses: number;
  researchedAt: string;
};

export function finalizeInterviewKit(input: FinalizeInterviewKitInput): FinalKitValidationResult {
  const kit: AppendixAKit = {
    source: {
      company: new URL(input.companyUrl).hostname.replace(/^www\./, ""),
      company_url: input.companyUrl,
      role: input.role.title,
      location: "",
      jd_chars: input.jd.length,
      researched_at: input.researchedAt,
      pages_used: input.companyResearch.pages.map((page) => page.finalUrl || page.url),
    },
    company_brief: input.companyBrief,
    role: { ...input.role, requirements: input.requirements },
    questions: input.questions,
    flashcards: input.flashcards,
    schedule: allocateSchedule(input.requirements, input.questions, input.days),
    coverage: { uncovered_requirement_ids: input.uncoveredRequirementIds, passes: input.coveragePasses },
  };
  return validateFinalKit(kit, input.days);
}
