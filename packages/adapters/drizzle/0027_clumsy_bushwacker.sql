-- data-impact: preserved — existing budgets keep their rows: scope defaults to 'user' and
-- scope_ref is generated from user_id, so (period, scope_ref) cannot collide while
-- app_usage_budgets_user_id_period_unique already holds one row per user and period.
DROP INDEX "app_usage_budgets_user_id_period_unique";--> statement-breakpoint
ALTER TABLE "app_usage_budgets" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app_usage_budgets" ADD COLUMN "scope" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_usage_budgets" ADD COLUMN "role_key" text;--> statement-breakpoint
ALTER TABLE "app_usage_budgets" ADD COLUMN "scope_ref" text GENERATED ALWAYS AS (COALESCE("user_id"::text, "role_key", 'everyone')) STORED;--> statement-breakpoint
CREATE UNIQUE INDEX "app_usage_budgets_period_scope_ref_unique" ON "app_usage_budgets" USING btree ("period","scope_ref");