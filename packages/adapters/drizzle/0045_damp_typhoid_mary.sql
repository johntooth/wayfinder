-- data-impact: preserved — additive nullable column; existing rows keep a NULL schema_request and are read unchanged.
ALTER TABLE "app_session_messages" ADD COLUMN "schema_request" jsonb;
