"use client";

interface ConfidenceBarProps {
  score: number | null;
  evaluating?: boolean;
}

export function ConfidenceBar({ score, evaluating = false }: ConfidenceBarProps) {
  if (evaluating || score === null) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <div className="h-[3px] w-24 animate-pulse rounded-full bg-[#e6e3dc]" />
        <span className="font-mono text-[10px] text-[#918d87]">Evaluating…</span>
      </div>
    );
  }

  const fillColour =
    score >= 80 ? "bg-[#2e9e6a]" : score >= 50 ? "bg-[#c17a1a]" : "bg-[#918d87]";
  const textColour =
    score >= 80 ? "text-[#2e9e6a]" : score >= 50 ? "text-[#c17a1a]" : "text-[#918d87]";
  const label =
    score >= 80 ? "High confidence" : score >= 50 ? "Medium confidence" : "Low confidence";

  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="h-[3px] w-24 overflow-hidden rounded-full bg-[#e6e3dc]">
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
