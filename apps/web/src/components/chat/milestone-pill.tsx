interface MilestonePillProps {
  nodeName: string;
  confidence: number;
  documentState?: "generating" | "no_template" | "failed" | "done" | null;
  onRegenerate?: () => void;
}

export function MilestonePill({
  nodeName,
  confidence,
  documentState,
  onRegenerate,
}: MilestonePillProps) {
  if (documentState === "no_template") {
    return (
      <div className="my-3 flex justify-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[#dedad2] bg-[#efede8] px-3 py-1 text-[11px] font-semibold text-[#918d87]">
          <span>📄</span>
          <span>Step complete — {nodeName} · No template configured</span>
        </div>
      </div>
    );
  }

  if (documentState === "failed") {
    return (
      <div className="my-3 flex flex-col items-center gap-1">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[#e8b87c] bg-[#fdf3e3] px-3 py-1 text-[11px] font-semibold text-[#c17a1a]">
          <span>⚠️</span>
          <span>Document generation failed — {nodeName}</span>
          {onRegenerate && (
            <button type="button" className="ml-1 underline hover:no-underline" onClick={onRegenerate}>
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (documentState === "generating") {
    return (
      <div className="my-3 flex justify-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[#c5d0f7] bg-[#eef1fc] px-3 py-1 text-[11px] font-semibold text-[#3a5fd9]">
          <span className="animate-pulse">📄</span>
          <span>Generating document — {nodeName}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="my-3 flex justify-center">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-[#c0e8d5] bg-[#eaf6f0] px-3 py-[4px] text-[11px] font-semibold text-[#2e9e6a]">
        <svg viewBox="0 0 12 12" width="12" height="12" className="shrink-0">
          <circle cx="6" cy="6" r="6" fill="currentColor" />
          <path d="M3.5 6l2 2 3-3" stroke="white" strokeWidth="1.2" fill="none" />
        </svg>
        <span>
          Step complete — {nodeName} ({confidence}%)
        </span>
      </div>
    </div>
  );
}
