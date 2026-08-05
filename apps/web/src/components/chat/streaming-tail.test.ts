import { describe, expect, it } from "vitest";
import { streamingTail } from "./streaming-tail";

const message = (id: string) => ({ id });

describe("streamingTail", () => {
  it("returns only what the server has not persisted yet", () => {
    // The reason this exists: the feed used to unmount the whole persisted
    // transcript while streaming and re-render it from the AI SDK's list, which
    // knows nothing of step dividers, timestamps, document cards or milestone
    // pills — so all of them vanished mid-turn.
    const streaming = [message("a"), message("b"), message("c")];
    expect(streamingTail(streaming, 2)).toEqual([message("c")]);
  });

  it("contributes nothing when the stream has not outgrown the transcript", () => {
    // The persisted rows already render; echoing them would double every
    // message in the thread.
    expect(streamingTail([message("a"), message("b")], 2)).toEqual([]);
  });

  it("contributes nothing when the stream is behind the transcript", () => {
    // Happens right after a turn settles: the server has persisted the reply
    // but the client list has not caught up.
    expect(streamingTail([message("a")], 3)).toEqual([]);
  });

  it("renders the just-sent user message that is not yet persisted", () => {
    const streaming = [message("a"), message("just-sent")];
    expect(streamingTail(streaming, 1)).toEqual([message("just-sent")]);
  });

  it("handles an empty stream and an empty transcript", () => {
    expect(streamingTail([], 0)).toEqual([]);
    expect(streamingTail([message("a")], 0)).toEqual([message("a")]);
  });

  it("treats a negative persisted count as zero rather than slicing from the end", () => {
    // Array.slice(-1) would silently return the last element instead of all of
    // them, which is the kind of bug that only shows up on an empty session.
    expect(streamingTail([message("a"), message("b")], -1)).toEqual([
      message("a"),
      message("b"),
    ]);
  });
});
