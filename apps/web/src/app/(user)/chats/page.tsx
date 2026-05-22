import { createServerHelpers } from "@/trpc/server";
import { ChatsContent } from "./_content";

export default async function ChatsPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.session.list.prefetch();
  return (
    <HydrateClient>
      <ChatsContent />
    </HydrateClient>
  );
}
