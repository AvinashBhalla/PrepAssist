import { appendixAKitSchema, type AppendixAKit } from "@prep-assist/shared";
import { checkCoverage } from "./coverage.js";

export type FinalKitValidationError = {
  code: string;
  path: string;
  message: string;
};

export type FinalKitValidationResult =
  | { valid: true; kit: AppendixAKit; errors: [] }
  | { valid: false; kit?: AppendixAKit; errors: FinalKitValidationError[] };

const requiredTopLevelFields = ["source", "company_brief", "role", "questions", "flashcards", "schedule", "coverage"];

export function validateFinalKit(input: unknown, requestedDays: number): FinalKitValidationResult {
  const errors: FinalKitValidationError[] = [];
  if (!Number.isInteger(requestedDays) || requestedDays <= 0) {
    errors.push({ code: "INVALID_REQUESTED_DAYS", path: "requestedDays", message: "Requested days must be a positive integer" });
  }

  if (!isRecord(input)) {
    return { valid: false, errors: [...errors, { code: "INVALID_KIT", path: "", message: "Kit must be an object" }] };
  }
  for (const field of requiredTopLevelFields) {
    if (!(field in input)) errors.push({ code: "MISSING_TOP_LEVEL_SECTION", path: field, message: `Missing required Appendix A section: ${field}` });
  }
  for (const field of Object.keys(input)) {
    if (!requiredTopLevelFields.includes(field)) errors.push({ code: "UNKNOWN_TOP_LEVEL_SECTION", path: field, message: `Unexpected Appendix A section: ${field}` });
  }

  const parsed = appendixAKitSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push({ code: "SCHEMA_VALIDATION_FAILED", path: issue.path.join("."), message: issue.message });
    return { valid: false, errors };
  }

  const kit = parsed.data;
  addNonEmpty(kit.role.requirements.map((item) => item.text), "role.requirements", "EMPTY_REQUIREMENT_TEXT", errors);
  addNonEmpty(kit.questions.map((item) => item.prompt), "questions", "EMPTY_QUESTION_PROMPT", errors);
  addNonEmpty(kit.questions.map((item) => item.answer_outline), "questions", "EMPTY_ANSWER_OUTLINE", errors);
  addNonEmpty(kit.flashcards.map((item) => item.front), "flashcards", "EMPTY_FLASHCARD_FRONT", errors);
  addNonEmpty(kit.flashcards.map((item) => item.back), "flashcards", "EMPTY_FLASHCARD_BACK", errors);
  addNonEmpty([kit.source.company, kit.source.company_url, kit.source.role, kit.source.researched_at], "source", "EMPTY_SOURCE_FIELD", errors);
  addNonEmpty([kit.company_brief.summary, kit.company_brief.what_they_do, kit.role.title, kit.role.seniority], "kit", "EMPTY_REQUIRED_STRING", errors);
  validateUniqueIds(kit.role.requirements.map((item) => item.id), "DUPLICATE_REQUIREMENT_ID", "role.requirements", errors);
  validateUniqueIds(kit.questions.map((item) => item.id), "DUPLICATE_QUESTION_ID", "questions", errors);
  validateUniqueIds(kit.flashcards.map((item) => item.id), "DUPLICATE_FLASHCARD_ID", "flashcards", errors);

  const requirementIds = new Set(kit.role.requirements.map((requirement) => requirement.id));
  const questionIds = new Set(kit.questions.map((question) => question.id));
  for (const [index, question] of kit.questions.entries()) {
    addUnknownReferences(question.requirement_ids, requirementIds, `questions.${index}.requirement_ids`, "UNKNOWN_QUESTION_REQUIREMENT", errors);
  }
  for (const [index, flashcard] of kit.flashcards.entries()) {
    addUnknownReferences(flashcard.requirement_ids, requirementIds, `flashcards.${index}.requirement_ids`, "UNKNOWN_FLASHCARD_REQUIREMENT", errors);
  }
  for (const [index, day] of kit.schedule.days.entries()) {
    addUnknownReferences(day.question_ids, questionIds, `schedule.days.${index}.question_ids`, "UNKNOWN_SCHEDULE_QUESTION", errors);
  }

  if (kit.schedule.days_available !== requestedDays) errors.push({ code: "DAYS_AVAILABLE_MISMATCH", path: "schedule.days_available", message: "days_available must equal requested days" });
  if (kit.schedule.days.length !== requestedDays) errors.push({ code: "SCHEDULE_DAY_COUNT_MISMATCH", path: "schedule.days", message: "Schedule must contain exactly requested days" });
  kit.schedule.days.forEach((day, index) => {
    if (day.day !== index + 1) errors.push({ code: "INVALID_SCHEDULE_DAY_NUMBER", path: `schedule.days.${index}.day`, message: "Schedule day numbers must be sequential from 1" });
  });
  if (kit.coverage.passes < 1) errors.push({ code: "INVALID_COVERAGE_PASSES", path: "coverage.passes", message: "Coverage passes must be at least 1" });
  addUnknownReferences(kit.coverage.uncovered_requirement_ids, requirementIds, "coverage.uncovered_requirement_ids", "UNKNOWN_COVERAGE_REQUIREMENT", errors);

  const facts = checkCoverage(kit.role.requirements, kit.questions);
  if (facts.unknown_requirement_ids.length > 0) errors.push({ code: "UNKNOWN_QUESTION_REQUIREMENT", path: "questions", message: `Unknown question requirement IDs: ${facts.unknown_requirement_ids.join(", ")}` });
  if (!sameArray(kit.coverage.uncovered_requirement_ids, facts.uncovered_requirement_ids)) errors.push({ code: "COVERAGE_MISMATCH", path: "coverage.uncovered_requirement_ids", message: "Coverage does not match the deterministic coverage result" });
  if (facts.uncovered_requirement_ids.length > 0) errors.push({ code: "UNCOVERED_MUST_REQUIREMENT", path: "coverage.uncovered_requirement_ids", message: "Every must requirement must be covered in the final kit" });

  const scheduledQuestionIds = new Set(kit.schedule.days.flatMap((day) => day.question_ids));
  for (const requirement of kit.role.requirements.filter((item) => item.priority === "must")) {
    const coveredQuestionIds = facts.coverage_by_requirement[requirement.id].question_ids;
    if (!coveredQuestionIds.some((questionId) => scheduledQuestionIds.has(questionId))) {
      errors.push({ code: "MUST_REQUIREMENT_NOT_SCHEDULED", path: `schedule.days`, message: `No scheduled question covers must requirement ${requirement.id}` });
    }
  }

  return errors.length > 0 ? { valid: false, kit, errors } : { valid: true, kit, errors: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateUniqueIds(ids: string[], code: string, path: string, errors: FinalKitValidationError[]): void {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) errors.push({ code, path: `${path}.${index}.id`, message: `Duplicate ID: ${id}` });
    seen.add(id);
  });
}

function addUnknownReferences(ids: string[], knownIds: Set<string>, path: string, code: string, errors: FinalKitValidationError[]): void {
  ids.forEach((id, index) => {
    if (!knownIds.has(id)) errors.push({ code, path: `${path}.${index}`, message: `Unknown reference: ${id}` });
  });
}

function addNonEmpty(values: string[], path: string, code: string, errors: FinalKitValidationError[]): void {
  values.forEach((value, index) => {
    if (!value.trim()) errors.push({ code, path: `${path}.${index}`, message: "Required string must be non-empty" });
  });
}

function sameArray(first: string[], second: string[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}
