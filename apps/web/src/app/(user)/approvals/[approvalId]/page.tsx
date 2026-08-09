import { createServerHelpers } from "@/trpc/server";
import { ApprovalDetailContent } from "./_content";

export default async function ApprovalDetailPage({
  params,
}: {
  params: Promise<{ approvalId: string }>;
}) {
  const { approvalId } = await params;
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.approval.get.prefetch({ approvalId });
  return (
    <HydrateClient>
      <ApprovalDetailContent approvalId={approvalId} />
    </HydrateClient>
  );
}
