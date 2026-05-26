export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <span
        className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#918d87]"
        style={{ animationDelay: "0ms" }}
      />
      <span
        className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#918d87]"
        style={{ animationDelay: "150ms" }}
      />
      <span
        className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#918d87]"
        style={{ animationDelay: "300ms" }}
      />
    </div>
  );
}
