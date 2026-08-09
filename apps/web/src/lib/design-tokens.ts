// The Wayfinder palette, mirroring docs/development/storybook/index.html.
//
// globals.css remains what the browser reads; this module exists so the values
// can be asserted. The contrast obligations in design-tokens.test.ts are the
// reason two of them deviate from the design mockup — see MUTED_TEXT_SURFACES.
export const TOKENS = {
  bg: "#faf9f7",
  bg2: "#f5f3ee",
  bg3: "#ebe8e0",
  surface: "#ffffff",

  border: "#e7e3db",
  borderStrong: "#dedad2",
  borderDashed: "#d8d3c7",

  text: "#1c1b19",
  text2: "#5c574c",
  // The mockup specifies #8a8272 and #a09884. Both fall below WCAG 1.4.3 AA
  // (3.81:1 and 2.87:1 on white), and the rail fill is darker still. These are
  // the same hues scaled toward black until they clear 4.5:1 on every surface
  // in MUTED_TEXT_SURFACES.
  text3: "#666055",
  text4: "#736d5f",

  primary: "#2f56d3",
  primaryLight: "#eaeefb",
  primaryDim: "#c3cef2",

  success: "#1f6b4d",
  successBg: "#e3efe5",
  successBorder: "#c7e0cf",
  warning: "#8a5a1d",
  warningBg: "#f6e9d8",
  warningBorder: "#e6d0ab",
  rose: "#a8324c",
  roseBg: "#f9e8eb",
  teal: "#14312e",
  tealBg: "#e6f2ee",
  purple: "#5b3fa8",
  purpleLight: "#efeafa",
} as const;

// Backgrounds that muted text is allowed to sit on. --bg3 is deliberately
// absent: it is the pressed/bubble fill and carries only --text or --text2, and
// including it squeezes the four-step ramp into a 0.7:1 spread.
export const MUTED_TEXT_SURFACES: readonly string[] = [TOKENS.surface, TOKENS.bg, TOKENS.bg2];

// Decorative values kept at their mockup lightness. They never carry text, so
// 1.4.3 does not apply; the hairlines and dots they draw are not the sole means
// of conveying anything.
export const DECORATION = {
  rule: "#e7e3db",
  dot: "#c9c3b5",
} as const;

const channelToLinear = (channel: number): number => {
  const normalised = channel / 255;
  return normalised <= 0.03928
    ? normalised / 12.92
    : Math.pow((normalised + 0.055) / 1.055, 2.4);
};

export const relativeLuminance = (hex: string): number => {
  const value = hex.replace("#", "");
  const [red, green, blue] = [0, 2, 4].map((offset) =>
    parseInt(value.slice(offset, offset + 2), 16),
  ) as [number, number, number];
  return (
    0.2126 * channelToLinear(red) +
    0.7152 * channelToLinear(green) +
    0.0722 * channelToLinear(blue)
  );
};

export const contrastRatio = (foreground: string, background: string): number => {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
};
