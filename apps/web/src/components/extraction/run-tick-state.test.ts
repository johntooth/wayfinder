import { describe, expect, it } from "vitest";
import { isLiveRun, isProcessing, shouldAnimateProgress, shouldDriveTick } from "./run-tick-state";

const state = (overrides: Partial<Parameters<typeof shouldDriveTick>[0]> = {}) => ({
  status: "running",
  tickInFlight: false,
  tickBlocked: false,
  ...overrides,
});

describe("shouldDriveTick", () => {
  it("drives a running run that has no tick in flight", () => {
    expect(shouldDriveTick(state())).toBe(true);
  });

  it("never overlaps a tick already in flight", () => {
    expect(shouldDriveTick(state({ tickInFlight: true }))).toBe(false);
  });

  it("stops after a failed tick so a persistent error is not a hot loop", () => {
    expect(shouldDriveTick(state({ tickBlocked: true }))).toBe(false);
  });

  it("leaves paused and terminal runs alone", () => {
    for (const status of [
      "paused_preview",
      "paused_cap",
      "complete",
      "partial",
      "cancelled",
      undefined,
    ]) {
      expect(shouldDriveTick(state({ status }))).toBe(false);
    }
  });
});

describe("isProcessing", () => {
  it("is true only while the run is running", () => {
    expect(isProcessing("running")).toBe(true);
    expect(isProcessing("paused_preview")).toBe(false);
    expect(isProcessing("complete")).toBe(false);
    expect(isProcessing(undefined)).toBe(false);
  });
});

describe("isLiveRun", () => {
  it("is true while the run can still gain results", () => {
    expect(isLiveRun("running")).toBe(true);
    expect(isLiveRun("paused_preview")).toBe(true);
    expect(isLiveRun("paused_cap")).toBe(true);
  });

  it("is false once the run is terminal, so the screen stops polling", () => {
    for (const status of ["complete", "partial", "cancelled", undefined]) {
      expect(isLiveRun(status)).toBe(false);
    }
  });
});

describe("shouldAnimateProgress", () => {
  it("animates while the run is processing", () => {
    expect(shouldAnimateProgress("running")).toBe(true);
  });

  it("holds the bar still when the run is paused, so 'stopped' reads as stopped", () => {
    expect(shouldAnimateProgress("paused_preview")).toBe(false);
    expect(shouldAnimateProgress("paused_cap")).toBe(false);
  });

  it("holds the bar still once the run is terminal", () => {
    for (const status of ["complete", "partial", "cancelled", undefined]) {
      expect(shouldAnimateProgress(status)).toBe(false);
    }
  });
});
