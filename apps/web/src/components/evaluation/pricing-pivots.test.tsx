import { describe, expect, it } from "vitest";
import { PricingPivots } from "./pricing-pivots";

describe("PricingPivots", () => {
  it("exports a function component", () => {
    expect(typeof PricingPivots).toBe("function");
  });

  it("component name is PricingPivots", () => {
    expect(PricingPivots.name).toBe("PricingPivots");
  });
});
