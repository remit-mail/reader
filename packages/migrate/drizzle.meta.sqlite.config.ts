import type { Config } from "drizzle-kit";

/**
 * `drizzle-kit generate` config for the committed SQLite instance-ownership
 * migration (RFC 037 D8). The SQLite twin of drizzle.meta.config.ts (pg-parity).
 */
export default {
	dialect: "sqlite",
	schema: "packages/auth-service/src/schema/meta-schema-sqlite.ts",
	out: "deploy/vps/migrations-sqlite/meta",
	tablesFilter: ["instance_owner"],
} satisfies Config;
