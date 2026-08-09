import { describe, expect, it } from "vitest";
import { RING, mostConstrainedPeriod, ringArcColour, ringGeometry } from "./usage-ring-model";
import { TOKENS } from "@/lib/design-tokens";

describe("ringGeometry", () => {
  it("leaves the arc empty at zero", () => {
    expect(ringGeometry(0).dashOffset).toBeCloseTo(RING.circumference, 5);
  });

  it("closes the arc at full", () => {
    expect(ringGeometry(1).dashOffset).toBeCloseTo(0, 5);
  });

  it("sweeps proportionally in between", () => {
    expect(ringGeometry(0.25).dashOffset).toBeCloseTo(RING.circumference * 0.75, 5);
  });

  it("clamps out-of-range ratios rather than drawing past the circle", () => {
    // Spend can exceed a limit, which would otherwise wind the arc round twice.
    expect(ringGeometry(1.8).dashOffset).toBeCloseTo(0, 5);
    expect(ringGeometry(-0.5).dashOffset).toBeCloseTo(RING.circumference, 5);
  });

  it("derives the circumference from the radius it draws with", () => {
    expect(RING.circumference).toBeCloseTo(2 * Math.PI * RING.radius, 5);
  });
});

describe("ringArcColour", () => {
  it("maps each status onto a palette token, never a bare literal", () => {
    expect(ringArcColour("ok")).toBe(TOKENS.primary);
    expect(ringArcColour("warn")).toBe(TOKENS.warning);
    expect(ringArcColour("blocked")).toBe(TOKENS.rose);
  });
});

describe("mostConstrainedPeriod", () => {
  const period = (name: string, ratio: number) => ({ period: name, ratio });

  it("returns the highest-ratio period, per ADR-031's most-restrictive rule", () => {
    const periods = [period("monthly", 0.2), period("daily", 0.9), period("weekly", 0.5)];
    expect(mostConstrainedPeriod(periods)?.period).toBe("daily");
  });

  it("returns null when there is nothing to show", () => {
    expect(mostConstrainedPeriod([])).toBeNull();
  });

  it("does not mutate the caller's array", () => {
    const periods = [period("monthly", 0.2), period("daily", 0.9)];
    mostConstrainedPeriod(periods);
    expect(periods.map((entry) => entry.period)).toEqual(["monthly", "daily"]);
  });
});
