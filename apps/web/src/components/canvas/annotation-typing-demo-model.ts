// The three annotations the no-fields screen types out for the author, in
// increasing order of detail: a plain field, then one carrying a type. Kept to
// forms the grammar accepts, so anything copied off the screen parses.
export interface DemoLine {
  caption: string;
  tag: string;
}

export const DEMO_LINES: DemoLine[] = [
  { caption: "Supplier Name:", tag: "{{ Supplier Name }}" },
  { caption: "Start Date:", tag: "{{ Start Date (date) }}" },
  { caption: "Contract Value:", tag: "{{ Contract Value (currency) }}" },
];

export interface DemoState {
  lineIndex: number;
  // Characters of the current line's tag revealed so far.
  chars: number;
}

export const INITIAL_DEMO_STATE: DemoState = { lineIndex: 0, chars: 0 };

export const TYPE_MS = 55;
const LINE_PAUSE_MS = 900;
export const RESTART_PAUSE_MS = 2200;

const isComplete = (state: DemoState): boolean =>
  state.chars >= (DEMO_LINES[state.lineIndex]?.tag.length ?? 0);

const isLastLine = (state: DemoState): boolean => state.lineIndex >= DEMO_LINES.length - 1;

// One tick of the demo: another character, the next line, or back to the start.
export const advanceDemo = (state: DemoState): DemoState => {
  if (!DEMO_LINES[state.lineIndex]) return INITIAL_DEMO_STATE;
  if (!isComplete(state)) return { lineIndex: state.lineIndex, chars: state.chars + 1 };
  if (isLastLine(state)) return INITIAL_DEMO_STATE;
  return { lineIndex: state.lineIndex + 1, chars: 0 };
};

// How long to hold this frame. A finished tag pauses long enough to be read, and
// the finished document longer still, so the loop does not feel like a flicker.
export const delayFor = (state: DemoState): number => {
  if (!isComplete(state)) return TYPE_MS;
  return isLastLine(state) ? RESTART_PAUSE_MS : LINE_PAUSE_MS;
};

// What a given line shows in this frame: typed in full, cut off at the caret, or
// nothing at all.
export const typedTagFor = (state: DemoState, lineIndex: number): string => {
  const line = DEMO_LINES[lineIndex];
  if (!line) return "";
  if (lineIndex < state.lineIndex) return line.tag;
  if (lineIndex > state.lineIndex) return "";
  return line.tag.slice(0, state.chars);
};
