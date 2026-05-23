import { createServerHelpers } from "@/trpc/server";
import { ChatSessionContent } from "./_content";

export default async function ChatSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.session.get.prefetch({ sessionId });
  return (
    <HydrateClient>
      <ChatSessionContent sessionId={sessionId} />
    </HydrateClient>
  );
}
