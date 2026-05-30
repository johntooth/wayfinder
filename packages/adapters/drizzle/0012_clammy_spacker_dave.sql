ALTER TABLE "app_sessions" ADD COLUMN "pending_executions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
INSERT INTO "core_feature_flag" ("key", "enabled", "rollout_pct", "description")
VALUES (
  'auto_node',
  false,
  100,
  'Auto node type + n8n sub-workflow execution. Disabled by default; an admin can enable it to use and test auto nodes before the feature is fully released.'
)
ON CONFLICT ("key") DO NOTHING;
