import {
  NotifyOnApprovalDecided,
  NotifyOnApprovalRequested,
  NotifyOnApprovalWithdrawn,
  type NotificationConfig,
} from "@rbrasier/application";
import type {
  IAuditLogger,
  IEmailSender,
  IFlowRepository,
  INotificationLogRepository,
  IUserRepository,
} from "@rbrasier/domain";

export interface ApprovalNotifierDeps {
  notificationLog: INotificationLogRepository;
  emailSender: IEmailSender;
  users: IUserRepository;
  flows: IFlowRepository;
  auditLogger: IAuditLogger;
  notificationConfig: NotificationConfig;
}

// The three approval-lifecycle notifiers, factored out of the main container to
// keep container.ts under the source-size ceiling. All three take the same
// dependencies in the same order, so building them together is also the one
// place a change to that shape has to be made.
export const buildApprovalNotifiers = (deps: ApprovalNotifierDeps) => {
  const parts = [
    deps.notificationLog,
    deps.emailSender,
    deps.users,
    deps.flows,
    deps.auditLogger,
    deps.notificationConfig,
  ] as const;

  return {
    notifyOnApprovalRequested: new NotifyOnApprovalRequested(...parts),
    notifyOnApprovalDecided: new NotifyOnApprovalDecided(...parts),
    notifyOnApprovalWithdrawn: new NotifyOnApprovalWithdrawn(...parts),
  };
};
