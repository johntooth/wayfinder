"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

// A titled, collapsible group of setting cards. The Configuration page has many
// cards, so sections start collapsed and the page opens as a scannable index of
// what can be configured. The header is styled as an obvious control — hover
// state, pointer cursor and a boxed chevron — because a plain heading gave no
// hint that it opened anything.
export function CollapsibleSection({
  title,
  description,
  defaultOpen = false,
  testId,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section data-testid={testId} className="rounded-[12px] border border-[#e4e1db] bg-white/40">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-[12px] px-4 py-3 text-left transition-colors hover:bg-[#efede8] ${
          open ? "rounded-b-none" : ""
        }`}
      >
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold tracking-tight text-[#1a1814]">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        <span className="flex items-center gap-2 text-xs font-medium text-[#6d6a65]">
          <span className="hidden sm:inline">{open ? "Hide" : "Show"}</span>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-[#dedad2] bg-white">
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-[#6d6a65] transition-transform ${open ? "" : "-rotate-90"}`}
            />
          </span>
        </span>
      </button>
      {open && <div className="space-y-4 border-t border-[#e4e1db] px-4 py-4">{children}</div>}
    </section>
  );
}
