"use client";

interface ConfidenceBarProps {
  score: number | null;
  evaluating?: boolean;
}

export function ConfidenceBar({ score, evaluating = false }: ConfidenceBarProps) {
  if (evaluating || score === null) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <div className="h-[3px] w-24 animate-pulse rounded-full bg-[#ebe8e0]" />
        <span className="font-mono text-[10px] text-[#666055]">Evaluating…</span>
      </div>
    );
  }

  const fillColour =
    score >= 80 ? "bg-[#1f6b4d]" : score >= 50 ? "bg-[#8a5a1d]" : "bg-[#736d5f]";
  const textColour =
    score >= 80 ? "text-[#1f6b4d]" : score >= 50 ? "text-[#8a5a1d]" : "text-[#666055]";
  const label =
    score >= 80 ? "High confidence" : score >= 50 ? "Medium confidence" : "Low confidence";

  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="h-[3px] w-24 overflow-hidden rounded-full bg-[#ebe8e0]">
        <div
          className={`h-full rounded-full transition-all duration-500 ${fillColour}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={`font-mono text-[10px] ${textColour}`}>
        {label} · {score}%
      </span>
    </div>
  );
}
