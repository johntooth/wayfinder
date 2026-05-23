import { createServerHelpers } from "@/trpc/server";
import { UserFlowsContent } from "./_content";

export default async function UserFlowsPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.flow.listMine.prefetch();
  return (
    <HydrateClient>
      <UserFlowsContent />
    </HydrateClient>
  );
}
