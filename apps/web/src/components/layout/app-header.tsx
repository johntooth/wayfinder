"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { StepProgressRail } from "@/components/chat/step-progress-rail";
import { hasStepLine } from "./app-header-model";
import type { StepRailItem } from "@/lib/flow-utils";

interface AppHeaderProps {
  // Optional parent surface, rendered as "Crumb / Title".
  breadcrumb?: { label: string; href: string };
  title: ReactNode;
  // Sits immediately after the title — a status pill, a count badge.
  status?: ReactNode;
  actions?: ReactNode;
  // When supplied and non-empty, the step rail renders as the header's second
  // line. Previously this was a separate full-width band below the header,
  // which cost roughly 50px of conversation space on every chat.
  steps?: StepRailItem[];
  currentNodeId?: string | null;
  completedNodeIds?: string[];
}

export function AppHeader({
  breadcrumb,
  title,
  status,
  actions,
  steps = [],
  currentNodeId = null,
  completedNodeIds = [],
}: AppHeaderProps) {
  return (
    <header
      data-testid="app-header"
      className="flex shrink-0 flex-col gap-[10px] border-b border-[#ece8e0] bg-white px-4 py-[12px] sm:px-8 sm:py-[14px]"
    >
      <div className="flex min-w-0 items-center gap-[10px] sm:gap-[14px]">
        {/* The mobile hamburger is fixed at the viewport's top-left, so the
            first row indents past it below the rail's breakpoint. */}
        <span className="w-[34px] shrink-0 sm:hidden" aria-hidden="true" />

        {breadcrumb && (
          <>
            <Link
              href={breadcrumb.href}
              className="hidden shrink-0 text-[12.5px] text-[#736d5f] transition-colors hover:text-[#1c1b19] sm:block"
            >
              {breadcrumb.label}
            </Link>
            <span aria-hidden="true" className="hidden shrink-0 text-[#dedad2] sm:block">
              /
            </span>
          </>
        )}

        <h1 className="truncate text-[16.5px] font-semibold tracking-[-0.015em] text-[#1c1b19]">
          {title}
        </h1>

        {status && <div className="shrink-0">{status}</div>}

        {actions && <div className="ml-auto flex shrink-0 items-center gap-[8px]">{actions}</div>}
      </div>

      {hasStepLine(steps) && (
        <StepProgressRail
          variant="inline"
          steps={steps}
          currentNodeId={currentNodeId}
          completedNodeIds={completedNodeIds}
        />
      )}
    </header>
  );
}
