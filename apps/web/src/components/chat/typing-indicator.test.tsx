import { describe, expect, it } from "vitest";
import { TypingIndicator } from "./typing-indicator";

describe("TypingIndicator", () => {
  it("exports a function component", () => {
    expect(typeof TypingIndicator).toBe("function");
  });

  it("component name is TypingIndicator", () => {
    expect(TypingIndicator.name).toBe("TypingIndicator");
  });
});
