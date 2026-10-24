import type { Config } from "drizzle-kit";

/**
 * `drizzle-kit generate --custom` config for the tenant search database's
 * committed migrations (#1420). The set is custom SQL only: its one table is
 * an FTS5 virtual table drizzle-kit cannot generate.
 */
export default {
	dialect: "sqlite",
	schema: ["packages/drizzle-service/src/schema-sets/search.ts"],
	out: "deploy/vps/migrations-sqlite/search",
} satisfies Config;
