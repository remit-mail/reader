import type { Config } from "drizzle-kit";

/**
 * `drizzle-kit generate` config for the app database's committed migrations
 * (#1420): the app entity tables, the better-auth identity tables and the
 * instance-owner singleton.
 */
export default {
	dialect: "sqlite",
	schema: [
		"packages/drizzle-service/src/schema-sets/app.ts",
		"packages/auth-service/src/schema/auth-schema-sqlite.ts",
		"packages/auth-service/src/schema/meta-schema-sqlite.ts",
	],
	out: "deploy/vps/migrations-sqlite/app",
} satisfies Config;
