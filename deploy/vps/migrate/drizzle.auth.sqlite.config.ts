import type { Config } from "drizzle-kit";

/**
 * `drizzle-kit generate` config for the committed SQLite better-auth identity
 * migrations (RFC 036 D5). The SQLite twin of drizzle.auth.config.ts.
 */
export default {
	dialect: "sqlite",
	schema: "packages/auth-service/src/schema/auth-schema-sqlite.ts",
	out: "deploy/vps/migrations-sqlite/auth",
	tablesFilter: [
		"auth_user",
		"auth_session",
		"auth_account",
		"auth_verification",
		"auth_jwks",
	],
} satisfies Config;
