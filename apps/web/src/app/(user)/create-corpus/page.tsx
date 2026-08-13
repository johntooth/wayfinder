import { notFound } from "next/navigation";
import { createServerTrpcContext } from "@/server/server-context";
import { CreateCorpusContent } from "./_content";

// The standalone Create Corpus tab (redline delivery-plan §2 item 1, fork
// mount). Deliberately NOT a change to /evaluations/new: ingest and evaluation
// are different users, so the existing create flow's "corpus already staged"
// assumption stays untouched. This surface picks a staged corpus, authors the
// allow-listed run config, and fires ingest → lens → grouping → build.
//
// Gated here as well as in the procedures, on evaluation:create with the same
// admin-wildcard rule permissionProcedure applies — a reviewer who can open a
// tender's grid cannot start one, and the sidebar entry is hidden by the same
// rule, so the surface is invisible from both directions.
export default async function CreateCorpusPage() {
  const { isAdmin, permissions } = await createServerTrpcContext();
  if (!isAdmin && !permissions.has("evaluation:create")) notFound();

  return <CreateCorpusContent />;
}
