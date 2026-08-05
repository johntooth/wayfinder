import { TOKENS } from "@/lib/design-tokens";

export type UsageStatus = "ok" | "warn" | "blocked";

const RADIUS = 7;

// Geometry for the footer ring. An 18px box with a 7px radius and a 2.5px
// stroke leaves the arc readable at rail scale without crowding the user chip.
export const RING = {
  size: 18,
  radius: RADIUS,
  strokeWidth: 2.5,
  circumference: 2 * Math.PI * RADIUS,
} as const;

// Drawn as a dash the length of the full circle, offset back by the unfilled
// remainder — so `dashOffset` shrinks to zero as usage approaches the limit.
export const ringGeometry = (ratio: number): { dashArray: number; dashOffset: number } => {
  const clamped = Math.min(Math.max(ratio, 0), 1);
  return {
    dashArray: RING.circumference,
    dashOffset: RING.circumference * (1 - clamped),
  };
};

const ARC_COLOUR: Record<UsageStatus, string> = {
  ok: TOKENS.primary,
  warn: TOKENS.warning,
  blocked: TOKENS.rose,
};

export const ringArcColour = (status: UsageStatus): string => ARC_COLOUR[status];

// ADR-031: where several periods carry limits, the most restrictive governs.
export const mostConstrainedPeriod = <T extends { ratio: number }>(
  periods: readonly T[],
): T | null => {
  if (periods.length === 0) return null;
  return [...periods].sort((first, second) => second.ratio - first.ratio)[0] ?? null;
};
