import type { BadgeState } from "@/components/settings/connectivity";

// Whether a required setup target is good enough to leave the wizard's required
// step. Presence of configuration is not enough on its own: every storage field
// has an env default (localhost/minioadmin/…), so a fresh install reads as
// "configured" with nothing actually set up. ADR-041 §2 always intended the
// wizard to require the live Test — this is that rule.
export type RequirementState = "unconfigured" | "untested" | "passed" | "failed" | "unsupported";

export const resolveRequirement = (
  configured: boolean,
  status: BadgeState["status"] | undefined,
): RequirementState => {
  if (!configured) return "unconfigured";
  if (status === "ok") return "passed";
  if (status === "failed") return "failed";
  // A configured target that reports skipped has no live probe — Bedrock is the
  // case in practice, where a real check needs SigV4-signed control-plane calls.
  if (status === "skipped") return "unsupported";
  return "untested";
};

export const isRequirementSatisfied = (state: RequirementState): boolean =>
  state === "passed" || state === "unsupported";

export const REQUIREMENT_HINT: Record<RequirementState, string> = {
  unconfigured: "required — not configured",
  untested: "required — run Test connectivity",
  passed: "connected",
  failed: "test failed — check the settings above",
  unsupported: "configured (no live test available)",
};
