"use client";

import type { ReactNode } from "react";
import type { FlowNode } from "@rbrasier/domain";

type StepState = "pending" | "current" | "complete";

interface StepProgressRailProps {
  nodes: FlowNode[];
  currentNodeId: string | null;
  completedNodeIds: string[];
  rightSlot?: ReactNode;
}

const badgeClass: Record<StepState, string> = {
  complete: "bg-[#2e9e6a] text-white",
  current:  "bg-[#3a5fd9] text-white",
  pending:  "bg-[#e6e3dc] text-[#918d87]",
};

const labelClass: Record<StepState, string> = {
  complete: "text-[#2e9e6a]",
  current:  "font-semibold text-[#3a5fd9]",
  pending:  "text-[#918d87]",
};

const getState = (
  nodeId: string,
  currentNodeId: string | null,
  completedNodeIds: string[],
): StepState => {
  if (completedNodeIds.includes(nodeId)) return "complete";
  if (nodeId === currentNodeId) return "current";
  return "pending";
};

export function StepProgressRail({ nodes, currentNodeId, completedNodeIds, rightSlot }: StepProgressRailProps) {
  if (nodes.length === 0 && !rightSlot) return null;

  return (
    <div className="flex shrink-0 items-center gap-3 overflow-x-auto border-b border-[#dedad2] bg-white px-4 py-[10px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max flex-1 items-center gap-0">
        {nodes.map((node, index) => {
          const state = getState(node.id, currentNodeId, completedNodeIds);
          return (
            <div key={node.id} className="flex items-center">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`flex h-[22px] w-[22px] items-center justify-center rounded-full text-[10px] font-bold ${badgeClass[state]}`}
                >
                  {state === "complete" ? "✓" : index + 1}
                </div>
                <span
                  className={`max-w-[80px] truncate text-center text-[12px] font-medium ${labelClass[state]}`}
                  title={node.name}
                >
                  {node.name}
                </span>
              </div>
              {index < nodes.length - 1 && (
                <div
                  className={`mx-1 h-px w-6 ${
                    completedNodeIds.includes(node.id) ? "bg-[#2e9e6a]/70" : "bg-[#dedad2]"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
      {rightSlot && <div className="ml-auto shrink-0">{rightSlot}</div>}
    </div>
  );
}
