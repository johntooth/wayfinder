import type { Approval, IApprovalRepository, Result } from "@rbrasier/domain";

export interface ListPendingApprovalsInput {
  approverUserId: string;
  approverEmail: string | null;
}

export class ListPendingApprovals {
  constructor(private readonly approvals: IApprovalRepository) {}

  async execute(input: ListPendingApprovalsInput): Promise<Result<Approval[]>> {
    return this.approvals.listPendingForApprover(input);
  }
}
