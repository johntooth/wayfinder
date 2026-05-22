import { createServerHelpers } from "@/trpc/server";
import { AdminSessionsContent } from "./_content";

export default async function AdminSessionsPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.session.listAll.prefetch();
  return (
    <HydrateClient>
      <AdminSessionsContent />
    </HydrateClient>
  );
}
