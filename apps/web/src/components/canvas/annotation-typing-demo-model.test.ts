import { describe, it, expect } from "vitest";
import {
  advanceDemo,
  delayFor,
  DEMO_LINES,
  INITIAL_DEMO_STATE,
  RESTART_PAUSE_MS,
  typedTagFor,
  TYPE_MS,
  type DemoState,
} from "./annotation-typing-demo-model";

const runToEnd = (from: DemoState, ticks: number): DemoState => {
  let state = from;
  for (let tick = 0; tick < ticks; tick += 1) state = advanceDemo(state);
  return state;
};

describe("DEMO_LINES", () => {
  it("demonstrates a plain field first, so the simplest form is what is learnt", () => {
    expect(DEMO_LINES[0]?.tag).toBe("{{ Supplier Name }}");
  });

  it("only demonstrates syntax the annotation grammar accepts", () => {
    for (const line of DEMO_LINES) {
      expect(line.tag).toMatch(/^\{\{ .+ \}\}$/);
    }
  });
});

describe("advanceDemo", () => {
  it("reveals one more character of the tag being typed", () => {
    expect(advanceDemo(INITIAL_DEMO_STATE)).toEqual({ lineIndex: 0, chars: 1 });
  });

  it("moves to the next line once a tag is fully typed", () => {
    const full = DEMO_LINES[0]!.tag.length;
    expect(advanceDemo({ lineIndex: 0, chars: full })).toEqual({ lineIndex: 1, chars: 0 });
  });

  it("starts over after the last line, so the demo loops", () => {
    const last = DEMO_LINES.length - 1;
    const full = DEMO_LINES[last]!.tag.length;
    expect(advanceDemo({ lineIndex: last, chars: full })).toEqual(INITIAL_DEMO_STATE);
  });

  it("returns to the start from a line index that no longer exists", () => {
    expect(advanceDemo({ lineIndex: DEMO_LINES.length, chars: 0 })).toEqual(INITIAL_DEMO_STATE);
  });

  it("types every line and returns to the start within one full cycle", () => {
    const ticks = DEMO_LINES.reduce((total, line) => total + line.tag.length + 1, 0);
    expect(runToEnd(INITIAL_DEMO_STATE, ticks)).toEqual(INITIAL_DEMO_STATE);
  });
});

describe("delayFor", () => {
  it("advances a character at typing speed mid-tag", () => {
    expect(delayFor({ lineIndex: 0, chars: 3 })).toBe(TYPE_MS);
  });

  it("holds a completed tag long enough to read it", () => {
    const full = DEMO_LINES[0]!.tag.length;
    expect(delayFor({ lineIndex: 0, chars: full })).toBeGreaterThan(TYPE_MS);
  });

  it("holds the finished document longest before looping", () => {
    const last = DEMO_LINES.length - 1;
    const full = DEMO_LINES[last]!.tag.length;
    expect(delayFor({ lineIndex: last, chars: full })).toBe(RESTART_PAUSE_MS);
  });
});

describe("typedTagFor", () => {
  it("shows a line already typed in full, so the document builds up", () => {
    expect(typedTagFor({ lineIndex: 2, chars: 0 }, 0)).toBe(DEMO_LINES[0]!.tag);
  });

  it("shows the line being typed cut off at the caret", () => {
    expect(typedTagFor({ lineIndex: 0, chars: 4 }, 0)).toBe(DEMO_LINES[0]!.tag.slice(0, 4));
  });

  it("shows nothing for a line not reached yet", () => {
    expect(typedTagFor({ lineIndex: 0, chars: 4 }, 2)).toBe("");
  });
});
