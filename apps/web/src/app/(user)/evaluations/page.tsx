import { notFound } from "next/navigation";
import { createServerTrpcContext } from "@/server/server-context";
import { EvaluationsIndexContent } from "./_content";

// The evaluations index (delivery-plan item 2) — the way in to redline. Without
// it a tester needs both the URL shape and an evaluation id handed to them out
// of band.
//
// Gated here as well as in the router, on the same `evaluation:review` key with
// the same admin-wildcard rule permissionProcedure applies: a user without the
// permission gets a 404, not an empty screen listing nothing. The sidebar entry
// pointing here is hidden by that same rule, so the surface is invisible to them
// from both directions.
export default async function EvaluationsIndexPage() {
  const { isAdmin, permissions } = await createServerTrpcContext();
  if (!isAdmin && !permissions.has("evaluation:review")) notFound();

  return <EvaluationsIndexContent />;
}
