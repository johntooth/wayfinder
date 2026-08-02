"use client";

import { useEffect, useState } from "react";
import {
  advanceDemo,
  delayFor,
  DEMO_LINES,
  INITIAL_DEMO_STATE,
  typedTagFor,
  type DemoState,
} from "./annotation-typing-demo-model";

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

// Types the annotations into a mock document, so an author who has never seen the
// syntax can watch where it goes rather than read about it. Reduced motion gets
// the finished document with no animation — the same information, held still.
export function AnnotationTypingDemo() {
  const [state, setState] = useState<DemoState>(INITIAL_DEMO_STATE);
  const [animate, setAnimate] = useState(true);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setAnimate(false);
      return;
    }

    const timer = setTimeout(() => setState(advanceDemo(state)), delayFor(state));
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <div className="overflow-hidden rounded-[9px] border border-[#dedad2] bg-white shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-[#e6e3dc] bg-[#f7f6f3] px-3 py-1.5">
        <span className="h-2 w-2 rounded-full bg-[#dedad2]" />
        <span className="h-2 w-2 rounded-full bg-[#dedad2]" />
        <span className="h-2 w-2 rounded-full bg-[#dedad2]" />
        <span className="ml-1 text-[11px] text-[#6d6a65]">your-template.docx</span>
      </div>

      <div className="space-y-2 p-4">
        <p className="text-[13px] font-semibold text-[#1a1814]">Supplier Agreement</p>
        {DEMO_LINES.map((line, index) => {
          const typed = animate ? typedTagFor(state, index) : line.tag;
          const isTyping = animate && index === state.lineIndex;
          return (
            <p key={line.caption} className="flex items-baseline gap-2 text-[12px]">
              <span className="w-[7.5rem] shrink-0 text-[#5a5650]">{line.caption}</span>
              <span className="min-w-0 font-mono text-[#3a5fd9]">
                {typed}
                {isTyping && (
                  <span
                    aria-hidden
                    className="ml-px inline-block h-[1em] w-[1px] animate-pulse bg-[#3a5fd9] align-text-bottom"
                  />
                )}
              </span>
            </p>
          );
        })}
      </div>
    </div>
  );
}
