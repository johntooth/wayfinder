import { notFound } from "next/navigation";
import { createServerTrpcContext } from "@/server/server-context";
import { CreateEvaluationContent } from "./_content";

// Starting an evaluation from the browser. Gated here as well as in the
// procedure, on evaluation:create — a reviewer may open a tender's grid without
// being able to start one, and the index only offers the link on the same rule,
// so the surface is consistent from both directions.
export default async function CreateEvaluationPage() {
  const { isAdmin, permissions } = await createServerTrpcContext();
  if (!isAdmin && !permissions.has("evaluation:create")) notFound();

  return <CreateEvaluationContent />;
}
