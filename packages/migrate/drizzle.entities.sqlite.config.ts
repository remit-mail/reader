import type { Config } from "drizzle-kit";

/**
 * `drizzle-kit generate` config for the committed SQLite entity migrations
 * consumed by the VPS/self-host `migrate` service when `DATA_BACKEND=sqlite`
 * (RFC 036 D5). The SQLite twin of drizzle.entities.config.ts: same entity
 * source, sqlite dialect, sqlite output.
 */
export default {
	dialect: "sqlite",
	// schema-full-sqlite.ts (not schema.ts) so the migration is generated from
	// the sqlite entity package wholesale — a new entity cannot silently miss
	// the committed migration. See that file's header.
	schema: "packages/drizzle-service/src/schema-full-sqlite.ts",
	out: "deploy/vps/migrations-sqlite/entities",
	// The better-auth identity tables are generated (and migrated) separately.
	tablesFilter: ["!auth_*"],
} satisfies Config;
