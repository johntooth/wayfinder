-- data-impact: destructive, approved — core_audit_log is append-only, so updated_at only ever
-- equalled created_at and nothing read it (ADR-033). The column's values are not recoverable
-- and are not worth recovering.
ALTER TABLE "core_audit_log" DROP COLUMN "updated_at";