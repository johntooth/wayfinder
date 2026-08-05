export interface ParticipantTint {
  fill: string;
  ink: string;
}

// Muted paper-weight tints. Each ink is the same hue as its fill, darkened
// until the initials clear WCAG 1.4.3 AA on it (asserted in the test).
export const PARTICIPANT_TINTS: readonly ParticipantTint[] = [
  { fill: "#dfeee4", ink: "#1f5137" },
  { fill: "#f2e7d3", ink: "#6b4a17" },
  { fill: "#dde8f7", ink: "#1f4372" },
  { fill: "#f7dfe4", ink: "#7a2a41" },
  { fill: "#e7e1f6", ink: "#4a3480" },
  { fill: "#d8ebe9", ink: "#1a4f4a" },
] as const;

// FNV-1a with a murmur3 finalizer. Seeded from the user id rather than the name
// so a rename keeps the person's colour.
//
// The finalizer is not optional: the palette index is `hash % 6`, which reads
// the low bits, and raw FNV-1a avalanches those poorly — "user-12" and
// "user-21" land on the same tint without it.
const hash = (seed: string): number => {
  let value = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35) >>> 0;
  value ^= value >>> 16;
  return value >>> 0;
};

export const participantTint = (seed: string): ParticipantTint =>
  PARTICIPANT_TINTS[hash(seed) % PARTICIPANT_TINTS.length]!;

export const participantInitials = (name: string | null | undefined): string => {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
};
