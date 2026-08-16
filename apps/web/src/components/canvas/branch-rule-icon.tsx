// The one drawing of the branch-rule indicator, used both on the connector
// badge and inside the advisory copy. The advisory tells the author to look for
// this mark on the canvas, so the two must be the same shape — a warning that
// describes an icon the canvas does not show is worse than no warning.
export function BranchRuleIcon({
  state,
  className = "",
}: {
  state: "missing" | "set";
  className?: string;
}) {
  if (state === "set") {
    return (
      <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
        <circle cx={8} cy={8} r={7} fill="#e8f3ea" stroke="#3f8f52" strokeWidth={1.5} />
        <path
          d="M4.8 8.3 L7 10.4 L11.2 5.9"
          fill="none"
          stroke="#2f6b3e"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      <path
        d="M8 1.6 L15 14.2 L1 14.2 Z"
        fill="#fff8e1"
        stroke="#e7c200"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <path d="M8 6 V9.4" stroke="#886b00" strokeWidth={1.7} strokeLinecap="round" />
      <circle cx={8} cy={11.7} r={0.95} fill="#886b00" />
    </svg>
  );
}
