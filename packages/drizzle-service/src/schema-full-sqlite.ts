// Complete SQLite drizzle schema for committed-migration GENERATION only
// (RFC 036 D5) — consumed by packages/migrate/drizzle.entities.sqlite.config.ts
// and the drift guard (npm-scripts/check-vps-migrations.mjs), never at runtime.
//
// It pulls the generated entity package in wholesale, so a new TypeSpec entity
// flows into the committed migration with nothing to hand-maintain. The only
// addition is the `outbox` infra table, which has no entity.
//
// schema.ts stays the app/dev surface (single `*Table` alias per table, what
// the repos and `pushSchema` need); this file exposes canonical names, so it
// must not be fed to `pushSchema` alongside schema.ts (duplicate index names).
export * from "@remit/drizzle-sqlite-schema";
export { outboxTable } from "./schema/outbox.js";
