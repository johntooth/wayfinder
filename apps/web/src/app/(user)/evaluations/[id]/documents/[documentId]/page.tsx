import { notFound } from "next/navigation";
import { createServerTrpcContext } from "@/server/server-context";
import { EvaluationDocumentContent } from "./_content";

// The document view every review row's source deep-link points at (redline
// delivery-plan item 1). review-view.ts builds
// /evaluations/:id/documents/:documentId?element=…&page=…&chunk=…; this is the
// route that serves it, beside review / pivots / grouping under [id].
//
// Gated here as well as in the router, on the same `evaluation:review` key with
// the same admin-wildcard rule permissionProcedure applies, matching the
// /evaluations index: a caller without the permission gets a 404, not a shell
// that then fails to load its data.
export default async function EvaluationDocumentPage({
  params,
}: {
  params: Promise<{ id: string; documentId: string }>;
}) {
  const { isAdmin, permissions } = await createServerTrpcContext();
  if (!isAdmin && !permissions.has("evaluation:review")) notFound();

  const { id, documentId } = await params;
  return <EvaluationDocumentContent evaluationId={id} documentId={documentId} />;
}
