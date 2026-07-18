// Complete SQLite drizzle schema for committed-migration GENERATION only
// (RFC 036 D5) — consumed by deploy/vps/migrate/drizzle.entities.sqlite.config.ts
// and the drift guard (npm-scripts/check-vps-migrations.mjs), never at runtime.
//
// The SQLite twin of schema-full.ts: the sqlite-dialect entity package
// wholesale (`sqliteTable`/`text(json)`/`integer`) plus the raw sqlite outbox
// infra table. Kept separate from the runtime facade (../schema/active-entities)
// because drizzle-kit's `generate --dialect sqlite` needs the real sqlite table
// objects, not the pg-cast the repos consume.
export * from "@remit/drizzle-sqlite-schema";
export { sqliteOutboxTable as outboxTable } from "./schema/outbox.js";
