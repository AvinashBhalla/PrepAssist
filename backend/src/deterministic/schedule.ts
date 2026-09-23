import type { ExtractedRequirement } from "../extraction/requirement-extraction.js";
import type { GeneratedQuestion } from "../generation/question-generation.js";

export type AllocatedScheduleDay = {
  day: number;
  focus: string;
  question_ids: string[];
  minutes: number;
};

export type AllocatedSchedule = {
  days_available: number;
  days: AllocatedScheduleDay[];
};

const difficultyDurations: Record<1 | 2 | 3, number> = {
  1: 10,
  2: 15,
  3: 25,
};

export function durationForDifficulty(difficulty: 1 | 2 | 3): number {
  return difficultyDurations[difficulty];
}

export function questionPriorityScore(
  question: Pick<GeneratedQuestion, "id" | "requirement_ids" | "difficulty">,
  requirements: readonly ExtractedRequirement[],
): number {
  const priorityById = new Map(requirements.map((requirement) => [requirement.id, requirement.priority]));
  const mustCount = question.requirement_ids.filter((id) => priorityById.get(id) === "must").length;
  const niceCount = question.requirement_ids.filter((id) => priorityById.get(id) === "nice").length;
  return mustCount * 1000 + niceCount * 100 + question.difficulty * 10;
}

export function allocateSchedule(
  requirements: readonly ExtractedRequirement[],
  questions: readonly GeneratedQuestion[],
  days: number,
): AllocatedSchedule {
  validateDays(days);
  const scheduleDays = Array.from({ length: days }, (_value, index) => ({
    day: index + 1,
    focus: "",
    question_ids: [] as string[],
    minutes: 0,
    requirementTexts: [] as string[],
    categories: [] as string[],
  }));
  const sortedQuestions = [...questions].sort((first, second) => {
    const scoreDifference = questionPriorityScore(second, requirements) - questionPriorityScore(first, requirements);
    return scoreDifference || first.id.localeCompare(second.id);
  });

  sortedQuestions.forEach((question, index) => {
    const targetDay = Math.min(days - 1, Math.floor(index * days / Math.max(sortedQuestions.length, 1)));
    const candidateDays = scheduleDays.slice(0, targetDay + 1);
    const selectedDay = candidateDays.reduce((best, current) => {
      if (current.minutes !== best.minutes) return current.minutes < best.minutes ? current : best;
      if (current.question_ids.length !== best.question_ids.length) return current.question_ids.length < best.question_ids.length ? current : best;
      return current.day < best.day ? current : best;
    });
    selectedDay.question_ids.push(question.id);
    selectedDay.minutes += durationForDifficulty(question.difficulty);
    selectedDay.categories.push(question.category);
    for (const requirement of requirements) {
      if (question.requirement_ids.includes(requirement.id)) selectedDay.requirementTexts.push(requirement.text);
    }
  });

  return {
    days_available: days,
    days: scheduleDays.map(({ requirementTexts, categories, ...day }) => ({
      ...day,
      focus: buildFocus(requirementTexts, categories),
    })),
  };
}

function validateDays(days: number): void {
  if (!Number.isInteger(days) || days <= 0) throw new Error("days must be a positive integer");
  if (days > 3650) throw new Error("days exceeds the supported maximum of 3650");
}

function buildFocus(requirementTexts: string[], categories: string[]): string {
  const uniqueRequirements = [...new Set(requirementTexts)].slice(0, 2);
  if (uniqueRequirements.length > 0) return uniqueRequirements.join(" + ");
  const uniqueCategories = [...new Set(categories)].slice(0, 2);
  return uniqueCategories.length > 0 ? uniqueCategories.join(" + ") : "Review and reflection";
}
