import type { Config } from "drizzle-kit";

/**
 * `drizzle-kit generate` config for the tenant mail database's committed
 * migrations (#1420).
 */
export default {
	dialect: "sqlite",
	schema: ["packages/drizzle-service/src/schema-sets/mail.ts"],
	out: "deploy/vps/migrations-sqlite/mail",
} satisfies Config;
