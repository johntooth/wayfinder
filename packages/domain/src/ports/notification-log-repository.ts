import type {
  NewNotificationLog,
  NotificationLog,
  NotificationTrigger,
} from "../entities/notification-log";
import type { Result } from "../result";

export interface INotificationLogRepository {
  // Inserts a `pending` outbox row. Returns null when a row already exists for
  // the same (trigger, resourceId, recipientEmail) — the unique index makes
  // enqueueing idempotent even under concurrent triggers.
  enqueue(input: NewNotificationLog): Promise<Result<NotificationLog | null>>;
  // Both mark* methods increment `attempts` so retries stay observable.
  markSent(id: string): Promise<Result<NotificationLog>>;
  markFailed(id: string, error: string): Promise<Result<NotificationLog>>;
  // Oldest-first `pending` rows — the retry sweeper's work queue.
  listPending(limit: number): Promise<Result<NotificationLog[]>>;
  existsFor(
    trigger: NotificationTrigger,
    resourceId: string,
    recipientEmail: string,
  ): Promise<Result<boolean>>;
}
