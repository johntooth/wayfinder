-- Both constraints were created under a name longer than Postgres's 63-character
-- identifier limit, so the database holds a truncated name that never matches the
-- one drizzle-kit recorded — and every `drizzle-kit push` dropped and re-created
-- them. Renaming in place keeps referential integrity throughout and skips the
-- full-table revalidation a drop/add would cost.
--
-- Guarded on the truncated name so this is a no-op on a database that already
-- carries the short one.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'app_session_approvals'::regclass
      AND conname = 'app_session_approvals_suggested_approver_user_id_core_users_id_'
  ) THEN
    ALTER TABLE "app_session_approvals"
      RENAME CONSTRAINT "app_session_approvals_suggested_approver_user_id_core_users_id_"
      TO "app_session_approvals_suggested_approver_user_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'app_session_schedule_runs'::regclass
      AND conname = 'app_session_schedule_runs_schedule_id_app_session_schedules_id_'
  ) THEN
    ALTER TABLE "app_session_schedule_runs"
      RENAME CONSTRAINT "app_session_schedule_runs_schedule_id_app_session_schedules_id_"
      TO "app_session_schedule_runs_schedule_id_fk";
  END IF;
END $$;
