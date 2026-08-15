import { describe, expect, it } from "vitest";
import { BRANCH_CHOICE_REQUEST, toBranchChoiceMessages } from "./branch-choice-messages";

describe("toBranchChoiceMessages", () => {
  it("appends a closing user turn when the transcript ends with the assistant", () => {
    const messages = toBranchChoiceMessages([
      { role: "user", content: "I need to buy laptops" },
      { role: "assistant", content: "How many, and what is the total spend?" },
    ]);

    expect(messages.at(-1)).toEqual({ role: "user", content: BRANCH_CHOICE_REQUEST });
  });

  it("appends the closing turn even when the transcript already ends with a user turn", () => {
    // The request is what the model answers, so it is always the last turn —
    // a transcript ending on the operator's message would otherwise ask the
    // model to route without ever stating that routing is the task.
    const messages = toBranchChoiceMessages([{ role: "user", content: "Twelve, about £14,000" }]);

    expect(messages).toEqual([
      { role: "user", content: "Twelve, about £14,000" },
      { role: "user", content: BRANCH_CHOICE_REQUEST },
    ]);
  });

  it("never ends on an assistant turn, whatever the transcript looks like", () => {
    const transcripts = [
      [{ role: "assistant" as const, content: "Step complete." }],
      [
        { role: "user" as const, content: "hello" },
        { role: "assistant" as const, content: "hi" },
      ],
      [],
    ];

    for (const transcript of transcripts) {
      expect(toBranchChoiceMessages(transcript).at(-1)?.role).toBe("user");
    }
  });

  it("produces a usable request from an empty transcript", () => {
    expect(toBranchChoiceMessages([])).toEqual([{ role: "user", content: BRANCH_CHOICE_REQUEST }]);
  });

  it("folds stored system rows into user notes rather than passing the role through", () => {
    const messages = toBranchChoiceMessages([
      { role: "user", content: "start" },
      { role: "system", content: "The document was generated." },
    ]);

    expect(messages.map((message) => message.role)).toEqual(["user", "user", "user"]);
    expect(messages[1]!.content).toContain("The document was generated.");
    expect(messages[1]!.content).toContain("[System note]");
  });

  it("keeps the conversation's own order", () => {
    const messages = toBranchChoiceMessages([
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
    ]);

    expect(messages.slice(0, 3).map((message) => message.content)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });
});
