import { test, expect, describe } from "vitest";
import { kitEditorService, KitEditorError } from "../kit-editor.service.js";

describe("Kit Editor Service", () => {
  const getMockKit = () => ({
    kit: {
      role: { requirements: [{ id: "req1", text: "Req 1", kind: "technical", priority: "must" }] },
      questions: [],
      flashcards: [],
      schedule: { days: [] }
    } as any,
    itemStates: { questions: {}, flashcards: {}, schedule: {} } as any
  });

  test("add question", () => {
    const data = getMockKit();
    const result = kitEditorService.addQuestion(data, {
      requirement_ids: ["req1"],
      category: "technical",
      prompt: "Q1",
      answer_outline: "A1",
      difficulty: 2
    });

    expect(result.kit.questions.length).toBe(1);
    const newId = result.kit.questions[0].id;
    expect(result.itemStates.questions[newId]).toBe("edited");
  });

  test("edit question marks state edited", () => {
    const data = getMockKit();
    data.kit.questions.push({ id: "q1", requirement_ids: ["req1"], category: "technical", prompt: "Q1", answer_outline: "A1", difficulty: 2 });
    data.itemStates.questions["q1"] = "generated";

    const result = kitEditorService.editQuestion(data, "q1", { prompt: "Q1 Edited" });
    expect(result.kit.questions[0].prompt).toBe("Q1 Edited");
    expect(result.itemStates.questions["q1"]).toBe("edited");
  });

  test("delete question marks state deleted", () => {
    const data = getMockKit();
    data.kit.questions.push({ id: "q1", requirement_ids: ["req1"], category: "technical", prompt: "Q1", answer_outline: "A1", difficulty: 2 });
    data.itemStates.questions["q1"] = "generated";

    const result = kitEditorService.deleteQuestion(data, "q1");
    expect(result.kit.questions.length).toBe(0);
    expect(result.itemStates.questions["q1"]).toBe("deleted");
  });

  test("reorder question", () => {
    const data = getMockKit();
    data.kit.questions = [
      { id: "q1" } as any,
      { id: "q2" } as any
    ];

    const result = kitEditorService.reorderQuestions(data, ["q2", "q1"]);
    expect(result.kit.questions[0].id).toBe("q2");
    expect(result.kit.questions[1].id).toBe("q1");
  });
});
