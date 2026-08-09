import { describe, expect, it } from "vitest";
import {
  MUTED_TEXT_SURFACES,
  TOKENS,
  contrastRatio,
  relativeLuminance,
} from "./design-tokens";

// WCAG 2.2 thresholds. 1.4.3 governs text; 1.4.11 governs meaningful non-text
// (the ring meter arc, the step badges) at the lower bar.
const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

describe("relativeLuminance", () => {
  it("anchors at the ends of the range", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("matches the worked example from the WCAG definition", () => {
    // #808080 mid-grey — 0.2158 per the sRGB transfer function.
    expect(relativeLuminance("#808080")).toBeCloseTo(0.2158, 3);
  });
});

describe("contrastRatio", () => {
  it("is symmetric and bounded by 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 2);
    expect(contrastRatio("#123456", "#123456")).toBeCloseTo(1, 5);
  });
});

// The reason this file exists. The design mockup specifies --text3 #8a8272 and
// --text4 #a09884, which are 3.81:1 and 2.87:1 on white — both below AA. The
// shipped tokens are hue-matched darkenings of those. Without this test a later
// "match the mockup exactly" edit would silently reintroduce the failure that
// globals.css already records having fixed once.
describe("muted text tokens meet WCAG 1.4.3 AA", () => {
  const mutedTokens = ["text2", "text3", "text4"] as const;

  for (const token of mutedTokens) {
    for (const surface of MUTED_TEXT_SURFACES) {
      it(`--${token} on ${surface} clears ${AA_TEXT}:1`, () => {
        expect(contrastRatio(TOKENS[token], surface)).toBeGreaterThanOrEqual(AA_TEXT);
      });
    }
  }

  it("keeps the ramp monotonic — each step is lighter than the one before", () => {
    const ratios = (["text", ...mutedTokens] as const).map((token) =>
      contrastRatio(TOKENS[token], TOKENS.surface),
    );
    const descending = [...ratios].sort((a, b) => b - a);
    expect(ratios).toEqual(descending);
  });

  it("rejects the raw mockup values, documenting why they were not shipped", () => {
    expect(contrastRatio("#8a8272", TOKENS.surface)).toBeLessThan(AA_TEXT);
    expect(contrastRatio("#a09884", TOKENS.surface)).toBeLessThan(AA_TEXT);
  });
});

describe("primary and semantic pairs meet AA", () => {
  it("primary is legible both as text on white and as a fill behind white", () => {
    expect(contrastRatio(TOKENS.primary, TOKENS.surface)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(TOKENS.surface, TOKENS.primary)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("each status pill is legible on its own tint", () => {
    const pills: [string, string][] = [
      [TOKENS.success, TOKENS.successBg],
      [TOKENS.warning, TOKENS.warningBg],
      [TOKENS.rose, TOKENS.roseBg],
      [TOKENS.teal, TOKENS.tealBg],
      [TOKENS.purple, TOKENS.purpleLight],
      [TOKENS.primary, TOKENS.primaryLight],
    ];
    for (const [foreground, background] of pills) {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe("non-text contrast meets WCAG 1.4.11", () => {
  it("the usage ring arc is distinguishable from its track in every status", () => {
    for (const arc of [TOKENS.primary, TOKENS.warning, TOKENS.rose]) {
      expect(contrastRatio(arc, TOKENS.bg3)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
  });
});
