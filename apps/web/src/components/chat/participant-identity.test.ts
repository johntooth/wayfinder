import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/design-tokens";
import { PARTICIPANT_TINTS, participantInitials, participantTint } from "./participant-identity";

const AA_TEXT = 4.5;

describe("participantTint", () => {
  it("gives one person the same tint every time", () => {
    // The tint is identity, not decoration: a person whose colour changed
    // between renders would be read as two people.
    const first = participantTint("user-ada");
    const second = participantTint("user-ada");
    expect(first).toEqual(second);
  });

  it("does not collide on ids that differ only by digit order", () => {
    // The specific weakness of summing char codes, which is why this hashes.
    // Two arbitrary people CAN share a tint — with six tints that is a 1-in-6
    // event and an accepted one, since the name is always written beside the
    // circle. What must not happen is a systematic collision.
    expect(participantTint("user-12")).not.toEqual(participantTint("user-21"));
  });

  it("distributes evenly enough that no tint dominates", () => {
    const seeds = Array.from({ length: 600 }, (_, index) => `user-${index}`);
    const counts = new Map<string, number>();
    for (const seed of seeds) {
      const { fill } = participantTint(seed);
      counts.set(fill, (counts.get(fill) ?? 0) + 1);
    }
    // Even distribution would be 100 each; allow generous slack but catch a
    // hash that funnels most people onto one colour.
    for (const count of counts.values()) {
      expect(count).toBeLessThan(200);
    }
  });

  it("is total — any seed resolves, including an empty one", () => {
    expect(PARTICIPANT_TINTS).toContainEqual(participantTint(""));
    expect(PARTICIPANT_TINTS).toContainEqual(participantTint("🙂"));
  });

  it("spreads across the whole palette rather than collapsing onto one entry", () => {
    const seeds = Array.from({ length: 60 }, (_, index) => `user-${index}`);
    const used = new Set(seeds.map((seed) => participantTint(seed).fill));
    expect(used.size).toBe(PARTICIPANT_TINTS.length);
  });
});

describe("participant tint contrast", () => {
  // The initials are text, so WCAG 1.4.3 AA applies at 4.5:1 against the circle
  // they sit on.
  it.each(PARTICIPANT_TINTS)("ink on $fill clears AA for body text", ({ fill, ink }) => {
    expect(contrastRatio(ink, fill)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // Deliberately NOT asserted: fill-versus-page contrast. These are ~1.2:1 by
  // design — a 3:1 avatar fill on warm paper is a garish dot. That is
  // acceptable here because the tint is never the only signal: the person's
  // name is always written beside it, so nobody has to identify a participant
  // by colour alone.
  it("keeps every fill light enough to sit quietly on the page", () => {
    for (const { fill } of PARTICIPANT_TINTS) {
      expect(contrastRatio(fill, "#ffffff")).toBeLessThan(1.5);
    }
  });
});

describe("participantInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(participantInitials("Ada Lovelace")).toBe("AL");
    expect(participantInitials("Grace Hopper")).toBe("GH");
  });

  it("handles a single name and extra whitespace", () => {
    expect(participantInitials("  Ada  ")).toBe("A");
  });

  it("ignores a third name rather than crowding the circle", () => {
    expect(participantInitials("Ada Byron Lovelace")).toBe("AB");
  });

  it("falls back to a placeholder when there is no name at all", () => {
    expect(participantInitials("")).toBe("?");
    expect(participantInitials(null)).toBe("?");
  });
});
