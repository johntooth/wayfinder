import { createServerHelpers } from "@/trpc/server";
import { AdminFlowContent } from "./_content";

export default async function AdminFlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.flow.getCanvas.prefetch({ flowId: id });
  return (
    <HydrateClient>
      <AdminFlowContent flowId={id} />
    </HydrateClient>
  );
}
