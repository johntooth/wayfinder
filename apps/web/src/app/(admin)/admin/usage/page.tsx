import { createServerHelpers } from "@/trpc/server";
import { AdminUsageContent } from "./_content";

export default async function AdminUsagePage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.usage.summary.prefetch(undefined);
  void trpc.governance.budgets.list.prefetch();
  void trpc.user.list.prefetch({});
  return (
    <HydrateClient>
      <AdminUsageContent />
    </HydrateClient>
  );
}
