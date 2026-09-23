import type { ExtractedRequirement } from "../extraction/requirement-extraction.js";
import type { GeneratedQuestion } from "../generation/question-generation.js";

export type RequirementCoverage = {
  covered: boolean;
  question_ids: string[];
};

export type CoverageFacts = {
  uncovered_requirement_ids: string[];
  covered_requirement_ids: string[];
  coverage_by_requirement: Record<string, RequirementCoverage>;
  unknown_requirement_ids: string[];
};

export function checkCoverage(
  requirements: readonly ExtractedRequirement[],
  questions: readonly Pick<GeneratedQuestion, "id" | "requirement_ids">[],
): CoverageFacts {
  const knownRequirementIds = new Set(requirements.map((requirement) => requirement.id));
  const coverageByRequirement: Record<string, RequirementCoverage> = {};
  const unknownRequirementIds = new Set<string>();

  for (const requirement of requirements) {
    const questionIds: string[] = [];
    for (const question of questions) {
      if (question.requirement_ids.includes(requirement.id)) questionIds.push(question.id);
      for (const requirementId of question.requirement_ids) {
        if (!knownRequirementIds.has(requirementId)) unknownRequirementIds.add(requirementId);
      }
    }
    coverageByRequirement[requirement.id] = {
      covered: questionIds.length > 0,
      question_ids: questionIds,
    };
  }

  const uncoveredRequirementIds = requirements
    .filter((requirement) => requirement.priority === "must" && !coverageByRequirement[requirement.id].covered)
    .map((requirement) => requirement.id);
  const coveredRequirementIds = requirements
    .filter((requirement) => coverageByRequirement[requirement.id].covered)
    .map((requirement) => requirement.id);

  return {
    uncovered_requirement_ids: uncoveredRequirementIds,
    covered_requirement_ids: coveredRequirementIds,
    coverage_by_requirement: coverageByRequirement,
    unknown_requirement_ids: [...unknownRequirementIds],
  };
}
