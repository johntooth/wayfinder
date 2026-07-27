// A deliberately narrow entry point for work that runs on the application's boot
// path, before it has served a request.
//
// Importing the package barrel pulls in OpenTelemetry, MinIO, the AI SDKs and
// LangGraph — thousands of modules the dev server then holds in memory from
// startup, enough to push `next dev` over its heap threshold and trigger a
// self-restart. Everything re-exported here is what the first-run setup-link
// emitter needs, and nothing more.
export { createDatabase, type Database } from "./db/client";
export { DrizzleAdminLookup } from "./auth/admin-lookup";
export { DrizzleSystemSettingsRepository } from "./repositories/drizzle-system-settings-repository";
export { EncryptedSystemSettingsRepository } from "./repositories/encrypted-system-settings-repository";
export { SettingsEncryptionService, createSettingsEncryptionKey } from "./config/settings-encryption";
