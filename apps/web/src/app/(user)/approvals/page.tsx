import { createServerHelpers } from "@/trpc/server";
import { ApprovalsContent } from "./_content";

export default async function ApprovalsPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  // The Active tab is what opens, so it is what is prefetched. The history tabs
  // fetch on demand: they are read far less often and cost a wider query.
  void trpc.approval.list.prefetch({ scope: "pending" });
  return (
    <HydrateClient>
      <ApprovalsContent />
    </HydrateClient>
  );
}
