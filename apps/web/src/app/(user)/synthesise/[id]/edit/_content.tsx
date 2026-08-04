"use client";

import { EmptyState } from "@/components/empty-state";
import { EditorCards } from "@/components/extraction/editor-cards";
import { schemaSeedKey } from "@/components/extraction/extraction-editor-model";
import { trpc } from "@/trpc/client";

export function EditSynthesisContent({ flowId }: { flowId: string }) {
  const schemaQuery = trpc.extraction.getSchema.useQuery({ flowId });

  if (schemaQuery.error) {
    return (
      <div className="mx-auto max-w-[900px] px-5 py-7">
        <EmptyState heading="Cannot open this synthesis" body={schemaQuery.error.message} />
      </div>
    );
  }

  const schema = schemaQuery.data ?? null;

  return (
    <EditorCards
      // The editor seeds its form state from the schema at mount, so it must be
      // remounted once the query settles — mounted against a pending null it
      // stays on the empty defaults and the next Save overwrites the saved
      // schema with them.
      key={schemaSeedKey(schema, schemaQuery.isPending)}
      flowId={flowId}
      initialSchema={schema}
      isLoading={schemaQuery.isPending}
    />
  );
}
