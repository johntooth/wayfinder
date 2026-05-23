import { createServerHelpers } from "@/trpc/server";
import { AdminErrorsContent } from "./_content";

export default async function AdminErrorsPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.error.listGrouped.prefetch({});
  return (
    <HydrateClient>
      <AdminErrorsContent />
    </HydrateClient>
  );
}
