import type { SessionStatus } from "@rbrasier/domain";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// Rail-sized ages. Under a day reads as elapsed time ("17h ago"); past that it
// compacts to a bare count ("3d"), which is what the design mockup shows and
// what keeps a two-line card from wrapping.
export const relativeAge = (timestamp: Date, now: Date = new Date()): string => {
  const elapsed = now.getTime() - new Date(timestamp).getTime();
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`;
  return `${Math.floor(elapsed / WEEK)}w`;
};

const STATUS_LABEL: Record<SessionStatus, string> = {
  active: "In progress",
  complete: "Done",
  abandoned: "Abandoned",
  cancelled: "Cancelled",
};

export const recentChatStatusLabel = (status: SessionStatus): string => STATUS_LABEL[status];

export const formatRecentChatMeta = (
  status: SessionStatus,
  updatedAt: Date,
  now: Date = new Date(),
): string => `${recentChatStatusLabel(status)} · ${relativeAge(updatedAt, now)}`;

// Structural subset of KeyboardEvent — enough to decide the binding without
// requiring a DOM in the tests.
interface ShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  target: { tagName?: string; isContentEditable?: boolean } | null;
}

const EDITABLE_TAGS = ["INPUT", "TEXTAREA", "SELECT"];

const isEditableTarget = (target: ShortcutEvent["target"]): boolean => {
  if (!target) return false;
  if (target.isContentEditable === true) return true;
  return EDITABLE_TAGS.includes(target.tagName ?? "");
};

export const isNewChatShortcut = (event: ShortcutEvent): boolean => {
  if (event.key.toLowerCase() !== "k") return false;
  if (!event.metaKey && !event.ctrlKey) return false;
  return !isEditableTarget(event.target);
};
