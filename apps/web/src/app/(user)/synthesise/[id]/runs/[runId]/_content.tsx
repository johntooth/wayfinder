"use client";

import { RunResults } from "@/components/extraction/run-results";

// RunResults owns the header bar as well as the body, because the header's
// downloads and document generation are the run's own mutations.
export function RunScreenContent({ flowId, runId }: { flowId: string; runId: string }) {
  return <RunResults flowId={flowId} runId={runId} />;
}
