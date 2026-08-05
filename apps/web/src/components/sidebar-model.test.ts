import { describe, expect, it } from "vitest";
import {
  formatRecentChatMeta,
  isNewChatShortcut,
  recentChatStatusLabel,
  relativeAge,
} from "./sidebar-model";

const NOW = new Date("2026-08-05T12:00:00Z");
const ago = (milliseconds: number) => new Date(NOW.getTime() - milliseconds);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relativeAge", () => {
  it("reads as 'just now' under a minute", () => {
    expect(relativeAge(ago(30_000), NOW)).toBe("just now");
  });

  it("counts minutes below the hour", () => {
    expect(relativeAge(ago(17 * MINUTE), NOW)).toBe("17m ago");
  });

  it("counts hours below the day, matching the design mockup's '17h ago'", () => {
    expect(relativeAge(ago(17 * HOUR), NOW)).toBe("17h ago");
  });

  it("drops 'ago' past a day, matching the mockup's '3d' and '6d'", () => {
    expect(relativeAge(ago(3 * DAY), NOW)).toBe("3d");
    expect(relativeAge(ago(6 * DAY), NOW)).toBe("6d");
  });

  it("switches to weeks rather than growing an unbounded day count", () => {
    expect(relativeAge(ago(14 * DAY), NOW)).toBe("2w");
  });

  it("treats a future timestamp as now rather than emitting a negative age", () => {
    expect(relativeAge(new Date(NOW.getTime() + HOUR), NOW)).toBe("just now");
  });
});

describe("recentChatStatusLabel", () => {
  it("maps each session status to the rail's wording", () => {
    expect(recentChatStatusLabel("active")).toBe("In progress");
    expect(recentChatStatusLabel("complete")).toBe("Done");
    expect(recentChatStatusLabel("abandoned")).toBe("Abandoned");
    expect(recentChatStatusLabel("cancelled")).toBe("Cancelled");
  });
});

describe("formatRecentChatMeta", () => {
  it("joins status and age with the mockup's separator", () => {
    expect(formatRecentChatMeta("complete", ago(17 * HOUR), NOW)).toBe("Done · 17h ago");
    expect(formatRecentChatMeta("active", ago(3 * DAY), NOW)).toBe("In progress · 3d");
  });
});

// The rail renders a ⌘K hint next to New chat. A hint that does nothing is a
// lie to the user, so the binding is real — and must not fire while the user is
// typing a K into a field.
describe("isNewChatShortcut", () => {
  const event = (over: Partial<Parameters<typeof isNewChatShortcut>[0]> = {}) => ({
    key: "k",
    metaKey: true,
    ctrlKey: false,
    target: null,
    ...over,
  });

  it("fires on meta+K and ctrl+K", () => {
    expect(isNewChatShortcut(event())).toBe(true);
    expect(isNewChatShortcut(event({ metaKey: false, ctrlKey: true }))).toBe(true);
  });

  it("is case-insensitive, so shift+⌘+K still counts", () => {
    expect(isNewChatShortcut(event({ key: "K" }))).toBe(true);
  });

  it("ignores a bare K", () => {
    expect(isNewChatShortcut(event({ metaKey: false, ctrlKey: false }))).toBe(false);
  });

  it("ignores other modified keys", () => {
    expect(isNewChatShortcut(event({ key: "j" }))).toBe(false);
  });

  it("does not fire while an input, textarea or editable element has focus", () => {
    expect(isNewChatShortcut(event({ target: { tagName: "INPUT" } }))).toBe(false);
    expect(isNewChatShortcut(event({ target: { tagName: "TEXTAREA" } }))).toBe(false);
    expect(isNewChatShortcut(event({ target: { tagName: "DIV", isContentEditable: true } }))).toBe(
      false,
    );
  });

  it("still fires when focus is on a non-editable element", () => {
    expect(isNewChatShortcut(event({ target: { tagName: "DIV" } }))).toBe(true);
  });
});
