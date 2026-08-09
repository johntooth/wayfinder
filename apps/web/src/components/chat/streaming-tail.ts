// The streamed messages the persisted transcript does not yet cover.
//
// The feed renders `dbMessages` unconditionally and appends this, rather than
// swapping one list for the other while a reply streams. The swap was why step
// dividers, timestamps, milestone pills, document cards and approval decision
// bubbles all disappeared mid-turn: the streaming branch renders from the AI
// SDK's client-side list, which carries none of that context.
//
// Generic over the message shape so it stays testable without constructing a
// full UIMessage.
export const streamingTail = <T>(
  streamingMessages: readonly T[],
  persistedCount: number,
): T[] => {
  const alreadyRendered = Math.max(persistedCount, 0);
  if (streamingMessages.length <= alreadyRendered) return [];
  return streamingMessages.slice(alreadyRendered);
};
