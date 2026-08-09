import type { ReactNode } from "react";

// The brand sits above the card so an unauthenticated screen — the first thing
// a new user ever sees — is identifiably Wayfinder without the app shell.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[22px] overflow-auto bg-[#faf9f7] p-4">
      <div className="flex items-center gap-[10px]">
        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-[#2f56d3] text-[14px] font-bold text-white">
          W
        </div>
        <span className="text-[19px] font-semibold tracking-[-0.015em] text-[#1c1b19]">
          Wayfinder
        </span>
        <span className="rounded-[4px] border border-[#dedad2] px-[5px] py-[2px] font-mono text-[9px] uppercase tracking-[0.1em] text-[#736d5f]">
          Alpha
        </span>
      </div>
      {children}
    </main>
  );
}
