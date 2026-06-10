CREATE TABLE "app_notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_email" text NOT NULL,
	"recipient_user_id" uuid,
	"trigger" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_notification_log_trigger_resource_recipient_unique" UNIQUE("trigger","resource_id","recipient_email")
);
--> statement-breakpoint
ALTER TABLE "app_notification_log" ADD CONSTRAINT "app_notification_log_recipient_user_id_core_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."core_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_notification_log_status_created_at_idx" ON "app_notification_log" USING btree ("status","created_at");