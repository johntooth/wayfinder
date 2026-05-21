"use client";

import { useRef, useEffect } from "react";
import { ArrowUp } from "lucide-react";

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  readOnly?: boolean;
}

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  readOnly = false,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) onSubmit();
    }
  };

  if (readOnly) {
    return (
      <div className="shrink-0 border-t border-[#dedad2] bg-[#f7f6f3] px-5 py-3 text-center text-[13px] text-[#918d87]">
        This is a shared session — view only.
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-[#dedad2] bg-white px-4 py-3">
      <div className="flex items-end gap-[10px]">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Message Wayfinder…"
          className="flex-1 resize-none rounded-[9px] border-[1.5px] border-[#dedad2] bg-[#f7f6f3] px-[14px] py-[10px] text-[13px] leading-[1.45] text-[#1a1814] outline-none placeholder:text-[#918d87] focus:border-[#c5d0f7] focus:bg-white disabled:cursor-not-allowed"
          style={{ minHeight: "40px", maxHeight: "120px", overflowY: "auto" }}
        />
        <button
          type="button"
          aria-label="Send message"
          onClick={onSubmit}
          disabled={!value.trim() || disabled}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[#3a5fd9] text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-[6px] text-center text-[11px] text-[#918d87]">
        Wayfinder works agentically — it asks follow-up questions and signals when each step is complete.
      </p>
    </div>
  );
}
