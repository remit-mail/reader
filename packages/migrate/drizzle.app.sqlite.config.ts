import type { Config } from "drizzle-kit";

/**
 * `drizzle-kit generate` config for the app database's committed migrations
 * (#1420): the app entity tables and the better-auth identity tables.
 */
export default {
	dialect: "sqlite",
	schema: [
		"packages/drizzle-service/src/schema-sets/app.ts",
		"packages/auth-service/src/schema/auth-schema-sqlite.ts",
	],
	out: "deploy/vps/migrations-sqlite/app",
} satisfies Config;
