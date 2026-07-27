import { describe, expect, it } from "vitest";
import { isRequirementSatisfied, resolveRequirement } from "./wizard-requirements";

describe("resolveRequirement", () => {
  it("reports unconfigured before anything is set, regardless of test state", () => {
    expect(resolveRequirement(false, undefined)).toBe("unconfigured");
    expect(resolveRequirement(false, "ok")).toBe("unconfigured");
  });

  it("reports untested once configured but before the probe has run", () => {
    expect(resolveRequirement(true, undefined)).toBe("untested");
    expect(resolveRequirement(true, "idle")).toBe("untested");
    expect(resolveRequirement(true, "testing")).toBe("untested");
  });

  it("reports passed on a successful probe and failed on an unsuccessful one", () => {
    expect(resolveRequirement(true, "ok")).toBe("passed");
    expect(resolveRequirement(true, "failed")).toBe("failed");
  });

  it("reports unsupported when a configured target has no live probe", () => {
    // Bedrock deliberately skips: a live check needs SigV4-signed control-plane
    // calls, so the probe reports unsupported rather than faking a pass.
    expect(resolveRequirement(true, "skipped")).toBe("unsupported");
  });
});

describe("isRequirementSatisfied", () => {
  it("lets a passing probe through", () => {
    expect(isRequirementSatisfied("passed")).toBe(true);
  });

  it("lets a configured target with no live probe through", () => {
    // Gating strictly on a pass would lock every Bedrock install out of setup,
    // because its probe can never return ok.
    expect(isRequirementSatisfied("unsupported")).toBe(true);
  });

  it("blocks anything unconfigured, untested or failing", () => {
    expect(isRequirementSatisfied("unconfigured")).toBe(false);
    expect(isRequirementSatisfied("untested")).toBe(false);
    expect(isRequirementSatisfied("failed")).toBe(false);
  });
});
