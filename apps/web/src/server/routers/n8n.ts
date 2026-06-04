import { adminProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

export const n8nRouter = router({
  // The workflow directory feeding the auto-node config dropdown. Admin-only
  // because flow authoring is an admin surface and the call hits the configured
  // n8n instance with its API key.
  listWorkflows: adminProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.services.n8nWorkflowDirectory.listWorkflows();
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),
});
