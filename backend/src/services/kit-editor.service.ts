import type { AppendixAKit, ItemStates, ItemState } from "@prep-assist/shared";

type KitAndStates = {
  kit: AppendixAKit;
  itemStates: ItemStates;
};

export class KitEditorError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "KitEditorError";
  }
}

export const kitEditorService = {
  addQuestion(
    data: KitAndStates,
    newQuestion: Omit<AppendixAKit["questions"][0], "id">
  ): KitAndStates {
    this.validateRequirementReferences(data.kit, newQuestion.requirement_ids);

    const id = `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const question = { ...newQuestion, id };

    data.kit.questions.push(question);
    data.itemStates.questions[id] = "edited";

    return data;
  },

  editQuestion(
    data: KitAndStates,
    questionId: string,
    updates: Partial<Omit<AppendixAKit["questions"][0], "id">>
  ): KitAndStates {
    const questionIndex = data.kit.questions.findIndex((q) => q.id === questionId);
    if (questionIndex === -1) {
      throw new KitEditorError("QUESTION_NOT_FOUND", "Question not found in kit");
    }

    if (updates.requirement_ids) {
      this.validateRequirementReferences(data.kit, updates.requirement_ids);
    }

    const currentQuestion = data.kit.questions[questionIndex];
    data.kit.questions[questionIndex] = { ...currentQuestion, ...updates, id: questionId };
    data.itemStates.questions[questionId] = "edited";

    return data;
  },

  deleteQuestion(data: KitAndStates, questionId: string): KitAndStates {
    const questionIndex = data.kit.questions.findIndex((q) => q.id === questionId);
    if (questionIndex === -1) {
      throw new KitEditorError("QUESTION_NOT_FOUND", "Question not found in kit");
    }

    data.kit.questions.splice(questionIndex, 1);
    data.itemStates.questions[questionId] = "deleted";

    // Clean up schedule references if a question is deleted
    data.kit.schedule.days.forEach((day) => {
      day.question_ids = day.question_ids.filter((id) => id !== questionId);
    });

    return data;
  },

  reorderQuestions(data: KitAndStates, newOrder: string[]): KitAndStates {
    const currentIds = data.kit.questions.map((q) => q.id);
    if (newOrder.length !== currentIds.length) {
      throw new KitEditorError("INVALID_ORDER", "Order array length must match number of questions");
    }

    const missingIds = currentIds.filter((id) => !newOrder.includes(id));
    if (missingIds.length > 0) {
      throw new KitEditorError("INVALID_ORDER", `Missing question IDs in new order: ${missingIds.join(", ")}`);
    }

    const questionMap = new Map(data.kit.questions.map((q) => [q.id, q]));
    data.kit.questions = newOrder.map((id) => questionMap.get(id)!);

    return data;
  },

  addFlashcard(
    data: KitAndStates,
    newFlashcard: Omit<AppendixAKit["flashcards"][0], "id">
  ): KitAndStates {
    this.validateRequirementReferences(data.kit, newFlashcard.requirement_ids);

    const id = `fc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const flashcard = { ...newFlashcard, id };

    data.kit.flashcards.push(flashcard);
    data.itemStates.flashcards[id] = "edited";

    return data;
  },

  editFlashcard(
    data: KitAndStates,
    flashcardId: string,
    updates: Partial<Omit<AppendixAKit["flashcards"][0], "id">>
  ): KitAndStates {
    const index = data.kit.flashcards.findIndex((fc) => fc.id === flashcardId);
    if (index === -1) {
      throw new KitEditorError("FLASHCARD_NOT_FOUND", "Flashcard not found in kit");
    }

    if (updates.requirement_ids) {
      this.validateRequirementReferences(data.kit, updates.requirement_ids);
    }

    const currentFlashcard = data.kit.flashcards[index];
    data.kit.flashcards[index] = { ...currentFlashcard, ...updates, id: flashcardId };
    data.itemStates.flashcards[flashcardId] = "edited";

    return data;
  },

  deleteFlashcard(data: KitAndStates, flashcardId: string): KitAndStates {
    const index = data.kit.flashcards.findIndex((fc) => fc.id === flashcardId);
    if (index === -1) {
      throw new KitEditorError("FLASHCARD_NOT_FOUND", "Flashcard not found in kit");
    }

    data.kit.flashcards.splice(index, 1);
    data.itemStates.flashcards[flashcardId] = "deleted";

    return data;
  },

  validateRequirementReferences(kit: AppendixAKit, requirementIds: string[]) {
    const validIds = new Set(kit.role.requirements.map((r) => r.id));
    for (const reqId of requirementIds) {
      if (!validIds.has(reqId)) {
        throw new KitEditorError("INVALID_REQUIREMENT", `Unknown requirement id: ${reqId}`);
      }
    }
  },
};
