import type { Config } from "drizzle-kit";

/**
 * `drizzle-kit generate` config for the committed Postgres instance-ownership
 * migration (RFC 037 D8).
 */
export default {
	dialect: "postgresql",
	schema: "packages/auth-service/src/schema/meta-schema.ts",
	out: "deploy/vps/migrations/meta",
	tablesFilter: ["instance_owner"],
} satisfies Config;
