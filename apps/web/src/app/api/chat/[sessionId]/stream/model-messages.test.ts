import { describe, expect, it } from "vitest";
import { toModelMessages } from "./model-messages";

const row = (role: "user" | "assistant" | "system", content: string) => ({ role, content });

describe("toModelMessages", () => {
  it("passes user and assistant turns through unchanged", () => {
    const messages = toModelMessages([
      row("user", "I need a contract for Sam."),
      row("assistant", "What is the start date?"),
    ]);

    expect(messages).toEqual([
      { role: "user", content: "I need a contract for Sam." },
      { role: "assistant", content: "What is the start date?" },
    ]);
  });

  // The SDK rejects a system message that appears after the conversation has
  // started, and several providers reject it outright — which is what left the
  // user staring at "The assistant couldn't reply" after an approval decision.
  it("emits no system-role message, whatever the transcript holds", () => {
    const messages = toModelMessages([
      row("system", "Cross-check complete."),
      row("user", "Agreed."),
      row("system", "Completed automated step: Notify payroll."),
      row("assistant", "Noted."),
      row("system", "Running automated step: Issue contract."),
    ]);

    // Widened deliberately: `ModelMessage["role"]` already excludes "system", so
    // this guards the runtime mapping against a future widening of that type
    // rather than restating what the compiler proves.
    const roles: string[] = messages.map((message) => message.role);
    expect(roles).not.toContain("system");
  });

  // The content still has to reach the model: these rows carry the cross-check
  // outcome and the automated steps' results, which the next turn reasons over.
  it("keeps a system row's content, marked as a note rather than a turn", () => {
    const messages = toModelMessages([
      row("user", "Ready."),
      row("system", "Completed automated step: Notify payroll."),
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("Completed automated step: Notify payroll.");
    expect(messages[1]?.content).toContain("[System note]");
  });

  it("preserves order across mixed roles", () => {
    const messages = toModelMessages([
      row("assistant", "first"),
      row("system", "second"),
      row("user", "third"),
    ]);

    expect(messages.map((message) => message.content.slice(-5))).toEqual([
      "first",
      "econd",
      "third",
    ]);
  });

  it("returns nothing for an empty transcript", () => {
    expect(toModelMessages([])).toEqual([]);
  });
});
