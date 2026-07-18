// Complete Postgres drizzle schema for committed-migration GENERATION only —
// consumed by deploy/vps/migrate/drizzle.entities.config.ts and the drift guard
// (npm-scripts/check-vps-migrations.mjs), never by `pushSchema`.
//
// It pulls the generated entity package in wholesale, so a new TypeSpec entity
// flows into the committed migration with nothing to hand-maintain — the
// omission that let eight tables drift out of the deployed schema. The only
// addition is the `outbox` infra table, which has no entity. This file imports
// the raw pg outbox directly (not the dialect-selected `outboxTable`), so
// migration generation never depends on the runtime `DATA_BACKEND`.
//
// schema.ts stays the app/dev surface (single `*Table` alias per table, what
// the repos and `pushSchema` need); this file exposes canonical names, so it
// must not be fed to `pushSchema` alongside schema.ts (duplicate index names).
export * from "@remit/drizzle-pg-schema";
export { pgOutboxTable as outboxTable } from "./schema/outbox.js";
