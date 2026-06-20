import { describe, expect, it } from "vitest";
import { SpendCapsCard } from "./spend-caps-card";

describe("SpendCapsCard", () => {
  it("exports a function component", () => {
    expect(typeof SpendCapsCard).toBe("function");
  });

  it("component name is SpendCapsCard", () => {
    expect(SpendCapsCard.name).toBe("SpendCapsCard");
  });
});
