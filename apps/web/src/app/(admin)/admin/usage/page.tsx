import { createServerHelpers } from "@/trpc/server";
import { AdminUsageContent } from "./_content";

export default async function AdminUsagePage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.usage.summary.prefetch(undefined);
  return (
    <HydrateClient>
      <AdminUsageContent />
    </HydrateClient>
  );
}
